package service

import (
	"errors"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
)

// 端到端：竖版海报 → 16:9 横版派生图 → 幂等复用。
func TestEnsureWideBackdrop(t *testing.T) {
	ffmpegPath, lookErr := exec.LookPath("ffmpeg")
	if lookErr != nil {
		t.Skip("本机无 ffmpeg，跳过横版合成集成测试")
	}

	dir := t.TempDir()
	poster := filepath.Join(dir, "poster.jpg")
	gen := exec.Command(ffmpegPath, "-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=orange:s=270x377", "-frames:v", "1", poster)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Skipf("生成测试海报失败（跳过）: %v (%s)", err, out)
	}

	cache := filepath.Join(dir, "cache")
	cfg := &config.Config{Cache: config.CacheConfig{CacheDir: cache}}
	cfg.App.FFmpegPath = ffmpegPath

	r := NewArtworkResolver(nil, nil, cfg)
	media := &model.Media{ID: "m-wide", PosterPath: poster, FilePath: filepath.Join(dir, "x.mp4")}

	path := r.EnsureWideBackdrop(media)
	if path == "" {
		t.Fatal("应生成横版派生图")
	}
	// 生成与解析必须共用同一条路径规则
	if found := findWideBackdrop(cache, "m-wide"); found != path {
		t.Fatalf("解析侧探测结果不一致: %q != %q", found, path)
	}

	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("打开产物失败: %v", err)
	}
	img, decodeErr := jpeg.Decode(f)
	f.Close()
	if decodeErr != nil {
		t.Fatalf("产物不可解码: %v", decodeErr)
	}
	if b := img.Bounds(); b.Dx() != wideBackdropWidth || b.Dy() != wideBackdropHeight {
		t.Fatalf("产物规格应为 %dx%d，实际 %dx%d", wideBackdropWidth, wideBackdropHeight, b.Dx(), b.Dy())
	}

	// 幂等：二次调用复用同一文件，不重新合成
	info, statErr := os.Stat(path)
	if statErr != nil {
		t.Fatalf("stat 产物失败: %v", statErr)
	}
	if again := r.EnsureWideBackdrop(media); again != path {
		t.Fatalf("二次调用应复用同一路径，实际 %q", again)
	}
	info2, statErr := os.Stat(path)
	if statErr != nil {
		t.Fatalf("stat 产物失败: %v", statErr)
	}
	if !info.ModTime().Equal(info2.ModTime()) {
		t.Fatal("二次调用不应重新合成")
	}
}

// 远程海报不参与合成，返回空串。
func TestEnsureWideBackdropSkipsRemotePoster(t *testing.T) {
	cache := t.TempDir()
	cfg := &config.Config{Cache: config.CacheConfig{CacheDir: cache}}
	cfg.App.FFmpegPath = "ffmpeg"

	r := NewArtworkResolver(nil, nil, cfg)
	media := &model.Media{ID: "m-remote", PosterPath: "https://image.tmdb.org/t/p/w500/x.jpg"}

	if path := r.EnsureWideBackdrop(media); path != "" {
		t.Fatalf("远程海报应跳过合成，实际返回 %q", path)
	}
}

// 剧集：没有 BackdropPath 时用剧集根目录 poster 合成，产物独立于媒体目录。
func TestEnsureWideBackdropForSeries(t *testing.T) {
	ffmpegPath, lookErr := exec.LookPath("ffmpeg")
	if lookErr != nil {
		t.Skip("本机无 ffmpeg，跳过横版合成集成测试")
	}

	dir := t.TempDir()
	poster := filepath.Join(dir, "poster.jpg")
	gen := exec.Command(ffmpegPath, "-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=navy:s=300x450", "-frames:v", "1", poster)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Skipf("生成测试海报失败（跳过）: %v (%s)", err, out)
	}

	cache := filepath.Join(dir, "cache")
	cfg := &config.Config{Cache: config.CacheConfig{CacheDir: cache}}
	cfg.App.FFmpegPath = ffmpegPath

	r := NewArtworkResolver(nil, nil, cfg)
	series := &model.Series{ID: "s1", FolderPath: dir}

	path := r.EnsureWideBackdropForSeries(series)
	if path == "" {
		t.Fatal("应生成剧集横版派生图")
	}
	if want := filepath.Join(cache, "images", "series", "s1"); !strings.HasPrefix(path, want) {
		t.Fatalf("剧集产物应落在 %s 下，实际 %s", want, path)
	}
	if !fileExistsNonEmpty(path) {
		t.Fatalf("产物不存在或为空: %s", path)
	}
}

