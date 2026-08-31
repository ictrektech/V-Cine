package handler

import (
	"errors"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/repository"
	"github.com/nowen-video/nowen-video/internal/service"
	"gorm.io/gorm"
)

type VideoAnalysisHandler struct {
	service *service.VideoAnalysisService
	worker  *service.VideoAnalysisWorker
	cfg     *config.Config
}

func NewVideoAnalysisHandler(service *service.VideoAnalysisService, worker *service.VideoAnalysisWorker, cfg *config.Config) *VideoAnalysisHandler {
	return &VideoAnalysisHandler{service: service, worker: worker, cfg: cfg}
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

func (h *VideoAnalysisHandler) DeleteTask(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
		return
	}
	if err := h.service.DeleteTask(c.Param("id")); err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
		case errors.Is(err, service.ErrVideoAnalysisTaskActive):
			c.JSON(http.StatusConflict, gin.H{"error": "分析中的任务不可删除，请等待完成后再删"})
		default:
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "任务已删除"})
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

// GetConfig 返回视频分析服务配置（供前端判断功能可用性）
func (h *VideoAnalysisHandler) GetConfig(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
		return
	}
	config := h.service.GetConfig()
	c.JSON(http.StatusOK, gin.H{"data": config})
}

// GetHealth 返回视频分析服务诊断信息（Scene / Structure 健康状态与关键配置）。
// 与 GetConfig 不同，服务未启用时也返回 200，便于系统设置展示状态。
func (h *VideoAnalysisHandler) GetHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": h.service.GetHealth(c.Request.Context())})
}

// videoAnalysisSettingsView 是前端读取的视频分析配置视图。
type videoAnalysisSettingsView struct {
	Enabled          bool   `json:"enabled"`
	SceneBaseURL     string `json:"scene_base_url"`
	StructureBaseURL string `json:"structure_base_url"`
	MediaBaseURL     string `json:"media_base_url"`
	AssetDir         string `json:"asset_dir"`
	DescribeEnabled  bool   `json:"describe_enabled"`
}

// updateVideoAnalysisSettingsRequest 是前端可更新的视频分析配置子集。
// asset_dir 属于数据目录，只读展示，不通过该接口修改；source_token 仅通过配置文件设置。
type updateVideoAnalysisSettingsRequest struct {
	Enabled          bool   `json:"enabled"`
	SceneBaseURL     string `json:"scene_base_url"`
	StructureBaseURL string `json:"structure_base_url"`
	MediaBaseURL     string `json:"media_base_url"`
	DescribeEnabled  bool   `json:"describe_enabled"`
}

// GetSettings 返回视频分析可配置项（不要求服务可用，供设置页编辑）。
func (h *VideoAnalysisHandler) GetSettings(c *gin.Context) {
	cfg := h.cfg.GetVideoAnalysisConfig()
	c.JSON(http.StatusOK, gin.H{"data": videoAnalysisSettingsView{
		Enabled:          cfg.Enabled,
		SceneBaseURL:     cfg.SceneBaseURL,
		StructureBaseURL: cfg.StructureBaseURL,
		MediaBaseURL:     cfg.MediaBaseURL,
		AssetDir:         cfg.AssetDir,
		DescribeEnabled:  cfg.DescribeEnabled,
	}})
}

// UpdateSettings 保存视频分析可配置项。
// scene_base_url / structure_base_url / describe_enabled 保存后立即生效，
// enabled 仍需要重启生效。
// asset_dir 只读，不在此接口修改；max_concurrent / poll_interval_seconds / job_timeout_minutes 保持现有值。
func (h *VideoAnalysisHandler) UpdateSettings(c *gin.Context) {
	var req updateVideoAnalysisSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "配置格式错误"})
		return
	}

	updated := h.cfg.GetVideoAnalysisConfig()
	updated.Enabled = req.Enabled
	updated.SceneBaseURL = strings.TrimSpace(req.SceneBaseURL)
	updated.StructureBaseURL = strings.TrimSpace(req.StructureBaseURL)
	updated.MediaBaseURL = strings.TrimSpace(req.MediaBaseURL)
	updated.DescribeEnabled = req.DescribeEnabled

	if updated.Enabled {
		if updated.SceneBaseURL == "" || updated.StructureBaseURL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "启用视频分析需要填写 Scene 与 Structure 服务地址"})
			return
		}
		if updated.MediaBaseURL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "启用视频分析需要填写 media_base_url（detect/structure 访问 nowen-video 的媒体源地址）"})
			return
		}
		if updated.AssetDir == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "启用视频分析需要配置产物目录 asset_dir"})
			return
		}
	}
	// 服务运行时地址会热更新，保存前先校验格式，避免配置已落盘但热更新失败；
	// 启用时即使服务尚未启动也要校验，避免保存后重启才发现地址非法。
	if updated.Enabled || h.service != nil {
		if _, err := service.NewVideoAnalysisClient(updated.SceneBaseURL, updated.StructureBaseURL, nil); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "服务地址格式无效: " + err.Error()})
			return
		}
	}

	if err := h.cfg.UpdateVideoAnalysisConfig(func(cfg *config.VideoAnalysisConfig) {
		*cfg = updated
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存配置失败: " + err.Error()})
		return
	}
	// scene_base_url / structure_base_url 支持热更新，保存后立即生效
	if h.service != nil {
		if err := h.service.SetBaseURLs(updated.SceneBaseURL, updated.StructureBaseURL); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "热更新服务地址失败: " + err.Error()})
			return
		}
		h.service.SetDescribeEnabled(updated.DescribeEnabled)
	}
	c.Status(http.StatusOK)
}

