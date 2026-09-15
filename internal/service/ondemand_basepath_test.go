package service

import (
	"strings"
	"testing"
)

func TestBuildAudioMediaEntries_basePath(t *testing.T) {
	tracks := []AudioTrackInfo{
		{Title: "国语", Language: "zh", AudioIdx: 0, Codec: "aac", Default: true},
		{Title: "日语", Language: "ja", AudioIdx: 1, Codec: "aac", Default: false},
	}

	// 根路径：basePath 为空，输出与旧行为一致（/api/audio-track/...）
	root := buildAudioMediaEntries("m1", tracks, "")
	if !strings.Contains(root, `URI="/api/audio-track/m1/0.m3u8"`) {
		t.Fatalf("root path: expected /api/audio-track/m1/0.m3u8, got:\n%s", root)
	}
	if strings.Contains(root, "/app/com.ictrek.v-cine") {
		t.Fatalf("root path: should not contain basePath prefix, got:\n%s", root)
	}

	// VOS 子路径：URI 应带前缀，经 Traefik 剥回后命中 /api/audio-track
	base := "/app/com.ictrek.v-cine"
	prefixed := buildAudioMediaEntries("m1", tracks, base)
	if !strings.Contains(prefixed, `URI="/app/com.ictrek.v-cine/api/audio-track/m1/0.m3u8"`) {
		t.Fatalf("subpath: expected prefixed URI, got:\n%s", prefixed)
	}
	if strings.Contains(prefixed, `URI="/app/com.ictrek.v-cine/app/com.ictrek.v-cine`) {
		t.Fatalf("subpath: URI should not double-prefix, got:\n%s", prefixed)
	}
}
