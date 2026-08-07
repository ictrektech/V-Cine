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

// TestCopyDirRecursivelyCopiesWithLayout 验证 EXDEV fallback 的 copy 路径：
// 递归复制后目录布局与文件内容一致。
func TestCopyDirRecursivelyCopiesWithLayout(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	if err := os.MkdirAll(filepath.Join(src, "grids"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "manifest.json"), []byte(`{"v":1}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "grids", "scene_000.jpg"), []byte("jpeg"), 0o644); err != nil {
		t.Fatal(err)
	}

	dst := filepath.Join(dir, "dst")
	if err := copyDirRecursive(src, dst); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(filepath.Join(dst, "manifest.json")); string(got) != `{"v":1}` {
		t.Fatalf("manifest content = %q", got)
	}
	if got, _ := os.ReadFile(filepath.Join(dst, "grids", "scene_000.jpg")); string(got) != "jpeg" {
		t.Fatalf("grid content = %q", got)
	}
	// 权限保留：文件 mode 应为 0644。
	info, err := os.Stat(filepath.Join(dst, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o644 {
		t.Fatalf("mode = %v, want 0644", info.Mode().Perm())
	}
}

// TestClaimStagingDirCrossDeviceCopyFailureCleansPartial 验证跨文件系统
// copy fallback 失败会清理半成品 dst，避免下次幂等检查误判"已搬移"。
// 用不可读子目录触发 copy 失败（非 root 下有效；root 跳过避免假失败）。
func TestClaimStagingDirCrossDeviceCopyFailureCleansPartial(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root 下权限不可读不可触发，跳过")
	}
	dir := t.TempDir()
	staging := filepath.Join(dir, "staging", "job-1")
	if err := os.MkdirAll(filepath.Join(staging, "blocked"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(staging, "manifest.json"), []byte(`{"v":1}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(staging, "blocked", "secret.bin"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	// 让 blocked 子目录不可读，copy 遍历时失败。
	if err := os.Chmod(filepath.Join(staging, "blocked"), 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(filepath.Join(staging, "blocked"), 0o755) })

	dst := filepath.Join(dir, "asset", "hash-1")
	if err := claimStagingDirCrossDevice(staging, dst); err == nil {
		t.Fatal("expected copy failure")
	}
	// 半成品 dst 必须被清理，否则下次幂等会误判成功。
	if dirExists(dst) {
		t.Fatal("partial dst should be cleaned up after copy failure")
	}
}

// TestCopyFilePreservesMode 验证单文件复制保留权限位。
func TestCopyFilePreservesMode(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(src, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "sub", "b.txt")
	if err := copyFileWithMode(src, dst, 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(dst)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v, want 0600", info.Mode().Perm())
	}
}
