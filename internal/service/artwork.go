package service

import (
	"context"
	"fmt"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
)

// ==================== 派生 Artwork（海报兜底图）====================
//
// 本包的约定：
//   - 刮削/手工来源的海报写在 media.PosterPath（DB 指针）；派生图**不写指针**。
//     否则 metadata.go 的 "PosterPath == \"\" → partial" 判定会把兜底图当成真海报，
//     ListNeedScrape 不再重试，真海报永远补不回来。
//   - 派生图落 cache/images/{id}/，媒体删除时随 MediaCacheCleaner 一并回收。
//   - 解析侧只做 stat 探测（不生成、不解码），可安全放在 GetPosterPath 热路径上；
//     生成由后台任务负责，幂等语义为"目标文件存在即跳过"。
//   - 派生图仅通过本服务对外可见（原生 /poster 端点与 Emby 兼容层共用 GetPosterPath），
//     不写用户媒体目录，因此 Kodi 等直读本地文件的客户端不会看到它。

// ArtworkSource 兜底图的派生来源，同时也是接口对外暴露的 poster_origin 取值（空串 = 非派生）。
type ArtworkSource string

const (
	// ArtworkSourceEmbedded 视频内嵌封面（attached_pic），属作者意图，优先级高于抽帧
	ArtworkSourceEmbedded ArtworkSource = "embedded"
	// ArtworkSourceFrame 视频抽帧，属机器推测
	ArtworkSourceFrame ArtworkSource = "frame"
)

// artworkExtractTimeout 单帧抽取（抽帧 / 内嵌封面提取）的最长耗时（远程源 seek 较慢，给足余量）
const artworkExtractTimeout = 30 * time.Second

// derivedArtworkPath 派生图落盘路径：cache/images/{mediaID}/poster-{source}.jpg。
// 唯一的分拼路径入口——生成侧与解析侧都必须走它，避免两处路径规则漂移。
// JPEG 与既有产物（preprocess / ai_scene 抽帧、雪碧图）一致，且被 image_validate.go
// 的内容嗅探与 Emby handler 的 Content-Type 映射覆盖。
func derivedArtworkPath(cacheDir, mediaID string, src ArtworkSource) string {
	return filepath.Join(cacheDir, "images", mediaID, "poster-"+string(src)+".jpg")
}

// resolveDerivedArtwork 按注册表优先级探测已生成的派生图，返回命中路径与其来源
// （均未命中返回空串与空来源）。只做 stat，不读文件内容、不解码：
// 内容校验由生成侧在落盘后完成（见 image_validate.go）。
func resolveDerivedArtwork(cacheDir, mediaID string) (string, ArtworkSource) {
	if cacheDir == "" || mediaID == "" {
		return "", ""
	}
	for _, spec := range artworkSourceRegistry {
		path := derivedArtworkPath(cacheDir, mediaID, spec.Source)
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return path, spec.Source
		}
	}
	return "", ""
}

// resolveDerivedPoster 派生图路径（来源见 resolveDerivedArtwork）。
func resolveDerivedPoster(cacheDir, mediaID string) string {
	path, _ := resolveDerivedArtwork(cacheDir, mediaID)
	return path
}

// ArtworkGenerator 兜底海报生成器。
// 优先级与启用开关都在 artworkSourceRegistry 里声明，接口只描述"怎么生成"。
// 新增来源 = 实现本接口 + 在注册表登记。
type ArtworkGenerator interface {
	// Source 本生成器产出的来源，决定落盘文件名与解析侧的优先级
	Source() ArtworkSource
	// Generate 生成并落盘到 dst。
	// generated=false 表示"该来源不适用或无需求"（非错误，调用方继续尝试下一来源）；
	// err 表示本轮失败，可重试。
	Generate(ctx context.Context, media *model.Media, dst string) (bool, error)
}

