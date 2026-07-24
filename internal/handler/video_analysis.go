package handler

import (
	"errors"
	"net/http"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/nowen-video/nowen-video/internal/service"
	"gorm.io/gorm"
)

type VideoAnalysisHandler struct {
	service *service.VideoAnalysisService
	worker  *service.VideoAnalysisWorker
}

func NewVideoAnalysisHandler(service *service.VideoAnalysisService, worker *service.VideoAnalysisWorker) *VideoAnalysisHandler {
	return &VideoAnalysisHandler{service: service, worker: worker}
}

func (h *VideoAnalysisHandler) SubmitMedia(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
		return
	}
	var request struct {
		MediaID             string `json:"media_id" binding:"required"`
		Force               bool   `json:"force"`
		IncludeDescriptions bool   `json:"include_descriptions"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 media_id"})
		return
	}
	task, reused, err := h.service.SubmitMedia(request.MediaID, service.VideoAnalysisSubmitOptions{
		Force: request.Force, IncludeDescriptions: request.IncludeDescriptions,
	})
	if err != nil {
		status := http.StatusUnprocessableEntity
		if errors.Is(err, gorm.ErrRecordNotFound) {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	if h.worker != nil {
		h.worker.Notify()
	}
	c.JSON(http.StatusAccepted, gin.H{"data": task, "reused": reused})
}

func (h *VideoAnalysisHandler) BatchSubmit(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
		return
	}
	var request struct {
		MediaIDs            []string `json:"media_ids" binding:"required,min=1,max=500"`
		Force               bool     `json:"force"`
		IncludeDescriptions bool     `json:"include_descriptions"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 1 到 500 个 media_ids"})
		return
	}
	result := h.service.BatchSubmit(request.MediaIDs, service.VideoAnalysisSubmitOptions{
		Force: request.Force, IncludeDescriptions: request.IncludeDescriptions,
	})
	if h.worker != nil && result.Created > 0 {
		h.worker.Notify()
	}
	c.JSON(http.StatusAccepted, gin.H{"data": result})
}

func (h *VideoAnalysisHandler) GetTask(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
		return
	}
	task, err := h.service.GetTask(c.Param("id"))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询任务失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": task})
}

func (h *VideoAnalysisHandler) GetLatestTaskByMedia(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
		return
	}
	mediaID := c.Query("media_id")
	if mediaID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 media_id"})
		return
	}
	task, err := h.service.GetLatestTaskByMediaID(mediaID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, gin.H{"data": nil})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询最新任务失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": task})
}

func (h *VideoAnalysisHandler) ListTasks(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	tasks, total, err := h.service.ListTasks(page, pageSize, c.Query("status"), c.Query("library_id"), c.Query("keyword"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询任务列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"tasks": tasks, "total": total, "page": page, "page_size": pageSize,
	}})
}

func (h *VideoAnalysisHandler) RetryTask(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
		return
	}
	task, err := h.service.RetryTask(c.Param("id"))
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
		case errors.Is(err, service.ErrVideoAnalysisTaskActive):
			c.JSON(http.StatusConflict, gin.H{"error": "该媒体已有进行中的视频分析任务", "data": task})
		default:
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		}
		return
	}
	if h.worker != nil {
		h.worker.Notify()
	}
	c.JSON(http.StatusAccepted, gin.H{"data": task})
}

func (h *VideoAnalysisHandler) Statistics(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
		return
	}
	counts, err := h.service.Statistics()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询任务统计失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": counts})
}

func (h *VideoAnalysisHandler) DetailedStatistics(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
		return
	}
	stats, err := h.service.DetailedStatistics()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询详细统计失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": stats})
}

func (h *VideoAnalysisHandler) Cleanup(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
		return
	}
	var request struct {
		KeepRecent int `json:"keep_recent"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		request.KeepRecent = 100
	}
	if request.KeepRecent < 10 {
		request.KeepRecent = 10
	}
	deletedCount, err := h.service.CleanupOldTasks(request.KeepRecent)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "清理任务失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted_count": deletedCount}})
}

func (h *VideoAnalysisHandler) GetMediaResult(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
		return
	}
	result, err := h.service.GetResultByMedia(c.Param("id"), c.Query("task_id"))
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "未找到可展示的视频分析结果"})
		case err.Error() == "media_id is required":
			c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 media_id"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "查询视频分析结果失败"})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}

func (h *VideoAnalysisHandler) ServeSceneGrid(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
		return
	}
	sceneIndex, err := strconv.Atoi(c.Param("sceneIndex"))
	if err != nil || sceneIndex < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sceneIndex 必须是非负整数"})
		return
	}
	file, contentType, modTime, err := h.service.OpenSceneGridByMedia(c.Param("id"), c.Query("task_id"), sceneIndex)
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "九宫格图片不存在"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "读取九宫格图片失败"})
		}
		return
	}
	defer file.Close()
	c.Header("Content-Type", contentType)
	c.Header("Cache-Control", "private, max-age=300")
	c.Header("X-Content-Type-Options", "nosniff")
	http.ServeContent(c.Writer, c.Request, filepath.Base(file.Name()), modTime, file)
}
