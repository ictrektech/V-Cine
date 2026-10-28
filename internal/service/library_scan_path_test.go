package service

import "testing"

func TestPathWithinRoot(t *testing.T) {
	cases := []struct {
		name string
		p    string
		root string
		want bool
	}{
		{"等于根", "/media", "/media", true},
		{"根下文件", "/media/a.mkv", "/media", true},
		{"根下多级", "/media/x/y/a.mkv", "/media", true},
		{"尾斜杠归一化", "/media/a.mkv", "/media/", true},
		{"同前缀的兄弟目录（关键：不能误放行）", "/media2/a.mkv", "/media", false},
		{"父目录", "/media/..", "/media", false},
		{"跳出根", "/media/../etc/passwd", "/media", false},
		{"无关绝对路径", "/mnt/x", "/media", false},
		{"空路径", "", "/media", false},
		{"空根", "/media/a.mkv", "", false},
		{"库根为子目录", "/media/Movies/a.mkv", "/media/Movies", true},
		{"库根为子目录但路径在兄弟", "/media/Movies2/a.mkv", "/media/Movies", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := pathWithinRoot(tc.p, tc.root); got != tc.want {
				t.Errorf("pathWithinRoot(%q, %q) = %v, want %v", tc.p, tc.root, got, tc.want)
			}
		})
	}
}

func TestHiddenSegmentBeyondRoot(t *testing.T) {
	roots := []string{"/media/.archive", "/media/Movies"}

	cases := []struct {
		name string
		p    string
		want bool
	}{
		{"库根本身是隐藏目录：不算隐藏段", "/media/.archive/a.mkv", false},
		{"库根之下的隐藏目录", "/media/.archive/.recycle/a.mkv", true},
		{"普通库里的隐藏文件", "/media/Movies/._a.mkv", true},
		{"普通路径", "/media/Movies/a.mkv", false},
		{"不在任何库根下时按整条路径判断", "/other/.trash/a.mkv", true},
		{"不在任何库根下但无隐藏段", "/other/a.mkv", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := hiddenSegmentBeyondRoot(tc.p, roots); got != tc.want {
				t.Errorf("hiddenSegmentBeyondRoot(%q) = %v, want %v", tc.p, got, tc.want)
			}
		})
	}
}
