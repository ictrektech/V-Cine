package service

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/repository"
	"go.uber.org/zap"
)

// ==================== 图片缓存孤儿清理 ====================
//
// 与 TranscodeService.CleanupOrphanTranscodeCaches / VideoAnalysisService.CleanOrphanStructure
// 同一范式：只删"数据库中已无任何引用"的目录。这些图片是元数据资产（media/series 的
// poster_path、person 的 profile_url 直接指向，海报墙与 Emby 都从这里取图），删掉在库
// 条目的图片会导致海报空白、拉图 404，且恢复需重新刮削——因此不做 TTL 清理，只回收孤儿。
//
// 前提：本实例独享 cache 目录。多实例共用 cache_dir 却连不同数据库时，一方判定的
// "孤儿"可能正是另一方在引用的图片，故有下述安全阀。

// imageCacheOrphanGracePeriod 孤儿目录宽限期：避免误删"图片刚落盘、引用尚未写入"的中间态。
const imageCacheOrphanGracePeriod = 24 * time.Hour

// imageCacheOrphanAllSuspectMin 安全阀下限：候选孤儿数 == 扫描总数且达到该值时中止清理
// （正常总会有部分目录被引用，"一个都没被引用"更可能是连错库或共用 cache 目录）。
const imageCacheOrphanAllSuspectMin = 5

// imageCacheMediaDirPattern 目录名是否为实体 ID（UUID）。
// UUID 形状准入用于自动排除 series / persons / photos 等命名空间子目录，新增同类无需改代码。
var imageCacheMediaDirPattern = regexp.MustCompile(
	`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`,
)

// imageCacheOrphanCategories 支持孤儿清理的缓存分类（分类名 = cache 下一级目录名）。
var imageCacheOrphanCategories = map[string]struct{}{
	"images":     {}, // 海报/背景图（另有 series / persons 命名空间）
	"covers":     {}, // AI 场景封面候选
	"thumbnails": {}, // 播放器缩略图/雪碧图
}

// imageCacheOrphanCategoryOrder 全量清理时的固定顺序，便于日志与结果稳定。
var imageCacheOrphanCategoryOrder = []string{"images", "covers", "thumbnails"}

// ImageCacheCleaner 图片类缓存目录的孤儿清理器。
type ImageCacheCleaner struct {
	cfg        *config.Config
	mediaRepo  *repository.MediaRepo
	seriesRepo *repository.SeriesRepo
	personRepo *repository.PersonRepo
	logger     *zap.SugaredLogger
}

func NewImageCacheCleaner(
	cfg *config.Config,
	mediaRepo *repository.MediaRepo,
	seriesRepo *repository.SeriesRepo,
	personRepo *repository.PersonRepo,
	logger *zap.SugaredLogger,
) *ImageCacheCleaner {
	return &ImageCacheCleaner{
		cfg:        cfg,
		mediaRepo:  mediaRepo,
		seriesRepo: seriesRepo,
		personRepo: personRepo,
		logger:     logger,
	}
}

// ImageCacheCleanResult 孤儿清理统计。
type ImageCacheCleanResult struct {
	Scanned    int   `json:"scanned"`     // 本次纳入判定的目录数（不含命名空间目录）
	Cleaned    int   `json:"cleaned"`     // 实际删除的目录数
	FreedBytes int64 `json:"freed_bytes"` // 释放字节数
	Skipped    int   `json:"skipped"`     // 因处于宽限期而跳过的目录数
}

// imageCacheOrphanDir 待删除的孤儿目录（先收集、后判定、再删除）。
type imageCacheOrphanDir struct {
	dir  string
	size int64
}

