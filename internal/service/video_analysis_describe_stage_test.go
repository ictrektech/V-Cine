package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"github.com/nowen-video/nowen-video/internal/testutil"
)

// ==================== runLocalDescribeStage 端到端 ====================
// 下面的测试驱动 runLocalDescribeStage，断言任务落库后的状态。

// newLocalStageFixture 构造本地 describe 现场：真实 repo（读写同一份）+ 内存 vision 替身。
// 用真实 SceneRepo 以同时覆盖读（缺口计算）与写（描述落库）。
func newLocalStageFixture(t *testing.T, sceneCount int, client SceneDescriptionClient) (*VideoAnalysisService, *model.VideoAnalysisTask, *repository.SceneRepo) {
	t.Helper()
	db := testutil.NewTestDB(t)
	if err := db.AutoMigrate(&model.Media{}, &model.VideoAnalysisTask{}, &model.Scene{}); err != nil {
		t.Fatal(err)
	}
	repos := repository.NewRepositories(db)
	dir := t.TempDir()
	videoPath := filepath.Join(dir, "movie.mp4")
	if err := os.WriteFile(videoPath, []byte("video"), 0o600); err != nil {
		t.Fatal(err)
	}
	media := &model.Media{LibraryID: "library-1", Title: "Movie", FilePath: videoPath, FileSize: 5}
	if err := repos.Media.Create(media); err != nil {
		t.Fatal(err)
	}

	assetDir := filepath.Join(dir, "asset")
	const videoHash = "hash-stage"
	gridDir := filepath.Join(assetDir, videoHash, "grids")
	if err := os.MkdirAll(gridDir, 0o755); err != nil {
		t.Fatal(err)
	}

	cfg := &config.Config{}
	cfg.VideoAnalysis.MediaBaseURL = "http://nowen-video:8080"
	cfg.SetSaveDir(t.TempDir())
	svc := NewVideoAnalysisService(
		repos.VideoAnalysis, repos.Media, &fakeVideoAnalysisClient{}, repos.Scene, nil,
		assetDir, true, nil, nil, time.Millisecond, time.Second, cfg,
	)
	svc.localDescribe = client

	scenes := make([]model.Scene, 0, sceneCount)
	sceneJSON := make([]map[string]any, 0, sceneCount)
	for i := 0; i < sceneCount; i++ {
		grid := fmt.Sprintf("scene_%03d.jpg", i)
		if err := os.WriteFile(filepath.Join(gridDir, grid), []byte("jpeg"), 0o600); err != nil {
			t.Fatal(err)
		}
		scenes = append(scenes, model.Scene{SceneIndex: i, ImagePath: grid})
		sceneJSON = append(sceneJSON, map[string]any{"scene_index": i, "grid_image": grid})
	}
	resultJSON, err := json.Marshal(map[string]any{"video_hash": videoHash, "scenes": sceneJSON})
	if err != nil {
		t.Fatal(err)
	}

	task := &model.VideoAnalysisTask{
		MediaID:             media.ID,
		LibraryID:           "library-1",
		MediaTitle:          "Movie",
		VideoPath:           videoPath,
		MappedVideoPath:     "/photos/movie.mp4",
		Trigger:             model.VideoAnalysisTriggerManual,
		Status:              model.VideoAnalysisStatusRunning,
		Stage:               model.VideoAnalysisStageDescribe,
		IncludeDescriptions: true,
		VideoHash:           videoHash,
		ResultJSON:          string(resultJSON),
	}
	if err := repos.VideoAnalysis.CreateIfNoActive(task); err != nil {
		t.Fatal(err)
	}
	if err := repos.Scene.BatchCreate(task.ID, scenes); err != nil {
		t.Fatal(err)
	}
	return svc, task, repos.Scene
}

// describedIndexes 从真实 repo 读取已有描述的场景索引（升序）。
func describedIndexes(t *testing.T, repo *repository.SceneRepo, taskID string) []int {
	t.Helper()
	scenes, err := repo.GetByTaskID(taskID)
	if err != nil {
		t.Fatal(err)
	}
	var out []int
	for _, scene := range scenes {
		if strings.TrimSpace(scene.Description) != "" {
			out = append(out, scene.SceneIndex)
		}
	}
	sort.Ints(out)
	return out
}

