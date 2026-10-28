package handler

import (
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/nowen-video/nowen-video/internal/service"
	"go.uber.org/zap"
)

// ==================== 「添加视频」上传落点 ====================
//
// 只做本地推导（位置 → VOS 共享路径形状 → kind/卷uuid/公共目录名/相对路径），
// 不访问平台 API、不持有平台凭据；公共目录 uuid 由前端用用户 token 查目录表后 join
// （见 tasks/media-import/PLAN.md 4.2 / 4.3）。

const defaultExposedMount = "/exposed"

// ImportTargetHandler 上传落点查询处理器
type ImportTargetHandler struct {
	libService *service.LibraryService
	logger     *zap.SugaredLogger
}

// NewImportTargetHandler 构造
func NewImportTargetHandler(libService *service.LibraryService, logger *zap.SugaredLogger) *ImportTargetHandler {
	return &ImportTargetHandler{libService: libService, logger: logger}
}

// List GET /api/admin/import/targets
//
// 返回可上传的位置：已建库的库路径（带 library_id）+ 尚未建库的位置（library_id 为空，
// 上传完成后调 ensure-library 自动建库）。uploadable=false 时带 reason。
func (h *ImportTargetHandler) List(c *gin.Context) {
	libs, err := h.libService.List()
	if err != nil {
		h.logger.Errorw("查询媒体库失败", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取媒体库列表失败"})
		return
	}

	// /media 的宿主绝对路径（安装时选择的媒体库目录）与 /exposed 挂载点，
	// 独立部署下均为空/不可用 → 落点不可上传（PLAN D8）
	mediaHostPath := os.Getenv("VCINE_MEDIA_PATH")
	exposedRoot := os.Getenv("VCINE_EXPOSED_MOUNT")
	if exposedRoot == "" {
		exposedRoot = defaultExposedMount
	}

	c.JSON(http.StatusOK, gin.H{
		"data": service.BuildImportLocations(libs, mediaHostPath, exposedRoot),
	})
}

type ensureLibraryRequest struct {
	LocalPath string `json:"local_path" binding:"required"`
	// LibraryName 由前端按当前语言给出（库名会落库，服务端不本地化）
	LibraryName string `json:"library_name"`
}

// EnsureLibrary POST /api/admin/import/ensure-library
//
// 幂等确保「覆盖该路径的媒体库」存在（没有则以该路径建 mixed 库），返回 library_id 供扫描。
// 只允许对当前可上传落点调用，避免任意路径建库。
func (h *ImportTargetHandler) EnsureLibrary(c *gin.Context) {
	var req ensureLibraryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	libs, err := h.libService.List()
	if err != nil {
		h.logger.Errorw("查询媒体库失败", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取媒体库列表失败"})
		return
	}
	mediaHostPath := os.Getenv("VCINE_MEDIA_PATH")
	exposedRoot := os.Getenv("VCINE_EXPOSED_MOUNT")
	if exposedRoot == "" {
		exposedRoot = defaultExposedMount
	}

	allowed := false
	for _, loc := range service.BuildImportLocations(libs, mediaHostPath, exposedRoot) {
		if loc.Uploadable && loc.LocalPath == req.LocalPath {
			allowed = true
			break
		}
	}
	if !allowed {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该目录不可上传"})
		return
	}

	lib, created, err := h.libService.EnsureForPath(req.LocalPath, req.LibraryName)
	if err != nil {
		h.logger.Warnw("按位置确保媒体库失败", "local_path", req.LocalPath, "error", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "创建媒体库失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"library_id":   lib.ID,
			"library_name": lib.Name,
			"created":      created,
		},
	})
}
