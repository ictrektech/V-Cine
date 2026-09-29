package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"go.uber.org/zap"
)

// ==================== 内嵌封面（attached_pic）兜底图生成 ====================
//
// 优先级高于抽帧：内嵌封面是发布方附带的封面（作者意图），抽帧只是机器猜测。
//
// 探测依据是 ffprobe 的 disposition.attached_pic 标记，它同时覆盖两类常见形态：
//   - MP4/M4V/MOV：封面是一路 mjpeg 视频流；
//   - MKV（ffmpeg -attach 写入的封面）：同样表现为 attached_pic=1 的视频流。
//
// 已知未覆盖：mkvtoolnix 写入的 codec_type=attachment 附件式封面。那类需要
// -dump_attachment 落盘后再二次转码，链路更长；如确有需求再补。
//
// 与抽帧来源的差异：内嵌封面不做画质阈值筛选（黑帧/细节不足照收）——它是作者提供的
// 封面，信任度高于机器抽帧，只校验能否解码。

// artworkEmbeddedProbeTimeout ffprobe 探测内嵌封面的超时
const artworkEmbeddedProbeTimeout = 20 * time.Second

// EmbeddedArtworkGenerator 从视频内嵌封面提取海报兜底图。
type EmbeddedArtworkGenerator struct {
	cfg    *config.Config
	logger *zap.SugaredLogger
}

func NewEmbeddedArtworkGenerator(cfg *config.Config, logger *zap.SugaredLogger) *EmbeddedArtworkGenerator {
	return &EmbeddedArtworkGenerator{cfg: cfg, logger: logger}
}

// Source 本生成器产出的来源
func (g *EmbeddedArtworkGenerator) Source() ArtworkSource { return ArtworkSourceEmbedded }

// Generate 提取内嵌封面并落盘到 dst。
// generated=false 表示无需处理（产物已存在 / 无内嵌封面 / 该媒体不适用）。
func (g *EmbeddedArtworkGenerator) Generate(ctx context.Context, media *model.Media, dst string) (bool, error) {
	if g == nil || g.cfg == nil || media == nil || dst == "" {
		return false, nil
	}
	// 幂等：产物已存在即无需重做
	if _, err := os.Stat(dst); err == nil {
		return false, nil
	}

	input, ok := resolveArtworkInput(g.cfg, media)
	if !ok {
		return false, nil
	}

	index, found, err := g.findAttachedPic(ctx, input)
	if err != nil {
		return false, err
	}
	if !found {
		g.logger.Debugw("无内嵌封面，交由下一来源", "media", media.ID)
		return false, nil
	}

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return false, fmt.Errorf("创建派生图目录失败: %w", err)
	}

	// 先写临时文件，解码校验通过才 rename：内嵌流可能损坏，
	// 避免半截文件被解析侧探测到。
	// 临时名保留 .jpg 扩展名——ffmpeg 依赖扩展名推断输出格式，
	// 用 ".tmp" 结尾会报 Unable to find a suitable output format。
	tmp := dst + ".tmp.jpg"
	// 失败路径统一清理临时文件；成功 rename 后 tmp 已不存在，删除即空操作。
	defer func() { _ = os.Remove(tmp) }()

	// 内嵌封面本身就是竖版封面，走与抽帧相同的后处理（2:3 裁剪对 2:3 的封面是空操作）
	req := artworkExtractRequest{
		input:   input,
		mapArgs: []string{"-map", fmt.Sprintf("0:%d", index)},
		out:     tmp,
	}
	if err := extractArtworkImage(ctx, g.cfg, req); err != nil {
		return false, err
	}
	if !isDecodableJPEG(tmp) {
		g.logger.Warnw("内嵌封面无法解码，已丢弃", "media", media.ID, "path", media.FilePath)
		return false, nil
	}
	if err := os.Rename(tmp, dst); err != nil {
		return false, fmt.Errorf("内嵌封面落盘失败: %w", err)
	}

	g.logger.Infow("已提取内嵌封面作为兜底海报", "media", media.ID, "path", dst)
	return true, nil
}

// findAttachedPic 探测内嵌封面流，返回其流索引。
func (g *EmbeddedArtworkGenerator) findAttachedPic(ctx context.Context, input string) (int, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, artworkEmbeddedProbeTimeout)
	defer cancel()

	args := []string{"-v", "error", "-hide_banner", "-show_streams", "-of", "json"}
	// HTTP 输入时注入重连与超时参数（本地文件返回空切片）
	args = append(args, BuildFFmpegInputArgs(input)...)
	args = append(args, "-i", input)

	cmd := exec.CommandContext(ctx, g.cfg.App.FFprobePath, args...)
	setLowPriority(cmd)
	output, err := cmd.Output()
	if err != nil {
		return 0, false, fmt.Errorf("ffprobe 探测内嵌封面失败: %w", err)
	}

	index, found := pickAttachedPicIndex(output)
	return index, found, nil
}

// ffprobeStreams ffprobe -show_streams -of json 的输出结构（仅取需要的字段）
type ffprobeStreams struct {
	Streams []struct {
		Index       int    `json:"index"`
		CodecType   string `json:"codec_type"`
		Disposition struct {
			AttachedPic int `json:"attached_pic"`
		} `json:"disposition"`
	} `json:"streams"`
}

// pickAttachedPicIndex 从 ffprobe 输出中找出内嵌封面的流索引。
// 判定条件：视频流且 disposition.attached_pic == 1（MP4 封面与 ffmpeg -attach 的 MKV 封面都是这个形态）。
//
// 解析失败按"无内嵌封面"处理（返回 false 而非 error）：调用方对此的处置就是退化到下一个来源（抽帧）。
func pickAttachedPicIndex(data []byte) (int, bool) {
	var out ffprobeStreams
	if err := json.Unmarshal(data, &out); err != nil {
		return 0, false
	}
	for _, s := range out.Streams {
		if s.CodecType == "video" && s.Disposition.AttachedPic == 1 {
			return s.Index, true
		}
	}
	return 0, false
}