// resolveArtworkInput 判断媒体是否可用于 FFmpeg 探测/抽帧，并返回 ffmpeg 输入路径。
// ok=false 表示该媒体不适用：配置缺失 / STRM 远程流 / 本地文件不存在 / 远程路径无法翻译成 URL。
// 文件不存在属永久性条件，按"不适用"处理而不是报错，避免无意义地消耗重试次数。
func resolveArtworkInput(cfg *config.Config, media *model.Media) (string, bool) {
	if cfg == nil || media == nil || media.StreamURL != "" || media.FilePath == "" {
		return "", false
	}
	if !IsRemotePath(media.FilePath) {
		if _, err := os.Stat(media.FilePath); err != nil {
			return "", false
		}
		return media.FilePath, true
	}
	input := ResolveRemoteFFmpegURL(cfg, media.FilePath)
	// 解析失败时该函数原样返回入参（webdav/alist/s3 的失败分支都是 return p），
	// 此时 ffmpeg 只会报 "Protocol not found"——按"不适用"处理，不做必然失败的尝试，
	// 也不消耗重试次数（存储未挂载 / 配置缺失都属此类）。
	if input == media.FilePath {
		return "", false
	}
	return input, true
}

// artworkExtractRequest 单帧抽取的入参：都是透传给 ffmpeg 的片段，字段名即语义。
type artworkExtractRequest struct {
	// input ffmpeg -i 的输入路径（本地文件或已翻译的远程 URL）
	input string
	// preInput 置于 -i 之前的输入侧选项（如 -ss 定位）
	preInput []string
	// mapArgs 流映射参数（如 -map 0:1，用于取内嵌封面）
	mapArgs []string
	// out 产物落盘路径
	out string
}

// extractArtworkImage 抽取单帧并落盘（抽帧与内嵌封面提取共用）：两个生成器只是
// 定位方式不同——preInput 放输入侧选项（如 -ss 定位），mapArgs 放流映射参数（如 -map 0:1）；
// 后处理统一走 artworkPosterFilter，保证两种来源产物规格一致（2:3 竖版、限宽 1000px）。
func extractArtworkImage(ctx context.Context, cfg *config.Config, req artworkExtractRequest) error {
	ctx, cancel := context.WithTimeout(ctx, artworkExtractTimeout)
	defer cancel()

	args := []string{"-hide_banner", "-loglevel", "error", "-nostdin", "-y"}
	args = append(args, req.preInput...)
	// HTTP 输入时注入重连与超时参数（本地文件返回空切片）
	args = append(args, BuildFFmpegInputArgs(req.input)...)
	args = append(args, "-i", req.input)
	args = append(args, req.mapArgs...)
	args = append(args, "-frames:v", "1", "-q:v", "2", "-vf", artworkPosterFilter, req.out)

	cmd := exec.CommandContext(ctx, cfg.App.FFmpegPath, args...)
	setLowPriority(cmd) // 让位于播放/转码，不抢占 CPU
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("单帧抽取失败: %w (%s)", err, summarizeFFmpegOutput(output))
	}
	if _, err := os.Stat(req.out); err != nil {
		return fmt.Errorf("未产出帧文件: %w", err)
	}
	return nil
}

// summarizeFFmpegOutput 把 ffmpeg 输出压成单行摘要（首个非空行、限长），供拼进 error 使用。
func summarizeFFmpegOutput(output []byte) string {
	line, _, _ := strings.Cut(strings.TrimSpace(string(output)), "\n")

	const maxLen = 200
	if len(line) <= maxLen {
		return line
	}
	return line[:maxLen] + "..."
}

// isDecodableJPEG 判断文件能否解码为 JPEG。
// 比 MIME 嗅探更强的有效性校验：用于丢弃损坏的内嵌封面流与异常的抽帧产物。
func isDecodableJPEG(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()

	img, err := jpeg.Decode(f)
	if err != nil {
		return false
	}
	b := img.Bounds()
	return b.Dx() > 0 && b.Dy() > 0
}