// TestRunLocalDescribeStagePartialKeepsTaskPartial 验证一个场景失败时任务为 partial，
// 错误码 DESCRIBE_PARTIAL，成功场景落库。
func TestRunLocalDescribeStagePartialKeepsTaskPartial(t *testing.T) {
	vision := &fakeVisionClient{failOn: map[int]error{
		1: &sceneDescribeError{Retryable: true, Message: "上游 503", Detail: "finish_reason=length\nraw={\"id\":\"chatcmpl-x\"}"},
	}}
	svc, task, sceneRepo := newLocalStageFixture(t, 3, vision)

	// partial 由 completeDescribePartial 落库后返回 nil，调用方按 task.Status 判断。
	if err := svc.runLocalDescribeStage(context.Background(), task, vision); err != nil {
		t.Fatalf("partial must be handled in-stage, got error: %v", err)
	}
	if task.Status != model.VideoAnalysisStatusPartial {
		t.Fatalf("status = %q, want partial", task.Status)
	}
	if task.ErrorCode != "DESCRIBE_PARTIAL" {
		t.Fatalf("error_code = %q, want DESCRIBE_PARTIAL", task.ErrorCode)
	}
	if got := describedIndexes(t, sceneRepo, task.ID); len(got) != 2 || got[0] != 0 || got[1] != 2 {
		t.Fatalf("described = %v, want [0 2] (successful scenes must be kept)", got)
	}

	stored, err := svc.tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.VideoAnalysisStatusPartial {
		t.Fatalf("persisted status = %q, want partial", stored.Status)
	}
	// 任务级错误保持简短（面向用户），上游原始诊断落到结果 warnings.detail。
	if !strings.Contains(stored.ErrorMessage, "上游 503") || strings.Contains(stored.ErrorMessage, "raw=") {
		t.Fatalf("error_message = %q, want short reason without upstream detail", stored.ErrorMessage)
	}
	var result videoAnalysisStructureResult
	if err := json.Unmarshal([]byte(stored.ResultJSON), &result); err != nil {
		t.Fatal(err)
	}
	var detail string
	for _, warning := range result.Warnings {
		if warning.TargetID == "1" {
			detail = warning.Detail
		}
	}
	if !strings.Contains(detail, "finish_reason=length") {
		t.Fatalf("warning detail = %q, want upstream diagnostics", detail)
	}
}

// TestRunLocalDescribeStageAllSuccessMarksSucceeded 全部成功 → describe 阶段 succeeded。
func TestRunLocalDescribeStageAllSuccessMarksSucceeded(t *testing.T) {
	vision := &fakeVisionClient{}
	svc, task, sceneRepo := newLocalStageFixture(t, 2, vision)

	if err := svc.runLocalDescribeStage(context.Background(), task, vision); err != nil {
		t.Fatalf("runLocalDescribeStage: %v", err)
	}
	if task.Status == model.VideoAnalysisStatusPartial {
		t.Fatal("task must not be partial when all scenes succeed")
	}
	if task.StageStatus(model.VideoAnalysisStageDescribe) != model.VideoAnalysisStageStatusSucceeded {
		t.Fatalf("describe status = %q, want succeeded", task.StageStatus(model.VideoAnalysisStageDescribe))
	}
	if got := describedIndexes(t, sceneRepo, task.ID); len(got) != 2 {
		t.Fatalf("described = %v, want both scenes", got)
	}
}

// TestRunLocalDescribeStageRetryOnlyCallsMissingScenes 重试只补缺口（核心承诺）。
func TestRunLocalDescribeStageRetryOnlyCallsMissingScenes(t *testing.T) {
	firstRound := &fakeVisionClient{failOn: map[int]error{
		1: &sceneDescribeError{Retryable: true, Message: "上游 503"},
	}}
	svc, task, sceneRepo := newLocalStageFixture(t, 3, firstRound)
	if err := svc.runLocalDescribeStage(context.Background(), task, firstRound); err != nil {
		t.Fatalf("partial must be handled in-stage, got error: %v", err)
	}
	if task.Status != model.VideoAnalysisStatusPartial {
		t.Fatalf("status after round 1 = %q, want partial", task.Status)
	}
	if got := describedIndexes(t, sceneRepo, task.ID); len(got) != 2 {
		t.Fatalf("described after round 1 = %v, want 2 scenes", got)
	}

	// 第二轮：换成成功的客户端，应只请求场景 1。
	secondRound := &fakeVisionClient{}
	svc.localDescribe = secondRound
	task.Status = model.VideoAnalysisStatusQueued
	if err := svc.runLocalDescribeStage(context.Background(), task, secondRound); err != nil {
		t.Fatalf("retry: %v", err)
	}
	if secondRound.callCount() != 1 {
		t.Fatalf("retry vision calls = %d, want 1 (only the missing scene)", secondRound.callCount())
	}
	if got := secondRound.calledIndexes(); len(got) != 1 || got[0] != 1 {
		t.Fatalf("retry called indexes = %v, want [1]", got)
	}
	if got := describedIndexes(t, sceneRepo, task.ID); len(got) != 3 {
		t.Fatalf("described after retry = %v, want all 3", got)
	}
}

