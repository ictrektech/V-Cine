package model

import (
	"testing"
	"time"
)

func TestStageTimingRecordingFlow(t *testing.T) {
	task := &VideoAnalysisTask{Status: VideoAnalysisStatusQueued, Stage: VideoAnalysisStageDetect}
	// 模拟 worker：detect running → succeeded
	task.SetStageStatus(VideoAnalysisStageDetect, VideoAnalysisStageStatusRunning)
	time.Sleep(10 * time.Millisecond)
	task.SetStageStatus(VideoAnalysisStageDetect, VideoAnalysisStageStatusSucceeded)
	if task.StageTimings["detect"] <= 0 {
		t.Fatalf("detect timing = %v, want > 0", task.StageTimings["detect"])
	}
	// structure running → succeeded
	task.SetStageStatus(VideoAnalysisStageStructure, VideoAnalysisStageStatusRunning)
	task.SetStageStatus(VideoAnalysisStageStructure, VideoAnalysisStageStatusSucceeded)
	// describe skipped：不计时
	task.SetStageStatus(VideoAnalysisStageDescribe, VideoAnalysisStageStatusRunning)
	task.SetStageStatus(VideoAnalysisStageDescribe, VideoAnalysisStageStatusSkipped)
	if _, ok := task.StageTimings["describe"]; ok {
		t.Fatal("describe skipped should not record timing")
	}
	if task.StageTimings["structure"] <= 0 {
		t.Fatalf("structure timing = %v, want > 0", task.StageTimings["structure"])
	}
	// 已完成阶段重跑不覆盖计时
	before := task.StageTimings["detect"]
	task.SetStageStatus(VideoAnalysisStageDetect, VideoAnalysisStageStatusSucceeded)
	if task.StageTimings["detect"] != before {
		t.Fatal("re-set succeeded on done stage should not overwrite timing")
	}
	// failed 阶段记录耗时
	task2 := &VideoAnalysisTask{Status: VideoAnalysisStatusRunning, Stage: VideoAnalysisStageDescribe}
	task2.SetStageStatus(VideoAnalysisStageDescribe, VideoAnalysisStageStatusRunning)
	time.Sleep(5 * time.Millisecond)
	task2.SetStageStatus(VideoAnalysisStageDescribe, VideoAnalysisStageStatusFailed)
	if task2.StageTimings["describe"] <= 0 {
		t.Fatalf("failed describe timing = %v, want > 0", task2.StageTimings["describe"])
	}
}
