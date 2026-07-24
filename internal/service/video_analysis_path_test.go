package service

import (
	"path/filepath"
	"testing"

	"github.com/nowen-video/nowen-video/internal/config"
)

func TestVideoPathMapperUsesLongestMatchingPrefix(t *testing.T) {
	mapper, err := NewVideoPathMapper([]config.VideoAnalysisPathMapping{
		{Source: "/media", Target: "/photos"},
		{Source: "/media/private", Target: "/restricted"},
	})
	if err != nil {
		t.Fatal(err)
	}

	got, err := mapper.Map("/media/private/movie.mp4")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join("/restricted", "movie.mp4")
	if got != want {
		t.Fatalf("Map() = %q, want %q", got, want)
	}
}

func TestVideoPathMapperMatchesPathBoundary(t *testing.T) {
	mapper, err := NewVideoPathMapper([]config.VideoAnalysisPathMapping{{Source: "/media", Target: "/photos"}})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := mapper.Map("/media-other/movie.mp4"); err == nil {
		t.Fatal("Map() should reject a textual prefix that is not a path boundary")
	}
}

func TestVideoPathMapperRejectsInvalidInput(t *testing.T) {
	for _, mappings := range [][]config.VideoAnalysisPathMapping{
		{{Source: "media", Target: "/photos"}},
		{{Source: "/media", Target: "photos"}},
		{{Source: "", Target: "/photos"}},
	} {
		if _, err := NewVideoPathMapper(mappings); err == nil {
			t.Fatalf("NewVideoPathMapper(%v) should fail", mappings)
		}
	}

	mapper, err := NewVideoPathMapper([]config.VideoAnalysisPathMapping{{Source: "/media", Target: "/photos"}})
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []string{"", "relative/movie.mp4", "/other/movie.mp4"} {
		if _, err := mapper.Map(input); err == nil {
			t.Fatalf("Map(%q) should fail", input)
		}
	}
}
