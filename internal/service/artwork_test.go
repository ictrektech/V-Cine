package service

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"go.uber.org/zap"
)

// 远程库的图片解析必须拿到 VFS：漏转发时 webdav:// 路径会被 os.Stat 判为不存在，
// 海报 / 背景图整链退化为占位图。
func TestSetVFSManagerReachesArtworkResolver(t *testing.T) {
	const videoDir = "webdav://host/library"
	const video = videoDir + "/movie.mkv"
	const wantPoster = videoDir + "/poster.jpg"

	vfsMgr := NewVFSManager(zap.NewNop().Sugar())
	vfsMgr.SetGlobalWebDAVFS(walkProbeVFS{statFn: func(path string) (fs.FileInfo, error) {
		// 远端只有 host/library/poster.jpg（ResolvePath 去掉 scheme 后仍是 host 开头）：
		// 同名的 movie.jpg 必须探测不到
		mfs := fstest.MapFS{"host/library/poster.jpg": &fstest.MapFile{Data: []byte("img"), ModTime: time.Unix(1, 0)}}
		return mfs.Stat(strings.TrimPrefix(path, "/"))
	}})

	svc := NewStreamService(nil, nil, nil, nil, zap.NewNop().Sugar())
	svc.SetVFSManager(vfsMgr)

	// 同目录 poster.jpg 只存在于远端：不经 VFS 必然探测不到
	media := &model.Media{ID: "m1", FilePath: video}
	if got := svc.artwork.ResolvePoster(media); got != wantPoster {
		t.Fatalf("远程 sidecar 海报应经 VFS 命中, got %q want %q", got, wantPoster)
	}
	if got := svc.artwork.ResolveBackdrop(media); got != "" {
		t.Fatalf("无背景图时应返回空, got %q", got)
	}
}

// 兜底图探测：解析侧只做 stat，不读文件内容（校验在生成侧落盘后做），
// 这条约束保证 GetPosterPath 热路径没有解码开销。
func TestResolveDerivedPoster(t *testing.T) {
	cache := t.TempDir()
	const mediaID = "m1"

	writeDerived := func(id string, src ArtworkSource, stamp int64, body string) string {
		p := derivedArtworkPath(cache, id, src, stamp)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}

	// 无产物 → 不命中
	if path := resolveDerivedPoster(cache, mediaID); path != "" {
		t.Fatalf("empty cache should not resolve, got %q", path)
	}
	// 参数缺失 → 不命中（空 cacheDir 会被拼成相对路径 images/...，必须挡住）
	if path := resolveDerivedPoster("", mediaID); path != "" {
		t.Fatalf("empty cacheDir should not resolve, got %q", path)
	}
	if path := resolveDerivedPoster(cache, ""); path != "" {
		t.Fatalf("empty mediaID should not resolve, got %q", path)
	}

	// 只有抽帧图 → 命中
	framePath := writeDerived(mediaID, ArtworkSourceFrame, 100, "frame")
	if path := resolveDerivedPoster(cache, mediaID); path != framePath {
		t.Fatalf("got %q, want %q", path, framePath)
	}

	// 同一来源有多个 stamp（源文件被替换过）→ 取最新的一份
	newerFrame := writeDerived(mediaID, ArtworkSourceFrame, 200, "frame-new")
	if path := resolveDerivedPoster(cache, mediaID); path != newerFrame {
		t.Fatalf("应取最新 stamp 的产物, got %q want %q", path, newerFrame)
	}

	// 内嵌封面出现后 → 优先于抽帧
	embeddedPath := writeDerived(mediaID, ArtworkSourceEmbedded, 100, "embedded")
	if path := resolveDerivedPoster(cache, mediaID); path != embeddedPath {
		t.Fatalf("embedded should outrank frame, got %q", path)
	}

	// 同名目录不算命中
	dirPath := derivedArtworkPath(cache, "m2", ArtworkSourceFrame, 100)
	if err := os.MkdirAll(dirPath, 0o755); err != nil {
		t.Fatal(err)
	}
	if path := resolveDerivedPoster(cache, "m2"); path != "" {
		t.Fatalf("directory should not resolve, got %q", path)
	}

	// 非图片内容也算命中（生成侧才会校验内容）
	corruptPath := writeDerived("m3", ArtworkSourceFrame, 100, "not an image")
	if path := resolveDerivedPoster(cache, "m3"); path != corruptPath {
		t.Fatalf("resolve is stat-only, got %q want %q", path, corruptPath)
	}

	// 清理旧 stamp 产物：只留当前一份
	pruneDerivedArtwork(cache, mediaID, ArtworkSourceFrame, newerFrame)
	if _, err := os.Stat(framePath); !os.IsNotExist(err) {
		t.Fatal("旧 stamp 产物应被清理")
	}
	if _, err := os.Stat(newerFrame); err != nil {
		t.Errorf("当前产物不应被清理: %v", err)
	}
}

