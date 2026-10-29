package service

import (
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"go.uber.org/zap"
)

func TestFrameSampleTimes(t *testing.T) {
	// 等距采样，首尾各留余量，全部落在 (0, duration) 内
	times := frameSampleTimes(600)
	if len(times) != artworkFrameSampleCount {
		t.Fatalf("采样点数 = %d, want %d", len(times), artworkFrameSampleCount)
	}
	for i, at := range times {
		if at <= 0 || at >= 600 {
			t.Fatalf("第 %d 个采样点越界: %v", i, at)
		}
		if i > 0 && at <= times[i-1] {
			t.Fatalf("采样点必须递增: times[%d]=%v times[%d]=%v", i-1, times[i-1], i, at)
		}
	}

	// 时长未知 → 无采样点
	if got := frameSampleTimes(0); got != nil {
		t.Fatalf("duration=0 应返回 nil, got %v", got)
	}
	if got := frameSampleTimes(-1); got != nil {
		t.Fatalf("duration<0 应返回 nil, got %v", got)
	}
}

func writeSyntheticFrame(t *testing.T, path string, fill func(x, y int) uint8) {
	t.Helper()
	const w, h = 120, 180
	img := image.NewGray(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetGray(x, y, color.Gray{Y: fill(x, y)})
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
}

// 黑帧与纯色帧必须被拒绝，有纹理的帧胜出——这是"选一张能看的当海报"的核心判据。
func TestPickBestFrame(t *testing.T) {
	dir := t.TempDir()
	logger := zap.NewNop().Sugar()

	black := filepath.Join(dir, "black.jpg")
	writeSyntheticFrame(t, black, func(x, y int) uint8 { return 0 })

	flat := filepath.Join(dir, "flat.jpg")
	writeSyntheticFrame(t, flat, func(x, y int) uint8 { return 128 })

	textured := filepath.Join(dir, "textured.jpg")
	writeSyntheticFrame(t, textured, func(x, y int) uint8 {
		if (x/8+y/8)%2 == 0 {
			return 20
		}
		return 235
	})

	// 黑帧：亮度不达标
	if luma, _, err := analyzeFrame(black); err != nil || luma >= artworkFrameMinLuma {
		t.Fatalf("黑帧应被判为过暗: luma=%.1f err=%v", luma, err)
	}
	// 纯色帧：亮度达标但细节不足
	luma, detail, err := analyzeFrame(flat)
	if err != nil {
		t.Fatal(err)
	}
	if luma < artworkFrameMinLuma || detail >= artworkFrameMinDetail {
		t.Fatalf("纯色帧应被判为细节不足: luma=%.1f detail=%.1f", luma, detail)
	}
	// 有纹理帧：亮度与细节都达标
	luma, detail, err = analyzeFrame(textured)
	if err != nil {
		t.Fatal(err)
	}
	if luma < artworkFrameMinLuma || detail < artworkFrameMinDetail {
		t.Fatalf("纹理帧应达标: luma=%.1f detail=%.1f", luma, detail)
	}

	// 三者同时作为候选 → 选中纹理帧
	if best, ok := pickBestFrame([]string{black, flat, textured}, logger, "m1"); !ok || best != textured {
		t.Fatalf("应选中纹理帧, ok=%v best=%q", ok, best)
	}
	// 只有不合格候选 → 明确报告"无可用帧"
	if _, ok := pickBestFrame([]string{black, flat}, logger, "m1"); ok {
		t.Fatal("全为黑帧/纯色时应报告无可用帧")
	}
	// 解码失败的候选被跳过而非中断
	broken := filepath.Join(dir, "missing.jpg")
	if best, ok := pickBestFrame([]string{broken, textured}, logger, "m1"); !ok || best != textured {
		t.Fatalf("应跳过损坏候选并选中纹理帧, ok=%v best=%q", ok, best)
	}
}

// 评分规则：细节在饱和值处封顶（超过不再加分，避免追噪声），
// 细节都饱和时由曝光决胜负——中灰帧胜过过曝帧。
func TestFrameScoreRanking(t *testing.T) {
	saturated := frameScore(160, artworkFrameDetailSaturation)
	overSaturated := frameScore(160, artworkFrameDetailSaturation+50)
	if overSaturated != saturated {
		t.Fatalf("超过饱和值后细节不应再加分: %f != %f", overSaturated, saturated)
	}

	dir := t.TempDir()
	logger := zap.NewNop().Sugar()
	midtone := filepath.Join(dir, "midtone.jpg")
	writeSyntheticFrame(t, midtone, func(x, y int) uint8 {
		if (x/8+y/8)%2 == 0 {
			return 20
		}
		return 235
	})
	overexposed := filepath.Join(dir, "over.jpg")
	writeSyntheticFrame(t, overexposed, func(x, y int) uint8 {
		if (x/8+y/8)%2 == 0 {
			return 200
		}
		return 255
	})

	if best, ok := pickBestFrame([]string{overexposed, midtone}, logger, "m1"); !ok || best != midtone {
		t.Fatalf("应选中曝光正常的一帧, ok=%v best=%q", ok, best)
	}
}

// 不适用抽帧的场景必须在起 ffmpeg 之前就短路返回（不需要 ffmpeg 环境即可验证）。
func TestFrameArtworkGeneratorSkips(t *testing.T) {
	cfg := &config.Config{}
	g := NewFrameArtworkGenerator(cfg, zap.NewNop().Sugar())
	ctx := context.Background()
	dst := filepath.Join(t.TempDir(), "poster-frame.jpg")

	if generated, err := g.Generate(ctx, nil, dst); generated || err != nil {
		t.Fatalf("nil media 应静默跳过, got %v/%v", generated, err)
	}
	if generated, err := g.Generate(ctx, &model.Media{ID: "m1"}, ""); generated || err != nil {
		t.Fatalf("空 dst 应静默跳过, got %v/%v", generated, err)
	}
	// STRM 远程流
	strm := &model.Media{ID: "m1", StreamURL: "http://x/y.mkv", Duration: 100}
	if generated, err := g.Generate(ctx, strm, dst); generated || err != nil {
		t.Fatalf("STRM 应跳过, got %v/%v", generated, err)
	}
	// 时长未知 → 无法定位采样点
	noDuration := &model.Media{ID: "m1", FilePath: "/nonexistent/y.mkv"}
	if generated, err := g.Generate(ctx, noDuration, dst); generated || err != nil {
		t.Fatalf("时长未知应跳过, got %v/%v", generated, err)
	}
	// 产物已存在 → 幂等跳过（早于任何文件检查）
	if err := os.WriteFile(dst, []byte("existing"), 0o644); err != nil {
		t.Fatal(err)
	}
	missingFile := &model.Media{ID: "m1", FilePath: "/nonexistent/y.mkv", Duration: 100}
	if generated, err := g.Generate(ctx, missingFile, dst); generated || err != nil {
		t.Fatalf("产物已存在应幂等跳过, got %v/%v", generated, err)
	}
}

// 端到端：真实抽帧 → 2:3 竖版产物 → 幂等重入。依赖本机 ffmpeg，缺失时跳过。
func TestFrameArtworkGeneratorGenerate(t *testing.T) {
	ffmpegPath, lookErr := exec.LookPath("ffmpeg")
	if lookErr != nil {
		t.Skip("本机无 ffmpeg，跳过抽帧集成测试")
	}

	dir := t.TempDir()
	video := filepath.Join(dir, "sample.mp4")
	// lavfi 造一段 1920x1080 的带纹理测试视频；mpeg4 编码器内建，不依赖 libx264
	gen := exec.Command(ffmpegPath, "-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=10:duration=3",
		"-c:v", "mpeg4", video)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Skipf("生成测试视频失败（跳过）: %v (%s)", err, out)
	}

	cache := filepath.Join(dir, "cache")
	cfg := &config.Config{Cache: config.CacheConfig{CacheDir: cache}}
	cfg.App.FFmpegPath = ffmpegPath
	g := NewFrameArtworkGenerator(cfg, zap.NewNop().Sugar())

	media := &model.Media{ID: "m1", FilePath: video, Duration: 3}
	dst := derivedArtworkPath(cache, "m1", ArtworkSourceFrame, artworkStamp(video))

	generated, err := g.Generate(context.Background(), media, dst)
	if err != nil {
		t.Fatalf("Generate 失败: %v", err)
	}
	if !generated {
		t.Fatal("应生成抽帧兜底图")
	}
	// 解析侧必须能探测到（生成与解析共用同一条路径规则）
	if path := resolveDerivedPoster(cache, "m1"); path != dst {
		t.Fatalf("解析侧未命中产物: %q", path)
	}

	// 产物应为 2:3 竖版（crop 允许 1px 取整误差）且不超过 1000px 宽
	f, err := os.Open(dst)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, err := jpeg.Decode(f)
	if err != nil {
		t.Fatalf("产物不是有效 JPEG: %v", err)
	}
	b := img.Bounds()
	if math.Abs(float64(b.Dx())*1.5-float64(b.Dy())) > 2 {
		t.Fatalf("产物应为 2:3 竖版, got %dx%d", b.Dx(), b.Dy())
	}
	if b.Dx() > 1000 {
		t.Fatalf("产物宽度应 <= 1000, got %d", b.Dx())
	}

	// 幂等：二次调用不再抽帧
	if again, err := g.Generate(context.Background(), media, dst); err != nil || again {
		t.Fatalf("二次调用应幂等跳过, got %v/%v", again, err)
	}

	// 候选帧临时目录必须清理干净，媒体目录下只留最终产物
	entries, err := os.ReadDir(filepath.Dir(dst))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != filepath.Base(dst) {
		t.Fatalf("临时目录未清理干净: %v", entries)
	}
}
