package service

import (
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"math"
	"os"
	"path/filepath"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"go.uber.org/zap"
)

// ==================== 抽帧海报兜底图生成 ====================
//
// 与解析侧（artwork.go）的分工：
//   - 本文件只负责"产出"：抽帧 → 打分选优 → 原子落盘到 derivedArtworkPath；
//   - 解析侧只做 stat 探测，不会调用本文件。两侧都不写 media.PosterPath。
//
// 幂等：目标文件存在即跳过，因此可被周期性重试安全地重复调用。

const (
	// artworkFrameSampleCount 采样点数。等距取样（i/(N+1)），天然避开片头片尾
	artworkFrameSampleCount = 10

	// artworkFrameMinLuma 平均亮度下限：低于此值判为黑帧
	artworkFrameMinLuma = 16.0
	// artworkFrameMinDetail 拉普拉斯能量下限，只用于挡掉"近纯色帧"，不负责筛质量。
	// 实测（1920x1080 源经 2:3 中心裁切后）：纯色/黑帧 0.0，SMPTE 色条 1.9，带纹理测试图 3.4~5.8，
	// 实拍画面更高。阈值刻意取低——大块平色是合法画面（静态镜头、字幕底、天空），
	// 真正选哪张交给 frameScore 排序。
	artworkFrameMinDetail = 1.2

	// artworkFrameDetailSaturation 细节评分的饱和值：达到此值即给满分。
	// 取 10 而非更高，是为了让实测区间（3~10）在评分里有足够区分度，否则亮度会实际主导排序。
	// 它同时是防噪点护栏：detail 超过此值不再奖励，避免选中噪声/字幕/强反差这类高频最重的帧。
	artworkFrameDetailSaturation = 10.0
	// artworkFrameScoreDetailWeight 细节在总分中的权重（黑帧/纯色已被阈值挡掉，故细节优先）
	artworkFrameScoreDetailWeight = 0.6
)

// artworkPosterFilter 抽帧后处理滤镜链：中心裁成 2:3 竖版，再限宽 1000px（不放大）。
//   - crop 的 w/h 用 min() 同时覆盖横版与竖版源：1920x1080 → 720x1080，1080x1920 → 1080x1620
//   - trunc(.../2)*2 保证 yuv420p 所需的偶数尺寸
//   - 表达式用单引号包裹：ffmpeg 的 filtergraph 以逗号分隔滤镜，不加引号会被当成分隔符
const artworkPosterFilter = "crop='trunc(min(iw,ih*2/3)/2)*2':'trunc(min(ih,iw*3/2)/2)*2'," +
	"scale='trunc(min(1000,iw)/2)*2':-2"

// FrameArtworkGenerator 通过抽帧生成 poster 兜底图。
type FrameArtworkGenerator struct {
	cfg    *config.Config
	logger *zap.SugaredLogger
}

func NewFrameArtworkGenerator(cfg *config.Config, logger *zap.SugaredLogger) *FrameArtworkGenerator {
	return &FrameArtworkGenerator{cfg: cfg, logger: logger}
}

// Source 本生成器产出的来源
func (g *FrameArtworkGenerator) Source() ArtworkSource { return ArtworkSourceFrame }

// Generate 生成抽帧兜底图并落盘到 dst。
// generated=false 表示无需处理（产物已存在 / 该媒体不适用抽帧）；
// err 非空表示本轮失败，调用方可按重试上限重试。
func (g *FrameArtworkGenerator) Generate(
	ctx context.Context,
	media *model.Media,
	dst string,
) (generated bool, err error) {
	if g == nil || g.cfg == nil || media == nil || dst == "" {
		return false, nil
	}
	// 幂等：产物已存在即无需重做
	if _, statErr := os.Stat(dst); statErr == nil {
		return false, nil
	}
	if media.Duration <= 0 {
		// 时长未知 → 无法定位采样点
		g.logger.Debugw("跳过抽帧：媒体时长未知", "media", media.ID, "path", media.FilePath)
		return false, nil
	}

	// 适用性判断（STRM 远程流 / 文件缺失 / 远程路径翻译）与内嵌封面来源共用同一套规则
	input, ok := resolveArtworkInput(g.cfg, media)
	if !ok {
		return false, nil
	}

	// 候选帧落在目标同级的临时目录：同一文件系统，胜出者可直接 rename 落盘；
	// defer 清理保证任何失败路径都不留垃圾。
	if mkErr := os.MkdirAll(filepath.Dir(dst), 0o755); mkErr != nil {
		return false, fmt.Errorf("创建派生图目录失败: %w", mkErr)
	}
	tmpDir, tmpErr := os.MkdirTemp(filepath.Dir(dst), ".frame-cand-")
	if tmpErr != nil {
		return false, fmt.Errorf("创建抽帧临时目录失败: %w", tmpErr)
	}
	defer os.RemoveAll(tmpDir)

	candidates := g.extractCandidates(ctx, input, media.Duration, tmpDir)
	if len(candidates) == 0 {
		// 一帧都没产出：多为 ffmpeg/网络问题，交给调用方重试
		return false, fmt.Errorf("抽帧失败: %d 个采样点均未产出帧", artworkFrameSampleCount)
	}

	// 候选帧在打分阶段已被 jpeg.Decode 解出，此处无需再校验文件内容
	best, ok := pickBestFrame(candidates, g.logger, media.ID)
	if !ok {
		// 产出过帧但全不合格（整片黑屏/纯色）：重试无意义，按"无需求"处理
		g.logger.Infow("抽帧候选全部不合格（黑帧/纯色），不生成兜底海报", "media", media.ID)
		return false, nil
	}

	if err := os.Rename(best, dst); err != nil {
		return false, fmt.Errorf("派生图落盘失败: %w", err)
	}
	g.logger.Infow("已生成抽帧兜底海报", "media", media.ID, "path", dst)
	return true, nil
}

