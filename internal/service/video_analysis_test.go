package service

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"gorm.io/gorm"

	"github.com/nowen-video/nowen-video/internal/testutil"
	"go.uber.org/zap"
)

type fakeVideoAnalysisClient struct {
	detectSubmits      []DetectJobRequest
	structureSubmits   []StructureJobRequest
	describeSubmits    []DescribeJobRequest
	structureError     error
	describeError      error
	describeJobFailure *ExternalJobError
	describeResult     []byte
	structureResult    []byte

	artifact      *VideoAnalysisArtifact
	downloadErr   error
	releaseErr    error
	downloadCalls int
	releaseCalls  int
}

func (f *fakeVideoAnalysisClient) SubmitDetectJob(_ context.Context, request DetectJobRequest) (*ExternalJobRef, error) {
	f.detectSubmits = append(f.detectSubmits, request)
	return &ExternalJobRef{JobID: "detect-1", Status: "queued", PollURL: "/api/v2/scenes/detect/jobs/detect-1"}, nil
}

func (f *fakeVideoAnalysisClient) GetDetectJob(context.Context, string) (*ExternalJob, error) {
	result, _ := json.Marshal(map[string]any{"scenes": []SceneBoundary{{SceneIndex: 0, StartFrame: 0, EndFrame: 10, StartTime: 0, EndTime: 1}}})
	return &ExternalJob{JobID: "detect-1", Status: "succeeded", Result: result}, nil
}

func (f *fakeVideoAnalysisClient) SubmitStructureJob(_ context.Context, request StructureJobRequest) (*ExternalJobRef, error) {
	f.structureSubmits = append(f.structureSubmits, request)
	if f.structureError != nil && request.DetectJobID != "" {
		return nil, f.structureError
	}
	return &ExternalJobRef{JobID: "structure-1", Status: "queued", PollURL: "/api/v2/video/structure/jobs/structure-1"}, nil
}

func (f *fakeVideoAnalysisClient) GetStructureJob(context.Context, string) (*ExternalJob, error) {
	result := f.structureResult
	if len(result) == 0 {
		result, _ = json.Marshal(map[string]any{"video_hash": "hash-1", "scenes": []any{}})
	}
	return &ExternalJob{JobID: "structure-1", Status: "succeeded", Result: result, Artifact: f.artifact}, nil
}

func (f *fakeVideoAnalysisClient) DownloadStructureArtifact(_ context.Context, _ string, dstDir string, _ *VideoAnalysisArtifact) error {
	f.downloadCalls++
	if f.downloadErr != nil {
		return f.downloadErr
	}
	if err := os.MkdirAll(filepath.Join(dstDir, "grids"), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dstDir, "manifest.json"), []byte("{}"), 0o600); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dstDir, "grids", "scene_000.jpg"), []byte("jpeg"), 0o600); err != nil {
		return err
	}
	return nil
}

func (f *fakeVideoAnalysisClient) ReleaseStructureJob(context.Context, string) error {
	f.releaseCalls++
	return f.releaseErr
}

func (f *fakeVideoAnalysisClient) SubmitDescribeJob(_ context.Context, request DescribeJobRequest) (*ExternalJobRef, error) {
	f.describeSubmits = append(f.describeSubmits, request)
	if f.describeError != nil {
		return nil, f.describeError
	}
	return &ExternalJobRef{JobID: "describe-1", Status: "queued", PollURL: "/api/v2/video/describe/jobs/describe-1"}, nil
}

func (f *fakeVideoAnalysisClient) GetDescribeJob(context.Context, string) (*ExternalJob, error) {
	if f.describeJobFailure != nil {
		return &ExternalJob{JobID: "describe-1", Status: "failed", Error: f.describeJobFailure}, nil
	}
	result := f.describeResult
	if len(result) == 0 {
		result, _ = json.Marshal(map[string]any{"video_hash": "hash-1", "descriptions": []any{}})
	}
	return &ExternalJob{JobID: "describe-1", Status: "succeeded", Result: result}, nil
}

