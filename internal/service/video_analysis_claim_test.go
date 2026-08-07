package service

import (
	"os"
	"path/filepath"
	"testing"
)

func TestClaimStagingDirMovesDirToAsset(t *testing.T) {
	dir := t.TempDir()
	staging := filepath.Join(dir, "staging", "job-1")
	if err := os.MkdirAll(filepath.Join(staging, "grids"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(staging, "manifest.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(staging, "grids", "scene_000.jpg"), []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}

	assetDir := filepath.Join(dir, "asset")
	dst, err := claimStagingDir(staging, assetDir, "hash-1")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(assetDir, "hash-1")
	if dst != want {
		t.Fatalf("dst = %q, want %q", dst, want)
	}
	if !fileExists(filepath.Join(want, "manifest.json")) {
		t.Fatal("manifest.json missing after claim")
	}
	if !fileExists(filepath.Join(want, "grids", "scene_000.jpg")) {
		t.Fatal("grid image missing after claim")
	}
	if dirExists(staging) {
		t.Fatal("staging dir should be moved away")
	}
}

func TestClaimStagingDirIdempotentWhenTargetExists(t *testing.T) {
	dir := t.TempDir()
	staging := filepath.Join(dir, "staging", "job-1")
	if err := os.MkdirAll(staging, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(staging, "manifest.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	assetDir := filepath.Join(dir, "asset")
	dst, err := claimStagingDir(staging, assetDir, "hash-1")
	if err != nil {
		t.Fatal(err)
	}
	// 第二次调用：目标已存在，应跳过（幂等），且不报错。
	dst2, err := claimStagingDir(staging, assetDir, "hash-1")
	if err != nil {
		t.Fatalf("second claim should be idempotent: %v", err)
	}
	if dst != dst2 {
		t.Fatalf("dst = %q, want %q", dst2, dst)
	}
}

func TestClaimStagingDirValidatesInput(t *testing.T) {
	dir := t.TempDir()
	staging := filepath.Join(dir, "staging", "job-1")
	if err := os.MkdirAll(staging, 0o755); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name       string
		stagingDir string
		assetDir   string
		videoHash  string
	}{
		{"relative staging", "staging/job-1", filepath.Join(dir, "asset"), "hash-1"},
		{"empty staging", "", filepath.Join(dir, "asset"), "hash-1"},
		{"nonexistent staging", filepath.Join(dir, "nope"), filepath.Join(dir, "asset"), "hash-1"},
		{"hash with slash", staging, filepath.Join(dir, "asset"), "a/b"},
		{"hash dotdot", staging, filepath.Join(dir, "asset"), ".."},
		{"empty hash", staging, filepath.Join(dir, "asset"), ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := claimStagingDir(tc.stagingDir, tc.assetDir, tc.videoHash); err == nil {
				t.Fatalf("expected error for %s", tc.name)
			}
		})
	}
}

func TestClaimStagingDirMissingManifestFails(t *testing.T) {
	dir := t.TempDir()
	staging := filepath.Join(dir, "staging", "job-1")
	if err := os.MkdirAll(staging, 0o755); err != nil {
		t.Fatal(err)
	}
	assetDir := filepath.Join(dir, "asset")
	if _, err := claimStagingDir(staging, assetDir, "hash-1"); err == nil {
		t.Fatal("expected error for missing manifest.json")
	}
}
