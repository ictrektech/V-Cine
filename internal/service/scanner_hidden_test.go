package service

import "testing"

func TestAllowFileFilter(t *testing.T) {
	s := &ScannerService{}

	// 未限定：一律允许
	if !s.allowFile("lib1", "/lib/_incoming/a.mkv") {
		t.Fatal("未限定文件时应允许")
	}

	// 限定为本批次文件：同目录下的历史文件必须被拒绝
	if n := s.setPartialFiles("lib1", []string{"/lib/_incoming/a.mkv"}); n != 1 {
		t.Fatalf("登记数 = %d, want 1", n)
	}
	if !s.allowFile("lib1", "/lib/_incoming/a.mkv") {
		t.Error("本批次文件应允许")
	}
	if s.allowFile("lib1", "/lib/_incoming/old.mkv") {
		t.Error("同目录历史文件应被拒绝")
	}
	// 其它库不受影响
	if !s.allowFile("lib2", "/lib/_incoming/old.mkv") {
		t.Error("其它库不应受该限制影响")
	}
	// 路径规范化后匹配（登记时带 ./ 也能命中）
	s.setPartialFiles("lib3", []string{"/lib/./_incoming/x.mkv"})
	if !s.allowFile("lib3", "/lib/_incoming/x.mkv") {
		t.Error("未清理路径的登记也应命中")
	}
	// 空列表不应生效（视为不限定）
	if n := s.setPartialFiles("lib4", []string{" ", ""}); n != 0 {
		t.Errorf("空文件列表登记数 = %d, want 0", n)
	}
}

func TestIsHiddenDirName(t *testing.T) {
	cases := map[string]bool{
		".recycle":    true,
		".Trashes":    true,
		".@__thumb":   true,
		"._movie.mkv": true,
		"recycle":     false,
		"Movies":      false,
		"电影":          false,
		"":            false,
		" .hidden":    true, // 前后空格先 Trim
		"Season 01":   false,
		"#recycle":    false, // QNAP 风格不是以点开头，另行处理
	}
	for in, want := range cases {
		if got := isHiddenDirName(in); got != want {
			t.Errorf("isHiddenDirName(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestIsSkippedDirName(t *testing.T) {
	cases := map[string]bool{
		".recycle":  true,
		"iso":       true, // xiaoyaSkipDirs
		"extras":    true, // extrasExcludeDirs
		"Movies":    false,
		"Season 01": false,
	}
	for in, want := range cases {
		if got := isSkippedDirName(in); got != want {
			t.Errorf("isSkippedDirName(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestHasHiddenPathSegment(t *testing.T) {
	cases := map[string]bool{
		"/exposed/01V/users/admin/data/.recycle/a.mp4": true,
		"/media/.hidden/a.mkv":                         true,
		"/media/._a.mkv":                               true,
		"/media/Movies/a.mkv":                          false,
		"/media/Movies/.a.mkv":                         true,
		"/media/电影/第二季/a.mkv":                          false,
		"":                                             false,
	}
	for in, want := range cases {
		if got := hasHiddenPathSegment(in); got != want {
			t.Errorf("hasHiddenPathSegment(%q) = %v, want %v", in, got, want)
		}
	}
}
