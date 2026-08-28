package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/nowen-video/nowen-video/internal/model"
)

func TestVideoAnalysisServiceCleanOrphanStructure(t *testing.T) {
	service, tasks, _ := setupVideoAnalysisService(t, &fakeVideoAnalysisClient{})
	assetDir := service.assetDir

	for _, h := range []string{"hash-1", "hash-2", "hash-3"} {
		if err := os.MkdirAll(filepath.Join(assetDir, h), 0o755); err != nil {
			t.Fatal(err)
		}
	}

	createTask := func(hash string) {
		task := &model.VideoAnalysisTask{
			MediaID:             "media-" + hash,
			LibraryID:           "library-1",
			MediaTitle:          hash,
			VideoPath:           "/media/" + hash + ".mp4",
			MappedVideoPath:     "/photos/" + hash + ".mp4",
			Trigger:             model.VideoAnalysisTriggerManual,
			Status:              model.VideoAnalysisStatusSucceeded,
			Stage:               model.VideoAnalysisStageDone,
			VideoHash:           hash,
			IncludeDescriptions: false,
		}
		if err := tasks.CreateIfNoActive(task); err != nil {
			t.Fatal(err)
		}
	}
	createTask("hash-1")
	createTask("hash-2")

	if err := service.CleanOrphanStructure(); err != nil {
		t.Fatal(err)
	}
	for _, h := range []string{"hash-1", "hash-2"} {
		if _, err := os.Stat(filepath.Join(assetDir, h)); err != nil {
			t.Fatalf("%s should remain: %v", h, err)
		}
	}
	if _, err := os.Stat(filepath.Join(assetDir, "hash-3")); !os.IsNotExist(err) {
		t.Fatalf("hash-3 should be removed, stat err=%v", err)
	}
}

func TestVideoAnalysisServiceCleanOrphanStructureRejectsUnsafeAssetDir(t *testing.T) {
	service, _, _ := setupVideoAnalysisService(t, &fakeVideoAnalysisClient{})

	for _, unsafe := range []string{"/", ".", ".."} {
		service.assetDir = unsafe
		if err := service.CleanOrphanStructure(); err == nil {
			t.Fatalf("expected error for unsafe asset dir %q", unsafe)
		}
	}

	service.assetDir = "relative/cache/structure"
	if err := service.CleanOrphanStructure(); err != nil {
		t.Fatalf("relative asset dir should be allowed, got %v", err)
	}

	service.assetDir = filepath.Join(t.TempDir(), "does-not-exist")
	if err := service.CleanOrphanStructure(); err != nil {
		t.Fatalf("missing asset dir should be a no-op, got %v", err)
	}
}
