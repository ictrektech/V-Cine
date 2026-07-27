package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"github.com/nowen-video/nowen-video/internal/service"

	"github.com/nowen-video/nowen-video/internal/testutil")

func setupVideoAnalysisResultHandler(t *testing.T) (*VideoAnalysisHandler, *repository.VideoAnalysisTaskRepo, string, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db := testutil.NewTestDB(t)
	if err := db.AutoMigrate(&model.Media{}, &model.VideoAnalysisTask{}); err != nil {
		t.Fatal(err)
	}
	repos := repository.NewRepositories(db)
	dir := t.TempDir()
	videoPath := filepath.Join(dir, "movie.mp4")
	if err := os.WriteFile(videoPath, []byte("video"), 0o600); err != nil {
		t.Fatal(err)
	}
	cacheRoot := filepath.Join(dir, "cache")
	mapper, err := service.NewVideoPathMapper([]config.VideoAnalysisPathMapping{{Source: dir, Target: "/photos"}})
	if err != nil {
		t.Fatal(err)
	}
	media := &model.Media{LibraryID: "library-1", Title: "Movie", FilePath: videoPath, FileSize: 5}
	if err := repos.Media.Create(media); err != nil {
		t.Fatal(err)
	}
	vaService := service.NewVideoAnalysisService(repos.VideoAnalysis, repos.Media, &fakeHandlerVideoAnalysisClient{}, mapper, nil, cacheRoot, false, nil, nil, time.Millisecond, time.Second)
	return NewVideoAnalysisHandler(vaService, nil), repos.VideoAnalysis, media.ID, cacheRoot
}

type fakeHandlerVideoAnalysisClient struct{}

func (f *fakeHandlerVideoAnalysisClient) SubmitDetectJob(context.Context, service.DetectJobRequest) (*service.ExternalJobRef, error) {
	return nil, nil
}
func (f *fakeHandlerVideoAnalysisClient) GetDetectJob(context.Context, string) (*service.ExternalJob, error) {
	return nil, nil
}
func (f *fakeHandlerVideoAnalysisClient) SubmitStructureJob(context.Context, service.StructureJobRequest) (*service.ExternalJobRef, error) {
	return nil, nil
}
func (f *fakeHandlerVideoAnalysisClient) GetStructureJob(context.Context, string) (*service.ExternalJob, error) {
	return nil, nil
}
func (f *fakeHandlerVideoAnalysisClient) SubmitDescribeJob(context.Context, service.DescribeJobRequest) (*service.ExternalJobRef, error) {
	return nil, nil
}
func (f *fakeHandlerVideoAnalysisClient) GetDescribeJob(context.Context, string) (*service.ExternalJob, error) {
	return nil, nil
}

func TestVideoAnalysisHandlerGetMediaResult(t *testing.T) {
	h, tasks, mediaID, _ := setupVideoAnalysisResultHandler(t)
	task := &model.VideoAnalysisTask{
		MediaID: mediaID, LibraryID: "library-1", MediaTitle: "Movie",
		VideoPath: "/media/movie.mp4", MappedVideoPath: "/photos/movie.mp4",
		Trigger: model.VideoAnalysisTriggerManual, Status: model.VideoAnalysisStatusSucceeded, Stage: model.VideoAnalysisStageDone,
		ResultJSON: `{"video_hash":"hash-1","metadata":{"video_path":"/photos/movie.mp4"},"grid_base_path":"scenes/hash-1","scenes":[{"scene_index":0,"start_time":0,"end_time":1,"start_frame":0,"end_frame":1}]}`,
	}
	if err := tasks.CreateIfNoActive(task); err != nil {
		t.Fatal(err)
	}

	r := gin.New()
	r.GET("/media/:id/video-analysis", h.GetMediaResult)
	req := httptest.NewRequest(http.MethodGet, "/media/"+mediaID+"/video-analysis", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestVideoAnalysisHandlerServeSceneGrid(t *testing.T) {
	h, tasks, mediaID, cacheRoot := setupVideoAnalysisResultHandler(t)
	cacheDir := filepath.Join(cacheRoot, "scenes", "hash-1")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cacheDir, "scene_000.jpg"), []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}
	task := &model.VideoAnalysisTask{
		MediaID: mediaID, LibraryID: "library-1", MediaTitle: "Movie",
		VideoPath: "/media/movie.mp4", MappedVideoPath: "/photos/movie.mp4",
		Trigger: model.VideoAnalysisTriggerManual, Status: model.VideoAnalysisStatusSucceeded, Stage: model.VideoAnalysisStageDone,
		ResultJSON: `{"video_hash":"hash-1","metadata":{"video_path":"/photos/movie.mp4"},"grid_base_path":"scenes/hash-1","scenes":[{"scene_index":0,"start_time":0,"end_time":1,"start_frame":0,"end_frame":1,"grid_image":"scene_000.jpg"}]}`,
	}
	if err := tasks.CreateIfNoActive(task); err != nil {
		t.Fatal(err)
	}

	r := gin.New()
	r.GET("/media/:id/video-analysis/scenes/:sceneIndex/grid", h.ServeSceneGrid)
	req := httptest.NewRequest(http.MethodGet, "/media/"+mediaID+"/video-analysis/scenes/0/grid?task_id="+task.ID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Content-Type"); got != "image/jpeg" {
		t.Fatalf("content-type = %q", got)
	}
}

func TestVideoAnalysisHandlerGetMediaResultNotFound(t *testing.T) {
	h, _, mediaID, _ := setupVideoAnalysisResultHandler(t)
	r := gin.New()
	r.GET("/media/:id/video-analysis", h.GetMediaResult)
	req := httptest.NewRequest(http.MethodGet, "/media/"+mediaID+"/video-analysis", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestVideoAnalysisHandlerServeSceneGridBadSceneIndex(t *testing.T) {
	h, _, mediaID, _ := setupVideoAnalysisResultHandler(t)
	r := gin.New()
	r.GET("/media/:id/video-analysis/scenes/:sceneIndex/grid", h.ServeSceneGrid)
	req := httptest.NewRequest(http.MethodGet, "/media/"+mediaID+"/video-analysis/scenes/not-a-number/grid", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}