// extractCandidates 在多个时间点抽帧，返回成功产出的候选帧路径。
func (g *FrameArtworkGenerator) extractCandidates(
	ctx context.Context,
	input string,
	duration float64,
	dir string,
) []string {
	times := frameSampleTimes(duration)
	paths := make([]string, 0, len(times))
	for i, at := range times {
		out := filepath.Join(dir, fmt.Sprintf("cand_%02d.jpg", i))
		// -ss 放在 -i 之前（input seeking）：直接定位到关键帧解码，比 output seeking 快 10~100x
		// （与 preprocess.go 的 P2 优化保持一致）。
		req := artworkExtractRequest{
			input:    input,
			preInput: []string{"-ss", fmt.Sprintf("%.2f", at)},
			out:      out,
		}
		if err := extractArtworkImage(ctx, g.cfg, req); err != nil {
			// 单点失败继续抽下一个点：最终以"是否有可用候选"给出结论（调用方据此重试）
			g.logger.Debugw("抽帧失败", "at_seconds", at, "error", err)
			continue
		}
		paths = append(paths, out)
	}
	return paths
}

// frameSampleTimes 计算等距采样点：duration * i/(N+1)，i=1..N。
// 首尾各留 1/(N+1) 的余量，正好避开片头与片尾。
func frameSampleTimes(duration float64) []float64 {
	if duration <= 0 {
		return nil
	}
	interval := duration / float64(artworkFrameSampleCount+1)
	times := make([]float64, 0, artworkFrameSampleCount)
	for i := 1; i <= artworkFrameSampleCount; i++ {
		at := interval * float64(i)
		if at >= duration {
			break
		}
		times = append(times, at)
	}
	return times
}

// pickBestFrame 对候选帧打分并选出最适合当海报的一张：阈值先挡掉黑帧/纯色，
// 剩下的按 frameScore 排序——细节越丰富、曝光越接近中灰越好。
// ok=false 表示所有候选都不合格（黑帧 / 纯色 / 解码失败）。
func pickBestFrame(paths []string, logger *zap.SugaredLogger, mediaID string) (string, bool) {
	best, bestScore := "", math.Inf(-1)
	for _, p := range paths {
		luma, detail, err := analyzeFrame(p)
		if err != nil {
			logger.Debugw("候选帧解码失败", "media", mediaID, "path", p, "error", err)
			continue
		}
		if luma < artworkFrameMinLuma {
			logger.Debugw("候选帧过暗，丢弃", "media", mediaID, "luma", luma, "path", p)
			continue
		}
		if detail < artworkFrameMinDetail {
			logger.Debugw("候选帧细节不足（纯色/糊帧），丢弃", "media", mediaID, "detail", detail, "path", p)
			continue
		}
		if score := frameScore(luma, detail); score > bestScore {
			best, bestScore = p, score
		}
	}
	return best, best != ""
}

// frameScore 综合评分：亮度越接近中灰（曝光正常）越好，细节越丰富越好。
// 细节在 artworkFrameDetailSaturation 处封顶——超过后不再奖励，
// 否则会优先选中噪点/字幕/强反差这类高频最重的帧。
func frameScore(luma, detail float64) float64 {
	lumaScore := 1 - math.Abs(luma-128)/128
	detailScore := math.Min(detail/artworkFrameDetailSaturation, 1)
	return lumaScore*(1-artworkFrameScoreDetailWeight) + detailScore*artworkFrameScoreDetailWeight
}

// analyzeFrame 解码候选帧，返回平均亮度与细节强度。
// 细节用拉普拉斯响应的平均绝对值度量：纯色/灰屏趋近 0，有纹理与边缘的画面显著大于 0。
func analyzeFrame(path string) (luma, detail float64, err error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, fmt.Errorf("打开候选帧失败: %w", err)
	}
	defer f.Close()

	img, err := jpeg.Decode(f)
	if err != nil {
		return 0, 0, fmt.Errorf("解码候选帧失败: %w", err)
	}

	grid, w, h := frameLumaGrid(img)
	if w < 3 || h < 3 {
		return 0, 0, fmt.Errorf("图像过小: %dx%d", w, h)
	}

	var sum float64
	for _, v := range grid {
		sum += v
	}
	luma = sum / float64(len(grid))

	var edges float64
	for y := 1; y < h-1; y++ {
		for x := 1; x < w-1; x++ {
			c := grid[y*w+x]
			edges += math.Abs(4*c - grid[(y-1)*w+x] - grid[(y+1)*w+x] - grid[y*w+x-1] - grid[y*w+x+1])
		}
	}
	detail = edges / float64((w-2)*(h-2))
	return luma, detail, nil
}

// frameLumaGrid 把图片按步长抽样成灰度矩阵（Rec.601 亮度）。
// 长边控制在 ~480 以内，限制解码后的遍历开销——打分只需相对可比，不需要原始分辨率。
func frameLumaGrid(img image.Image) (grid []float64, w, h int) {
	b := img.Bounds()
	step := max(1, (max(b.Dx(), b.Dy())+479)/480)
	w, h = b.Dx()/step, b.Dy()/step

	grid = make([]float64, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, bl, _ := img.At(b.Min.X+x*step, b.Min.Y+y*step).RGBA()
			grid[y*w+x] = 0.299*float64(r>>8) + 0.587*float64(g>>8) + 0.114*float64(bl>>8)
		}
	}
	return grid, w, h
}