// CleanOrphanImageCaches 清理 cache 下已无数据库引用的图片类缓存目录。
// categories 为空时清理全部，也可只传一个分类（供缓存管理面板按分类触发时给出准确统计）。
//
// 各分类目录结构：
//   - images/{media_id}          媒体海报/背景
//   - images/series/{series_id}  剧集海报/背景
//   - images/persons/{person_id} 人物头像
//   - covers/{media_id}          AI 场景封面候选
//   - thumbnails/{media_id}      播放器缩略图/雪碧图
//
// 两阶段执行（先全量收集候选再统一删除）：删除前才能判断"是否全部均为孤儿"从而启用安全阀。
// 单个目录删除失败只记日志（best-effort）。
func (c *ImageCacheCleaner) CleanOrphanImageCaches(categories ...string) (*ImageCacheCleanResult, error) {
	res := &ImageCacheCleanResult{}
	if c == nil || c.cfg == nil || strings.TrimSpace(c.cfg.Cache.CacheDir) == "" {
		return res, nil
	}

	scope := categories
	if len(scope) == 0 {
		scope = imageCacheOrphanCategoryOrder
	}
	for _, name := range scope {
		if _, ok := imageCacheOrphanCategories[name]; !ok {
			return nil, fmt.Errorf("不支持的图片缓存分类: %s", name)
		}
	}

	validMedia, err := c.mediaIDSet()
	if err != nil {
		return nil, err
	}

	// series / persons 的引用集合只在需要时查询（仅 images 分类用得到）
	var validSeries, validPersons map[string]struct{}
	if imageCacheScopeHas(scope, "images") {
		if validSeries, err = c.seriesIDSet(); err != nil {
			return nil, err
		}
		if validPersons, err = c.personIDSet(); err != nil {
			return nil, err
		}
	}

	// ---- 第一阶段：收集候选（不删除） ----
	var candidates []imageCacheOrphanDir
	cacheDir := c.cfg.Cache.CacheDir
	for _, name := range scope {
		if name == "images" {
			c.collectImageRoot(filepath.Join(cacheDir, name), validMedia, validSeries, validPersons, res, &candidates)
			continue
		}
		c.collectFlatMediaDirs(filepath.Join(cacheDir, name), validMedia, res, &candidates)
	}

	// ---- 安全阀：全部目录都无引用时中止 ----
	if len(candidates) >= imageCacheOrphanAllSuspectMin && len(candidates) == res.Scanned {
		return res, fmt.Errorf(
			"已中止图片缓存孤儿清理：扫描到的 %d 个目录全部无数据库引用（疑似连错数据库或与其他实例共用 cache 目录），"+
				"为免整批误删不予执行；如确认无误，请手动清理 %s 下的对应目录",
			res.Scanned, filepath.Join(cacheDir, strings.Join(scope, ",")),
		)
	}

	// ---- 第二阶段：执行删除 ----
	for _, cand := range candidates {
		if err := os.RemoveAll(cand.dir); err != nil {
			c.logger.Warnf("清理孤儿图片缓存目录失败 %s: %v", cand.dir, err)
			continue
		}
		res.Cleaned++
		res.FreedBytes += cand.size
		c.logger.Debugf("已清理孤儿图片缓存目录 %s（释放 %d 字节）", cand.dir, cand.size)
	}

	if res.Cleaned > 0 {
		c.logger.Infof("图片缓存孤儿清理完成：分类=%v 扫描 %d 个目录，清理 %d 个，释放 %d 字节，跳过 %d 个（宽限期）",
			scope, res.Scanned, res.Cleaned, res.FreedBytes, res.Skipped)
	}
	return res, nil
}

func (c *ImageCacheCleaner) mediaIDSet() (map[string]struct{}, error) {
	ids, err := c.mediaRepo.ListAllIDs()
	if err != nil {
		return nil, fmt.Errorf("查询媒体 ID 失败: %w", err)
	}
	return imageCacheIDSet(ids), nil
}

func (c *ImageCacheCleaner) seriesIDSet() (map[string]struct{}, error) {
	ids, err := c.seriesRepo.ListAllIDs()
	if err != nil {
		return nil, fmt.Errorf("查询剧集合集 ID 失败: %w", err)
	}
	return imageCacheIDSet(ids), nil
}

func (c *ImageCacheCleaner) personIDSet() (map[string]struct{}, error) {
	ids, err := c.personRepo.ListAllIDs()
	if err != nil {
		return nil, fmt.Errorf("查询人物 ID 失败: %w", err)
	}
	return imageCacheIDSet(ids), nil
}

