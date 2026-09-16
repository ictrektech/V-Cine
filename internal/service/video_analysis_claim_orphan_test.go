package service

import (
	"os"
	"path/filepath"
	"testing"
)

// 回归测试：claim 幂等跳过/失败路径必须落库 video_hash，否则删除首个创建目录的
// 任务后，CleanOrphanStructure 会把仍被其他任务引用的目录当孤儿删除，导致九宫格 404。
func TestClaimArtifactSkipPersistsVideoHash(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	const resultJSON = `{"video_hash":"hash-1","artifact":{"files":[{"path":"manifest.json","size":2}]}}`

	svc, task := newClaimArtifactTestService(t, client, resultJSON)
	// 预置已存在的目录（由同 hash 的其他任务先 claim 创建）。
	if err := os.MkdirAll(filepath.Join(svc.assetDir, "hash-1", "grids"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.assetDir, "hash-1", "manifest.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := svc.claimArtifactsForTask(task, true); err != nil {
		t.Fatal(err)
	}
	// 幂等跳过也必须落库 video_hash（孤儿保护依赖该列）。
	if task.VideoHash != "hash-1" {
		t.Fatalf("task video_hash = %q, want hash-1 (skip path must persist video_hash)", task.VideoHash)
	}
	stored, err := svc.tasks.FindByID(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.VideoHash != "hash-1" {
		t.Fatalf("stored video_hash = %q, want hash-1", stored.VideoHash)
	}
}

func TestClaimArtifactWithoutArtifactPersistsVideoHash(t *testing.T) {
	client := &fakeVideoAnalysisClient{}
	const resultJSON = `{"video_hash":"hash-1"}`

	svc, task := newClaimArtifactTestService(t, client, resultJSON)
	if err := svc.claimArtifactsForTask(task, false); err != nil {
		t.Fatal(err)
	}
	if task.VideoHash != "hash-1" {
		t.Fatalf("task video_hash = %q, want hash-1 (artifact-less claim must persist video_hash)", task.VideoHash)
	}
}
