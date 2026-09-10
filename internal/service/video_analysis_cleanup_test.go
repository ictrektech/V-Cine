package service

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"github.com/nowen-video/nowen-video/internal/testutil"
)

// TestRetryTaskKeepsVideoHashProtectsStructureDir 验证重试不再清空 video_hash：
// 已 claim 的 structure 目录在重试期间持续受保护，不会被孤儿清理误删。
func TestRetryTaskKeepsVideoHashProtectsStructureDir(t *testing.T) {
	service, tasks, mediaID := setupVideoAnalysisService(t, &fakeVideoAnalysisClient{})
	assetDir := service.assetDir

	// 已 claim 的 structure 目录
	dir := filepath.Join(assetDir, "hash-1")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	// 失败于 structure 阶段的任务（video_hash 已落库）
	videoPath := filepath.Join(t.TempDir(), "video.mp4")
	if err := os.WriteFile(videoPath, []byte("v"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(videoPath)
	if err != nil {
		t.Fatal(err)
	}
	task := &model.VideoAnalysisTask{
		MediaID:         mediaID,
		LibraryID:       "library-1",
		MediaTitle:      "Movie",
		VideoPath:       videoPath,
		MappedVideoPath: videoPath,
		FileSize:        info.Size(),
		FileMTime:       info.ModTime().Unix(),
		Trigger:         model.VideoAnalysisTriggerManual,
		Status:          model.VideoAnalysisStatusFailed,
		Stage:           model.VideoAnalysisStageStructure,
		VideoHash:       "hash-1",
	}
	if err := tasks.CreateIfNoActive(task); err != nil {
		t.Fatal(err)
	}

	// 重试：video_hash 必须保留
	if _, err := service.RetryTask(task.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.VideoHash != "hash-1" {
		t.Fatalf("video_hash must be kept after retry, got %q", stored.VideoHash)
	}

	// 重试期间任意一次孤儿清理都不得删除受保护的目录
	if err := service.CleanOrphanStructure(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("claimed dir should survive orphan cleanup during retry: %v", err)
	}
}

// TestFileManagerDeleteFileCleansOrphanStructureDirs 验证删除媒体后立即回收
// cache/structure 下不再被引用的孤儿目录（不再等到下一次无关清理）。
func TestFileManagerDeleteFileCleansOrphanStructureDirs(t *testing.T) {
	db := testutil.NewTestDB(t)
	if err := db.AutoMigrate(&model.Media{}, &model.VideoAnalysisTask{}, &model.FileOperationLog{}); err != nil {
		t.Fatal(err)
	}

	repos := repository.NewRepositories(db)
	assetDir := filepath.Join(t.TempDir(), "cache")

	media := &model.Media{Title: "Test Movie", FilePath: "/media/test.mp4", MediaType: "movie"}
	if err := repos.Media.Create(media); err != nil {
		t.Fatal(err)
	}
	task := &model.VideoAnalysisTask{
		MediaID:         media.ID,
		LibraryID:       "library-1",
		MediaTitle:      "Test Movie",
		VideoPath:       "/media/test.mp4",
		MappedVideoPath: "/photos/test.mp4",
		Trigger:         model.VideoAnalysisTriggerManual,
		Status:          model.VideoAnalysisStatusSucceeded,
		Stage:           model.VideoAnalysisStageDone,
		VideoHash:       "hash-1",
	}
	if err := repos.VideoAnalysis.CreateIfNoActive(task); err != nil {
		t.Fatal(err)
	}

	// structure 产物目录
	dir := filepath.Join(assetDir, "hash-1")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	client := &fakeVideoAnalysisClient{}
	vaService := NewVideoAnalysisService(repos.VideoAnalysis, repos.Media, client, nil, nil, assetDir, false, nil, nil, time.Millisecond, time.Second, nil)

	fm := NewFileManagerService(repos.Media, nil, repos.FileOpLog, nil, nil, nil)
	fm.SetVideoAnalysisTaskRepo(repos.VideoAnalysis)
	fm.SetVideoAnalysisService(vaService)

	if err := fm.DeleteFile(media.ID, "test-user"); err != nil {
		t.Fatal(err)
	}

	// 任务已删除，目录应立即被回收
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("orphan structure dir should be removed after media delete, stat err=%v", err)
	}
}

// TestCleanupOldTasksCleansOrphanedScenes 验证清理旧任务后 scenes 同步被清理
//（显式级联，不依赖 DB 的 FK 约束）。
func TestCleanupOldTasksCleansOrphanedScenes(t *testing.T) {
	db := testutil.NewTestDB(t)
	if err := db.AutoMigrate(&model.Media{}, &model.VideoAnalysisTask{}, &model.Scene{}); err != nil {
		t.Fatal(err)
	}

	repos := repository.NewRepositories(db)
	client := &fakeVideoAnalysisClient{}
	service := NewVideoAnalysisService(repos.VideoAnalysis, repos.Media, client, repos.Scene, nil, t.TempDir(), false, nil, nil, time.Millisecond, time.Second, &config.Config{})

	media := &model.Media{Title: "Test Movie", FilePath: "/media/test.mp4", MediaType: "movie"}
	if err := repos.Media.Create(media); err != nil {
		t.Fatal(err)
	}

	// 两个已成功任务，各带场景；keepRecent=1 时旧任务及其 scenes 应被清理
	taskIDs := make([]string, 0, 2)
	for _, hash := range []string{"hash-old", "hash-new"} {
		task := &model.VideoAnalysisTask{
			MediaID:         media.ID,
			LibraryID:       "library-1",
			MediaTitle:      "Test Movie",
			VideoPath:       "/media/test.mp4",
			MappedVideoPath: "/photos/test.mp4",
			Trigger:         model.VideoAnalysisTriggerManual,
			Status:          model.VideoAnalysisStatusSucceeded,
			Stage:           model.VideoAnalysisStageDone,
			VideoHash:       hash,
		}
		if err := repos.VideoAnalysis.CreateIfNoActive(task); err != nil {
			t.Fatal(err)
		}
		taskIDs = append(taskIDs, task.ID)
		scenes := []model.Scene{{SceneIndex: 0, ImagePath: "grids/scene_000.jpg"}}
		if err := repos.Scene.BatchCreate(task.ID, scenes); err != nil {
			t.Fatal(err)
		}
	}

	if _, err := service.CleanupOldTasks(1); err != nil {
		t.Fatal(err)
	}

	// 旧任务的 scenes 应被清理
	oldScenes, err := repos.Scene.GetByTaskID(taskIDs[0])
	if err != nil {
		t.Fatal(err)
	}
	if len(oldScenes) != 0 {
		t.Fatalf("scenes of cleaned task should be removed, got %d", len(oldScenes))
	}
	// 新任务的 scenes 应保留
	newScenes, err := repos.Scene.GetByTaskID(taskIDs[1])
	if err != nil {
		t.Fatal(err)
	}
	if len(newScenes) != 1 {
		t.Fatalf("scenes of kept task should remain, got %d", len(newScenes))
	}

	// 兜底方法：一致状态下无孤儿可清，不应报错
	if cleaned, err := repos.Scene.DeleteOrphaned(); err != nil {
		t.Fatal(err)
	} else if cleaned != 0 {
		t.Fatalf("expected 0 orphaned scenes in consistent state, got %d", cleaned)
	}
}

// TestVideoAnalysisRepoDeleteByMediaIDSkipsRunning 验证 DeleteByMediaID
// 不删除 running 任务（与 DeleteByID 的保护一致，避免与 worker 抢状态）。
func TestVideoAnalysisRepoDeleteByMediaIDSkipsRunning(t *testing.T) {
	db := testutil.NewTestDB(t)
	if err := db.AutoMigrate(&model.Media{}, &model.VideoAnalysisTask{}); err != nil {
		t.Fatal(err)
	}

	repos := repository.NewRepositories(db)
	media := &model.Media{Title: "Test Movie", FilePath: "/media/test.mp4", MediaType: "movie"}
	if err := repos.Media.Create(media); err != nil {
		t.Fatal(err)
	}

	running := &model.VideoAnalysisTask{
		MediaID: media.ID, LibraryID: "library-1", MediaTitle: "Test Movie",
		VideoPath: "/media/test.mp4", MappedVideoPath: "/photos/test.mp4",
		Trigger: model.VideoAnalysisTriggerManual,
		Status:  model.VideoAnalysisStatusRunning,
		Stage:   model.VideoAnalysisStageStructure,
	}
	if err := repos.VideoAnalysis.CreateIfNoActive(running); err != nil {
		t.Fatal(err)
		return
	}
	succeeded := &model.VideoAnalysisTask{
		MediaID: media.ID, LibraryID: "library-1", MediaTitle: "Test Movie",
		VideoPath: "/media/test.mp4", MappedVideoPath: "/photos/test.mp4",
		Trigger: model.VideoAnalysisTriggerManual,
		Status:  model.VideoAnalysisStatusSucceeded,
		Stage:   model.VideoAnalysisStageDone,
	}
	if err := repos.VideoAnalysis.CreateIfNoActive(succeeded); err != nil {
		t.Fatal(err)
	}

	deleted, err := repos.VideoAnalysis.DeleteByMediaID(media.ID)
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 1 {
		t.Fatalf("expected only the terminal task to be deleted, deleted=%d", deleted)
	}
	if _, err := repos.VideoAnalysis.FindByID(running.ID); err != nil {
		t.Fatalf("running task must survive DeleteByMediaID: %v", err)
	}
	if _, err := repos.VideoAnalysis.FindByID(succeeded.ID); err == nil {
		t.Fatal("terminal task should be deleted by DeleteByMediaID")
	}
}

// TestFileManagerBatchDeleteFilesCleansOrphanStructureDirs 验证批量删除在全部结束后
// 统一回收一次孤儿目录（而非每个媒体各做一次全目录扫描）。
func TestFileManagerBatchDeleteFilesCleansOrphanStructureDirs(t *testing.T) {
	db := testutil.NewTestDB(t)
	if err := db.AutoMigrate(&model.Media{}, &model.VideoAnalysisTask{}, &model.FileOperationLog{}); err != nil {
		t.Fatal(err)
	}

	repos := repository.NewRepositories(db)
	assetDir := filepath.Join(t.TempDir(), "cache")

	client := &fakeVideoAnalysisClient{}
	vaService := NewVideoAnalysisService(repos.VideoAnalysis, repos.Media, client, nil, nil, assetDir, false, nil, nil, time.Millisecond, time.Second, nil)

	fm := NewFileManagerService(repos.Media, nil, repos.FileOpLog, nil, nil, nil)
	fm.SetVideoAnalysisTaskRepo(repos.VideoAnalysis)
	fm.SetVideoAnalysisService(vaService)

	mediaIDs := make([]string, 0, 2)
	for _, hash := range []string{"hash-1", "hash-2"} {
		media := &model.Media{Title: "Movie " + hash, FilePath: "/media/" + hash + ".mp4", MediaType: "movie"}
		if err := repos.Media.Create(media); err != nil {
			t.Fatal(err)
		}
		task := &model.VideoAnalysisTask{
			MediaID: media.ID, LibraryID: "library-1", MediaTitle: "Movie " + hash,
			VideoPath: "/media/" + hash + ".mp4", MappedVideoPath: "/photos/" + hash + ".mp4",
			Trigger: model.VideoAnalysisTriggerManual,
			Status:  model.VideoAnalysisStatusSucceeded, Stage: model.VideoAnalysisStageDone,
			VideoHash: hash,
		}
		if err := repos.VideoAnalysis.CreateIfNoActive(task); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Join(assetDir, hash), 0o755); err != nil {
			t.Fatal(err)
		}
		mediaIDs = append(mediaIDs, media.ID)
	}

	if deleted, errList := fm.BatchDeleteFiles(mediaIDs, "test-user"); errList != nil || deleted != 2 {
		t.Fatalf("batch delete deleted=%d errors=%v", deleted, errList)
	}

	for _, hash := range []string{"hash-1", "hash-2"} {
		if _, err := os.Stat(filepath.Join(assetDir, hash)); !os.IsNotExist(err) {
			t.Fatalf("orphan dir %s should be removed after batch delete, stat err=%v", hash, err)
		}
	}
}
