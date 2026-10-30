package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/service"
)

// CapabilityHandler 能力发现接口。
//
// 公开只读：只回状态与文案 key，不回服务地址、密钥与模型凭证。
// 每次请求都重新读 services，保证运行期动态拉起视频分析后状态即时变化。
type CapabilityHandler struct {
	services *service.Services
	cfg      *config.Config
}

func NewCapabilityHandler(services *service.Services, cfg *config.Config) *CapabilityHandler {
	return &CapabilityHandler{services: services, cfg: cfg}
}

// List 返回所有功能的三态清单。
// 响应形态：{"data": {"items": [...]}}，与其它接口的 data 包裹保持一致。
func (h *CapabilityHandler) List(c *gin.Context) {
	// 用普通变量赋接口：服务为 nil 时保持接口为 nil，不产生 typed nil 陷阱。
	var ai service.CapabilityAI
	var va service.CapabilityVideoAnalysis
	if h.services != nil {
		if h.services.AI != nil {
			ai = h.services.AI
		}
		if h.services.VideoAnalysis != nil {
			va = h.services.VideoAnalysis
		}
	}

	// 状态随配置变化，禁止浏览器与中间层缓存。
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{"items": service.BuildCapabilities(h.cfg, ai, va)},
	})
}
