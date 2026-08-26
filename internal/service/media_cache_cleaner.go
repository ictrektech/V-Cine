package service

import "go.uber.org/zap"

// MediaCacheCleaner 删除媒体记录时清理转码/预处理/ABR 缓存的协调器。
// 所有清理都是 best-effort，失败只记日志，不阻断媒体删除。
type MediaCacheCleaner struct {
	transcode  *TranscodeService
	preprocess *PreprocessService
	abr        *ABRService
	logger     *zap.SugaredLogger
}

func NewMediaCacheCleaner(transcode *TranscodeService, preprocess *PreprocessService, abr *ABRService, logger *zap.SugaredLogger) *MediaCacheCleaner {
	return &MediaCacheCleaner{transcode: transcode, preprocess: preprocess, abr: abr, logger: logger}
}

func (c *MediaCacheCleaner) Clean(mediaID string) {
	if err := c.transcode.CleanMediaCache(mediaID); err != nil {
		c.logger.Warnf("删除媒体后清理转码缓存失败: media_id=%s, err=%v", mediaID, err)
	}
	if err := c.preprocess.DeleteByMediaID(mediaID); err != nil {
		c.logger.Warnf("删除媒体后清理预处理缓存失败: media_id=%s, err=%v", mediaID, err)
	}
	if err := c.abr.CleanABRCache(mediaID); err != nil {
		c.logger.Warnf("删除媒体后清理 ABR 缓存失败: media_id=%s, err=%v", mediaID, err)
	}
}