// 解析链顺序：真横版图 > 派生横版图 > 竖版派生图。
func TestResolveBackdropPrefersWideOverPortrait(t *testing.T) {
	cache := t.TempDir()
	svc := &ArtworkResolver{cfg: &config.Config{Cache: config.CacheConfig{CacheDir: cache}}}

	// 竖版派生图
	portrait := derivedArtworkPath(cache, "m1", ArtworkSourceFrame, 100)
	if err := os.MkdirAll(filepath.Dir(portrait), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(portrait, []byte("p"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := svc.ResolveBackdrop(&model.Media{ID: "m1", FilePath: "/nonexistent/m.mkv"}); got != portrait {
		t.Fatalf("无横版图时应回退竖版派生图, got %q", got)
	}

	// 加上横版派生图后应先命中它
	wide := wideBackdropPath(cache, "m1", 101)
	if err := os.WriteFile(wide, []byte("w"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := svc.ResolveBackdrop(&model.Media{ID: "m1", FilePath: "/nonexistent/m.mkv"}); got != wide {
		t.Fatalf("应优先命中派生横版图, got %q want %q", got, wide)
	}

	// 同目录 fanart 是真横版图，必须压过派生横版图
	videoDir := t.TempDir()
	video := filepath.Join(videoDir, "movie.mkv")
	if err := os.WriteFile(video, []byte("v"), 0o644); err != nil {
		t.Fatal(err)
	}
	fanart := filepath.Join(videoDir, "fanart.jpg")
	if err := os.WriteFile(fanart, []byte("f"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := svc.ResolveBackdrop(&model.Media{ID: "m1", FilePath: video}); got != fanart {
		t.Fatalf("真横版图应优先于派生图, got %q want %q", got, fanart)
	}
}

// 并发槽已满时立即返回 busy（不进队列、不算失败）。
func TestComposeWideBackdropBusy(t *testing.T) {
	wideBackdropSem <- struct{}{}
	wideBackdropSem <- struct{}{}
	defer func() {
		<-wideBackdropSem
		<-wideBackdropSem
	}()

	err := composeWideBackdrop("ffmpeg", "/nonexistent/poster.jpg", 1, filepath.Join(t.TempDir(), "x.jpg"))
	if !errors.Is(err, errWideBackdropBusy) {
		t.Fatalf("并发满时应返回 busy 错误, got %v", err)
	}
}

// 合成失败后进入冷却期，冷却期内不再执行 ffmpeg。
func TestEnsureWideBackdropCoolsDownAfterFailure(t *testing.T) {
	dir := t.TempDir()
	poster := filepath.Join(dir, "poster.jpg")
	if err := os.WriteFile(poster, []byte("not an image"), 0o644); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(dir, "runs.log")
	fake := filepath.Join(dir, "fake-ffmpeg.sh")
	script := "#!/bin/sh\necho run >> " + marker + "\nexit 1\n"
	if err := os.WriteFile(fake, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	cache := filepath.Join(dir, "cache")
	cfg := &config.Config{Cache: config.CacheConfig{CacheDir: cache}}
	cfg.App.FFmpegPath = fake

	r := NewArtworkResolver(nil, nil, cfg)
	media := &model.Media{ID: "m-fail", PosterPath: poster, FilePath: filepath.Join(dir, "x.mp4")}

	if got := r.EnsureWideBackdrop(media); got != "" {
		t.Fatalf("失败时应返回空串, got %q", got)
	}
	// 冷却期内再次调用不得再执行 ffmpeg
	if got := r.EnsureWideBackdrop(media); got != "" {
		t.Fatalf("冷却期内应返回空串, got %q", got)
	}

	runs, err := os.ReadFile(marker)
	if err != nil {
		t.Fatalf("读取执行记录失败: %v", err)
	}
	if n := strings.Count(string(runs), "run"); n != 1 {
		t.Fatalf("冷却期内只应执行 1 次合成, 实际 %d 次", n)
	}
}

// 探测结果进内存缓存；文件被清理后缓存自动失效并重新扫描。
func TestFindWideBackdropCacheInvalidation(t *testing.T) {
	cache := t.TempDir()
	wide := wideBackdropPath(cache, "m-hit", 5)
	if err := os.MkdirAll(filepath.Dir(wide), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(wide, []byte("w"), 0o644); err != nil {
		t.Fatal(err)
	}

	if got := findWideBackdrop(cache, "m-hit"); got != wide {
		t.Fatalf("首次探测应命中产物, got %q", got)
	}
	// 二次调用走缓存，结果一致
	if got := findWideBackdrop(cache, "m-hit"); got != wide {
		t.Fatalf("缓存命中应返回同一路径, got %q", got)
	}
	// 产物被删后缓存必须失效
	if err := os.Remove(wide); err != nil {
		t.Fatal(err)
	}
	if got := findWideBackdrop(cache, "m-hit"); got != "" {
		t.Fatalf("产物删除后应返回空, got %q", got)
	}
}

// 删除剧集时清理剧集级派生图目录；非法 ID 不得越界删除。
func TestMediaCacheCleanerCleanSeries(t *testing.T) {
	cache := t.TempDir()
	dir := filepath.Join(cache, "images", "series", "s1")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "backdrop-wide-1.jpg"), []byte("w"), 0o644); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(cache, "images", "s1")
	if err := os.MkdirAll(sentinel, 0o755); err != nil {
		t.Fatal(err)
	}

	c := &MediaCacheCleaner{cacheDir: cache, logger: zap.NewNop().Sugar()}
	c.CleanSeries("s1")
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("剧集派生图目录应被删除")
	}
	if _, err := os.Stat(sentinel); err != nil {
		t.Fatal("同名的媒体目录不应被误删")
	}

	// 非法 ID（含路径分隔符/上跳）必须被拒绝
	c.CleanSeries("../s1")
	if _, err := os.Stat(sentinel); err != nil {
		t.Fatal("非法 ID 不应触发删除")
	}
}

// 源海报缺失时不生成，返回空串。
func TestEnsureWideBackdropWithoutPoster(t *testing.T) {
	cache := t.TempDir()
	cfg := &config.Config{Cache: config.CacheConfig{CacheDir: cache}}
	cfg.App.FFmpegPath = "ffmpeg"

	r := NewArtworkResolver(nil, nil, cfg)
	media := &model.Media{ID: "m-none", FilePath: filepath.Join(t.TempDir(), "x.mp4")}

	if path := r.EnsureWideBackdrop(media); path != "" {
		t.Fatalf("无海报时不应生成，实际返回 %q", path)
	}
	if found := findWideBackdrop(cache, "m-none"); found != "" {
		t.Fatalf("不应落盘任何产物: %q", found)
	}
}
