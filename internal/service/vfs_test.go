package service

import (
	"context"
	"testing"
	"time"
)

type probeOnlyVFS struct{}

func (probeOnlyVFS) Probe() error                           { return nil }
func (probeOnlyVFS) ProbeContext(ctx context.Context) error { return nil }

func TestProbeVFSSuccess(t *testing.T) {
	if err := probeVFS(probeOnlyVFS{}, time.Second); err != nil {
		t.Fatalf("probeVFS() unexpected error: %v", err)
	}
}

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
