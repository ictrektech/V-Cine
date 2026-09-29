package service

import (
	"os"
	"strings"

	"github.com/nowen-video/nowen-video/internal/model"
)

// 本地图片指针校验：源目录中的 nfo/jpg 被外部删除后，失效的 poster/backdrop 指针
// 会导致假成功 scraped 与前端海报 404。仅校验本地路径（/ 开头），http(s)/远程存储不做 stat。

// isLocalImagePath 判断图片路径是否为本地文件系统路径。
// 只有本地路径才需要（也才能）做 stat 校验；http(s) 与远程存储 scheme 一律放行。
// 图片指针校验与兜底图的"是否已有海报"判断共用这一份路径语义。
func isLocalImagePath(p string) bool {
	return strings.HasPrefix(p, "/") && !IsRemotePath(p)
}

// validateLocalImagePaths 校验媒体的本地图片指针，失效时清空并回写。返回是否有指针被清空。
func validateLocalImagePaths(media *model.Media) bool {
	if media == nil {
		return false
	}
	var invalid bool
	for _, p := range []*string{&media.PosterPath, &media.BackdropPath} {
		path := strings.TrimSpace(*p)
		if path == "" || !isLocalImagePath(path) {
			continue
		}
		if _, err := os.Stat(path); os.IsNotExist(err) {
			*p = ""
			invalid = true
		}
	}
	return invalid
}
