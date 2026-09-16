package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/nowen-video/nowen-video/internal/model"
)

// claimArtifactForTask 通过 HTTP 下载 structure 产物（v2 Pull 交付）到 asset_dir/<hash>。
// 下载在 cleanupMu 外进行；video_hash 落库、幂等检查与最终落盘加锁。
// 幂等：目标目录已存在且含 manifest.json 则跳过。release=true 时下载完成后调用
// DELETE 释放服务端 staging；release=false 时保留 staging，供服务端增量重试。
func (s *VideoAnalysisService) claimArtifactForTask(task *model.VideoAnalysisTask, videoHash string, artifact *VideoAnalysisArtifact, release bool) error {
	dst := filepath.Join(s.assetDir, videoHash)

	// video_hash 落库 + 幂等检查必须在 cleanupMu 内，与 CleanOrphanStructure 的
	// 「查名单 → 删除」串行化：video_hash 列是孤儿清理保护目录的唯一依据，
	// 锁外执行时清理可能读到旧名单，在本任务判定「跳过下载」后误删目录。
	s.cleanupMu.Lock()
	if err := s.persistVideoHash(task, videoHash); err != nil {
		s.cleanupMu.Unlock()
		return fmt.Errorf("persist video_hash before claim: %w", err)
	}
	if dirExists(dst) && fileExists(filepath.Join(dst, "manifest.json")) {
		s.cleanupMu.Unlock()
		if release {
			s.releaseStructureJob(task)
		}
		return nil
	}
	s.cleanupMu.Unlock()
	if strings.TrimSpace(task.StructureJobID) == "" {
		return fmt.Errorf("%w: artifact claim requires structure_job_id", errClaimStagingFailed)
	}

	tmp, err := s.downloadStructureArtifact(task.StructureJobID, artifact, s.assetDir)
	if err != nil {
		return fmt.Errorf("%w: %v", errClaimStagingFailed, err)
	}

	s.cleanupMu.Lock()
	err = s.finalizeArtifactClaimLocked(task, videoHash, tmp, dst)
	s.cleanupMu.Unlock()
	if err != nil {
		return err
	}

	if s.logger != nil {
		s.logger.Infow("Video analysis claim artifact succeeded",
			"task_id", task.ID,
			"media_id", task.MediaID,
			"video_hash", videoHash,
			"asset_dir", s.assetDir,
		)
	}
	if release {
		s.releaseStructureJob(task)
	}
	return nil
}

// releaseStructureJob 释放服务端 staging 所有权（幂等，失败不致命，TTL 兜底）。
func (s *VideoAnalysisService) releaseStructureJob(task *model.VideoAnalysisTask) {
	if err := s.client.ReleaseStructureJob(context.Background(), task.StructureJobID); err != nil && s.logger != nil {
		s.logger.Warnw("Video analysis release structure job failed (TTL will clean)",
			"task_id", task.ID,
			"media_id", task.MediaID,
			"structure_job_id", task.StructureJobID,
			"error", err,
		)
	}
}

// finalizeArtifactClaimLocked 在持有 cleanupMu 时完成幂等复查、清理残留、
// 持久化 video_hash 和最终 rename。失败时负责清理 tmp。
func (s *VideoAnalysisService) finalizeArtifactClaimLocked(task *model.VideoAnalysisTask, videoHash, tmp, dst string) error {
	if dirExists(dst) && fileExists(filepath.Join(dst, "manifest.json")) {
		_ = os.RemoveAll(tmp)
		return nil
	}
	// 清理历史遗留的不完整 dst（存在但缺 manifest.json），避免 rename 永远失败。
	if !fileExists(filepath.Join(dst, "manifest.json")) {
		if err := os.RemoveAll(dst); err != nil {
			_ = os.RemoveAll(tmp)
			return fmt.Errorf("%w: clean incomplete dst: %v", errClaimStagingFailed, err)
		}
	}
	// video_hash 已在 claimArtifactForTask 入口处落库，这里直接 rename。
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.RemoveAll(tmp)
		return fmt.Errorf("%w: rename downloaded artifact: %v", errClaimStagingFailed, err)
	}
	return nil
}

// downloadStructureArtifact 下载到 assetDir/.tmp 下的唯一临时目录：
// 与最终目录同文件系统，且 CleanOrphanStructure 会跳过隐藏的 .tmp，
// 因此下载期间无需持有 cleanupMu。
func (s *VideoAnalysisService) downloadStructureArtifact(jobID string, artifact *VideoAnalysisArtifact, assetDir string) (string, error) {
	if err := os.MkdirAll(filepath.Join(assetDir, ".tmp"), 0o755); err != nil {
		return "", fmt.Errorf("create artifact tmp dir: %w", err)
	}
	tmp, err := os.MkdirTemp(filepath.Join(assetDir, ".tmp"), "claim-")
	if err != nil {
		return "", fmt.Errorf("create artifact tmp dir: %w", err)
	}
	if err := os.Chmod(tmp, 0o755); err != nil {
		_ = os.RemoveAll(tmp)
		return "", fmt.Errorf("chmod artifact tmp dir: %w", err)
	}
	if err := s.client.DownloadStructureArtifact(context.Background(), jobID, tmp, artifact); err != nil {
		_ = os.RemoveAll(tmp)
		return "", err
	}
	if !fileExists(filepath.Join(tmp, "manifest.json")) {
		_ = os.RemoveAll(tmp)
		return "", errors.New("downloaded artifact missing manifest.json")
	}
	return tmp, nil
}

// persistVideoHash 将 video_hash 落库（幂等：相同值跳过），供 claim 各路径统一调用；
// 任务行存活期间其引用的产物目录持续受孤儿清理保护。
func (s *VideoAnalysisService) persistVideoHash(task *model.VideoAnalysisTask, videoHash string) error {
	videoHash = strings.TrimSpace(videoHash)
	if task == nil || videoHash == "" || task.VideoHash == videoHash {
		return nil
	}
	task.VideoHash = videoHash
	if err := s.persist(task); err != nil {
		task.VideoHash = ""
		return err
	}
	return nil
}

func dirExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}
