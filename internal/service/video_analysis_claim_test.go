package service

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/nowen-video/nowen-video/internal/model"
)

func newClaimArtifactTestService(t *testing.T, client videoAnalysisExternalClient, resultJSON string) (*VideoAnalysisService, *model.VideoAnalysisTask) {
	t.Helper()
	svc, _, mediaID := setupVideoAnalysisService(t, client)
	svc.assetDir = filepath.Join(t.TempDir(), "asset")
	task := &model.VideoAnalysisTask{
		ID:              "t1",
		MediaID:         mediaID,
		LibraryID:       "library-1",
		MediaTitle:      "movie",
		VideoPath:       "/media/movie.mp4",
		MappedVideoPath: "/photos/movie.mp4",
		Trigger:         model.VideoAnalysisTriggerManual,
		Status:          model.VideoAnalysisStatusRunning,
		Stage:           model.VideoAnalysisStageStructure,
		StructureJobID:  "structure-1",
		ResultJSON:      resultJSON,
	}
	if err := svc.tasks.CreateIfNoActive(task); err != nil {
		t.Fatal(err)
	}
	return svc, task
}

func TestClaimArtifactForTaskDownloadsAndReleases(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	const resultJSON = `{"video_hash":"hash-1","artifact":{"files":[{"path":"manifest.json","size":2},{"path":"grids/scene_000.jpg","size":4}]}}`
	svc, task := newClaimArtifactTestService(t, client, resultJSON)
	if err := svc.claimArtifactsForTask(task); err != nil {
		t.Fatal(err)
	}
	if client.downloadCalls != 1 || client.releaseCalls != 1 {
		t.Fatalf("downloadCalls=%d releaseCalls=%d, want 1/1", client.downloadCalls, client.releaseCalls)
	}
	if !fileExists(filepath.Join(svc.assetDir, "hash-1", "manifest.json")) {
		t.Fatal("manifest.json missing after artifact claim")
	}
	if !fileExists(filepath.Join(svc.assetDir, "hash-1", "grids", "scene_000.jpg")) {
		t.Fatal("grid image missing after artifact claim")
	}
}

func TestClaimArtifactForTaskIdempotentWhenTargetExists(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	const resultJSON = `{"video_hash":"hash-1","artifact":{"files":[{"path":"manifest.json","size":2}]}}`
	svc, task := newClaimArtifactTestService(t, client, resultJSON)
	if err := os.MkdirAll(filepath.Join(svc.assetDir, "hash-1", "grids"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.assetDir, "hash-1", "manifest.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := svc.claimArtifactsForTask(task); err != nil {
		t.Fatal(err)
	}
	if client.downloadCalls != 0 || client.releaseCalls != 0 {
		t.Fatalf("downloadCalls=%d releaseCalls=%d, want 0/0 (idempotent skip)", client.downloadCalls, client.releaseCalls)
	}
}

func TestClaimArtifactForTaskCleansTmpOnDownloadError(t *testing.T) {
	client := &fakeVideoAnalysisClient{downloadErr: errors.New("boom")}
	const resultJSON = `{"video_hash":"hash-1","artifact":{"files":[{"path":"manifest.json","size":2}]}}`
	svc, task := newClaimArtifactTestService(t, client, resultJSON)
	if err := svc.claimArtifactsForTask(task); err == nil {
		t.Fatal("expected download error")
	}
	if client.releaseCalls != 0 {
		t.Fatalf("release should not be called after download error, got %d", client.releaseCalls)
	}
	if dirExists(filepath.Join(svc.assetDir, "hash-1", "manifest.json")) {
		t.Fatal("partial artifact must not remain")
	}
}
