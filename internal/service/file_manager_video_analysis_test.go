package service

import (
	"testing"

	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"go.uber.org/zap"

	"github.com/nowen-video/nowen-video/internal/testutil"
)

func TestFileManagerDeleteCleansVideoAnalysisTasks(t *testing.T) {
	db := testutil.NewTestDB(t)
	if err := db.AutoMigrate(&model.Media{}, &model.VideoAnalysisTask{}, &model.FileOperationLog{}); err != nil {
		t.Fatal(err)
	}

	repos := repository.NewRepositories(db)
	logger := zap.NewNop().Sugar()

	// 创建媒体记录
	media := &model.Media{
		Title:     "Test Movie",
		FilePath:  "/media/test.mp4",
		MediaType: "movie",
	}
	if err := repos.Media.Create(media); err != nil {
		t.Fatal(err)
	}

	// 为该媒体创建 2 个视频分析任务
	for _, status := range []string{model.VideoAnalysisStatusSucceeded, model.VideoAnalysisStatusFailed} {
		task := &model.VideoAnalysisTask{
			MediaID:         media.ID,
			LibraryID:       "library-1",
			MediaTitle:      "Test Movie",
			VideoPath:       "/media/test.mp4",
			MappedVideoPath: "/photos/test.mp4",
			Trigger:         model.VideoAnalysisTriggerManual,
			Status:          status,
			Stage:           model.VideoAnalysisStageDone,
		}
		if err := repos.VideoAnalysis.CreateIfNoActive(task); err != nil {
			t.Fatal(err)
		}
	}

	// 创建 FileManagerService 并注入 videoAnalysisRepo
	fm := NewFileManagerService(repos.Media, nil, repos.FileOpLog, nil, nil, logger)
	fm.SetVideoAnalysisTaskRepo(repos.VideoAnalysis)

	// 删除媒体
	if err := fm.DeleteFile(media.ID, "test-user"); err != nil {
		t.Fatal(err)
	}

	// 验证视频分析任务已被清理
	tasks, total, err := repos.VideoAnalysis.List(1, 100, "", "", "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if total != 0 || len(tasks) != 0 {
		t.Fatalf("expected 0 tasks after media delete, got total=%d len=%d", total, len(tasks))
	}
}

func TestFileManagerDeleteWithoutVideoAnalysisRepo(t *testing.T) {
	db := testutil.NewTestDB(t)
	if err := db.AutoMigrate(&model.Media{}, &model.VideoAnalysisTask{}, &model.FileOperationLog{}); err != nil {
		t.Fatal(err)
	}

	repos := repository.NewRepositories(db)
	logger := zap.NewNop().Sugar()

	// 创建媒体记录
	media := &model.Media{
		Title:     "Test Movie",
		FilePath:  "/media/test.mp4",
		MediaType: "movie",
	}
	if err := repos.Media.Create(media); err != nil {
		t.Fatal(err)
	}

	// 创建任务
	task := &model.VideoAnalysisTask{
		MediaID:         media.ID,
		LibraryID:       "library-1",
		MediaTitle:      "Test Movie",
		VideoPath:       "/media/test.mp4",
		MappedVideoPath: "/photos/test.mp4",
		Trigger:         model.VideoAnalysisTriggerManual,
		Status:          model.VideoAnalysisStatusSucceeded,
		Stage:           model.VideoAnalysisStageDone,
	}
	if err := repos.VideoAnalysis.CreateIfNoActive(task); err != nil {
		t.Fatal(err)
	}

	// 创建 FileManagerService，不注入 videoAnalysisRepo
	fm := NewFileManagerService(repos.Media, nil, repos.FileOpLog, nil, nil, logger)
	// 故意不调用 fm.SetVideoAnalysisTaskRepo(...)

	// 删除媒体应该成功（清理任务是 best-effort）
	if err := fm.DeleteFile(media.ID, "test-user"); err != nil {
		t.Fatal(err)
	}

	// 视频分析任务仍然存在（因为没有注入清理逻辑）
	tasks, total, err := repos.VideoAnalysis.List(1, 100, "", "", "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(tasks) != 1 {
		t.Fatalf("expected 1 task when no cleanup repo, got total=%d len=%d", total, len(tasks))
	}
}
