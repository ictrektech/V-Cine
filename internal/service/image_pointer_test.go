package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/nowen-video/nowen-video/internal/model"
)

// 回归测试：本地图片指针指向的文件被外部删除后，
// validateLocalImagePaths 必须清空失效指针并报告失效，
// 避免刮削完成判定把失效海报当作有效资产（假成功 scraped）。
func TestValidateLocalImagePaths(t *testing.T) {
	dir := t.TempDir()
	existing := filepath.Join(dir, "poster.jpg")
	if err := os.WriteFile(existing, []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}

	// 本地文件存在 → 保留指针，不报告失效
	media := &model.Media{PosterPath: existing}
	if validateLocalImagePaths(media) {
		t.Fatal("existing local poster should not be invalidated")
	}
	if media.PosterPath != existing {
		t.Fatalf("poster_path = %q, want unchanged %q", media.PosterPath, existing)
	}

	// 本地文件不存在 → 清空指针并报告失效
	missing := filepath.Join(dir, "missing.jpg")
	media = &model.Media{PosterPath: missing, BackdropPath: missing}
	if !validateLocalImagePaths(media) {
		t.Fatal("missing local paths should be invalidated")
	}
	if media.PosterPath != "" || media.BackdropPath != "" {
		t.Fatalf("invalid pointers should be cleared, got poster=%q backdrop=%q", media.PosterPath, media.BackdropPath)
	}

	// http(s) URL → 不做本地校验，保留
	const url = "https://example.com/poster.jpg"
	media = &model.Media{PosterPath: url}
	if validateLocalImagePaths(media) {
		t.Fatal("URL paths should not be validated locally")
	}
	if media.PosterPath != url {
		t.Fatalf("url poster_path = %q, want unchanged %q", media.PosterPath, url)
	}

	// 远程存储路径 → 不做本地校验，保留
	const remote = "webdav://host/media/poster.jpg"
	media = &model.Media{PosterPath: remote}
	if validateLocalImagePaths(media) {
		t.Fatal("remote storage paths should not be validated locally")
	}
	if media.PosterPath != remote {
		t.Fatalf("remote poster_path = %q, want unchanged %q", media.PosterPath, remote)
	}

	// nil 安全
	if validateLocalImagePaths(nil) {
		t.Fatal("nil media should be a no-op")
	}
}
