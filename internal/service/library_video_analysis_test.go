package service

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

func setupLibraryVideoAnalysisTest(t *testing.T) (*LibraryService, *repository.Repositories, *model.Library, string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Library{}, &model.Media{}, &model.VideoAnalysisTask{}); err != nil {
		t.Fatal(err)
	}
	repos := repository.NewRepositories(db)
	logger := zap.NewNop().Sugar()
	dir := t.TempDir()

	libSvc := NewLibraryService(repos.Library, repos.Media, repos.Series, repos.Favorite, repos.WatchHistory, repos.MediaPerson, repos.ScanClassification, &config.Config{}, nil, nil, logger)
	vaClient := &fakeVideoAnalysisClient{}
	mapper, err := NewVideoPathMapper([]config.VideoAnalysisPathMapping{{Source: dir, Target: "/photos"}})
	if err != nil {
		t.Fatal(err)
	}
	vaSvc := NewVideoAnalysisService(repos.VideoAnalysis, repos.Media, vaClient, mapper, filepath.Join(dir, "cache"), nil, logger, 0, 0)
	vaWorker := NewVideoAnalysisWorker(vaSvc, repos.VideoAnalysis, logger, 1)
	libSvc.videoAnalysis = vaSvc
	libSvc.videoAnalysisWorker = vaWorker

	library := &model.Library{Name: "Lib", Path: dir, Type: "movie", AutoAnalyzeVideo: true}
	if err := repos.Library.Create(library); err != nil {
		t.Fatal(err)
	}
	return libSvc, repos, library, dir
}

func TestLibraryServiceEnqueueAutoVideoAnalysisOnlyNewMediaSinceBoundary(t *testing.T) {
	libSvc, repos, library, dir := setupLibraryVideoAnalysisTest(t)
	videoPathOld := filepath.Join(dir, "movie-old.mp4")
	videoPathNew := filepath.Join(dir, "movie-new.mp4")
	if err := os.WriteFile(videoPathOld, []byte("video-old"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(videoPathNew, []byte("video-new"), 0600); err != nil {
		t.Fatal(err)
	}

	oldMedia := &model.Media{LibraryID: library.ID, Title: "Old Movie", FilePath: videoPathOld, FileSize: 1}
	if err := repos.Media.Create(oldMedia); err != nil {
		t.Fatal(err)
	}
	since := time.Now()
	time.Sleep(10 * time.Millisecond)
	newMedia := &model.Media{LibraryID: library.ID, Title: "New Movie", FilePath: videoPathNew, FileSize: 1}
	if err := repos.Media.Create(newMedia); err != nil {
		t.Fatal(err)
	}

	result := libSvc.enqueueAutoVideoAnalysis(library, since, 1)
	if result == nil {
		t.Fatal("result is nil")
	}
	if result.Created != 1 || result.Reused != 0 || result.Skipped != 0 || len(result.Errors) != 0 {
		t.Fatalf("result = %+v", result)
	}

	list, total, err := repos.VideoAnalysis.List(1, 10, "", library.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1", total)
	}
	if len(list) != 1 {
		t.Fatalf("task count = %d, want 1", len(list))
	}
	if list[0].MediaID != newMedia.ID {
		t.Fatalf("task media_id = %q, want %q", list[0].MediaID, newMedia.ID)
	}
	if len(libSvc.videoAnalysisWorker.wake) != 1 {
		t.Fatalf("wake queue len = %d, want 1", len(libSvc.videoAnalysisWorker.wake))
	}
}

func TestLibraryServiceSkipsAutoVideoAnalysisWhenDisabled(t *testing.T) {
	libSvc, repos, library, dir := setupLibraryVideoAnalysisTest(t)
	library.AutoAnalyzeVideo = false
	if err := repos.Library.Update(library); err != nil {
		t.Fatal(err)
	}
	videoPath := filepath.Join(dir, "movie.mp4")
	if err := os.WriteFile(videoPath, []byte("video"), 0600); err != nil {
		t.Fatal(err)
	}
	media := &model.Media{LibraryID: library.ID, Title: "Movie", FilePath: videoPath, FileSize: 1}
	if err := repos.Media.Create(media); err != nil {
		t.Fatal(err)
	}

	result := libSvc.enqueueAutoVideoAnalysis(library, time.Now().Add(-time.Minute), 1)
	if result != nil {
		t.Fatalf("result = %+v, want nil", result)
	}

	stats, err := libSvc.videoAnalysis.Statistics()
	if err != nil {
		t.Fatal(err)
	}
	if stats[model.VideoAnalysisStatusQueued] != 0 {
		t.Fatalf("queued = %d, want 0", stats[model.VideoAnalysisStatusQueued])
	}
	if len(libSvc.videoAnalysisWorker.wake) != 0 {
		t.Fatalf("wake queue len = %d, want 0", len(libSvc.videoAnalysisWorker.wake))
	}
}

func TestLibraryServiceSkipsAutoVideoAnalysisWhenNoNewMedia(t *testing.T) {
	libSvc, repos, library, dir := setupLibraryVideoAnalysisTest(t)
	videoPath := filepath.Join(dir, "movie.mp4")
	if err := os.WriteFile(videoPath, []byte("video"), 0600); err != nil {
		t.Fatal(err)
	}
	media := &model.Media{LibraryID: library.ID, Title: "Movie", FilePath: videoPath, FileSize: 1}
	if err := repos.Media.Create(media); err != nil {
		t.Fatal(err)
	}

	result := libSvc.enqueueAutoVideoAnalysis(library, time.Now().Add(-time.Minute), 0)
	if result != nil {
		t.Fatalf("result = %+v, want nil", result)
	}

	stats, err := libSvc.videoAnalysis.Statistics()
	if err != nil {
		t.Fatal(err)
	}
	if stats[model.VideoAnalysisStatusQueued] != 0 {
		t.Fatalf("queued = %d, want 0", stats[model.VideoAnalysisStatusQueued])
	}
	if len(libSvc.videoAnalysisWorker.wake) != 0 {
		t.Fatalf("wake queue len = %d, want 0", len(libSvc.videoAnalysisWorker.wake))
	}
}
