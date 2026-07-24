package handler

import (
	"errors"
	"net/http"
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

func (h *VideoAnalysisHandler) ListTasks(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	tasks, total, err := h.service.ListTasks(page, pageSize, c.Query("status"), c.Query("library_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询任务列表失败"})
		return
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"tasks": tasks, "total": total, "page": page, "page_size": pageSize,
	}})
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
