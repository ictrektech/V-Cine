package repository

import (
	"errors"
	"testing"
	"time"

	"github.com/nowen-video/nowen-video/internal/model"
	"gorm.io/gorm"

	"github.com/nowen-video/nowen-video/internal/testutil"
)

func setupVideoAnalysisRepo(t *testing.T) *VideoAnalysisTaskRepo {
	t.Helper()
	db := testutil.NewTestDB(t)
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
	tasks, total, err := repo.List(1, 2, "", "library-1", "", "", false)
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

func TestVideoAnalysisRepoListVideoHashes(t *testing.T) {
	repo := setupVideoAnalysisRepo(t)

	tasks := []*model.VideoAnalysisTask{
		newVideoAnalysisTask("media-1", model.VideoAnalysisStatusSucceeded),
		newVideoAnalysisTask("media-2", model.VideoAnalysisStatusSucceeded),
		newVideoAnalysisTask("media-3", model.VideoAnalysisStatusFailed),
		newVideoAnalysisTask("media-4", model.VideoAnalysisStatusSucceeded),
	}
	tasks[0].VideoHash = "hash-1"
	tasks[1].VideoHash = "hash-1"
	tasks[2].VideoHash = "hash-2"
	// tasks[3].VideoHash 保持为空，不应出现在结果中
	for _, task := range tasks {
		if err := repo.CreateIfNoActive(task); err != nil {
			t.Fatal(err)
		}
	}

	hashes, err := repo.ListVideoHashes()
	if err != nil {
		t.Fatal(err)
	}
	if len(hashes) != 2 {
		t.Fatalf("hashes = %v, want [hash-1 hash-2]", hashes)
	}
	set := make(map[string]bool, len(hashes))
	for _, h := range hashes {
		set[h] = true
	}
	if !set["hash-1"] || !set["hash-2"] {
		t.Fatalf("hashes = %v, want hash-1 and hash-2", hashes)
	}
}

func TestVideoAnalysisRepoCleanupOldTasksKeepsPerMedia(t *testing.T) {
	repo := setupVideoAnalysisRepo(t)
	base := time.Now()

	// media-1 6 条成功任务，media-2 2 条失败任务
	for i := 0; i < 6; i++ {
		task := newVideoAnalysisTask("media-1", model.VideoAnalysisStatusSucceeded)
		task.CreatedAt = base.Add(time.Duration(i) * time.Minute)
		if err := repo.CreateIfNoActive(task); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		task := newVideoAnalysisTask("media-2", model.VideoAnalysisStatusFailed)
		task.CreatedAt = base.Add(time.Duration(i) * time.Minute)
		if err := repo.CreateIfNoActive(task); err != nil {
			t.Fatal(err)
		}
	}

	deleted, err := repo.CleanupOldTasks(5)
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 1 {
		t.Fatalf("deleted = %d, want 1", deleted)
	}

	var media1Count, media2Count int64
	if err := repo.db.Model(&model.VideoAnalysisTask{}).Where("media_id = ?", "media-1").Count(&media1Count).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.db.Model(&model.VideoAnalysisTask{}).Where("media_id = ?", "media-2").Count(&media2Count).Error; err != nil {
		t.Fatal(err)
	}
	if media1Count != 5 || media2Count != 2 {
		t.Fatalf("media counts = m1:%d m2:%d, want m1:5 m2:2", media1Count, media2Count)
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
	tasks, total, err := repo.List(1, 100, "", "", "", "", false)
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

func TestVideoAnalysisRepoListGroupsByMedia(t *testing.T) {
	repo := setupVideoAnalysisRepo(t)
	first := newVideoAnalysisTask("media-1", model.VideoAnalysisStatusSucceeded)
	first.CreatedAt = time.Now().Add(-time.Hour)
	if err := repo.CreateIfNoActive(first); err != nil {
		t.Fatal(err)
	}
	second := newVideoAnalysisTask("media-1", model.VideoAnalysisStatusRunning)
	second.CreatedAt = time.Now()
	if err := repo.CreateIfNoActive(second); err != nil {
		t.Fatal(err)
	}
	other := newVideoAnalysisTask("media-2", model.VideoAnalysisStatusFailed)
	if err := repo.CreateIfNoActive(other); err != nil {
		t.Fatal(err)
	}

	// 分组：每个媒体仅返回最新一条，按时间倒序
	tasks, total, err := repo.List(1, 10, "", "", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || len(tasks) != 2 {
		t.Fatalf("grouped list = %d tasks (total %d), want 2", len(tasks), total)
	}
	if tasks[0].MediaID != "media-2" {
		t.Fatalf("first group = %q, want latest media media-2", tasks[0].MediaID)
	}
	if tasks[1].ID != second.ID {
		t.Fatalf("media-1 group head = %q, want latest %q", tasks[1].ID, second.ID)
	}

	// 组头状态过滤：running 的 media-1 命中，succeeded 的历史不参与
	tasks, total, err = repo.List(1, 10, model.VideoAnalysisStatusRunning, "", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(tasks) != 1 || tasks[0].MediaID != "media-1" {
		t.Fatalf("status-filtered groups = %d tasks (total %d), want only media-1", len(tasks), total)
	}

	// media_id 过滤：返回该媒体全部历史（含旧记录）
	tasks, total, err = repo.List(1, 10, "", "", "", "media-1", false)
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || len(tasks) != 2 {
		t.Fatalf("media history = %d tasks (total %d), want 2", len(tasks), total)
	}
	if tasks[0].ID != second.ID || tasks[1].ID != first.ID {
		t.Fatalf("media history order = %q, %q; want newest first", tasks[0].ID, tasks[1].ID)
	}
}

func TestVideoAnalysisRepoAssignMediaSeq(t *testing.T) {
	repo := setupVideoAnalysisRepo(t)
	first := newVideoAnalysisTask("media-1", model.VideoAnalysisStatusFailed)
	first.CreatedAt = time.Now().Add(-2 * time.Hour)
	if err := repo.CreateIfNoActive(first); err != nil {
		t.Fatal(err)
	}
	second := newVideoAnalysisTask("media-1", model.VideoAnalysisStatusPartial)
	second.CreatedAt = time.Now().Add(-time.Hour)
	if err := repo.CreateIfNoActive(second); err != nil {
		t.Fatal(err)
	}
	third := newVideoAnalysisTask("media-1", model.VideoAnalysisStatusRunning)
	third.CreatedAt = time.Now()
	if err := repo.CreateIfNoActive(third); err != nil {
		t.Fatal(err)
	}
	other := newVideoAnalysisTask("media-2", model.VideoAnalysisStatusSucceeded)
	if err := repo.CreateIfNoActive(other); err != nil {
		t.Fatal(err)
	}

	// 分组列表：组头为每个媒体最新一条，seq = 该媒体第几次执行
	tasks, _, err := repo.List(1, 10, "", "", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 2 {
		t.Fatalf("grouped list = %d tasks, want 2", len(tasks))
	}
	if tasks[0].MediaID != "media-2" || tasks[0].Seq != 1 {
		t.Fatalf("media-2 seq = %d, want 1", tasks[0].Seq)
	}
	if tasks[1].ID != third.ID || tasks[1].Seq != 3 {
		t.Fatalf("media-1 latest seq = %d, want 3", tasks[1].Seq)
	}

	// 媒体历史：按创建时间升序编号（最新一次最大）
	tasks, _, err = repo.List(1, 10, "", "", "", "media-1", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 3 {
		t.Fatalf("media history = %d tasks, want 3", len(tasks))
	}
	if tasks[0].Seq != 3 || tasks[1].Seq != 2 || tasks[2].Seq != 1 {
		t.Fatalf("media history seqs = %d, %d, %d; want 3, 2, 1", tasks[0].Seq, tasks[1].Seq, tasks[2].Seq)
	}

	// 单任务查询
	got, err := repo.FindByID(second.ID)
	if err != nil {
		t.Fatal(err)
	}
	batch := []model.VideoAnalysisTask{*got}
	repo.AssignMediaSeq(batch)
	*got = batch[0]
	if got.Seq != 2 {
		t.Fatalf("AssignMediaSeq seq = %d, want 2", got.Seq)
	}
}
