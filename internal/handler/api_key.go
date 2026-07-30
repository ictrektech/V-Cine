package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-video/nowen-video/internal/service"
	"go.uber.org/zap"
)

// ApiKeyHandler API Key 管理处理器
type ApiKeyHandler struct {
	service *service.ApiKeyService
	logger  *zap.SugaredLogger
}

func NewApiKeyHandler(apiKeyService *service.ApiKeyService, logger *zap.SugaredLogger) *ApiKeyHandler {
	return &ApiKeyHandler{service: apiKeyService, logger: logger}
}

type createApiKeyRequest struct {
	Name      string     `json:"name" binding:"required"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
}

// Create 创建 API Key
func (h *ApiKeyHandler) Create(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未认证"})
		return
	}

	var req createApiKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 API Key 名称"})
		return
	}

	result, err := h.service.Create(c.Request.Context(), userID, req.Name, req.ExpiresAt)
	if err != nil {
		h.logger.Warnw("Failed to create API Key", "user_id", userID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": result})
}

// List 列出当前用户的 API Key
func (h *ApiKeyHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未认证"})
		return
	}

	keys, err := h.service.ListByUser(c.Request.Context(), userID)
	if err != nil {
		h.logger.Warnw("Failed to list API Keys", "user_id", userID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}

	if keys == nil {
		keys = []service.ApiKeyView{}
	}
	c.JSON(http.StatusOK, gin.H{"data": keys})
}

// Revoke 撤销 API Key
func (h *ApiKeyHandler) Revoke(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未认证"})
		return
	}

	keyID := c.Param("id")
	if keyID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 Key ID"})
		return
	}

	if err := h.service.Revoke(c.Request.Context(), keyID, userID); err != nil {
		h.logger.Warnw("Failed to revoke API Key", "key_id", keyID, "user_id", userID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "撤销失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "已撤销"})
}

// Delete 物理删除 API Key
func (h *ApiKeyHandler) Delete(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未认证"})
		return
	}

	keyID := c.Param("id")
	if keyID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 Key ID"})
		return
	}

	if err := h.service.Delete(c.Request.Context(), keyID, userID); err != nil {
		h.logger.Warnw("Failed to delete API Key", "key_id", keyID, "user_id", userID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}
