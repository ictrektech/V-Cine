package service

import (
	"os"
	"path/filepath"
	"testing"
)

// collectEpisodes 在部分扫描时只收录 allowFile 允许的文件
func TestCollectEpisodesHonorsPartialFiles(t *testing.T) {
	dir := t.TempDir()
	keep := filepath.Join(dir, "new.mp4")
	old := filepath.Join(dir, "old.mp4")
	for _, p := range []string{keep, old} {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatalf("写入测试文件失败: %v", err)
		}
	}

	s := &ScannerService{}
	if n := s.setPartialFiles("lib1", []string{keep}); n != 1 {
		t.Fatalf("登记数 = %d, want 1", n)
	}
	defer s.partialFiles.Delete("lib1")

	eps := s.collectEpisodes("lib1", dir)
	if len(eps) != 1 || eps[0].FilePath != keep {
		t.Fatalf("部分扫描应只收录本次文件 %s, got %+v", keep, eps)
	}

	// 其它库未限定文件：同目录下的文件都要收录
	if eps := s.collectEpisodes("lib2", dir); len(eps) != 2 {
		t.Fatalf("未限定文件时应收录 2 个, got %d", len(eps))
	}
}

// isTVShowFolder 不把上传暂存目录当作剧集目录
func TestIsTVShowFolderSkipsUploadStagingDir(t *testing.T) {
	parent := t.TempDir()
	staging := filepath.Join(parent, uploadStagingDirName)
	normal := filepath.Join(parent, "some-show")
	for _, dir := range []string{staging, normal} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("创建目录失败: %v", err)
		}
		for _, name := range []string{"Show.S01E01.mp4", "Show.S01E02.mp4"} {
			if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
				t.Fatalf("写入测试文件失败: %v", err)
			}
		}
	}

	s := &ScannerService{}
	if s.isTVShowFolder(staging) {
		t.Fatal("上传暂存目录不应判为剧集目录")
	}
	if !s.isTVShowFolder(normal) {
		t.Fatal("含剧集命名文件的普通目录应判为剧集目录")
	}
}
