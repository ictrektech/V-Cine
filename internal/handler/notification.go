package handler

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/nowen-video/nowen-video/internal/service"
	"go.uber.org/zap"
)

// NotificationHandler 通知处理器
type NotificationHandler struct {
	notifyService *service.NotificationService
	logger        *zap.SugaredLogger
}

// GetConfig 获取通知配置
func (h *NotificationHandler) GetConfig(c *gin.Context) {
	cfg := h.notifyService.GetConfig()
	c.JSON(http.StatusOK, gin.H{"data": cfg})
}

// UpdateConfig 更新通知配置
func (h *NotificationHandler) UpdateConfig(c *gin.Context) {
	var cfg service.NotificationConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的配置参数"})
		return
	}

	h.notifyService.UpdateConfig(cfg)
	c.JSON(http.StatusOK, gin.H{"message": "通知配置已更新", "data": cfg})
}

// TestNotification 测试通知
func (h *NotificationHandler) TestNotification(c *gin.Context) {
	channel := c.Query("channel")
	if channel == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请指定通知渠道"})
		return
	}

	if err := h.notifyService.TestNotification(channel); err != nil {
		respondErr(c, http.StatusInternalServerError, "", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "测试通知已发送"})
}

// SubtitleSearchHandler 字幕搜索处理器
type SubtitleSearchHandler struct {
	subtitleSearch *service.SubtitleSearchService
	streamService  *service.StreamService
	logger         *zap.SugaredLogger
}

// SearchSubtitles 搜索字幕
func (h *SubtitleSearchHandler) SearchSubtitles(c *gin.Context) {
	mediaID := c.Param("id")
	language := c.DefaultQuery("language", "zh-cn,en")

	// 获取媒体信息
	filePath, _, err := h.streamService.GetDirectStreamInfo(mediaID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "媒体不存在"})
		return
	}

	// 先尝试哈希搜索
	results, err := h.subtitleSearch.SearchByHash(filePath, language)
	if err != nil || len(results) == 0 {
		// 回退到标题搜索（需要从数据库获取标题信息）
		title := c.Query("title")
		yearStr := c.Query("year")
		year := 0
		if yearStr != "" {
			fmt.Sscanf(yearStr, "%d", &year)
		}
		mediaType := c.DefaultQuery("type", "movie")

		if title != "" {
			results, err = h.subtitleSearch.SearchByTitle(title, year, language, mediaType)
			if err != nil {
				respondErr(c, http.StatusInternalServerError, "字幕搜索失败", err)
				return
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": results})
}

// DownloadSubtitle 下载字幕
func (h *SubtitleSearchHandler) DownloadSubtitle(c *gin.Context) {
	mediaID := c.Param("id")

	var req struct {
		FileID string `json:"file_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
		return
	}

	// 获取媒体文件路径
	filePath, _, err := h.streamService.GetDirectStreamInfo(mediaID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "媒体不存在"})
		return
	}

	result, err := h.subtitleSearch.Download(req.FileID, filePath)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "字幕下载失败", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "字幕下载成功",
		"data":    result,
	})
}

// BatchMetadataHandler 批量元数据处理器
type BatchMetadataHandler struct {
	batchService    *service.BatchMetadataService
	importExportSvc *service.MediaImportExportService
	logger          *zap.SugaredLogger
}

// BatchUpdateMedia 批量更新媒体元数据
func (h *BatchMetadataHandler) BatchUpdateMedia(c *gin.Context) {
	var req service.BatchUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
		return
	}

	result, err := h.batchService.BatchUpdateMedia(req)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "批量更新完成",
		"data":    result,
	})
}

// BatchUpdateSeries 批量更新剧集合集元数据
func (h *BatchMetadataHandler) BatchUpdateSeries(c *gin.Context) {
	var req struct {
		SeriesIDs []string          `json:"series_ids"`
		Updates   map[string]string `json:"updates"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
		return
	}

	result, err := h.batchService.BatchUpdateSeries(req.SeriesIDs, req.Updates)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "批量更新完成",
		"data":    result,
	})
}

// TestImportConnection 测试导入连接
func (h *BatchMetadataHandler) TestImportConnection(c *gin.Context) {
	var source service.ImportSource
	if err := c.ShouldBindJSON(&source); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
		return
	}

	if err := h.importExportSvc.TestConnection(source); err != nil {
		respondErr(c, http.StatusInternalServerError, "", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "连接成功"})
}

// FetchImportLibraries 获取外部服务器媒体库列表
func (h *BatchMetadataHandler) FetchImportLibraries(c *gin.Context) {
	var source service.ImportSource
	if err := c.ShouldBindJSON(&source); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
		return
	}

	libraries, err := h.importExportSvc.FetchLibraries(source)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": libraries})
}

// ImportFromExternal 从外部服务器导入
func (h *BatchMetadataHandler) ImportFromExternal(c *gin.Context) {
	var req struct {
		Source          service.ImportSource `json:"source"`
		LibraryID       string               `json:"library_id"`
		TargetLibraryID string               `json:"target_library_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
		return
	}

	result, err := h.importExportSvc.ImportFromEmby(req.Source, req.LibraryID, req.TargetLibraryID)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "导入完成",
		"data":    result,
	})
}

// ExportLibrary 导出媒体库数据
func (h *BatchMetadataHandler) ExportLibrary(c *gin.Context) {
	libraryID := c.Query("library_id")

	data, err := h.importExportSvc.ExportMediaLibrary(libraryID)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "导出成功",
		"data":    data,
	})
}

// ImportFromExportData 从导出数据导入
func (h *BatchMetadataHandler) ImportFromExportData(c *gin.Context) {
	var req struct {
		Data            service.ExportData `json:"data"`
		TargetLibraryID string             `json:"target_library_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
		return
	}

	result, err := h.importExportSvc.ImportFromExportData(&req.Data, req.TargetLibraryID)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "导入完成",
		"data":    result,
	})
}