func setupVideoAnalysisService(t *testing.T, client videoAnalysisExternalClient) (*VideoAnalysisService, *repository.VideoAnalysisTaskRepo, string) {
	t.Helper()
	db := testutil.NewTestDB(t)
	if err := db.AutoMigrate(&model.Media{}, &model.VideoAnalysisTask{}); err != nil {
		t.Fatal(err)
	}
	repos := repository.NewRepositories(db)
	dir := t.TempDir()
	videoPath := filepath.Join(dir, "movie.mp4")
	if err := os.WriteFile(videoPath, []byte("video"), 0600); err != nil {
		t.Fatal(err)
	}
	media := &model.Media{LibraryID: "library-1", Title: "Movie", FilePath: videoPath, FileSize: 5}
	if err := repos.Media.Create(media); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{}
	cfg.VideoAnalysis.MediaBaseURL = "http://nowen-video:8080"
	service := NewVideoAnalysisService(repos.VideoAnalysis, repos.Media, client, nil, nil, filepath.Join(dir, "cache"), false, nil, nil, time.Millisecond, time.Second, cfg)
	return service, repos.VideoAnalysis, media.ID
}

func TestVideoAnalysisServiceProcessesDetectAndStructure(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	task, reused, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil || reused {
		t.Fatalf("SubmitMedia reused=%v err=%v", reused, err)
	}
	if err := service.ProcessTask(context.Background(), task.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.VideoAnalysisStatusSucceeded || stored.VideoHash != "hash-1" || stored.ActiveKey != nil {
		t.Fatalf("unexpected task: %+v", stored)
	}
	if len(client.structureSubmits) != 1 || client.structureSubmits[0].VideoPath != "http://nowen-video:8080/internal/video-analysis/source/"+mediaID || client.structureSubmits[0].DetectJobID != "detect-1" {
		t.Fatalf("structure submits: %+v", client.structureSubmits)
	}
}

func TestVideoAnalysisServiceDeleteTask(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteTask(task.ID); err != nil {
		t.Fatalf("DeleteTask queued: %v", err)
	}
	if _, err := tasks.FindByID(task.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("task still present after delete: %v", err)
	}

	running, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}
	running.Status = model.VideoAnalysisStatusRunning
	if err := tasks.Update(running); err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteTask(running.ID); !errors.Is(err, ErrVideoAnalysisTaskActive) {
		t.Fatalf("DeleteTask running = %v, want ErrVideoAnalysisTaskActive", err)
	}
}

func TestVideoAnalysisServiceFallsBackToScenesOnce(t *testing.T) {
	client := &fakeVideoAnalysisClient{structureError: &VideoAnalysisAPIError{HTTPStatus: 200, Code: 70201, Message: "detect job not found"}}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ProcessTask(context.Background(), task.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !stored.FallbackUsed || len(client.structureSubmits) != 2 || len(client.structureSubmits[1].Scenes) != 1 || client.structureSubmits[1].DetectJobID != "" {
		t.Fatalf("fallback task=%+v submits=%+v", stored, client.structureSubmits)
	}
}

func TestVideoAnalysisServiceReusesActiveTask(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, _, mediaID := setupVideoAnalysisService(t, client)
	first, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}
	second, reused, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil || !reused || first.ID != second.ID {
		t.Fatalf("second=%+v reused=%v err=%v", second, reused, err)
	}
}

func TestVideoAnalysisServiceSkipsCurrentSuccessUnlessForced(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, _, mediaID := setupVideoAnalysisService(t, client)
	first, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ProcessTask(context.Background(), first.ID); err != nil {
		t.Fatal(err)
	}
	outcome, err := service.SubmitMediaWithOutcome(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil || outcome.Result != "skipped" || outcome.Task.ID != first.ID {
		t.Fatalf("outcome=%+v err=%v", outcome, err)
	}
	forced, err := service.SubmitMediaWithOutcome(mediaID, VideoAnalysisSubmitOptions{Force: true})
	if err != nil || forced.Result != "created" || forced.Task.ID == first.ID {
		t.Fatalf("forced=%+v err=%v", forced, err)
	}
}

func TestVideoAnalysisServiceRetriesStructureWithoutRepeatingDetect(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}
	task.Status = model.VideoAnalysisStatusFailed
	task.Stage = model.VideoAnalysisStageStructure
	task.DetectJobID = "detect-complete"
	task.StructureJobID = "structure-failed"
	task.ErrorCode = "STRUCTURE_FAILED"
	if err := tasks.Update(task); err != nil {
		t.Fatal(err)
	}
	retried, err := service.RetryTask(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if retried.Status != model.VideoAnalysisStatusQueued || retried.DetectJobID != "detect-complete" || retried.StructureJobID != "" || retried.Stage != model.VideoAnalysisStageStructure {
		t.Fatalf("retried=%+v", retried)
	}
}

func TestVideoAnalysisServiceGetsLatestTaskByMediaID(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	first, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}
	first.Status = model.VideoAnalysisStatusSucceeded
	first.Stage = model.VideoAnalysisStageDone
	if err := tasks.Update(first); err != nil {
		t.Fatal(err)
	}
	second, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{Force: true})
	if err != nil {
		t.Fatal(err)
	}
	latest, err := service.GetLatestTaskByMediaID(mediaID)
	if err != nil {
		t.Fatal(err)
	}
	if latest.ID != second.ID {
		t.Fatalf("latest task = %q, want %q", latest.ID, second.ID)
	}
}

