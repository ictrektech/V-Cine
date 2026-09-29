package service

import (
	"context"
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

func decodeJPEGSize(t *testing.T, path string) (int, int) {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, err := jpeg.Decode(f)
	if err != nil {
		t.Fatalf("产物不是有效 JPEG: %v", err)
	}
	return img.Bounds().Dx(), img.Bounds().Dy()
}

// 内嵌封面的识别判据：视频流 + disposition.attached_pic == 1
// （MP4 封面与 ffmpeg -attach 写入的 MKV 封面都是这个形态）。
func TestPickAttachedPicIndex(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want int
		ok   bool
	}{
		{
			name: "MP4/MKV 封面在最后一路视频流",
			raw: `{"streams":[` +
				`{"index":0,"codec_type":"video","disposition":{"attached_pic":0}},` +
				`{"index":1,"codec_type":"video","disposition":{"attached_pic":1}}]}`,
			want: 1,
			ok:   true,
		},
		{
			name: "封面是第一路视频流",
			raw:  `{"streams":[{"index":0,"codec_type":"video","disposition":{"attached_pic":1}}]}`,
			want: 0,
			ok:   true,
		},
		{
			name: "无封面",
			raw: `{"streams":[` +
				`{"index":0,"codec_type":"video","disposition":{"attached_pic":0}},` +
				`{"index":1,"codec_type":"audio"}]}`,
			ok: false,
		},
		{
			name: "非视频流上的 attached_pic 标记不算",
			raw:  `{"streams":[{"index":0,"codec_type":"audio","disposition":{"attached_pic":1}}]}`,
			ok:   false,
		},
		{
			name: "非法 JSON",
			raw:  `not json`,
			ok:   false,
		},
		{
			name: "空流列表",
			raw:  `{"streams":[]}`,
			ok:   false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := pickAttachedPicIndex([]byte(tc.raw))
			if ok != tc.ok || (ok && got != tc.want) {
				t.Fatalf("pickAttachedPicIndex = (%d, %v), want (%d, %v)", got, ok, tc.want, tc.ok)
			}
		})
	}
}

// 端到端：真实带内嵌封面的 mkv → 提取产物 → 幂等；无封面文件应返回"不适用"且不留垃圾。
// 依赖本机 ffmpeg/ffprobe，缺失时跳过。
func TestEmbeddedArtworkGeneratorGenerate(t *testing.T) {
	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("本机无 ffmpeg，跳过内嵌封面集成测试")
	}
	ffprobePath, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("本机无 ffprobe，跳过内嵌封面集成测试")
	}

	dir := t.TempDir()
	video := filepath.Join(dir, "v.mp4")
	cover := filepath.Join(dir, "cover.jpg")
	withCover := filepath.Join(dir, "withcover.mkv")

	run := func(args ...string) {
		t.Helper()
		if out, runErr := exec.Command(ffmpegPath, args...).CombinedOutput(); runErr != nil {
			t.Skipf("构造测试素材失败（跳过）: %v (%s)", runErr, out)
		}
	}
	run("-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "testsrc2=size=640x360:rate=10:duration=2", "-c:v", "mpeg4", video)
	run("-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=red:size=600x900", "-frames:v", "1", cover)
	run("-hide_banner", "-loglevel", "error", "-y",
		"-i", video, "-c", "copy", "-attach", cover, "-metadata:s:t", "mimetype=image/jpeg", withCover)

	cache := filepath.Join(dir, "cache")
	cfg := &config.Config{Cache: config.CacheConfig{CacheDir: cache}}
	cfg.App.FFmpegPath = ffmpegPath
	cfg.App.FFprobePath = ffprobePath
	cfg.Artwork.Fallback = config.ArtworkFallbackConfig{Enabled: true, Frame: true, Embedded: true}
	g := NewEmbeddedArtworkGenerator(cfg, zap.NewNop().Sugar())

	// 带内嵌封面 → 提取成功
	withCoverMedia := &model.Media{ID: "m1", FilePath: withCover}
	dst := derivedArtworkPath(cache, "m1", ArtworkSourceEmbedded)
	generated, err := g.Generate(context.Background(), withCoverMedia, dst)
	if err != nil {
		t.Fatalf("Generate 失败: %v", err)
	}
	if !generated {
		t.Fatal("带内嵌封面的文件应提取出封面")
	}
	if !isDecodableJPEG(dst) {
		t.Fatal("产物应为可解码 JPEG")
	}
	// 封面本身即 2:3（600x900）→ 裁剪为空操作
	if w, h := decodeJPEGSize(t, dst); math.Abs(float64(w)*1.5-float64(h)) > 2 {
		t.Fatalf("产物应为 2:3, got %dx%d", w, h)
	}
	// 解析侧必须能探测到（生成与解析共用同一条路径规则）
	if path := resolveDerivedPoster(cache, "m1"); path != dst {
		t.Fatalf("解析侧应命中内嵌封面: %q", path)
	}
	// 幂等：二次调用不重复提取
	if again, againErr := g.Generate(context.Background(), withCoverMedia, dst); againErr != nil || again {
		t.Fatalf("二次调用应幂等跳过, got %v/%v", again, againErr)
	}

	// 无内嵌封面 → 返回"不适用"，且不留下任何产物
	noCoverDst := derivedArtworkPath(cache, "m2", ArtworkSourceEmbedded)
	generated, err = g.Generate(context.Background(), &model.Media{ID: "m2", FilePath: video}, noCoverDst)
	if err != nil || generated {
		t.Fatalf("无内嵌封面时应返回不适用, got %v/%v", generated, err)
	}
	if _, statErr := os.Stat(noCoverDst); !os.IsNotExist(statErr) {
		t.Fatal("无内嵌封面时不应留下产物")
	}
}
