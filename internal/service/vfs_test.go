package service

import "testing"

func TestTrimRemoteRoot(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"webdav://", "webdav://"},
		{"webdav:///", "webdav://"},
		{"webdav:///foo/", "webdav:///foo"},
		{"webdav://foo/", "webdav://foo"},
		{"alist:///dir/", "alist:///dir"},
		{"s3://bucket/", "s3://bucket"},
		{"/data/a/", "/data/a"},
		{"/data/a", "/data/a"},
	}
	for _, tt := range tests {
		if got := trimRemoteRoot(tt.in); got != tt.want {
			t.Errorf("trimRemoteRoot(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
