package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/nowen-video/nowen-video/internal/model"
)

func TestNextIncompleteStageRetriesFailedStages(t *testing.T) {
	for _, stage := range []string{
		model.VideoAnalysisStageDetect,
		model.VideoAnalysisStageStructure,
		model.VideoAnalysisStageDescribe,
	} {
		t.Run(stage, func(t *testing.T) {
			task := &model.VideoAnalysisTask{
				IncludeDescriptions: true,
				DetectStatus:        model.VideoAnalysisStageStatusSucceeded,
				StructureStatus:     model.VideoAnalysisStageStatusSucceeded,
				DescribeStatus:      model.VideoAnalysisStageStatusSucceeded,
			}
			task.SetStageStatus(stage, model.VideoAnalysisStageStatusFailed)
			if got := task.NextIncompleteStage(); got != stage {
				t.Fatalf("next stage = %q, want failed stage %q", got, stage)
			}
		})
	}
}

func TestWorkflowRunMissingCompletesTask(t *testing.T) {
	for _, tc := range []struct {
		name                string
		includeDescriptions bool
		wantDescribeStatus  string
	}{
		{name: "structure only", wantDescribeStatus: model.VideoAnalysisStageStatusSkipped},
		{
			name:                "with descriptions",
			includeDescriptions: true,
			wantDescribeStatus:  model.VideoAnalysisStageStatusSucceeded,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := &fakeVideoAnalysisClient{}
			service, tasks, mediaID := setupVideoAnalysisService(t, client)
			service.describeEnabled = true
			task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{
				IncludeDescriptions: tc.includeDescriptions,
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := service.RunMissing(context.Background(), task.ID); err != nil {
				t.Fatal(err)
			}
			stored, err := tasks.FindByID(task.ID)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Status != model.VideoAnalysisStatusSucceeded || stored.Stage != model.VideoAnalysisStageDone {
				t.Fatalf("status/stage = %s/%s, want succeeded/done", stored.Status, stored.Stage)
			}
			if stored.Progress != 100 || stored.StartedAt == nil || stored.FinishedAt == nil || stored.ActiveKey != nil {
				t.Fatalf("task was not finalized: %+v", stored)
			}
			if stored.DescribeStatus != tc.wantDescribeStatus {
				t.Fatalf("describe_status = %q, want %q", stored.DescribeStatus, tc.wantDescribeStatus)
			}
			if err := service.RunMissing(context.Background(), task.ID); err != nil {
				t.Fatal(err)
			}
			if len(client.detectSubmits) != 1 || len(client.structureSubmits) != 1 {
				t.Fatal("completed stages should not be resubmitted")
			}
		})
	}
}