// 背景图解析链：真背景图 → 同目录 fanart → 派生兜底图（竖版）→ 空
func TestResolveBackdropForMediaPriority(t *testing.T) {
	cache := t.TempDir()
	videoDir := t.TempDir()
	video := filepath.Join(videoDir, "movie.mkv")
	if err := os.WriteFile(video, []byte("v"), 0o644); err != nil {
		t.Fatal(err)
	}

	svc := &ArtworkResolver{cfg: &config.Config{Cache: config.CacheConfig{CacheDir: cache}}}
	newMedia := func() *model.Media { return &model.Media{ID: "m1", FilePath: video} }

	// nil 安全
	if got := svc.ResolveBackdrop(nil); got != "" {
		t.Fatalf("nil media 应解析为空, got %q", got)
	}
	// 全无 → 空
	if got := svc.ResolveBackdrop(newMedia()); got != "" {
		t.Fatalf("无任何背景图时应返回空, got %q", got)
	}

	// 只有竖版派生图 → 退而用它（横版槽位由前端裁切）
	poster := derivedArtworkPath(cache, "m1", ArtworkSourceFrame, 100)
	if err := os.MkdirAll(filepath.Dir(poster), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(poster, []byte("p"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := svc.ResolveBackdrop(newMedia()); got != poster {
		t.Fatalf("应回退到竖版派生图, got %q want %q", got, poster)
	}

	// 同目录 fanart 优先于派生图
	fanart := filepath.Join(videoDir, "fanart.jpg")
	if err := os.WriteFile(fanart, []byte("f"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := svc.ResolveBackdrop(newMedia()); got != fanart {
		t.Fatalf("sidecar 应优先于派生图, got %q want %q", got, fanart)
	}

	// DB 指针优先于一切
	dbBackdrop := filepath.Join(videoDir, "custom-backdrop.png")
	if err := os.WriteFile(dbBackdrop, []byte("c"), 0o644); err != nil {
		t.Fatal(err)
	}
	m := newMedia()
	m.BackdropPath = dbBackdrop
	if got := svc.ResolveBackdrop(m); got != dbBackdrop {
		t.Fatalf("DB 指针应优先, got %q want %q", got, dbBackdrop)
	}
}

// 封面来源判定只回答"是不是程序生成的"：碰 DB 指针就跳过，无指针才探测派生图。
func TestDerivedPosterSource(t *testing.T) {
	cache := t.TempDir()
	svc := &ArtworkResolver{cfg: &config.Config{Cache: config.CacheConfig{CacheDir: cache}}}
	media := &model.Media{ID: "m1", FilePath: "/nonexistent/movie.mkv"}

	if src := svc.DerivedPosterSource(nil); src != "" {
		t.Fatalf("nil media 应返回空, got %q", src)
	}
	if src := svc.DerivedPosterSource(media); src != "" {
		t.Fatalf("无派生产物时应返回空, got %q", src)
	}

	derived := derivedArtworkPath(cache, "m1", ArtworkSourceFrame, 100)
	if err := os.MkdirAll(filepath.Dir(derived), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(derived, []byte("f"), 0o644); err != nil {
		t.Fatal(err)
	}
	if src := svc.DerivedPosterSource(media); src != ArtworkSourceFrame {
		t.Fatalf("命中抽帧派生图应报告 frame, got %q", src)
	}

	// 有 DB 指针即视为刮削/手工来源：即使文件不存在也不再回退探测（不做额外 stat）
	media.PosterPath = filepath.Join(t.TempDir(), "missing.jpg")
	if src := svc.DerivedPosterSource(media); src != "" {
		t.Fatalf("有 DB 指针时不应报告派生来源, got %q", src)
	}
}

// 海报解析链优先级：派生图只在真海报全部缺席时生效，且绝不写回 media.PosterPath。
func TestResolvePosterForMediaPriority(t *testing.T) {
	cache := t.TempDir()
	videoDir := t.TempDir()
	video := filepath.Join(videoDir, "movie.mkv")
	if err := os.WriteFile(video, []byte("v"), 0o644); err != nil {
		t.Fatal(err)
	}

	svc := &ArtworkResolver{cfg: &config.Config{Cache: config.CacheConfig{CacheDir: cache}}}
	newMedia := func() *model.Media {
		return &model.Media{ID: "m1", FilePath: video}
	}

	// cfg 缺失（部分单测/早期初始化）不应 panic
	if got := (&ArtworkResolver{}).ResolvePoster(newMedia()); got != "" {
		t.Fatalf("nil cfg should be tolerated, got %q", got)
	}

	// nil 安全
	if got := svc.ResolvePoster(nil); got != "" {
		t.Fatalf("nil media should resolve to empty, got %q", got)
	}

	derived := derivedArtworkPath(cache, "m1", ArtworkSourceFrame, 100)
	if err := os.MkdirAll(filepath.Dir(derived), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(derived, []byte("frame"), 0o644); err != nil {
		t.Fatal(err)
	}

	// 无真海报 → 命中派生兜底图
	m := newMedia()
	if got := svc.ResolvePoster(m); got != derived {
		t.Fatalf("derived should be the last resort, got %q want %q", got, derived)
	}
	// 解析不得写回 DB 指针（否则 partial 重试语义被破坏）
	if m.PosterPath != "" {
		t.Fatalf("resolve must not write PosterPath, got %q", m.PosterPath)
	}

	// DB 指针（刮削 / 手工上传）优先于派生图
	localPoster := filepath.Join(videoDir, "movie-poster.jpg")
	if err := os.WriteFile(localPoster, []byte("p"), 0o644); err != nil {
		t.Fatal(err)
	}
	m = newMedia()
	m.PosterPath = localPoster
	if got := svc.ResolvePoster(m); got != localPoster {
		t.Fatalf("PosterPath should outrank derived, got %q want %q", got, localPoster)
	}

	// 同目录 sidecar 优先于派生图
	sidecar := filepath.Join(videoDir, "poster.jpg")
	if err := os.WriteFile(sidecar, []byte("p"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := svc.ResolvePoster(newMedia()); got != sidecar {
		t.Fatalf("sidecar should outrank derived, got %q want %q", got, sidecar)
	}
}