// collectImageRoot 收集 cache/images 下的孤儿候选（一级为 media_id，series / persons 命名空间单独判定）。
func (c *ImageCacheCleaner) collectImageRoot(
	root string,
	validMedia, validSeries, validPersons map[string]struct{},
	res *ImageCacheCleanResult,
	candidates *[]imageCacheOrphanDir,
) {
	entries, err := os.ReadDir(root)
	if err != nil {
		if !os.IsNotExist(err) {
			c.logger.Warnf("读取缓存目录失败 %s: %v", root, err)
		}
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		dir := filepath.Join(root, name)

		// 命名空间目录：二级才是实体 ID，须按对应实体表判定，否则会被当成 media_id 整个误删。
		switch name {
		case "series":
			c.collectNamespacedDirs(dir, validSeries, res, candidates)
			continue
		case "persons":
			c.collectNamespacedDirs(dir, validPersons, res, candidates)
			continue
		}

		if !imageCacheMediaDirPattern.MatchString(name) {
			continue
		}
		res.Scanned++
		if _, ok := validMedia[name]; ok {
			continue
		}
		c.appendCandidate(entry, dir, res, candidates)
	}
}

// collectNamespacedDirs 收集 cache/images/{namespace}/{entity_id} 这类二级目录的孤儿候选。
func (c *ImageCacheCleaner) collectNamespacedDirs(
	root string,
	valid map[string]struct{},
	res *ImageCacheCleanResult,
	candidates *[]imageCacheOrphanDir,
) {
	for _, entry := range c.readEntityDirs(root) {
		name := entry.Name()
		res.Scanned++
		if _, ok := valid[name]; ok {
			continue
		}
		c.appendCandidate(entry, filepath.Join(root, name), res, candidates)
	}
}

// collectFlatMediaDirs 收集 cache/{category}/{media_id} 这类"一级目录名即 media_id"的孤儿候选。
func (c *ImageCacheCleaner) collectFlatMediaDirs(
	root string,
	validMedia map[string]struct{},
	res *ImageCacheCleanResult,
	candidates *[]imageCacheOrphanDir,
) {
	for _, entry := range c.readEntityDirs(root) {
		name := entry.Name()
		res.Scanned++
		if _, ok := validMedia[name]; ok {
			continue
		}
		c.appendCandidate(entry, filepath.Join(root, name), res, candidates)
	}
}

// appendCandidate 把无引用目录加入候选：宽限期内仅计数跳过，其余统计大小后入列。
func (c *ImageCacheCleaner) appendCandidate(
	entry os.DirEntry,
	dir string,
	res *ImageCacheCleanResult,
	candidates *[]imageCacheOrphanDir,
) {
	if info, err := entry.Info(); err == nil && time.Since(info.ModTime()) < imageCacheOrphanGracePeriod {
		res.Skipped++
		return
	}
	size, _ := dirSize(dir)
	*candidates = append(*candidates, imageCacheOrphanDir{dir: dir, size: size})
}

// readEntityDirs 读取目录并只保留名称形如 UUID 的子目录；目录不存在返回 nil。
func (c *ImageCacheCleaner) readEntityDirs(root string) []os.DirEntry {
	entries, err := os.ReadDir(root)
	if err != nil {
		if !os.IsNotExist(err) {
			c.logger.Warnf("读取缓存目录失败 %s: %v", root, err)
		}
		return nil
	}
	dirs := make([]os.DirEntry, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || !imageCacheMediaDirPattern.MatchString(entry.Name()) {
			continue
		}
		dirs = append(dirs, entry)
	}
	return dirs
}

// imageCacheIDSet 把 ID 列表转成集合，便于 O(1) 判定引用是否存在。
func imageCacheIDSet(ids []string) map[string]struct{} {
	set := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id != "" {
			set[id] = struct{}{}
		}
	}
	return set
}

// imageCacheScopeHas 判断清理范围中是否包含指定分类。
func imageCacheScopeHas(scope []string, name string) bool {
	for _, s := range scope {
		if s == name {
			return true
		}
	}
	return false
}