func TestWorkflowRunMissingRetriesPartial(t *testing.T) {
	client := &fakeVideoAnalysisClient{
		describeJobFailure: &ExternalJobError{
			Code: "DESCRIBE_ERROR", Message: "unknown model: model-hub/test-model",
		},
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

	// 一次点击只重试一次；模型仍不可用时保持 partial，不在本次请求内循环重试。
	if err := service.RunMissing(context.Background(), task.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(client.describeSubmits) != 2 {
		t.Fatalf("describe submits = %d, want 2 (initial run + one retry)", len(client.describeSubmits))
	}
	if stored.Status != model.VideoAnalysisStatusPartial || stored.DescribeStatus != model.VideoAnalysisStageStatusFailed {
		t.Fatalf("describe failure must remain partial: %+v", stored)
	}
	if stored.DescribeJobID != "" || stored.FinishedAt == nil || stored.ActiveKey != nil {
		t.Fatalf("partial task was not finalized for another retry: %+v", stored)
	}

	client.describeJobFailure = nil
	if err := service.RunMissing(context.Background(), task.ID); err != nil {
		t.Fatal(err)
	}
	stored, err = tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.VideoAnalysisStatusSucceeded || stored.Stage != model.VideoAnalysisStageDone {
		t.Fatalf("recovered task status/stage = %s/%s, want succeeded/done", stored.Status, stored.Stage)
	}
	if stored.ErrorCode != "" || stored.ErrorMessage != "" || stored.MissingModel != "" {
		t.Fatalf("successful retry retained stale errors: %+v", stored)
	}
	if len(client.detectSubmits) != 1 || len(client.structureSubmits) != 1 || len(client.describeSubmits) != 3 {
		t.Fatal("retry must only resubmit the failed describe stage")
	}
}

func TestWorkflowRunMissingFailureIsTerminal(t *testing.T) {
	failure := errors.New("service unavailable")
	for _, tc := range []struct {
		name   string
		client *fakeVideoAnalysisClient
	}{
		{name: "structure submission", client: &fakeVideoAnalysisClient{structureError: failure}},
		{
			name: "artifact claim",
			client: &fakeVideoAnalysisClient{
				artifact: &VideoAnalysisArtifact{
					Files: []VideoAnalysisArtifactFile{{Path: "manifest.json", Size: 2}},
				},
				downloadErr: failure,
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service, tasks, mediaID := setupVideoAnalysisService(t, tc.client)
			service.describeEnabled = true
			task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{IncludeDescriptions: true})
			if err != nil {
				t.Fatal(err)
			}
			if err := service.RunMissing(context.Background(), task.ID); err == nil {
				t.Fatal("expected stage/claim failure")
			}
			stored, err := tasks.FindByID(task.ID)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Status != model.VideoAnalysisStatusFailed || stored.Stage != model.VideoAnalysisStageStructure {
				t.Fatalf("status/stage = %s/%s, want failed/structure", stored.Status, stored.Stage)
			}
			if stored.StructureStatus != model.VideoAnalysisStageStatusFailed || stored.FinishedAt == nil {
				t.Fatalf("failed task was not finalized: %+v", stored)
			}
			if stored.ErrorMessage == "" || stored.ActiveKey != nil {
				t.Fatalf("failed task must retain its error and release its active key: %+v", stored)
			}
		})
	}
}

func TestWorkflowRunMissingResubmitsFailedJobs(t *testing.T) {
	for _, tc := range []struct {
		stage                string
		wantDetectSubmits    int
		wantStructureSubmits int
	}{
		{stage: model.VideoAnalysisStageDetect, wantDetectSubmits: 1, wantStructureSubmits: 1},
		{stage: model.VideoAnalysisStageStructure, wantStructureSubmits: 1},
		{stage: model.VideoAnalysisStageDescribe},
	} {
		t.Run(tc.stage, func(t *testing.T) {
			client := &fakeVideoAnalysisClient{failedJobIDs: map[string]bool{tc.stage + "-old": true}}
			service, tasks, mediaID := setupVideoAnalysisService(t, client)
			service.describeEnabled = true
			task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{IncludeDescriptions: true})
			if err != nil {
				t.Fatal(err)
			}
			task.Status = model.VideoAnalysisStatusFailed
			task.Stage = tc.stage
			task.DetectStatus = model.VideoAnalysisStageStatusSucceeded
			task.StructureStatus = model.VideoAnalysisStageStatusSucceeded
			task.DescribeStatus = model.VideoAnalysisStageStatusSucceeded
			task.SetStageStatus(tc.stage, model.VideoAnalysisStageStatusFailed)
			task.DetectJobID = "detect-old"
			task.StructureJobID = "structure-old"
			task.DescribeJobID = "describe-old"
			task.VideoHash = "hash-1"
			task.ResultJSON = `{"video_hash":"hash-1","scenes":[]}`
			if err := tasks.Update(task); err != nil {
				t.Fatal(err)
			}

			if err := service.RunMissing(context.Background(), task.ID); err != nil {
				t.Fatal(err)
			}
			stored, err := tasks.FindByID(task.ID)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Status != model.VideoAnalysisStatusSucceeded {
				t.Fatalf("status = %q, want succeeded after resubmitting failed job", stored.Status)
			}
			if len(client.detectSubmits) != tc.wantDetectSubmits {
				t.Fatalf("detect submits = %d, want %d", len(client.detectSubmits), tc.wantDetectSubmits)
			}
			if len(client.structureSubmits) != tc.wantStructureSubmits {
				t.Fatalf("structure submits = %d, want %d", len(client.structureSubmits), tc.wantStructureSubmits)
			}
			if len(client.describeSubmits) != 1 || stored.DescribeJobID != "describe-1" {
				t.Fatal("failed stage and its dependent stages must be resubmitted")
			}
		})
	}
}

