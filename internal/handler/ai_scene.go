package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/nowen-video/nowen-video/internal/service"
	"go.uber.org/zap"
)

// AISceneHandler AI场景识别与封面优化处理器
type AISceneHandler struct {
	sceneService *service.AISceneService
	logger       *zap.SugaredLogger
}

// GenerateChapters 为视频生成AI章节
func (h *AISceneHandler) GenerateChapters(c *gin.Context) {
	mediaID := c.Param("id")

	task, err := h.sceneService.GenerateChapters(mediaID)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "生成章节失败", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": task, "message": "章节生成任务已启动"})
}

// GetChapters 获取视频章节
func (h *AISceneHandler) GetChapters(c *gin.Context) {
	mediaID := c.Param("id")

	chapters, err := h.sceneService.GetChapters(mediaID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取章节失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": chapters})
}

// ExtractHighlights 提取视频精彩片段
func (h *AISceneHandler) ExtractHighlights(c *gin.Context) {
	mediaID := c.Param("id")

	task, err := h.sceneService.ExtractHighlights(mediaID)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "提取精彩片段失败", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": task, "message": "精彩片段提取任务已启动"})
}

// GetHighlights 获取视频精彩片段
func (h *AISceneHandler) GetHighlights(c *gin.Context) {
	mediaID := c.Param("id")

	highlights, err := h.sceneService.GetHighlights(mediaID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取精彩片段失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": highlights})
}

// GenerateCoverCandidates 生成封面候选
func (h *AISceneHandler) GenerateCoverCandidates(c *gin.Context) {
	mediaID := c.Param("id")

	task, err := h.sceneService.GenerateCoverCandidates(mediaID)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "生成封面候选失败", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": task, "message": "封面候选生成任务已启动"})
}

// GetCoverCandidates 获取封面候选
func (h *AISceneHandler) GetCoverCandidates(c *gin.Context) {
	mediaID := c.Param("id")

	candidates, err := h.sceneService.GetCoverCandidates(mediaID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取封面候选失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": candidates})
}

// SelectCover 选择封面
func (h *AISceneHandler) SelectCover(c *gin.Context) {
	mediaID := c.Param("id")
	candidateID := c.Param("candidateId")

	if err := h.sceneService.SelectCover(mediaID, candidateID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "选择封面失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "封面已选择"})
}

// ApplyCover 应用选中的封面
func (h *AISceneHandler) ApplyCover(c *gin.Context) {
	mediaID := c.Param("id")

	if err := h.sceneService.ApplySelectedCover(mediaID); err != nil {
		respondErr(c, http.StatusInternalServerError, "应用封面失败", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "封面已应用"})
}

// GetAnalysisTasks 获取AI分析任务列表
func (h *AISceneHandler) GetAnalysisTasks(c *gin.Context) {
	mediaID := c.Param("id")

	tasks, err := h.sceneService.GetAnalysisTasks(mediaID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取分析任务失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": tasks})
}

// GetAnalysisTask 获取单个分析任务状态
func (h *AISceneHandler) GetAnalysisTask(c *gin.Context) {
	taskID := c.Param("taskId")

	task, err := h.sceneService.GetAnalysisTask(taskID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取任务失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": task})
}