func TestVideoAnalysisBatchSubmitSkipsUnsupportedSTRM(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, _, mediaID := setupVideoAnalysisService(t, client)
	if err := service.media.DB().Model(&model.Media{}).Where("id = ?", mediaID).Update("stream_url", "https://example.com/test.m3u8").Error; err != nil {
		t.Fatal(err)
	}

	result := service.BatchSubmit([]string{mediaID}, VideoAnalysisSubmitOptions{Trigger: model.VideoAnalysisTriggerAuto})
	if result.Created != 0 || result.Reused != 0 || result.Skipped != 1 || len(result.Errors) != 0 || len(result.SkippedErrors) != 1 {
		t.Fatalf("result = %+v", result)
	}
	if result.SkippedErrors[0].Kind != "unsupported_strm" {
		t.Fatalf("skip kind = %q", result.SkippedErrors[0].Kind)
	}
}

func TestVideoAnalysisBatchSubmitSkipsUnsupportedRemote(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, _, mediaID := setupVideoAnalysisService(t, client)
	service.appCfg.VideoAnalysis.RemoteVideoEnabled = true
	if err := service.media.DB().Model(&model.Media{}).Where("id = ?", mediaID).Update("file_path", "webdav://example.com/media.mp4").Error; err != nil {
		t.Fatal(err)
	}

	result := service.BatchSubmit([]string{mediaID}, VideoAnalysisSubmitOptions{Trigger: model.VideoAnalysisTriggerAuto})
	if result.Created != 0 || result.Reused != 0 || result.Skipped != 1 || len(result.Errors) != 0 || len(result.SkippedErrors) != 1 {
		t.Fatalf("result = %+v", result)
	}
	if result.SkippedErrors[0].Kind != "unsupported_remote" {
		t.Fatalf("skip kind = %q", result.SkippedErrors[0].Kind)
	}
}

func TestVideoAnalysisBatchSubmitSkipsRemoteWhenDisabled(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, _, mediaID := setupVideoAnalysisService(t, client)
	if err := service.media.DB().Model(&model.Media{}).Where("id = ?", mediaID).Update("file_path", "webdav://example.com/media.mp4").Error; err != nil {
		t.Fatal(err)
	}

	result := service.BatchSubmit([]string{mediaID}, VideoAnalysisSubmitOptions{Trigger: model.VideoAnalysisTriggerAuto})
	if result.Created != 0 || result.Reused != 0 || result.Skipped != 1 || len(result.Errors) != 0 || len(result.SkippedErrors) != 1 {
		t.Fatalf("result = %+v", result)
	}
	if result.SkippedErrors[0].Kind != "remote_video_disabled" {
		t.Fatalf("skip kind = %q", result.SkippedErrors[0].Kind)
	}
}

