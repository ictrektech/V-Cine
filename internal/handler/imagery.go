package handler

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-video/nowen-video/internal/service"
)

// ==================== 图片服务（海报 / 背景图）====================
//
// 本文件负责图片 serving：占位图、缓存头（ETag/304）与远程路径分支。
// 图片解析链在 service 层（海报见 StreamService.GetPosterPath，背景图见 GetBackdropPath），
// 这里只负责把它解析出的路径以正确的 Content-Type / 缓存语义吐给客户端。

// posterPlaceholderSVG 美观的海报占位图 SVG（深色渐变背景 + 电影图标 + 提示文字）
const posterPlaceholderSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1a1b2e"/>
      <stop offset="100%" stop-color="#0f1019"/>
    </linearGradient>
    <linearGradient id="icon" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0.25"/>
    </linearGradient>
  </defs>
  <rect fill="url(#bg)" width="300" height="450" rx="0"/>
  <rect x="0" y="0" width="300" height="450" fill="url(#icon)" opacity="0.08"/>
  <!-- 电影胶片图标 -->
  <g transform="translate(150,200)" fill="none" stroke="#4a5568" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5">
    <rect x="-24" y="-18" width="48" height="36" rx="3"/>
    <path d="M-24,-10 L-16,-10 M-24,-2 L-16,-2 M-24,6 L-16,6"/>
    <path d="M24,-10 L16,-10 M24,-2 L16,-2 M24,6 L16,6"/>
    <circle cx="-4" cy="0" r="6"/>
    <circle cx="10" cy="0" r="3"/>
  </g>
  <text fill="#4a5568" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="12" font-weight="500" text-anchor="middle" x="150" y="248">暂无海报</text>
</svg>`

// Poster 提供媒体海报/缩略图
func (h *StreamHandler) Poster(c *gin.Context) {
	posterPath, err := h.streamService.GetPosterPath(c.Param("id"))
	if err != nil || posterPath == "" {
		posterPlaceholder(c)
		return
	}
	h.serveImage(c, posterPath, posterPlaceholder)
}

// posterPlaceholder 输出竖版海报占位图（禁止缓存，确保海报就绪后立即生效）
func posterPlaceholder(c *gin.Context) {
	c.Header("Content-Type", "image/svg+xml")
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Header("Pragma", "no-cache")
	c.Header("X-Poster-Placeholder", "true")
	c.String(http.StatusOK, posterPlaceholderSVG)
}

// serveImage 输出图片：本地文件带 ETag/304，远程路径经 VFS 流式读取；
// 取不到文件（远端不可达 / 本地缺失）时回退到各自的占位图。
func (h *StreamHandler) serveImage(c *gin.Context, path string, placeholder func(*gin.Context)) {
	if service.IsRemotePath(path) {
		if h.serveRemoteImage(c, path) {
			return
		}
		placeholder(c)
		return
	}

	// 基于文件修改时间生成 ETag，支持条件请求（If-None-Match）
	fileInfo, err := os.Stat(path)
	if err != nil {
		placeholder(c)
		return
	}

	etag := fmt.Sprintf(`"%x-%x"`, fileInfo.ModTime().UnixNano(), fileInfo.Size())
	c.Header("ETag", etag)

	// 客户端缓存命中时返回 304
	if match := c.GetHeader("If-None-Match"); match == etag {
		c.Status(http.StatusNotModified)
		return
	}

	setImageContentType(c, path)
	c.Header("Cache-Control", "public, max-age=86400, must-revalidate") // 缓存1天，但必须重新验证
	c.File(path)
}

// setImageContentType 根据扩展名设置图片 Content-Type（海报与背景图共用）
func setImageContentType(c *gin.Context, path string) {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".jpg", ".jpeg":
		c.Header("Content-Type", "image/jpeg")
	case ".png":
		c.Header("Content-Type", "image/png")
	case ".webp":
		c.Header("Content-Type", "image/webp")
	default:
		c.Header("Content-Type", "application/octet-stream")
	}
}

// serveRemoteImage 流式输出远程图片（VFS 打开 + ETag/304 + Range 支持）。
// 远端不可达或取不到文件信息时返回 false，由调用方回退到各自的占位图。
func (h *StreamHandler) serveRemoteImage(c *gin.Context, path string) bool {
	vfsFile, err := h.streamService.OpenMediaFileBounded(path)
	if err != nil {
		return false
	}
	defer vfsFile.Close()

	stat, err := vfsFile.Stat()
	if err != nil {
		return false
	}

	etag := fmt.Sprintf(`"%x-%x"`, stat.ModTime().UnixNano(), stat.Size())
	c.Header("ETag", etag)
	if match := c.GetHeader("If-None-Match"); match == etag {
		c.Status(http.StatusNotModified)
		return true
	}

	setImageContentType(c, path)
	c.Header("Cache-Control", "public, max-age=86400, must-revalidate")
	// 通过 VFSReadSeeker 提供完整文件（支持 Range，但图片一般很小）
	reader := service.NewVFSReadSeeker(vfsFile, stat.Size())
	http.ServeContent(c.Writer, c.Request, filepath.Base(path), stat.ModTime(), reader)
	return true
}

// mediaBackdropPlaceholderSVG 横版（16:9）占位图：媒体完全没有背景图时返回。
const mediaBackdropPlaceholderSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bdbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1b2e"/>
      <stop offset="100%" stop-color="#0f1019"/>
    </linearGradient>
    <linearGradient id="bdglow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0.10"/>
    </linearGradient>
  </defs>
  <rect fill="url(#bdbg)" width="1280" height="720"/>
  <rect width="1280" height="720" fill="url(#bdglow)" opacity="0.35"/>
  <g transform="translate(640,320)" fill="none" stroke="#4a5568" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5">
    <rect x="-32" y="-24" width="64" height="48" rx="4"/>
    <circle cx="-18" cy="16" r="3"/>
    <path d="M-32,-8 L-14,-22 L2,-6 L14,-16 L32,4"/>
  </g>
  <text fill="#4a5568" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="22" font-weight="500" text-anchor="middle" x="640" y="416">暂无背景图</text>
</svg>`

// backdropPlaceholder 输出横版占位图（禁止缓存，确保背景图就绪后立即生效）
func backdropPlaceholder(c *gin.Context) {
	c.Header("Content-Type", "image/svg+xml")
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Header("Pragma", "no-cache")
	c.Header("X-Backdrop-Placeholder", "true")
	c.String(http.StatusOK, mediaBackdropPlaceholderSVG)
}

// Backdrop 提供媒体的横版背景图（首页"继续观看"、分集卡、Pulse 等横版槽位使用）。
// 解析链见 StreamService.GetBackdropPath：真背景图 → 同目录 fanart/backdrop → 剧集回退
// → 派生兜底图（抽帧竖版图，前端按 object-cover 裁切）→ 占位图。
func (h *StreamHandler) Backdrop(c *gin.Context) {
	path, err := h.streamService.GetBackdropPath(c.Param("id"))
	if err != nil || path == "" {
		backdropPlaceholder(c)
		return
	}
	h.serveImage(c, path, backdropPlaceholder)
}
