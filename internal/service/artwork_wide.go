package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nowen-video/nowen-video/internal/model"
	"golang.org/x/sync/singleflight"
)

// ==================== 派生横版背景图（16:9）====================
//
// 把竖版海报合成为 16:9：背景放大铺满 + 高斯模糊 + 压暗，前景海报按高度缩放居中。
// 产物落 cache/images/{id}/backdrop-wide-{stamp}.jpg，stamp 为源海报 mtime，
// 不回写 media.BackdropPath。解析侧只 stat 探测，生成幂等且同 key 单飞。

const (
	// wideBackdropWidth / wideBackdropHeight 产物规格：1280x720（16:9）。
	wideBackdropWidth  = 1280
	wideBackdropHeight = 720
	// wideBackdropTimeout 单次合成最长耗时。
	wideBackdropTimeout = 20 * time.Second
	// wideBackdropFilePrefix 产物文件名前缀，后缀为源海报 mtime。
	wideBackdropFilePrefix = "backdrop-wide-"
)

// wideBackdropFilter 16:9 合成滤镜链：
// 背景层放大铺满并按需裁切 → 高斯模糊 → 轻微压暗，前景层海报按高度缩放后水平居中。
var wideBackdropFilter = "[0:v]scale=" + strconv.Itoa(wideBackdropWidth) + ":" + strconv.Itoa(wideBackdropHeight) +
	":force_original_aspect_ratio=increase,crop=" + strconv.Itoa(wideBackdropWidth) + ":" + strconv.Itoa(wideBackdropHeight) +
	",gblur=sigma=24,eq=brightness=-0.10[bg];" +
	"[0:v]scale=-2:" + strconv.Itoa(wideBackdropHeight) + "[fg];" +
	"[bg][fg]overlay=(W-w)/2:0"

// wideBackdropSem 限制合成并发，最多同时跑 2 个。
var wideBackdropSem = make(chan struct{}, 2)

// wideBackdropGroup 同一 key 的并发生成合并为一次。
var wideBackdropGroup singleflight.Group

// wideBackdropFailureTTL 合成失败后的冷却时长。
const wideBackdropFailureTTL = 10 * time.Minute

// wideBackdropFailures 记录失败过的 {cacheKey}@{stamp}，过期后允许重试。
var wideBackdropFailures sync.Map

// errWideBackdropBusy 并发槽已满；不计入失败冷却。
var errWideBackdropBusy = errors.New("横版合成并发已满")

// wideBackdropPath 产物路径：cache/images/{id}/backdrop-wide-{stamp}.jpg。
func wideBackdropPath(cacheDir, mediaID string, stamp int64) string {
	return filepath.Join(derivedArtworkDir(cacheDir, mediaID), wideBackdropFilePrefix+strconv.FormatInt(stamp, 10)+".jpg")
}

// wideBackdropHits 已生成产物的路径缓存（cacheDir|cacheKey → 文件路径）。
// 命中时仍 stat 一次，文件被清理后自动失效。
var wideBackdropHits sync.Map

// wideHitKey 路径缓存的键，含 cacheDir。
func wideHitKey(cacheDir, cacheKey string) string { return cacheDir + "|" + cacheKey }

// findWideBackdrop 探测已生成的横版派生图（取最新 stamp）。只 stat，不生成。
func findWideBackdrop(cacheDir, cacheKey string) string {
	if cacheDir == "" || cacheKey == "" {
		return ""
	}
	mapKey := wideHitKey(cacheDir, cacheKey)
	if v, ok := wideBackdropHits.Load(mapKey); ok {
		if p, _ := v.(string); p != "" && fileExistsNonEmpty(p) {
			return p
		}
		wideBackdropHits.Delete(mapKey)
	}
	p := newestStampedFile(derivedArtworkDir(cacheDir, cacheKey), wideBackdropFilePrefix)
	if p != "" {
		wideBackdropHits.Store(mapKey, p)
	}
	return p
}

// EnsureWideBackdrop 为媒体生成（幂等）16:9 横版派生图。
// 源海报为远程 URL、ffmpeg 失败或产物不可解码时返回空串。
func (r *ArtworkResolver) EnsureWideBackdrop(media *model.Media) string {
	if r == nil || r.cfg == nil || media == nil || media.ID == "" {
		return ""
	}
	// 分集无自身海报时共用剧集产物。
	if strings.TrimSpace(media.PosterPath) == "" && media.SeriesID != "" && r.seriesRepo != nil {
		if series, err := r.seriesRepo.FindByIDOnly(media.SeriesID); err == nil && series != nil {
			if wide := r.EnsureWideBackdropForSeries(series); wide != "" {
				return wide
			}
		}
	}
	return r.ensureWideBackdrop(media.ID, r.ResolvePoster(media))
}

// seriesArtworkKey 剧集级缓存的目录键，产物落 cache/images/series/{id}/。
func seriesArtworkKey(seriesID string) string { return "series/" + seriesID }

