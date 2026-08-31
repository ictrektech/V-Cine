package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/viper"
)

func TestLoadVideoAnalysisConfig(t *testing.T) {
	viper.Reset()
	t.Cleanup(viper.Reset)

	tempDir := t.TempDir()
	configBody := `
app:
  data_dir: ./app-data
cache:
  cache_dir: ./cache
video_analysis:
  enabled: true
  scene_base_url: "http://scene:8910/"
  structure_base_url: "http://structure:8911/"
  asset_dir: /custom/structure
  max_concurrent: 0
  poll_interval_seconds: 0
  job_timeout_minutes: 0
`
	if err := os.WriteFile(filepath.Join(tempDir, "config.yaml"), []byte(configBody), 0600); err != nil {
		t.Fatal(err)
	}
	oldWorkingDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(oldWorkingDir) })

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.VideoAnalysis.Enabled || cfg.VideoAnalysis.SceneBaseURL != "http://scene:8910" || cfg.VideoAnalysis.StructureBaseURL != "http://structure:8911" {
		t.Fatalf("unexpected video analysis config: %+v", cfg.VideoAnalysis)
	}
	if cfg.VideoAnalysis.AssetDir != "/custom/structure" {
		t.Fatalf("unexpected asset_dir: %+v", cfg.VideoAnalysis.AssetDir)
	}
	if cfg.VideoAnalysis.MaxConcurrent != 2 || cfg.VideoAnalysis.PollIntervalSeconds != 2 || cfg.VideoAnalysis.JobTimeoutMinutes != 120 {
		t.Fatalf("defaults not applied: %+v", cfg.VideoAnalysis)
	}
}

func TestDefaultAssetDirFollowsCacheDir(t *testing.T) {
	viper.Reset()
	t.Cleanup(viper.Reset)

	tempDir := t.TempDir()
	configBody := `
app:
  data_dir: ./app-data
cache:
  cache_dir: ./cache
video_analysis:
  enabled: false
`
	if err := os.WriteFile(filepath.Join(tempDir, "config.yaml"), []byte(configBody), 0600); err != nil {
		t.Fatal(err)
	}
	oldWorkingDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(oldWorkingDir) })

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join("cache", "structure")
	if cfg.VideoAnalysis.AssetDir != want {
		t.Fatalf("asset_dir = %q, want %q", cfg.VideoAnalysis.AssetDir, want)
	}
}

func TestUpdateVideoAnalysisConfigPersists(t *testing.T) {
	tempDir := t.TempDir()
	oldWorkingDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(oldWorkingDir) })

	cfg := &Config{}
	if err := cfg.UpdateVideoAnalysisConfig(func(v *VideoAnalysisConfig) {
		v.Enabled = true
		v.SceneBaseURL = "http://scene:8910"
		v.StructureBaseURL = "http://structure:8911"
		v.AssetDir = "/custom/structure"
		v.DescribeEnabled = true
	}); err != nil {
		t.Fatal(err)
	}

	if !cfg.VideoAnalysis.Enabled || cfg.VideoAnalysis.SceneBaseURL != "http://scene:8910" {
		t.Fatalf("unexpected updated config: %+v", cfg.VideoAnalysis)
	}

	data, err := os.ReadFile(filepath.Join(tempDir, "config", "video_analysis.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "enabled: true") || !strings.Contains(string(data), "scene_base_url: http://scene:8910") {
		t.Fatalf("shard file missing expected values:\n%s", data)
	}
}

func TestUpdateVideoAnalysisConfigRollsBackOnSaveError(t *testing.T) {
	tempDir := t.TempDir()
	oldWorkingDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(oldWorkingDir) })

	// 让目标“文件”是一个目录，使 WriteFile 失败，验证内存回滚。
	if err := os.MkdirAll(filepath.Join(tempDir, "config", "video_analysis.yaml"), 0o755); err != nil {
		t.Fatal(err)
	}

	cfg := &Config{}
	if err := cfg.UpdateVideoAnalysisConfig(func(v *VideoAnalysisConfig) {
		v.Enabled = true
	}); err == nil {
		t.Fatal("expected save error")
	}
	if cfg.VideoAnalysis.Enabled {
		t.Fatal("expected in-memory config to roll back after save failure")
	}
}
