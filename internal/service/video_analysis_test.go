package service

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"gorm.io/gorm"
)

type fakeVideoAnalysisClient struct {
	detectSubmits    []DetectJobRequest
	structureSubmits []StructureJobRequest
	structureError   error
}

func (f *fakeVideoAnalysisClient) SubmitDetectJob(_ context.Context, request DetectJobRequest) (*ExternalJobRef, error) {
	f.detectSubmits = append(f.detectSubmits, request)
	return &ExternalJobRef{JobID: "detect-1", Status: "queued", PollURL: "/api/v2/scenes/detect/jobs/detect-1"}, nil
}

func (f *fakeVideoAnalysisClient) GetDetectJob(context.Context, string) (*ExternalJob, error) {
	result, _ := json.Marshal(map[string]any{"scenes": []SceneBoundary{{SceneIndex: 0, StartFrame: 0, EndFrame: 10, StartTime: 0, EndTime: 1}}})
	return &ExternalJob{JobID: "detect-1", Status: "succeeded", Result: result}, nil
}

func (f *fakeVideoAnalysisClient) SubmitStructureJob(_ context.Context, request StructureJobRequest) (*ExternalJobRef, error) {
	f.structureSubmits = append(f.structureSubmits, request)
	if f.structureError != nil && request.DetectJobID != "" {
		return nil, f.structureError
	}
	return &ExternalJobRef{JobID: "structure-1", Status: "queued", PollURL: "/api/v2/video/structure/jobs/structure-1"}, nil
}

func (f *fakeVideoAnalysisClient) GetStructureJob(context.Context, string) (*ExternalJob, error) {
	result, _ := json.Marshal(map[string]any{"video_hash": "hash-1", "scenes": []any{}})
	return &ExternalJob{JobID: "structure-1", Status: "succeeded", Result: result}, nil
}

func setupVideoAnalysisService(t *testing.T, client videoAnalysisExternalClient) (*VideoAnalysisService, *repository.VideoAnalysisTaskRepo, string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Media{}, &model.VideoAnalysisTask{}); err != nil {
		t.Fatal(err)
	}
	repos := repository.NewRepositories(db)
	dir := t.TempDir()
	videoPath := filepath.Join(dir, "movie.mp4")
	if err := os.WriteFile(videoPath, []byte("video"), 0600); err != nil {
		t.Fatal(err)
	}
	media := &model.Media{LibraryID: "library-1", Title: "Movie", FilePath: videoPath, FileSize: 5}
	if err := repos.Media.Create(media); err != nil {
		t.Fatal(err)
	}
	mapper, err := NewVideoPathMapper([]config.VideoAnalysisPathMapping{{Source: dir, Target: "/photos"}})
	if err != nil {
		t.Fatal(err)
	}
	service := NewVideoAnalysisService(repos.VideoAnalysis, repos.Media, client, mapper, nil, nil, time.Millisecond, time.Second)
	return service, repos.VideoAnalysis, media.ID
}

func TestVideoAnalysisServiceProcessesDetectAndStructure(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	task, reused, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil || reused {
		t.Fatalf("SubmitMedia reused=%v err=%v", reused, err)
	}
	if err := service.ProcessTask(context.Background(), task.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.VideoAnalysisStatusSucceeded || stored.VideoHash != "hash-1" || stored.ActiveKey != nil {
		t.Fatalf("unexpected task: %+v", stored)
	}
	if len(client.structureSubmits) != 1 || client.structureSubmits[0].VideoPath != "/photos/movie.mp4" || client.structureSubmits[0].DetectJobID != "detect-1" {
		t.Fatalf("structure submits: %+v", client.structureSubmits)
	}
}

func TestVideoAnalysisServiceFallsBackToScenesOnce(t *testing.T) {
	client := &fakeVideoAnalysisClient{structureError: &VideoAnalysisAPIError{HTTPStatus: 200, Code: 70201, Message: "detect job not found"}}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ProcessTask(context.Background(), task.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !stored.FallbackUsed || len(client.structureSubmits) != 2 || len(client.structureSubmits[1].Scenes) != 1 || client.structureSubmits[1].DetectJobID != "" {
		t.Fatalf("fallback task=%+v submits=%+v", stored, client.structureSubmits)
	}
}

func TestVideoAnalysisServiceReusesActiveTask(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, _, mediaID := setupVideoAnalysisService(t, client)
	first, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}
	second, reused, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil || !reused || first.ID != second.ID {
		t.Fatalf("second=%+v reused=%v err=%v", second, reused, err)
	}
}