func TestWorkflowRunMissingReusesCompletedWork(t *testing.T) {
	for _, describeStatus := range []string{
		model.VideoAnalysisStageStatusSucceeded,
		model.VideoAnalysisStageStatusRunning,
	} {
		t.Run(describeStatus, func(t *testing.T) {
			client := &fakeVideoAnalysisClient{}
			service, tasks, mediaID := setupVideoAnalysisService(t, client)
			service.describeEnabled = true
			task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{IncludeDescriptions: true})
			if err != nil {
				t.Fatal(err)
			}
			task.Status = model.VideoAnalysisStatusRunning
			task.Stage = model.VideoAnalysisStageDescribe
			task.DetectStatus = model.VideoAnalysisStageStatusSucceeded
			task.StructureStatus = model.VideoAnalysisStageStatusSucceeded
			task.DescribeStatus = describeStatus
			task.DetectJobID = "detect-existing"
			task.StructureJobID = "structure-existing"
			task.DescribeJobID = "describe-existing"
			task.ResultJSON = `{"video_hash":"hash-1","scenes":[]}`
			if err := tasks.Update(task); err != nil {
				t.Fatal(err)
			}
			if err := service.RunMissing(context.Background(), task.ID); err != nil {
				t.Fatal(err)
			}
			stored, err := tasks.FindByID(task.ID)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Status != model.VideoAnalysisStatusSucceeded || stored.FinishedAt == nil || stored.ActiveKey != nil {
				t.Fatalf("existing work was not finalized: %+v", stored)
			}
			if len(client.detectSubmits)+len(client.structureSubmits)+len(client.describeSubmits) != 0 {
				t.Fatal("completed/running jobs should be reused, not resubmitted")
			}
		})
	}
}

func TestWorkflowRunMissingKeepsPartialDescriptions(t *testing.T) {
	client := &fakeVideoAnalysisClient{
		artifact: &VideoAnalysisArtifact{
			Files: []VideoAnalysisArtifactFile{{Path: "manifest.json", Size: 2}},
		},
		structureResult: []byte(`{"video_hash":"hash-1","scenes":[{"scene_index":0},{"scene_index":1}]}`),
		describeResult: []byte(`{
			"video_hash":"hash-1", "status":"partial",
			"descriptions":[
				{"scene_index":0,"description":"successful description","status":"ok"},
				{"scene_index":1,"status":"failed","error":"model unavailable"}
			],
			"warnings":[{"code":"DESC_LLM_ERROR","message":"model unavailable"}]
		}`),
	}
	service, tasks, mediaID := setupVideoAnalysisService(t, client)
	service.describeEnabled = true
	task, _, err := service.SubmitMedia(mediaID, VideoAnalysisSubmitOptions{IncludeDescriptions: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.RunMissing(context.Background(), task.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.VideoAnalysisStatusPartial || stored.ErrorCode != "DESCRIBE_PARTIAL" {
		t.Fatalf("partially described task = %+v", stored)
	}
	if !strings.Contains(stored.ResultJSON, "successful description") {
		t.Fatal("partial result lost its successful description")
	}
	if len(client.describeSubmits) != 1 || client.downloadCalls != 1 || client.releaseCalls != 0 {
		t.Fatal("partial run must stop after one attempt, claim grids, and retain staging for retry")
	}

	client.describeResult = []byte(`{
		"video_hash":"hash-1", "status":"completed",
		"descriptions":[
			{"scene_index":0,"description":"successful description","status":"ok"},
			{"scene_index":1,"description":"retried description","status":"ok"}
		]
	}`)
	if err := service.RunMissing(context.Background(), task.ID); err != nil {
		t.Fatal(err)
	}
	stored, err = tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.VideoAnalysisStatusSucceeded || !strings.Contains(stored.ResultJSON, "retried description") {
		t.Fatalf("retry did not complete the missing descriptions: %+v", stored)
	}
	if len(client.describeSubmits) != 2 || client.downloadCalls != 1 || client.releaseCalls != 1 {
		t.Fatal("successful retry should reuse claimed grids and release staging")
	}
}
