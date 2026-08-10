package service

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// claimStagingDir 把结构服务 staging 目录整体 mv 到 <assetDir>/<videoHash>/。
//
// 语义（结构服务无状态化契约）：structure job 成功后产物暂存于服务端
// <staging_base>/<job_id>/，由上游自行搬走（搬走即归上游所有）。本函数执行
// 这次搬移，成功后 asset_dir/<hash>/ 即 Nowen 持久持有的资产目录。
//
// 幂等：目标目录已存在则跳过（说明已搬移过），不覆盖。
// 同卷优先：os.Rename 原子且便宜；跨文件系统（容器内两个独立挂载点，即使底层
// 同一设备）rename 返回 EXDEV，此时 fallback 到 copy + delete（非原子，但正确）。
func claimStagingDir(stagingDir, assetDir, videoHash string) (string, error) {
	stagingDir = strings.TrimSpace(stagingDir)
	if stagingDir == "" || !filepath.IsAbs(stagingDir) {
		return "", errors.New("staging dir must be an absolute path")
	}
	videoHash = strings.TrimSpace(videoHash)
	if videoHash == "" || videoHash == "." || videoHash == ".." || strings.ContainsAny(videoHash, "/\\") {
		return "", errors.New("video hash is invalid for claim")
	}
	assetDir = filepath.Clean(strings.TrimSpace(assetDir))
	if assetDir == "." || assetDir == "" {
		return "", errors.New("asset dir is not configured")
	}
	if err := os.MkdirAll(assetDir, 0o755); err != nil {
		return "", fmt.Errorf("create asset dir: %w", err)
	}

	dst := filepath.Join(assetDir, videoHash)
	// 幂等：目标已存在则跳过（已搬移过），不覆盖。
	if dirExists(dst) {
		return dst, nil
	}
	if !dirExists(stagingDir) {
		return "", fmt.Errorf("staging dir does not exist: %s", stagingDir)
	}

	if err := os.Rename(stagingDir, dst); err != nil {
		if !errors.Is(err, syscall.EXDEV) {
			return "", fmt.Errorf("rename staging dir to asset dir: %w", err)
		}
		// 跨文件系统/挂载点：rename 不可用，fallback 到 copy + delete。
		// copy 完成后删除源目录；源删除失败返回错误（调用方标 failed），
		// 但产物已归上游所有，且源残留由结构服务 TTL 兜底清理；
		// 下次重试时目标已存在会幂等跳过，可自愈。
		if err := claimStagingDirCrossDevice(stagingDir, dst); err != nil {
			return "", err
		}
	}
	// 产物完整标志：manifest.json 必须存在（结构服务最后写它）。
	if err := verifyClaimedManifest(dst); err != nil {
		return "", err
	}
	return dst, nil
}

// claimStagingDirCrossDevice 跨文件系统搬移 fallback：copy + delete。
// copy 非原子，失败会留半成品 dst —— 清理掉，避免下次幂等检查误判"已搬移"，
// 否则半成品永远无法自愈。
func claimStagingDirCrossDevice(stagingDir, dst string) error {
	if err := copyDirRecursive(stagingDir, dst); err != nil {
		_ = os.RemoveAll(dst)
		return fmt.Errorf("claim staging via copy (EXDEV fallback): %w", err)
	}
	if err := os.RemoveAll(stagingDir); err != nil {
		return fmt.Errorf("claim staging: copy ok but remove source %s: %w", stagingDir, err)
	}
	return nil
}

// verifyClaimedManifest 校验搬移/复制后的产物完整标志：manifest.json 必须存在
// （结构服务最后写它），缺失说明产物不完整。
func verifyClaimedManifest(dst string) error {
	if !fileExists(filepath.Join(dst, "manifest.json")) {
		return fmt.Errorf("claimed staging dir missing manifest.json: %s", dst)
	}
	return nil
}

// copyDirRecursive 递归复制 src 目录到 dst（保留文件权限），用于跨文件系统搬移 fallback。
func copyDirRecursive(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if !d.Type().IsRegular() {
			// 跳过符号链接等非普通文件，避免复制不可靠对象。
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		return copyFileWithMode(path, target, info.Mode())
	})
}

// copyFileWithMode 复制单个文件内容并保留权限位。
func copyFileWithMode(src, dst string, mode fs.FileMode) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.WriteFile(dst, data, mode)
}

func dirExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}
