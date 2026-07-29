package service

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"gorm.io/gorm"

	"github.com/nowen-video/nowen-video/internal/testutil")

type fakeVideoAnalysisClient struct {
	detectSubmits    []DetectJobRequest
	structureSubmits []StructureJobRequest
	describeSubmits  []DescribeJobRequest
	structureError   error
	describeError    error
	describeResult   []byte
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
	result, _ := json.Marshal(map[string]any{"video_hash": "hash-1", "scenes": []any{}})
	return &ExternalJob{JobID: "structure-1", Status: "succeeded", Result: result}, nil
}

func (f *fakeVideoAnalysisClient) SubmitDescribeJob(_ context.Context, request DescribeJobRequest) (*ExternalJobRef, error) {
	f.describeSubmits = append(f.describeSubmits, request)
	if f.describeError != nil {
		return nil, f.describeError
	}
	return &ExternalJobRef{JobID: "describe-1", Status: "queued", PollURL: "/api/v2/video/describe/jobs/describe-1"}, nil
}

func (f *fakeVideoAnalysisClient) GetDescribeJob(context.Context, string) (*ExternalJob, error) {
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
	mapper, err := NewVideoPathMapper([]config.VideoAnalysisPathMapping{{Source: dir, Target: "/photos"}})
	if err != nil {
		t.Fatal(err)
	}
	service := NewVideoAnalysisService(repos.VideoAnalysis, repos.Media, client, mapper, nil, nil, filepath.Join(dir, "cache"), false, nil, nil, time.Millisecond, time.Second)
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
	if len(client.structureSubmits) != 1 || client.structureSubmits[0].VideoPath != "/photos/movie.mp4" || client.structureSubmits[0].DetectJobID != "detect-1" {
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
	if len(client.describeSubmits) != 1 || client.describeSubmits[0].VideoHash != "hash-1" {
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
