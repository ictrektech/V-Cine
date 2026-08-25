package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nowen-video/nowen-video/internal/config"
)

func TestVideoAnalysisGetSettings(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cfg := &config.Config{VideoAnalysis: config.VideoAnalysisConfig{
		Enabled:          true,
		SceneBaseURL:     "http://scene:8910",
		StructureBaseURL: "http://structure:8911",
		AssetDir:         "/data/nowen-video-structure",
		DescribeEnabled:  true,
		MaxConcurrent:    99, // 不可编辑字段不应出现在 settings 响应中
	}}
	h := NewVideoAnalysisHandler(nil, nil, cfg)

	r := gin.New()
	r.GET("/settings", h.GetSettings)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/settings", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("GET /settings status = %d, body = %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data videoAnalysisSettingsView `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.Data.Enabled || resp.Data.SceneBaseURL != "http://scene:8910" || resp.Data.StructureBaseURL != "http://structure:8911" || resp.Data.AssetDir != "/data/nowen-video-structure" || !resp.Data.DescribeEnabled {
		t.Fatalf("unexpected settings view: %+v", resp.Data)
	}
}

func TestVideoAnalysisUpdateSettingsRejectsInvalidEnable(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cfg := &config.Config{VideoAnalysis: config.VideoAnalysisConfig{Enabled: false}}
	h := NewVideoAnalysisHandler(nil, nil, cfg)

	r := gin.New()
	r.PUT("/settings", h.UpdateSettings)

	body := `{"enabled":true,"scene_base_url":"","structure_base_url":"","asset_dir":""}`
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/settings", bytes.NewBufferString(body)))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("PUT /settings status = %d, body = %s", w.Code, w.Body.String())
	}
	if cfg.VideoAnalysis.Enabled {
		t.Fatal("config must not change on invalid enable request")
	}
}

func TestVideoAnalysisUpdateSettingsRejectsInvalidPathMapping(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cfg := &config.Config{VideoAnalysis: config.VideoAnalysisConfig{
		Enabled:          false,
		SceneBaseURL:     "http://scene:8910",
		StructureBaseURL: "http://structure:8911",
		AssetDir:         "/data/nowen-video-structure",
		PathMappings:     []config.VideoAnalysisPathMapping{{Source: "", Target: ""}},
	}}
	h := NewVideoAnalysisHandler(nil, nil, cfg)

	r := gin.New()
	r.PUT("/settings", h.UpdateSettings)

	body := `{"enabled":true,"scene_base_url":"http://scene:8910","structure_base_url":"http://structure:8911","asset_dir":"/data/nowen-video-structure"}`
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/settings", bytes.NewBufferString(body)))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("PUT /settings status = %d, body = %s", w.Code, w.Body.String())
	}
	if cfg.VideoAnalysis.Enabled {
		t.Fatal("config must not change on invalid path mapping request")
	}
}

func TestVideoAnalysisUpdateSettingsPreservesAssetDir(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tempDir := t.TempDir()
	oldWorkingDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(oldWorkingDir) })

	cfg := &config.Config{VideoAnalysis: config.VideoAnalysisConfig{
		Enabled:          false,
		SceneBaseURL:     "http://scene:8910",
		StructureBaseURL: "http://structure:8911",
		AssetDir:         "/data/original-asset-dir",
	}}
	h := NewVideoAnalysisHandler(nil, nil, cfg)

	r := gin.New()
	r.PUT("/settings", h.UpdateSettings)

	body := `{"enabled":true,"scene_base_url":"http://scene:8910","structure_base_url":"http://structure:8911","asset_dir":"/data/should-be-ignored"}`
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/settings", bytes.NewBufferString(body)))

	if w.Code != http.StatusOK {
		t.Fatalf("PUT /settings status = %d, body = %s", w.Code, w.Body.String())
	}
	if cfg.VideoAnalysis.AssetDir != "/data/original-asset-dir" {
		t.Fatalf("asset_dir must be preserved, got %q", cfg.VideoAnalysis.AssetDir)
	}
	if !cfg.VideoAnalysis.Enabled {
		t.Fatal("enabled should be updated")
	}
	if _, err := os.Stat(filepath.Join(tempDir, "config", "video_analysis.yaml")); err != nil {
		t.Fatalf("expected shard config to be written: %v", err)
	}
}
