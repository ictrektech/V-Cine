package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/nowen-video/nowen-video/internal/model"
)

func TestVideoAnalysisServiceCleanOrphanStructure(t *testing.T) {
	service, tasks, _ := setupVideoAnalysisService(t, &fakeVideoAnalysisClient{})
	assetDir := service.assetDir

	for _, h := range []string{"hash-1", "hash-2", "hash-3"} {
		if err := os.MkdirAll(filepath.Join(assetDir, h), 0o755); err != nil {
			t.Fatal(err)
		}
	}

	createTask := func(hash string) {
		task := &model.VideoAnalysisTask{
			MediaID:             "media-" + hash,
			LibraryID:           "library-1",
			MediaTitle:          hash,
			VideoPath:           "/media/" + hash + ".mp4",
			MappedVideoPath:     "/photos/" + hash + ".mp4",
			Trigger:             model.VideoAnalysisTriggerManual,
			Status:              model.VideoAnalysisStatusSucceeded,
			Stage:               model.VideoAnalysisStageDone,
			VideoHash:           hash,
			IncludeDescriptions: false,
		}
		if err := tasks.CreateIfNoActive(task); err != nil {
			t.Fatal(err)
		}
	}
	createTask("hash-1")
	createTask("hash-2")

	if err := service.CleanOrphanStructure(); err != nil {
		t.Fatal(err)
	}
	for _, h := range []string{"hash-1", "hash-2"} {
		if _, err := os.Stat(filepath.Join(assetDir, h)); err != nil {
			t.Fatalf("%s should remain: %v", h, err)
		}
	}
	if _, err := os.Stat(filepath.Join(assetDir, "hash-3")); !os.IsNotExist(err) {
		t.Fatalf("hash-3 should be removed, stat err=%v", err)
	}
}

func TestVideoAnalysisServiceCleanOrphanStructureRejectsUnsafeAssetDir(t *testing.T) {
	service, _, _ := setupVideoAnalysisService(t, &fakeVideoAnalysisClient{})

	for _, unsafe := range []string{"/", ".", ".."} {
		service.assetDir = unsafe
		if err := service.CleanOrphanStructure(); err == nil {
			t.Fatalf("expected error for unsafe asset dir %q", unsafe)
		}
	}

	service.assetDir = "relative/cache/structure"
	if err := service.CleanOrphanStructure(); err != nil {
		t.Fatalf("relative asset dir should be allowed, got %v", err)
	}

	service.assetDir = filepath.Join(t.TempDir(), "does-not-exist")
	if err := service.CleanOrphanStructure(); err != nil {
		t.Fatalf("missing asset dir should be a no-op, got %v", err)
	}
}

// 回归测试：video_hash 列为空、但 result_json 内嵌 video_hash 的任务，
// 其引用的产物目录同样受孤儿清理保护（保护名单与展示路径同源）。
func TestCleanOrphanStructureProtectsJSONReferencedHash(t *testing.T) {
	service, tasks, _ := setupVideoAnalysisService(t, &fakeVideoAnalysisClient{})
	assetDir := service.assetDir

	// 目录存在（此前由别的任务 claim 创建），但唯一引用它的任务列漏写了 video_hash，
	// 只有 result_json 内嵌 video_hash。
	if err := os.MkdirAll(filepath.Join(assetDir, "hash-1", "grids"), 0o755); err != nil {
		t.Fatal(err)
	}
	task := &model.VideoAnalysisTask{
		MediaID:    "media-1",
		LibraryID:  "library-1",
		MediaTitle: "movie",
		VideoPath:  "/media/movie.mp4",
		Trigger:    model.VideoAnalysisTriggerManual,
		Status:     model.VideoAnalysisStatusPartial,
		Stage:      model.VideoAnalysisStageStructure,
		ResultJSON: `{"video_hash":"hash-1","scenes":[{"scene_index":0,"grid_image":"scene_000.jpg"}]}`,
	}
	if err := tasks.CreateIfNoActive(task); err != nil {
		t.Fatal(err)
	}

	if err := service.CleanOrphanStructure(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(assetDir, "hash-1", "grids", "scene_000.jpg")); os.IsNotExist(err) {
		t.Fatal("hash-1 should be protected via result_json video_hash, got removed")
	}
}