func TestVideoAnalysisBatchSubmitSkipsUnreadableFile(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, _, mediaID := setupVideoAnalysisService(t, client)
	media, err := service.media.FindByID(mediaID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(media.FilePath); err != nil {
		t.Fatal(err)
	}

	result := service.BatchSubmit([]string{mediaID}, VideoAnalysisSubmitOptions{Trigger: model.VideoAnalysisTriggerAuto})
	if result.Created != 0 || result.Reused != 0 || result.Skipped != 1 || len(result.Errors) != 0 || len(result.SkippedErrors) != 1 {
		t.Fatalf("result = %+v", result)
	}
	if result.SkippedErrors[0].Kind != "unreadable_file" {
		t.Fatalf("skip kind = %q", result.SkippedErrors[0].Kind)
	}
}

func TestVideoAnalysisServiceProcessesDescribeWhenEnabled(t *testing.T) {
	client := &fakeVideoAnalysisClient{
		describeResult: mustMarshalJSONBytes(t, map[string]any{
			"video_hash": "hash-1",
			"status":     "completed",
			"descriptions": []map[string]any{{
				"scene_index": 0,
				"description": "画面展示一群人在室外广场活动。",
				"status":      "ok",
			}},
		}),
	}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	service.describeEnabled = true
	task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{IncludeDescriptions: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ProcessTask(context.Background(), task.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.VideoAnalysisStatusSucceeded || stored.Stage != model.VideoAnalysisStageDone || stored.DescribeJobID != "describe-1" {
		t.Fatalf("unexpected task: %+v", stored)
	}
	if len(client.describeSubmits) != 1 || client.describeSubmits[0].StructureJobID != "structure-1" {
		t.Fatalf("describe submits: %+v", client.describeSubmits)
	}
	if stored.IncludeDescriptions != true {
		t.Fatal("include_descriptions should be persisted")
	}
}

func TestVideoAnalysisServiceDescribeFailureMarksPartial(t *testing.T) {
	client := &fakeVideoAnalysisClient{describeError: &VideoAnalysisAPIError{HTTPStatus: 200, Code: 70301, Message: "describe failed"}}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	service.describeEnabled = true
	task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{IncludeDescriptions: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ProcessTask(context.Background(), task.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.VideoAnalysisStatusPartial || stored.Stage != model.VideoAnalysisStageDescribe || stored.ResultJSON == "" || stored.VideoHash != "hash-1" {
		t.Fatalf("unexpected partial task: %+v", stored)
	}
}

func TestVideoAnalysisServiceDescribeJobFailedMarksPartialAndClaims(t *testing.T) {
	// describe job 全部失败（status=failed + DESCRIBE_ERROR）→ task partial，
	// 九宫格仍要 claim 落盘（staging TTL 兜底前取走），describe job 清空待重试重提。
	client := &fakeVideoAnalysisClient{
		artifact: &VideoAnalysisArtifact{
			Files: []VideoAnalysisArtifactFile{{Path: "manifest.json", Size: 2}},
		},
		describeJobFailure: &ExternalJobError{Code: "DESCRIBE_ERROR", Message: "全部 73 个场景描述失败: 场景 0 描述失败: Connection error."},
	}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	service.describeEnabled = true
	task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{IncludeDescriptions: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ProcessTask(context.Background(), task.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.VideoAnalysisStatusPartial {
		t.Fatalf("status = %q, want partial", stored.Status)
	}
	if stored.ErrorCode != "DESCRIBE_ERROR" {
		t.Fatalf("error_code = %q, want DESCRIBE_ERROR", stored.ErrorCode)
	}
	if stored.DescribeStatus != model.VideoAnalysisStageStatusFailed {
		t.Fatalf("describe_status = %q, want failed", stored.DescribeStatus)
	}
	if client.downloadCalls == 0 {
		t.Fatal("artifact should be claimed even when describe failed")
	}
	if stored.DescribeJobID != "" {
		t.Fatalf("describe_job_id = %q, want empty for retry resubmit", stored.DescribeJobID)
	}
}

func TestVideoAnalysisServiceDescribePartialResultMarksPartial(t *testing.T) {
	// describe job succeeded + result.status = "partial" → task partial（DESCRIBE_PARTIAL），
	// 成功场景的描述保留，九宫格 claim 落盘。
	client := &fakeVideoAnalysisClient{
		artifact: &VideoAnalysisArtifact{
			Files: []VideoAnalysisArtifactFile{{Path: "manifest.json", Size: 2}},
		},
		structureResult: mustMarshalJSONBytes(t, map[string]any{
			"video_hash": "hash-1",
			"scenes": []map[string]any{
				{"scene_index": 0, "start_time": 0.0, "end_time": 1.0, "grid_image": "scene_000.jpg"},
				{"scene_index": 1, "start_time": 1.0, "end_time": 2.0, "grid_image": "scene_001.jpg"},
			},
		}),
		describeResult: mustMarshalJSONBytes(t, map[string]any{
			"video_hash": "hash-1",
			"status":     "partial",
			"descriptions": []map[string]any{
				{"scene_index": 0, "description": "画面展示一群人在室外广场活动。", "status": "ok"},
				{"scene_index": 1, "description": "", "status": "failed", "error": "大模型调用失败"},
			},
			"warnings": []map[string]any{{"code": "DESC_LLM_ERROR", "message": "场景 1 描述失败: 大模型调用失败", "target_id": "1"}},
		}),
	}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	service.describeEnabled = true
	task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{IncludeDescriptions: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ProcessTask(context.Background(), task.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.VideoAnalysisStatusPartial {
		t.Fatalf("status = %q, want partial", stored.Status)
	}
	if stored.ErrorCode != "DESCRIBE_PARTIAL" {
		t.Fatalf("error_code = %q, want DESCRIBE_PARTIAL", stored.ErrorCode)
	}
	if stored.DescribeStatus != model.VideoAnalysisStageStatusFailed {
		t.Fatalf("describe_status = %q, want failed", stored.DescribeStatus)
	}
	if client.downloadCalls == 0 {
		t.Fatal("artifact should be claimed for partial describe")
	}
	// 成功场景的描述保留在 ResultJSON
	if !strings.Contains(stored.ResultJSON, "画面展示一群人在室外广场活动。") {
		t.Fatal("successful description should be preserved in result JSON")
	}
}

func TestVideoAnalysisServiceRunStageDescribeFailureKeepsPartial(t *testing.T) {
	// RunStage 的 describe 失败 → partial（不被覆盖为 succeeded），
	// 且重试时重新提交 describe job（而非轮询同一个已失败的 job）。
	client := &fakeVideoAnalysisClient{describeError: &VideoAnalysisAPIError{HTTPStatus: 200, Code: 70301, Message: "describe failed"}}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	service.describeEnabled = true
	task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{IncludeDescriptions: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ProcessTask(context.Background(), task.ID); err != nil {
		t.Fatal(err)
	}
	if err := service.RunStage(context.Background(), task.ID, model.VideoAnalysisStageDescribe); err != nil {
		t.Fatalf("RunStage describe should swallow partial failure: %v", err)
	}
	stored, err := tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.VideoAnalysisStatusPartial {
		t.Fatalf("status = %q, want partial", stored.Status)
	}
	if stored.DescribeStatus != model.VideoAnalysisStageStatusFailed {
		t.Fatalf("describe_status = %q, want failed", stored.DescribeStatus)
	}
	// 第一次 ProcessTask + 一次 RunStage 重试 = 两次提交 describe job
	if len(client.describeSubmits) != 2 {
		t.Fatalf("describe submits = %d, want 2 (retry should resubmit)", len(client.describeSubmits))
	}
}

func TestVideoAnalysisServiceClaimArtifactFailureMarksFailed(t *testing.T) {
	// artifact 下载失败 → claim 失败 → task failed + CLAIM_STAGING_FAILED
	client := &fakeVideoAnalysisClient{
		artifact: &VideoAnalysisArtifact{
			Files: []VideoAnalysisArtifactFile{{Path: "manifest.json", Size: 2}},
		},
		downloadErr: errors.New("boom"),
		structureResult: mustMarshalJSONBytes(t, map[string]any{
			"video_hash": "hash-1",
			"scenes":     []any{},
		}),
	}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ProcessTask(context.Background(), task.ID); err == nil {
		t.Fatal("expected claim staging failure")
	}
	stored, err := tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.VideoAnalysisStatusFailed {
		t.Fatalf("status = %q, want failed", stored.Status)
	}
	if stored.ErrorCode != "CLAIM_STAGING_FAILED" {
		t.Fatalf("error_code = %q, want CLAIM_STAGING_FAILED", stored.ErrorCode)
	}
}

func TestVideoAnalysisServiceRejectsDescriptionsWhenDisabled(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	service, _, mediaID := setupVideoAnalysisService(t, client)
	_, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{IncludeDescriptions: true})
	if err == nil {
		t.Fatal("expected describe-disabled error")
	}
}

func mustMarshalJSONBytes(t *testing.T, value any) []byte {
	return []byte(mustMarshalJSON(t, value))
}

func TestCanRunStage_DependencyChecks(t *testing.T) {
	task := &model.VideoAnalysisTask{IncludeDescriptions: true}

	ok, _ := task.CanRunStage(model.VideoAnalysisStageDetect)
	if !ok {
		t.Fatal("Detect should have no dependencies")
	}

	ok, _ = task.CanRunStage(model.VideoAnalysisStageStructure)
	if ok {
		t.Fatal("Structure should be rejected when Detect is not done")
	}

	ok, _ = task.CanRunStage(model.VideoAnalysisStageDescribe)
	if ok {
		t.Fatal("Describe should be rejected when Detect is not done")
	}

	task.DetectStatus = model.VideoAnalysisStageStatusSucceeded

	ok, _ = task.CanRunStage(model.VideoAnalysisStageStructure)
	if !ok {
		t.Fatal("Structure should be allowed after Detect succeeded")
	}

	ok, _ = task.CanRunStage(model.VideoAnalysisStageDescribe)
	if ok {
		t.Fatal("Describe should be rejected when Structure is not done")
	}

	task.StructureStatus = model.VideoAnalysisStageStatusSucceeded

	ok, _ = task.CanRunStage(model.VideoAnalysisStageDescribe)
	if !ok {
		t.Fatal("Describe should be allowed after both Detect and Structure succeeded")
	}
}

func TestNextPendingStage(t *testing.T) {
	task := &model.VideoAnalysisTask{IncludeDescriptions: true}
	if stage := task.NextPendingStage(); stage != model.VideoAnalysisStageDetect {
		t.Fatalf("expected detect, got %s", stage)
	}

	task.DetectStatus = model.VideoAnalysisStageStatusSucceeded
	if stage := task.NextPendingStage(); stage != model.VideoAnalysisStageStructure {
		t.Fatalf("expected structure, got %s", stage)
	}

	task.StructureStatus = model.VideoAnalysisStageStatusSucceeded
	if stage := task.NextPendingStage(); stage != model.VideoAnalysisStageDescribe {
		t.Fatalf("expected describe, got %s", stage)
	}

	task.DescribeStatus = model.VideoAnalysisStageStatusSucceeded
	if stage := task.NextPendingStage(); stage != model.VideoAnalysisStageDone {
		t.Fatalf("expected done, got %s", stage)
	}

	task2 := &model.VideoAnalysisTask{IncludeDescriptions: false}
	task2.DetectStatus = model.VideoAnalysisStageStatusSucceeded
	task2.StructureStatus = model.VideoAnalysisStageStatusSucceeded
	if stage := task2.NextPendingStage(); stage != model.VideoAnalysisStageDone {
		t.Fatalf("(no describe) expected done, got %s", stage)
	}
}

func TestWorkflowRunStage(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	vaService, tasks, mediaID := setupVideoAnalysisService(t, client)
	submitTask, _, err := vaService.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}

	if err := vaService.RunStage(context.Background(), submitTask.ID, model.VideoAnalysisStageDetect); err != nil {
		t.Fatal(err)
	}
	task, _ := tasks.FindByID(submitTask.ID)
	if task.DetectStatus != model.VideoAnalysisStageStatusSucceeded {
		t.Fatalf("Detect status should be succeeded, got %s", task.DetectStatus)
	}

	if err := vaService.RunStage(context.Background(), submitTask.ID, model.VideoAnalysisStageStructure); err != nil {
		t.Fatal(err)
	}
	task, _ = tasks.FindByID(submitTask.ID)
	if task.StructureStatus != model.VideoAnalysisStageStatusSucceeded {
		t.Fatalf("Structure status should be succeeded, got %s", task.StructureStatus)
	}
}

func TestWorkflowRunStage_DependencyRejected(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	vaService, tasks, mediaID := setupVideoAnalysisService(t, client)
	submitTask, _, err := vaService.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}

	err = vaService.RunStage(context.Background(), submitTask.ID, model.VideoAnalysisStageStructure)
	if err == nil {
		t.Fatal("should reject Structure when Detect is not done")
	}
	_ = tasks
}

func TestWorkflowGetWorkflow(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	vaService, tasks, mediaID := setupVideoAnalysisService(t, client)
	submitTask, _, err := vaService.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{})
	if err != nil {
		t.Fatal(err)
	}

	wf, err := vaService.GetWorkflow(submitTask.ID)
	if err != nil {
		t.Fatal(err)
	}
	if wf.Status != model.VideoAnalysisStatusQueued {
		t.Fatalf("expected queued, got %s", wf.Status)
	}
	_ = tasks
}

func TestBuildAnalysisSourceURL(t *testing.T) {
	svc := &VideoAnalysisService{appCfg: &config.Config{}}
	svc.appCfg.VideoAnalysis.MediaBaseURL = "http://nowen-video:8080/"
	svc.appCfg.VideoAnalysis.SourceToken = "secret"

	got := svc.buildAnalysisSourceURL("media/1")
	want := "http://nowen-video:8080/internal/video-analysis/source/media%2F1?token=secret"
	if got != want {
		t.Fatalf("buildAnalysisSourceURL() = %q, want %q", got, want)
	}

	svc.appCfg.VideoAnalysis.SourceToken = ""
	got = svc.buildAnalysisSourceURL("abc")
	want = "http://nowen-video:8080/internal/video-analysis/source/abc"
	if got != want {
		t.Fatalf("buildAnalysisSourceURL() without token = %q, want %q", got, want)
	}
	// 未配置 media_base_url → 默认 compose 服务名
	svc.appCfg.VideoAnalysis.MediaBaseURL = ""
	got = svc.buildAnalysisSourceURL("abc")
	want = defaultAnalysisMediaBaseURL + "/internal/video-analysis/source/abc"
	if got != want {
		t.Fatalf("buildAnalysisSourceURL() with default base = %q, want %q", got, want)
	}
}

func TestVideoAnalysisServiceSubmitUsesURLAccessMode(t *testing.T) {
	tests := []struct {
		name   string
		remote bool
	}{
		{name: "local"},
		{name: "remote", remote: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := testutil.NewTestDB(t)
			if err := db.AutoMigrate(&model.Media{}, &model.VideoAnalysisTask{}); err != nil {
				t.Fatal(err)
			}
			repos := repository.NewRepositories(db)
			cfg := &config.Config{}
			cfg.VideoAnalysis.MediaBaseURL = "http://nowen-video:8080"
			cfg.VideoAnalysis.SourceToken = "secret"

			var media *model.Media
			if tt.remote {
				cfg.VideoAnalysis.RemoteVideoEnabled = true
				media = &model.Media{LibraryID: "library-1", Title: "Remote Movie", FilePath: "webdav://remote/movie.mp4", FileSize: 5}
			} else {
				dir := t.TempDir()
				videoPath := filepath.Join(dir, "movie.mp4")
				if err := os.WriteFile(videoPath, []byte("video"), 0600); err != nil {
					t.Fatal(err)
				}
				media = &model.Media{LibraryID: "library-1", Title: "Movie", FilePath: videoPath, FileSize: 5}
			}
			if err := repos.Media.Create(media); err != nil {
				t.Fatal(err)
			}
			service := NewVideoAnalysisService(repos.VideoAnalysis, repos.Media, &fakeVideoAnalysisClient{}, nil, nil, filepath.Join(t.TempDir(), "cache"), false, nil, nil, time.Millisecond, time.Second, cfg)
			if tt.remote {
				vfsMgr := NewVFSManager(zap.NewNop().Sugar())
				vfsMgr.SetGlobalWebDAVFS(walkProbeVFS{statFn: func(string) (fs.FileInfo, error) {
					return fstest.MapFS{"movie.mp4": &fstest.MapFile{Data: []byte("video"), ModTime: time.Unix(123, 0)}}.Stat("movie.mp4")
				}})
				service.SetVFSManager(vfsMgr)
			}

			task, reused, err := service.SubmitMedia(media.ID, VideoAnalysisSubmitOptions{})
			if err != nil || reused {
				t.Fatalf("SubmitMedia reused=%v err=%v", reused, err)
			}
			want := "http://nowen-video:8080/internal/video-analysis/source/" + media.ID + "?token=secret"
			if task.MappedVideoPath != want {
				t.Fatalf("MappedVideoPath = %q, want %q", task.MappedVideoPath, want)
			}
		})
	}
}
