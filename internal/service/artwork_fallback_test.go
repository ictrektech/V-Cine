package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"go.uber.org/zap"
)

// fakeMediaFinder 假仓储：依赖收窄成 mediaFinder 窄接口后，调度逻辑可脱离 DB 单测。
type fakeMediaFinder struct {
	media *model.Media
	err   error
	calls int
}

func (f *fakeMediaFinder) FindByID(string) (*model.Media, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return f.media, nil
}

func newTestArtworkFallback(t *testing.T, enabled bool, concurrency int) *ArtworkFallbackService {
	t.Helper()
	cfg := &config.Config{Cache: config.CacheConfig{CacheDir: t.TempDir()}}
	cfg.Artwork.Fallback = config.ArtworkFallbackConfig{
		Enabled:     enabled,
		Frame:       true,
		Embedded:    true,
		Concurrency: concurrency,
	}
	// 默认注入"媒体不存在"的假仓储；需要真实媒体的用例自行构造服务
	return NewArtworkFallbackService(cfg, &fakeMediaFinder{err: errors.New("媒体不存在")}, zap.NewNop().Sugar())
}

// 未开启（默认配置）时必须完全不动作。
func TestArtworkFallbackDisabled(t *testing.T) {
	svc := newTestArtworkFallback(t, false, 2)
	if svc.Submit("m1") {
		t.Fatal("未开启时不应投递")
	}

	// 零值与 nil 服务同样安全（避免装配顺序或早期调用踩空）
	var zero ArtworkFallbackService
	if zero.Submit("m1") {
		t.Fatal("零值服务不应投递")
	}
	var nilSvc *ArtworkFallbackService
	if nilSvc.Submit("m1") {
		t.Fatal("nil 服务不应投递")
	}
}

func TestArtworkFallbackSubmitGuards(t *testing.T) {
	svc := newTestArtworkFallback(t, true, 1)

	// 空 mediaID
	if svc.Submit("   ") {
		t.Fatal("空 mediaID 不应投递")
	}

	// 闸门占满 → 直接丢弃（不阻塞、不排队，交由下一轮刮削重试）
	svc.sem <- struct{}{}
	if svc.Submit("m1") {
		t.Fatal("闸门占满时不应投递")
	}
	if _, loaded := svc.inFlight.Load("m1"); loaded {
		t.Fatal("被丢弃的投递不应残留在途标记")
	}
	<-svc.sem

	// 同一媒体在途去重
	svc.inFlight.Store("m2", struct{}{})
	if svc.Submit("m2") {
		t.Fatal("在途媒体不应重复投递")
	}
	svc.inFlight.Delete("m2")

	// 正常投递（媒体查不到，后台 goroutine 会立即安全退出）
	if !svc.Submit("m3") {
		t.Fatal("应投递成功")
	}
}

// 媒体不存在时静默跳过，不计入失败次数。
func TestArtworkFallbackRunSkipsMissingMedia(t *testing.T) {
	svc := newTestArtworkFallback(t, true, 1)
	svc.run(context.Background(), "m1")

	if got := svc.failCount("m1"); got != 0 {
		t.Fatalf("跳过不应计入失败次数, got %d", got)
	}
}

// 已有可展示的真海报时不应触发生成——即使有人手工提交，也不该白跑一次抽帧。
func TestArtworkFallbackRunSkipsWhenPosterExists(t *testing.T) {
	dir := t.TempDir()
	poster := filepath.Join(dir, "poster.jpg")
	if err := os.WriteFile(poster, []byte("jpeg"), 0o644); err != nil {
		t.Fatal(err)
	}

	finder := &fakeMediaFinder{media: &model.Media{
		ID:         "m1",
		PosterPath: poster,
		FilePath:   filepath.Join(dir, "v.mkv"),
	}}
	cache := t.TempDir()
	cfg := &config.Config{Cache: config.CacheConfig{CacheDir: cache}}
	cfg.Artwork.Fallback = config.ArtworkFallbackConfig{
		Enabled: true, Frame: true, Embedded: true, Concurrency: 1,
	}
	svc := NewArtworkFallbackService(cfg, finder, zap.NewNop().Sugar())

	svc.run(context.Background(), "m1")

	if finder.calls != 1 {
		t.Fatalf("应查询一次媒体, got %d", finder.calls)
	}
	derived := derivedArtworkPath(cache, "m1", ArtworkSourceFrame)
	if _, err := os.Stat(derived); !os.IsNotExist(err) {
		t.Fatal("已有真海报时不应生成兜底图")
	}
}

// fakeArtworkProbe 假解析链：用于验证判定依据来自整条链而不是单一 DB 指针。
type fakeArtworkProbe struct{ path string }

func (f fakeArtworkProbe) ResolvePoster(*model.Media) string { return f.path }

// 是否生成兜底图应看整条解析链的结论：只看 media.PosterPath 会让
// "靠同目录 sidecar / 剧集海报展示"的条目被误判为没有海报，白跑一轮探测与抽帧。
func TestHasUsableArtworkUsesResolutionChain(t *testing.T) {
	svc := newTestArtworkFallback(t, true, 1)
	media := &model.Media{ID: "m1", FilePath: filepath.Join(t.TempDir(), "v.mkv")}

	// 未注入解析链 → 退化为只校验 DB 指针（此处无指针 → 需要生成）
	if svc.hasUsableArtwork(media) {
		t.Fatal("未注入解析链时应退化为只校验 DB 指针")
	}

	// 注入后 sidecar / 剧集海报命中 → 判为已有，不再生成
	svc.SetArtworkProbe(fakeArtworkProbe{path: "/videos/poster.jpg"})
	if !svc.hasUsableArtwork(media) {
		t.Fatal("解析链命中 sidecar 时应判为已有可展示海报")
	}

	// 解析链无结果 → 触发生成
	svc.SetArtworkProbe(fakeArtworkProbe{})
	if svc.hasUsableArtwork(media) {
		t.Fatal("解析链无结果时应触发生成")
	}
}

func TestHasUsablePoster(t *testing.T) {
	dir := t.TempDir()
	existing := filepath.Join(dir, "poster.jpg")
	if err := os.WriteFile(existing, []byte("jpeg"), 0o644); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name  string
		media *model.Media
		want  bool
	}{
		{"nil media", nil, false},
		{"空指针", &model.Media{}, false},
		{"http URL 视为可用", &model.Media{PosterPath: "https://example.com/p.jpg"}, true},
		{"远程存储路径视为可用", &model.Media{PosterPath: "webdav://host/p.jpg"}, true},
		{"本地文件存在", &model.Media{PosterPath: existing}, true},
		{"本地文件缺失", &model.Media{PosterPath: filepath.Join(dir, "missing.jpg")}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := hasUsablePoster(tc.media); got != tc.want {
				t.Fatalf("hasUsablePoster = %v, want %v", got, tc.want)
			}
		})
	}
}