// TestRunLocalDescribeStagePropagatesMissingModel 验证本地路径的错误文本带上上游原文，
// 使 completeDescribePartial 能推导出 missing_model。
func TestRunLocalDescribeStagePropagatesMissingModel(t *testing.T) {
	vision := &fakeVisionClient{failOn: map[int]error{
		0: &sceneDescribeError{
			Retryable: false,
			Message:   "场景描述请求失败：http=404 | unknown model: model-hub/minicpm-v4.6:latest",
		},
	}}
	svc, task, _ := newLocalStageFixture(t, 2, vision)

	if err := svc.runLocalDescribeStage(context.Background(), task, vision); err != nil {
		t.Fatalf("partial must be handled in-stage, got error: %v", err)
	}
	stored, err := svc.tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.MissingModel != "model-hub/minicpm-v4.6:latest" {
		t.Fatalf("missing_model = %q, want model-hub/minicpm-v4.6:latest (upstream text must survive)", stored.MissingModel)
	}
	if !strings.Contains(stored.ErrorMessage, "unknown model") {
		t.Fatalf("error_message = %q, must carry upstream text", stored.ErrorMessage)
	}
}

// TestRunLocalDescribeStageNoGapIsNoop 无缺口时不调用视觉模型，阶段直接成功。
func TestRunLocalDescribeStageNoGapIsNoop(t *testing.T) {
	vision := &fakeVisionClient{}
	svc, task, sceneRepo := newLocalStageFixture(t, 2, vision)
	// 预置描述：让缺口为空。
	if err := sceneRepo.UpdateDescriptions(task.ID, []repository.SceneDescriptionUpdate{
		{SceneIndex: 0, Description: "已有描述"},
		{SceneIndex: 1, Description: "已有描述"},
	}); err != nil {
		t.Fatal(err)
	}

	if err := svc.runLocalDescribeStage(context.Background(), task, vision); err != nil {
		t.Fatalf("runLocalDescribeStage: %v", err)
	}
	if vision.callCount() != 0 {
		t.Fatalf("vision calls = %d, want 0 when nothing is missing", vision.callCount())
	}
	if task.StageStatus(model.VideoAnalysisStageDescribe) != model.VideoAnalysisStageStatusSucceeded {
		t.Fatalf("describe status = %q, want succeeded", task.StageStatus(model.VideoAnalysisStageDescribe))
	}
}

// TestLocalDescribeErrorCarriesFirstFailureReason 验证错误信息带最小失败索引对应的原因。
func TestLocalDescribeErrorCarriesFirstFailureReason(t *testing.T) {
	outcome := localDescribeOutcome{
		Total:  3,
		Failed: []int{2, 10},
		Warnings: []VideoAnalysisWarning{
			{Message: "场景 10：later", TargetID: "10"},
			{Message: "场景 2：earlier", TargetID: "2"},
		},
	}
	err := localDescribeError(outcome)
	if err == nil {
		t.Fatal("expected error")
	}
	message := err.Error()
	if !strings.Contains(message, "2/3") {
		t.Fatalf("message = %q, want failure count", message)
	}
	if !strings.Contains(message, "earlier") {
		t.Fatalf("message = %q, want the reason of the smallest failed index", message)
	}
}

// TestDescribeLimitsFallsBackToDefaults 配置缺省时用内置默认值。
func TestDescribeLimitsFallsBackToDefaults(t *testing.T) {
	svc := &VideoAnalysisService{}
	concurrency, timeout := svc.describeLimits()
	if concurrency != defaultDescribeConcurrency || timeout != defaultDescribeSceneTimeout {
		t.Fatalf("limits = (%d, %v), want defaults", concurrency, timeout)
	}

	cfg := &config.Config{}
	cfg.VideoAnalysis.DescribeConcurrency = 5
	cfg.VideoAnalysis.DescribeSceneTimeoutSeconds = 30
	svc.appCfg = cfg
	concurrency, timeout = svc.describeLimits()
	if concurrency != 5 || timeout != 30*time.Second {
		t.Fatalf("limits = (%d, %v), want (5, 30s)", concurrency, timeout)
	}
}