func (h *VideoAnalysisHandler) Cleanup(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
		return
	}
	var request struct {
		KeepRecent int `json:"keep_recent"`
	}
	if err := c.ShouldBindJSON(&request); err != nil || request.KeepRecent < 1 {
		request.KeepRecent = 5
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

// SearchScenes 搜索场景
// q      文本查询（必需）
// mode   检索目标：
//        text  （默认）文搜文：查询文本 vs 场景描述文本 embedding
//        image 文搜图：查询文本 vs 场景视觉 embedding（同一 SigLIP2 模型空间）
// limit  返回条数（默认 20，最大 100）
func (h *VideoAnalysisHandler) SearchScenes(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
		return
	}
	query := c.Query("q")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	mode := c.DefaultQuery("mode", "text")
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少查询参数 q（文本查询）"})
		return
	}
	var results []repository.SceneSearchResult
	var err error
	switch mode {
	case "image":
		results, err = h.service.SearchScenesByTextToImage(query, limit)
	default:
		results, err = h.service.SearchScenesByTextQuery(query, limit)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "场景搜索失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": results})
}

// ListScenesByTask 获取某次视频分析的所有场景
func (h *VideoAnalysisHandler) ListScenesByTask(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
		return
	}
	taskID := c.Param("id")
	if taskID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "taskId 是必填参数"})
		return
	}
	scenes, err := h.service.GetScenesByTaskID(taskID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询场景失败: " + err.Error()})
		return
	}
	// 列表接口排除 embedding 向量（768维 float32 → ~3KB/个，避免响应过大）
	type sceneListItem struct {
		ID                  string  `json:"id"`
		VideoAnalysisTaskID string  `json:"video_analysis_task_id"`
		SceneIndex          int     `json:"scene_index"`
		StartTime           float64 `json:"start_time"`
		EndTime             float64 `json:"end_time"`
		ImagePath           string  `json:"image_path"`
		Description         string  `json:"description"`
		Status              string  `json:"status"`
		Error               string  `json:"error"`
		CreatedAt           string  `json:"created_at"`
	}
	items := make([]sceneListItem, 0, len(scenes))
	for _, s := range scenes {
		items = append(items, sceneListItem{
			ID:                  s.ID,
			VideoAnalysisTaskID: s.VideoAnalysisTaskID,
			SceneIndex:          s.SceneIndex,
			StartTime:           s.StartTime,
			EndTime:             s.EndTime,
			ImagePath:           s.ImagePath,
			Description:         s.Description,
			Status:              s.Status,
			Error:               s.Error,
			CreatedAt:           s.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		})
	}
	c.JSON(http.StatusOK, gin.H{"scenes": items})
}

// GetWorkflow 获取任务工作流状态
func (h *VideoAnalysisHandler) GetWorkflow(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
		return
	}
	workflow, err := h.service.GetWorkflow(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询工作流状态失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": workflow})
}

// RunStage 执行单个阶段
func (h *VideoAnalysisHandler) RunStage(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
		return
	}
	var request struct {
		Stage string `json:"stage" binding:"required"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 stage 参数 (detect/structure/describe)"})
		return
	}
	if err := h.service.RunStage(c.Request.Context(), c.Param("id"), request.Stage); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "阶段已启动"})
}

// RunAll 从第一个未完成阶段跑到尾
func (h *VideoAnalysisHandler) RunAll(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
		return
	}
	if err := h.service.RunAll(c.Request.Context(), c.Param("id")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "任务已全部执行完成"})
}

// RunMissing 自动补齐缺失阶段
func (h *VideoAnalysisHandler) RunMissing(c *gin.Context) {
	if h.service == nil || !h.service.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
		return
	}
	if err := h.service.RunMissing(c.Request.Context(), c.Param("id")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "缺失阶段已补齐"})
}
