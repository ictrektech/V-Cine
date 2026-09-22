package handler

import (
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/nowen-video/nowen-video/internal/service"
	"go.uber.org/zap"
)

// userSafeErrors 业务 sentinel 错误：消息面向用户设计，可直接展示给客户端。
var userSafeErrors = []error{
	service.ErrInvalidCredentials,
	service.ErrUserExists,
	service.ErrUserNotFound,
	service.ErrUserDisabled,
	service.ErrVOSIdentityConflict,
	service.ErrLastAdmin,
	service.ErrLibraryNotFound,
	service.ErrMediaNotFound,
	service.ErrAlreadyFavorited,
	service.ErrScanInProgress,
	service.ErrForbidden,
	service.ErrPlaylistNotFound,
	service.ErrUnauthorized,
	service.ErrInvalidRating,
	service.ErrTimeLimitExceeded,
	service.ErrContentRestricted,
	service.ErrTaskNotFound,
	service.ErrRegistrationDisabled,
	service.ErrInvalidInviteCode,
	service.ErrAIDisabled,
	service.ErrAINotConfigured,
	service.ErrAIModelNotConfigured,
	service.ErrLocalAIBlocked,
	service.ErrAIBudgetExhausted,
	service.ErrVideoAnalysisTaskActive,
}

// isUserSafe 判断错误是否为业务 sentinel（消息可直接展示给用户）。
func isUserSafe(err error) bool {
	for _, e := range userSafeErrors {
		if errors.Is(err, e) {
			return true
		}
	}
	return false
}

// respondErr 将错误翻译为 HTTP 响应（单一处理点：技术细节只进日志，不暴露给客户端）：
//   - 业务 sentinel 错误 → 直接返回其用户可读消息
//   - 其余错误 → 记入日志（zap 全局 logger），客户端只收到 op 文案或通用文案
//
// op 为操作描述（如 "创建合集"、"保存失败"），可为空；为空时非 sentinel 错误
// 返回通用文案。日志通过 zap 全局 logger 记录（cmd/server 启动时 ReplaceGlobals 接线）。
func respondErr(c *gin.Context, status int, op string, err error) {
	if isUserSafe(err) {
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	zap.S().Errorw("请求处理失败",
		"op", op, "status", status, "path", c.Request.URL.Path, "error", err)
	msg := "内部错误，请稍后重试"
	if op != "" {
		msg = op
	}
	c.JSON(status, gin.H{"error": msg})
}