// EnsureWideBackdropForSeries 为剧集生成（幂等）16:9 横版派生图：
// 优先剧集海报指针，其次剧集根目录 poster / cover / folder / show。
// 产物落 cache/images/series/{id}/ 下。
func (r *ArtworkResolver) EnsureWideBackdropForSeries(series *model.Series) string {
	if r == nil || r.cfg == nil || series == nil || series.ID == "" {
		return ""
	}
	src := strings.TrimSpace(series.PosterPath)
	if src == "" || !r.fileExists(src) {
		src = r.findFirstImage(series.FolderPath, artworkSeriesPosterNames)
	}
	return r.ensureWideBackdrop(seriesArtworkKey(series.ID), src)
}

// ensureWideBackdrop 通用实现：cacheKey 决定产物目录，src 为本地海报文件。
func (r *ArtworkResolver) ensureWideBackdrop(cacheKey, src string) string {
	cacheDir := r.cfg.Cache.CacheDir
	if cacheDir == "" || cacheKey == "" {
		return ""
	}

	src = strings.TrimSpace(src)
	// 远程海报不参与合成。
	if src == "" || IsRemotePath(src) {
		return ""
	}
	if _, err := os.Stat(src); err != nil {
		return ""
	}

	stamp := artworkStamp(src)
	target := wideBackdropPath(cacheDir, cacheKey, stamp)
	if fileExistsNonEmpty(target) {
		wideBackdropHits.Store(wideHitKey(cacheDir, cacheKey), target)
		return target
	}
	failKey := cacheKey + "@" + strconv.FormatInt(stamp, 10)
	if wideBackdropRecentFailure(failKey) {
		return ""
	}

	result, _, _ := wideBackdropGroup.Do(cacheKey, func() (interface{}, error) {
		// 单飞内二次探测。
		if fileExistsNonEmpty(target) {
			return target, nil
		}
		if err := composeWideBackdrop(r.cfg.App.FFmpegPath, src, stamp, target); err != nil {
			if !errors.Is(err, errWideBackdropBusy) {
				wideBackdropFailures.Store(failKey, time.Now())
			}
			return "", err
		}
		wideBackdropFailures.Delete(failKey)
		trimOldWideBackdrops(cacheDir, cacheKey, stamp)
		wideBackdropHits.Store(wideHitKey(cacheDir, cacheKey), target)
		return target, nil
	})
	if result == nil {
		return ""
	}
	path, _ := result.(string)
	return path
}

// composeWideBackdrop 用 ffmpeg 合成 16:9 图并原子落盘（先写 .tmp 再 rename）。
func composeWideBackdrop(ffmpegPath, src string, stamp int64, target string) error {
	if ffmpegPath == "" {
		ffmpegPath = "ffmpeg"
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return fmt.Errorf("创建派生目录失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), wideBackdropTimeout)
	defer cancel()

	// 拿不到并发槽立即返回，不排队。
	select {
	case wideBackdropSem <- struct{}{}:
		defer func() { <-wideBackdropSem }()
	default:
		return errWideBackdropBusy
	}

	tmp := strings.TrimSuffix(target, ".jpg") + ".tmp.jpg"
	_ = os.Remove(tmp)

	args := []string{
		"-hide_banner", "-loglevel", "error", "-nostdin", "-y",
		"-i", src,
		"-filter_complex", wideBackdropFilter,
		"-frames:v", "1", "-q:v", "3",
		tmp,
	}
	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	setLowPriority(cmd)
	if output, err := cmd.CombinedOutput(); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("横版合成失败: %w (%s)", err, summarizeFFmpegOutput(output))
	}
	if !isDecodableJPEG(tmp) {
		_ = os.Remove(tmp)
		return fmt.Errorf("横版合成产物不可解码: %s", filepath.Base(tmp))
	}
	if err := os.Rename(tmp, target); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("横版产物落盘失败: %w", err)
	}
	return nil
}

// trimOldWideBackdrops 删除同一 key 的旧 stamp 产物，只保留 keepStamp 这一份。
func trimOldWideBackdrops(cacheDir, mediaID string, keepStamp int64) {
	dir := derivedArtworkDir(cacheDir, mediaID)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	keep := filepath.Base(wideBackdropPath(cacheDir, mediaID, keepStamp))
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || name == keep || !strings.HasPrefix(name, wideBackdropFilePrefix) || !strings.HasSuffix(name, ".jpg") {
			continue
		}
		_ = os.Remove(filepath.Join(dir, name))
	}
}

// wideBackdropRecentFailure 该 {key}@{stamp} 是否在冷却期内失败过。
func wideBackdropRecentFailure(failKey string) bool {
	v, ok := wideBackdropFailures.Load(failKey)
	if !ok {
		return false
	}
	if ts, _ := v.(time.Time); time.Since(ts) < wideBackdropFailureTTL {
		return true
	}
	wideBackdropFailures.Delete(failKey)
	return false
}

// fileExistsNonEmpty 判断路径存在、是文件且大小大于 0。
func fileExistsNonEmpty(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Size() > 0
}
