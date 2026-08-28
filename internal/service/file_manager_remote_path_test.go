package service

import (
	"io/fs"
	"path/filepath"
	"testing"

	"go.uber.org/zap"
)

func TestRemotePathParts(t *testing.T) {
	tests := []struct {
		path   string
		scheme string
		parts  []string
		ok     bool
	}{
		{"webdav://test-webdav/素材.mp4", "webdav://", []string{"test-webdav", "素材.mp4"}, true},
		{"webdav://", "webdav://", nil, true},
		{"alist://nas/视频/a.mp4", "alist://", []string{"nas", "视频", "a.mp4"}, true},
		{"s3://bucket/key/file.mkv", "s3://", []string{"bucket", "key", "file.mkv"}, true},
		{"/data/movies/a.mp4", "", nil, false},
	}
	for _, tt := range tests {
		scheme, parts, ok := remotePathParts(tt.path)
		if ok != tt.ok {
			t.Errorf("remotePathParts(%q) ok = %v, want %v", tt.path, ok, tt.ok)
			continue
		}
		if scheme != tt.scheme {
			t.Errorf("remotePathParts(%q) scheme = %q, want %q", tt.path, scheme, tt.scheme)
		}
		if len(parts) != len(tt.parts) {
			t.Errorf("remotePathParts(%q) parts = %#v, want %#v", tt.path, parts, tt.parts)
			continue
		}
		for i := range parts {
			if parts[i] != tt.parts[i] {
				t.Errorf("remotePathParts(%q) parts[%d] = %q, want %q", tt.path, i, parts[i], tt.parts[i])
			}
		}
	}
}

func TestRemoteDirName(t *testing.T) {
	tests := map[string]string{
		"webdav://":            "webdav://",
		"webdav://test-webdav": "test-webdav",
		"webdav://a/b/Movies":  "Movies",
		"/media/movies":        "movies",
	}
	for dir, want := range tests {
		if got := remoteDirName(dir); got != want {
			t.Errorf("remoteDirName(%q) = %q, want %q", dir, got, want)
		}
	}
}

func TestRemoteDirParent(t *testing.T) {
	tests := map[string]string{
		"webdav://":            "",
		"webdav://test-webdav": "webdav://",
		"webdav://a/b":         "webdav://a",
		"/media/movies":        "/media",
	}
	for dir, want := range tests {
		if got := remoteDirParent(dir); got != want {
			t.Errorf("remoteDirParent(%q) = %q, want %q", dir, got, want)
		}
	}
}

type walkProbeVFS struct {
	walkFn func(root string, fn filepath.WalkFunc) error
}

func (v walkProbeVFS) Open(string) (VFSFile, error) { return nil, nil }
func (v walkProbeVFS) ReadDir(string) ([]fs.DirEntry, error) {
	return nil, nil
}
func (v walkProbeVFS) Stat(string) (fs.FileInfo, error) { return nil, nil }
func (v walkProbeVFS) Walk(root string, fn filepath.WalkFunc) error {
	return v.walkFn(root, fn)
}
func (v walkProbeVFS) Type() string { return "webdav" }

func TestVFSManagerWalkRemotePaths(t *testing.T) {
	m := NewVFSManager(zap.NewNop().Sugar())

	tests := []struct {
		name string
		root string
		p    string
		want string
	}{
		{"media root", "webdav://media", "/media", "webdav://media"},
		{"media nested", "webdav://media", "/media/Movie/a.mkv", "webdav://media/Movie/a.mkv"},
		{"scheme root", "webdav://", "/", "webdav://"},
		{"scheme root nested", "webdav://", "/test-webdav/素材.mp4", "webdav://test-webdav/素材.mp4"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m.SetGlobalWebDAVFS(walkProbeVFS{walkFn: func(_ string, fn filepath.WalkFunc) error {
				return fn(tt.p, nil, nil)
			}})
			var got []string
			err := m.Walk(tt.root, func(p string, _ fs.FileInfo, _ error) error {
				got = append(got, p)
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != 1 || got[0] != tt.want {
				t.Fatalf("Walk(%q) = %v, want [%q]", tt.root, got, tt.want)
			}
		})
	}
}
