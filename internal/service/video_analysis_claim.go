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
// 下载在 cleanupMu 外进行，只在最终落盘（persist + rename）时加锁。
// 幂等：目标目录已存在且含 manifest.json 则跳过。release=true 时下载完成后调用
// DELETE 释放服务端 staging；release=false 时保留 staging，供服务端增量重试。
func (s *VideoAnalysisService) claimArtifactForTask(task *model.VideoAnalysisTask, videoHash string, artifact *VideoAnalysisArtifact, release bool) error {
	dst := filepath.Join(s.assetDir, videoHash)
	if dirExists(dst) && fileExists(filepath.Join(dst, "manifest.json")) {
		if release {
			s.releaseStructureJob(task)
		}
		return nil
	}
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
	task.VideoHash = strings.TrimSpace(videoHash)
	if err := s.persist(task); err != nil {
		_ = os.RemoveAll(tmp)
		return fmt.Errorf("persist task before claim: %w", err)
	}
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

func dirExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}
