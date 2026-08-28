package service

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"go.uber.org/zap"

	"github.com/nowen-video/nowen-video/internal/testutil"
)

func setupFileWatcherVideoAnalysisTest(t *testing.T) (*FileWatcherService, *repository.Repositories, *model.Library, string) {
	t.Helper()
	db := testutil.NewTestDB(t)
	if err := db.AutoMigrate(&model.Library{}, &model.Media{}, &model.VideoAnalysisTask{}); err != nil {
		t.Fatal(err)
	}
	repos := repository.NewRepositories(db)
	logger := zap.NewNop().Sugar()
	dir := t.TempDir()

	fw := NewFileWatcherService(&config.Config{}, logger, repos.Library, repos.Media, repos.Series, nil, nil)
	vaClient := &fakeVideoAnalysisClient{}
	mapper, err := NewVideoPathMapper([]config.VideoAnalysisPathMapping{{Source: dir, Target: "/photos"}})
	if err != nil {
		t.Fatal(err)
	}
	vaSvc := NewVideoAnalysisService(repos.VideoAnalysis, repos.Media, vaClient, mapper, nil, nil, filepath.Join(dir, "cache"), false, nil, logger, 0, 0, nil)
	vaWorker := NewVideoAnalysisWorker(vaSvc, repos.VideoAnalysis, logger, 1)
	fw.videoAnalysis = vaSvc
	fw.videoAnalysisWorker = vaWorker

	library := &model.Library{Name: "Lib", Path: dir, Type: "movie", AutoAnalyzeVideo: true}
	if err := repos.Library.Create(library); err != nil {
		t.Fatal(err)
	}
	return fw, repos, library, dir
}

func TestFileWatcherEnqueueAutoVideoAnalysisOnlyNewMediaSinceBoundary(t *testing.T) {
	fw, repos, library, dir := setupFileWatcherVideoAnalysisTest(t)
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

	result := fw.enqueueAutoVideoAnalysis(library, since, 1)
	if result == nil {
		t.Fatal("result is nil")
	}
	if result.Created != 1 || result.Reused != 0 || result.Skipped != 0 || len(result.Errors) != 0 {
		t.Fatalf("result = %+v", result)
	}
	if len(fw.videoAnalysisWorker.wake) != 1 {
		t.Fatalf("wake queue len = %d, want 1", len(fw.videoAnalysisWorker.wake))
	}
}

func TestFileWatcherSkipsAutoVideoAnalysisWhenDisabled(t *testing.T) {
	fw, repos, library, dir := setupFileWatcherVideoAnalysisTest(t)
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

	result := fw.enqueueAutoVideoAnalysis(library, time.Now().Add(-time.Minute), 1)
	if result != nil {
		t.Fatalf("result = %+v, want nil", result)
	}
	stats, err := fw.videoAnalysis.Statistics()
	if err != nil {
		t.Fatal(err)
	}
	if stats[model.VideoAnalysisStatusQueued] != 0 {
		t.Fatalf("queued = %d, want 0", stats[model.VideoAnalysisStatusQueued])
	}
}
