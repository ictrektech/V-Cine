package service

import (
	"os"
	"path/filepath"
	"strings"

	"go.uber.org/zap"
)

// mediaScopedCacheCategories 以 media_id 为一级目录名的缓存分类。
// 删除媒体记录后，这些目录必然成为孤儿，可精确按 ID 直接删除。
var mediaScopedCacheCategories = []string{
	"images",     // 海报/背景图（含刮削回退到缓存的副本）
	"covers",     // AI 场景封面候选
	"thumbnails", // 播放器缩略图/雪碧图
}

// MediaCacheCleaner 删除媒体记录时清理转码/预处理/ABR/图片缓存的协调器。
// 所有清理都是 best-effort，失败只记日志，不阻断媒体删除。
type MediaCacheCleaner struct {
	transcode  *TranscodeService
	preprocess *PreprocessService
	abr        *ABRService
	cacheDir   string
	logger     *zap.SugaredLogger
}

func NewMediaCacheCleaner(
	transcode *TranscodeService,
	preprocess *PreprocessService,
	abr *ABRService,
	cacheDir string,
	logger *zap.SugaredLogger,
) *MediaCacheCleaner {
	return &MediaCacheCleaner{
		transcode:  transcode,
		preprocess: preprocess,
		abr:        abr,
		cacheDir:   cacheDir,
		logger:     logger,
	}
}

func (c *MediaCacheCleaner) Clean(mediaID string) {
	if err := c.transcode.CleanMediaCache(mediaID); err != nil {
		c.logger.Warnw("删除媒体后清理转码缓存失败", "mediaID", mediaID, "error", err)
	}
	if err := c.preprocess.DeleteByMediaID(mediaID); err != nil {
		c.logger.Warnw("删除媒体后清理预处理缓存失败", "mediaID", mediaID, "error", err)
	}
	if err := c.abr.CleanABRCache(mediaID); err != nil {
		c.logger.Warnw("删除媒体后清理 ABR 缓存失败", "mediaID", mediaID, "error", err)
	}
	c.removeMediaScopedDirs(mediaID)
}

// CleanSeries 删除剧集级图片缓存目录 cache/images/series/{id}。
func (c *MediaCacheCleaner) CleanSeries(seriesID string) {
	if seriesID == "" || c.cacheDir == "" || strings.ContainsAny(seriesID, `/\`) || strings.Contains(seriesID, "..") {
		return
	}
	if err := os.RemoveAll(filepath.Join(c.cacheDir, "images", "series", seriesID)); err != nil {
		c.logger.Warnw("删除剧集后清理缓存失败", "seriesID", seriesID, "error", err)
	}
}

// removeMediaScopedDirs 删除该媒体在 cache 下的图片类目录。
//
// 只删 cache 内的副本：视频同目录的 {视频名}-poster.jpg 属于用户媒体目录，
// 程序不做任何删除（与 NFO 同级，由用户自行管理）。
func (c *MediaCacheCleaner) removeMediaScopedDirs(mediaID string) {
	// 防御性校验：mediaID 会作为路径片段参与拼接，含分隔符或上跳会把删除范围带出 cache 目录。
	if mediaID == "" || c.cacheDir == "" || strings.ContainsAny(mediaID, `/\`) || strings.Contains(mediaID, "..") {
		return
	}
	for _, category := range mediaScopedCacheCategories {
		if err := os.RemoveAll(filepath.Join(c.cacheDir, category, mediaID)); err != nil {
			c.logger.Warnw("删除媒体后清理缓存失败", "category", category, "mediaID", mediaID, "error", err)
		}
	}
}
