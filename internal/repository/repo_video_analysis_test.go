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

func TestVideoAnalysisRepoDeleteByID(t *testing.T) {
	repo := setupVideoAnalysisRepo(t)

	queued := newVideoAnalysisTask("media-1", model.VideoAnalysisStatusQueued)
	if err := repo.CreateIfNoActive(queued); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteByID(queued.ID); err != nil {
		t.Fatalf("delete queued task: %v", err)
	}
	if _, err := repo.FindByID(queued.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("queued task still present after delete: %v", err)
	}

	running := newVideoAnalysisTask("media-2", model.VideoAnalysisStatusRunning)
	if err := repo.CreateIfNoActive(running); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteByID(running.ID); !errors.Is(err, ErrVideoAnalysisTaskActive) {
		t.Fatalf("delete running = %v, want ErrVideoAnalysisTaskActive", err)
	}
	if _, err := repo.FindByID(running.ID); err != nil {
		t.Fatalf("running task should remain: %v", err)
	}

	if err := repo.DeleteByID("missing-id"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("delete missing = %v, want ErrRecordNotFound", err)
	}
}

func TestVideoAnalysisRepoDeleteByMediaID(t *testing.T) {
	repo := setupVideoAnalysisRepo(t)

	// 创建 2 个任务属于同一个媒体，1 个属于另一个媒体
	task1 := newVideoAnalysisTask("media-to-delete", model.VideoAnalysisStatusSucceeded)
	task2 := newVideoAnalysisTask("media-to-delete", model.VideoAnalysisStatusFailed)
	task3 := newVideoAnalysisTask("media-keep", model.VideoAnalysisStatusQueued)
	for _, task := range []*model.VideoAnalysisTask{task1, task2, task3} {
		if err := repo.CreateIfNoActive(task); err != nil {
			t.Fatal(err)
		}
	}

	// 删除指定媒体的任务
	deletedCount, err := repo.DeleteByMediaID("media-to-delete")
	if err != nil {
		t.Fatal(err)
	}
	if deletedCount != 2 {
		t.Fatalf("deleted count = %d, want 2", deletedCount)
	}

	// 验证删除后该媒体没有任务
	tasks, total, err := repo.List(1, 100, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(tasks) != 1 {
		t.Fatalf("remaining tasks len=%d total=%d", len(tasks), total)
	}
	if tasks[0].MediaID != "media-keep" {
		t.Fatalf("remaining task media_id = %q, want media-keep", tasks[0].MediaID)
	}

	// 删除不存在的媒体 ID 不报错
	deletedCount, err = repo.DeleteByMediaID("non-existent")
	if err != nil {
		t.Fatal(err)
	}
	if deletedCount != 0 {
		t.Fatalf("deleted count for non-existent = %d, want 0", deletedCount)
	}

	// 空媒体 ID 不报错
	deletedCount, err = repo.DeleteByMediaID("")
	if err != nil {
		t.Fatal(err)
	}
	if deletedCount != 0 {
		t.Fatalf("deleted count for empty = %d, want 0", deletedCount)
	}
}
