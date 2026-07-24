package service

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/nowen-video/nowen-video/internal/model"
	"gorm.io/gorm"
)

func TestVideoAnalysisServiceGetResultByMediaBuildsDTO(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}
	task.Status = model.VideoAnalysisStatusSucceeded
	task.Stage = model.VideoAnalysisStageDone
	task.VideoHash = "hash-1"
	task.ResultJSON = mustMarshalJSON(t, map[string]any{
		"video_hash": "hash-1",
		"metadata": map[string]any{
			"video_path": "/photos/movie.mp4",
			"fps": 25.0,
			"duration": 120.5,
			"width": 1920,
			"height": 1080,
			"codec": "h264",
			"bitrate": 123456,
			"has_audio": true,
			"total_frames": 3012,
		},
		"grid_base_path": "scenes/hash-1",
		"scenes": []map[string]any{{
			"scene_id": "scene_000",
			"scene_index": 0,
			"start_time": 0.0,
			"end_time": 10.0,
			"start_frame": 0,
			"end_frame": 250,
			"grid_image": "scene_000.jpg",
		}},
		"warnings": []map[string]any{{"code": "LOW_FPS", "message": "fps too low", "scope": "video"}},
		"stage_timings": map[string]any{"metadata": 0.1, "frame_grid": 0.9},
		"elapsed_sec": 1.2,
	})
	if err := tasks.Update(task); err != nil {
		t.Fatal(err)
	}

	result, err := service.GetResultByMedia(mediaID, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.TaskID != task.ID || result.SceneCount != 1 || result.VideoHash != "hash-1" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(result.Scenes) != 1 || !result.Scenes[0].GridAvailable || result.Scenes[0].GridURL == "" {
		t.Fatalf("unexpected scenes: %+v", result.Scenes)
	}
}

func TestVideoAnalysisServiceGetResultByMediaUsesLatestTaskWithResult(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	first, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}
	first.Status = model.VideoAnalysisStatusSucceeded
	first.Stage = model.VideoAnalysisStageDone
	first.ResultJSON = mustMarshalJSON(t, map[string]any{
		"video_hash": "hash-1",
		"metadata": map[string]any{"video_path": "/photos/movie.mp4"},
		"grid_base_path": "scenes/hash-1",
		"scenes": []map[string]any{{"scene_index": 0, "start_time": 0.0, "end_time": 1.0, "start_frame": 0, "end_frame": 1}},
	})
	if err := tasks.Update(first); err != nil {
		t.Fatal(err)
	}
	second, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{Force: true})
	if err != nil {
		t.Fatal(err)
	}
	second.Status = model.VideoAnalysisStatusFailed
	second.Stage = model.VideoAnalysisStageStructure
	if err := tasks.Update(second); err != nil {
		t.Fatal(err)
	}

	result, err := service.GetResultByMedia(mediaID, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.TaskID != first.ID {
		t.Fatalf("task_id = %q, want %q", result.TaskID, first.ID)
	}
}

func TestVideoAnalysisServiceOpenSceneGridByMedia(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	cacheDir := filepath.Join(service.cacheRoot, "scenes", "hash-1")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatal(err)
	}
	gridPath := filepath.Join(cacheDir, "scene_000.jpg")
	if err := os.WriteFile(gridPath, []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}
	task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}
	task.Status = model.VideoAnalysisStatusSucceeded
	task.Stage = model.VideoAnalysisStageDone
	task.ResultJSON = mustMarshalJSON(t, map[string]any{
		"video_hash": "hash-1",
		"metadata": map[string]any{"video_path": "/photos/movie.mp4"},
		"grid_base_path": "scenes/hash-1",
		"scenes": []map[string]any{{
			"scene_index": 0,
			"start_time": 0.0,
			"end_time": 1.0,
			"start_frame": 0,
			"end_frame": 1,
			"grid_image": "scene_000.jpg",
		}},
	})
	if err := tasks.Update(task); err != nil {
		t.Fatal(err)
	}

	file, contentType, _, err := service.OpenSceneGridByMedia(mediaID, task.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if contentType != "image/jpeg" {
		t.Fatalf("contentType = %q", contentType)
	}
}

func TestVideoAnalysisServiceOpenSceneGridBySceneIndexValue(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	cacheDir := filepath.Join(service.cacheRoot, "scenes", "hash-2")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatal(err)
	}
	gridPath := filepath.Join(cacheDir, "scene_010.jpg")
	if err := os.WriteFile(gridPath, []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}
	task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}
	task.Status = model.VideoAnalysisStatusSucceeded
	task.Stage = model.VideoAnalysisStageDone
	task.ResultJSON = mustMarshalJSON(t, map[string]any{
		"video_hash": "hash-2",
		"metadata": map[string]any{"video_path": "/photos/movie.mp4"},
		"grid_base_path": "scenes/hash-2",
		"scenes": []map[string]any{{
			"scene_index": 10,
			"start_time": 10.0,
			"end_time": 20.0,
			"start_frame": 250,
			"end_frame": 500,
			"grid_image": "scene_010.jpg",
		}},
	})
	if err := tasks.Update(task); err != nil {
		t.Fatal(err)
	}

	file, contentType, _, err := service.OpenSceneGridByMedia(mediaID, task.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if contentType != "image/jpeg" {
		t.Fatalf("contentType = %q", contentType)
	}
}

func TestVideoAnalysisServiceOpenSceneGridRejectsTraversal(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}
	task.Status = model.VideoAnalysisStatusSucceeded
	task.Stage = model.VideoAnalysisStageDone
	task.ResultJSON = mustMarshalJSON(t, map[string]any{
		"video_hash": "hash-1",
		"metadata": map[string]any{"video_path": "/photos/movie.mp4"},
		"grid_base_path": "../escape",
		"scenes": []map[string]any{{
			"scene_index": 0,
			"start_time": 0.0,
			"end_time": 1.0,
			"start_frame": 0,
			"end_frame": 1,
			"grid_image": "scene_000.jpg",
		}},
	})
	if err := tasks.Update(task); err != nil {
		t.Fatal(err)
	}

	_, _, _, err = service.OpenSceneGridByMedia(mediaID, task.ID, 0)
	if err == nil || err.Error() != "video analysis grid path escapes cache root" {
		t.Fatalf("err = %v", err)
	}
}

func TestVideoAnalysisServiceGetResultByMediaRejectsForeignTask(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}
	task.Status = model.VideoAnalysisStatusSucceeded
	task.Stage = model.VideoAnalysisStageDone
	task.ResultJSON = mustMarshalJSON(t, map[string]any{
		"video_hash": "hash-1",
		"metadata": map[string]any{"video_path": "/photos/movie.mp4"},
		"grid_base_path": "scenes/hash-1",
		"scenes": []map[string]any{{"scene_index": 0, "start_time": 0.0, "end_time": 1.0, "start_frame": 0, "end_frame": 1}},
	})
	if err := tasks.Update(task); err != nil {
		t.Fatal(err)
	}

	_, err = service.GetResultByMedia("other-media", task.ID)
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("err = %v, want record not found", err)
	}
}

func mustMarshalJSON(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}
