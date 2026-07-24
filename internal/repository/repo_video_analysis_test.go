package repository

import (
	"errors"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/nowen-video/nowen-video/internal/model"
	"gorm.io/gorm"
)

func setupVideoAnalysisRepo(t *testing.T) *VideoAnalysisTaskRepo {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.VideoAnalysisTask{}); err != nil {
		t.Fatal(err)
	}
	return NewVideoAnalysisTaskRepo(db)
}

func newVideoAnalysisTask(mediaID, status string) *model.VideoAnalysisTask {
	return &model.VideoAnalysisTask{
		MediaID: mediaID, LibraryID: "library-1", MediaTitle: mediaID,
		VideoPath: "/media/" + mediaID + ".mp4", MappedVideoPath: "/photos/" + mediaID + ".mp4",
		Trigger: model.VideoAnalysisTriggerManual, Status: status, Stage: model.VideoAnalysisStageDetect,
	}
}

func TestVideoAnalysisRepoRejectsSecondActiveTask(t *testing.T) {
	repo := setupVideoAnalysisRepo(t)
	first := newVideoAnalysisTask("media-1", model.VideoAnalysisStatusQueued)
	if err := repo.CreateIfNoActive(first); err != nil {
		t.Fatal(err)
	}
	second := newVideoAnalysisTask("media-1", model.VideoAnalysisStatusRunning)
	if err := repo.CreateIfNoActive(second); !errors.Is(err, ErrVideoAnalysisTaskActive) {
		t.Fatalf("error = %v, want ErrVideoAnalysisTaskActive", err)
	}
}

func TestVideoAnalysisRepoAllowsNewTaskAfterTerminalState(t *testing.T) {
	repo := setupVideoAnalysisRepo(t)
	first := newVideoAnalysisTask("media-1", model.VideoAnalysisStatusRunning)
	if err := repo.CreateIfNoActive(first); err != nil {
		t.Fatal(err)
	}
	first.Status = model.VideoAnalysisStatusSucceeded
	if err := repo.Update(first); err != nil {
		t.Fatal(err)
	}
	if first.ActiveKey != nil {
		t.Fatal("terminal task should clear active key")
	}
	second := newVideoAnalysisTask("media-1", model.VideoAnalysisStatusQueued)
	if err := repo.CreateIfNoActive(second); err != nil {
		t.Fatal(err)
	}
	latest, err := repo.FindLatestByMediaID("media-1")
	if err != nil {
		t.Fatal(err)
	}
	if latest.ID != second.ID {
		t.Fatalf("latest task = %q, want %q", latest.ID, second.ID)
	}
	first.ResultJSON = `{"video_hash":"hash-1"}`
	if err := repo.Update(first); err != nil {
		t.Fatal(err)
	}
	latestResult, err := repo.FindLatestResultByMediaID("media-1")
	if err != nil {
		t.Fatal(err)
	}
	if latestResult.ID != first.ID {
		t.Fatalf("latest result task = %q, want %q", latestResult.ID, first.ID)
	}
}

func TestVideoAnalysisRepoListsAndCountsTasks(t *testing.T) {
	repo := setupVideoAnalysisRepo(t)
	for _, task := range []*model.VideoAnalysisTask{
		newVideoAnalysisTask("media-1", model.VideoAnalysisStatusSucceeded),
		newVideoAnalysisTask("media-2", model.VideoAnalysisStatusQueued),
		newVideoAnalysisTask("media-3", model.VideoAnalysisStatusFailed),
	} {
		if err := repo.CreateIfNoActive(task); err != nil {
			t.Fatal(err)
		}
	}
	tasks, total, err := repo.List(1, 2, "", "library-1", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 2 || total != 3 {
		t.Fatalf("list len=%d total=%d", len(tasks), total)
	}
	counts, err := repo.CountByStatus()
	if err != nil {
		t.Fatal(err)
	}
	if counts[model.VideoAnalysisStatusQueued] != 1 || counts[model.VideoAnalysisStatusFailed] != 1 {
		t.Fatalf("counts = %#v", counts)
	}
}
