package config

import (
	"os"
	"path/filepath"
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
  path_mappings:
    - source: /media
      target: /photos
  asset_dir: /data/nowen-video-structure
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
	if len(cfg.VideoAnalysis.PathMappings) != 1 || cfg.VideoAnalysis.PathMappings[0].Source != "/media" || cfg.VideoAnalysis.PathMappings[0].Target != "/photos" {
		t.Fatalf("unexpected path mappings: %+v", cfg.VideoAnalysis.PathMappings)
	}
	if cfg.VideoAnalysis.AssetDir != "/data/nowen-video-structure" {
		t.Fatalf("unexpected asset_dir: %+v", cfg.VideoAnalysis.AssetDir)
	}
	if cfg.VideoAnalysis.MaxConcurrent != 2 || cfg.VideoAnalysis.PollIntervalSeconds != 2 || cfg.VideoAnalysis.JobTimeoutMinutes != 120 {
		t.Fatalf("defaults not applied: %+v", cfg.VideoAnalysis)
	}
}
