package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// claimStagingDir 把结构服务 staging 目录整体 mv 到 <assetDir>/<videoHash>/。
//
// 语义（结构服务无状态化契约）：structure job 成功后产物暂存于服务端
// <staging_base>/<job_id>/，由上游自行搬走（搬走即归上游所有）。本函数执行
// 这次搬移，成功后 asset_dir/<hash>/ 即 Nowen 持久持有的资产目录。
//
// 幂等：目标目录已存在则跳过（说明已搬移过），不覆盖。
// 同卷：os.Rename 要求源与目标在同一文件系统，跨卷返回 EXDEV。
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
		return "", fmt.Errorf("rename staging dir to asset dir (cross-filesystem?): %w", err)
	}
	// 产物完整标志：manifest.json 存在（结构服务最后写它）。
	if !fileExists(filepath.Join(dst, "manifest.json")) {
		return "", fmt.Errorf("claimed staging dir missing manifest.json: %s", dst)
	}
	return dst, nil
}

func dirExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}
