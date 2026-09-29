package handler

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

// serveImage 是 Poster / Backdrop 共用的出口：本地图片带 ETag 与 304，
// 取不到文件时回退到各自的占位图。
func TestServeImage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	imgPath := filepath.Join(dir, "poster.jpg")
	if err := os.WriteFile(imgPath, []byte("jpeg-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}

	h := &StreamHandler{}
	r := gin.New()
	r.GET("/img", func(c *gin.Context) { h.serveImage(c, imgPath, posterPlaceholder) })
	r.GET("/missing", func(c *gin.Context) {
		h.serveImage(c, filepath.Join(dir, "none.jpg"), posterPlaceholder)
	})

	get := func(path, ifNoneMatch string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if ifNoneMatch != "" {
			req.Header.Set("If-None-Match", ifNoneMatch)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	w := get("/img", "")
	if w.Code != http.StatusOK || w.Body.String() != "jpeg-bytes" {
		t.Fatalf("status=%d body=%q", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Fatalf("Content-Type=%q, want image/jpeg", ct)
	}
	etag := w.Header().Get("ETag")
	if etag == "" {
		t.Fatal("本地图片应带 ETag")
	}
	if w := get("/img", etag); w.Code != http.StatusNotModified {
		t.Fatalf("条件请求应返回 304, got %d", w.Code)
	}

	// 本地文件缺失 → 占位图（禁止缓存）
	w = get("/missing", "")
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "image/svg+xml" {
		t.Fatalf("缺失文件应回退占位图, status=%d ct=%q", w.Code, w.Header().Get("Content-Type"))
	}
	if w.Header().Get("X-Poster-Placeholder") != "true" {
		t.Fatal("占位图应带 X-Poster-Placeholder 标记")
	}
}
