package service

import (
	"errors"
	"path"
	"strings"
	"sync"

	"github.com/nowen-video/nowen-video/internal/model"
)

// ==================== 按位置自动建库（「添加视频」零库冷启动） ====================
//
// 位置驱动的前提：文件必须落在某个扫描根内。因此上传完成后：
//   - 已有库覆盖该路径 → 直接用它扫描；
//   - 没有库覆盖 → 以该路径建一个 mixed 库再扫描（幂等，重复上传不会重复建库）。

// ErrLibraryOverlap 目标路径是已有库的父目录：上传到该目录不会被已有库扫描到，
// 若强行建库又会与子库重叠，因此拒绝（正常情况下 BuildImportLocations 已过滤，不会触发）。
var ErrLibraryOverlap = errors.New("目标目录包含已有的媒体库")

var ensureLibraryMu sync.Mutex

// FindCoveringLibrary 返回覆盖 localPath 的媒体库（库路径等于该目录，或是其祖先）。
// 多个命中时取最长匹配。
func FindCoveringLibrary(localPath string, libs []model.Library) (*model.Library, bool) {
	target := strings.TrimSuffix(strings.TrimSpace(localPath), "/")
	if target == "" {
		return nil, false
	}
	var best *model.Library
	bestLen := -1
	for i := range libs {
		for _, p := range libs[i].AllPaths() {
			cur := strings.TrimSuffix(strings.TrimSpace(p), "/")
			if cur == "" {
				continue
			}
			if cur != target && !strings.HasPrefix(target, cur+"/") {
				continue
			}
			if len(cur) > bestLen {
				best = &libs[i]
				bestLen = len(cur)
			}
		}
	}
	return best, best != nil
}

// userDataOwner 判断路径是否位于某用户的私人数据目录下（<...>/users/<用户>/data[/...]），
// 返回用户名。用于把自动建的库命名为「<用户> 的个人媒体库」而不是 "data"。
func userDataOwner(localPath string) (string, bool) {
	const marker = "/users/"
	p := strings.TrimSuffix(strings.TrimSpace(localPath), "/")
	idx := strings.LastIndex(p, marker)
	if idx < 0 {
		return "", false
	}
	segs := strings.Split(p[idx+len(marker):], "/")
	if len(segs) < 2 || segs[0] == "" || segs[1] != "data" {
		return "", false
	}
	return segs[0], true
}

// DefaultLibraryNameForPath 自动建库的**兜底**库名（语言中立）。
// 正常由前端按当前语言传名字（库名会落库，不能在服务端本地化）：
// 主媒体库 / 公共媒体库（<目录名>）/ <用户> 的个人媒体库。
func DefaultLibraryNameForPath(localPath string) string {
	p := strings.TrimSuffix(strings.TrimSpace(localPath), "/")
	if owner, ok := userDataOwner(p); ok {
		return owner
	}
	if name := path.Base(p); name != "" && name != "." && name != "/" {
		return name
	}
	return "media"
}

// normalizeLibraryName 清洗前端传入的库名：去空白、限长；为空时用语言中立的兜底名
func normalizeLibraryName(name, localPath string) string {
	n := strings.TrimSpace(name)
	if n == "" {
		return DefaultLibraryNameForPath(localPath)
	}
	if r := []rune(n); len(r) > 64 {
		n = string(r[:64])
	}
	return n
}

// EnsureForPath 幂等确保「覆盖该路径的媒体库」存在：
//   - 已有库覆盖 → 返回该库（created=false）；
//   - 目标路径是某个库的父目录 → ErrLibraryOverlap；
//   - 否则以该路径创建 mixed 库（created=true）。
//
// name 由前端按当前语言传入（库名落库，不在服务端本地化）；为空时用目录名兜底。
func (s *LibraryService) EnsureForPath(localPath, name string) (*model.Library, bool, error) {
	libs, err := s.repo.List()
	if err != nil {
		return nil, false, err
	}
	if lib, ok := FindCoveringLibrary(localPath, libs); ok {
		return lib, false, nil
	}

	target := strings.TrimSuffix(strings.TrimSpace(localPath), "/")
	for i := range libs {
		for _, p := range libs[i].AllPaths() {
			if pathsOverlap(p, target) {
				return nil, false, ErrLibraryOverlap
			}
		}
	}

	// 并发上传的多个批次可能同时 ensure 同一位置，串行化避免重复建库
	ensureLibraryMu.Lock()
	defer ensureLibraryMu.Unlock()

	libs, err = s.repo.List()
	if err != nil {
		return nil, false, err
	}
	if lib, ok := FindCoveringLibrary(target, libs); ok {
		return lib, false, nil
	}

	lib, err := s.CreateWithPaths(normalizeLibraryName(name, target), []string{target}, "mixed")
	if err != nil {
		return nil, false, err
	}
	return lib, true, nil
}
