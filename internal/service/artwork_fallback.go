package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/safego"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// ==================== 派生海报兜底图的触发与调度 ====================
//
// 触发源：刮削降级为 partial（MetadataService.SubmitArtworkFallback 投递）。
//
// 调度语义：
//   - 异步执行，不阻塞刮削；
//   - 闸门限流：同时进行的生成不超过 Concurrency；队列满时直接丢弃——
//     该媒体仍是 partial，下一轮刮削重试会再次投递，因此不需要无界队列；
//   - 同一媒体在途去重；
//   - 进程内失败计数，达到上限后不再重试（避免对同一个坏文件反复起 ffmpeg）。
//
// 注意：派生图不写 media.PosterPath，因此本服务不会影响刮削的 partial 语义。

const (
	// artworkFallbackDefaultConcurrency 未配置时的并发上限
	artworkFallbackDefaultConcurrency = 2
	// artworkFallbackMaxAttempts 同一媒体的失败重试上限（进程内计数，重启后清零）
	artworkFallbackMaxAttempts = 3
)

// mediaFinder 兜底生成只需要"按 ID 取媒体"这一项能力。
// 依赖窄接口而非具体仓储：既是依赖倒置，也让调度逻辑能用假实现单测。
type mediaFinder interface {
	FindByID(id string) (*model.Media, error)
}

// artworkProbe 判断媒体当前是否已能解析出可展示的海报（DB 指针 → 同目录侧车图 → 剧集海报）。
// 同样收窄成接口：兜底生成只需要"这条链的结论"，不需要知道它怎么实现。
type artworkProbe interface {
	ResolvePoster(media *model.Media) string
}

// ArtworkFallbackService 派生海报兜底图的触发与调度。
type ArtworkFallbackService struct {
	cfg    *config.Config
	medias mediaFinder
	logger *zap.SugaredLogger
	// probe 可选的图片解析链（*ArtworkResolver）。延迟注入：解析器由 StreamService 持有，
	// 构造顺序上晚于本服务；未注入时退化为只校验 DB 指针（见 hasUsableArtwork）。
	probe artworkProbe

	sem      chan struct{} // 并发闸门
	inFlight sync.Map      // mediaID -> struct{}，在途去重

	mu       sync.Mutex     // 保护 attempts
	attempts map[string]int // mediaID -> 失败次数
}

func NewArtworkFallbackService(
	cfg *config.Config,
	medias mediaFinder,
	logger *zap.SugaredLogger,
) *ArtworkFallbackService {
	concurrency := artworkFallbackDefaultConcurrency
	if cfg != nil && cfg.Artwork.Fallback.Concurrency > 0 {
		concurrency = cfg.Artwork.Fallback.Concurrency
	}
	return &ArtworkFallbackService{
		cfg:      cfg,
		medias:   medias,
		logger:   logger,
		sem:      make(chan struct{}, concurrency),
		attempts: make(map[string]int),
	}
}

// SetArtworkProbe 注入图片解析链（传 StreamService.ArtworkResolver()）。
// 不注入也能工作，但那时只能看到 DB 指针——靠同目录侧车图或剧集海报展示的条目
// 会被误判为"没有海报"，白跑一轮探测与抽帧。
func (s *ArtworkFallbackService) SetArtworkProbe(p artworkProbe) {
	if s == nil {
		return
	}
	s.probe = p
}

// Submit 异步投递一次兜底海报生成，不等待生成完成。
// 返回 false 表示未投递：功能未开启 / mediaID 为空 / 该媒体已在处理中 / 并发已满被丢弃。
func (s *ArtworkFallbackService) Submit(mediaID string) bool {
	if s == nil || !s.enabled() {
		return false
	}
	if strings.TrimSpace(mediaID) == "" {
		return false
	}
	if _, loaded := s.inFlight.LoadOrStore(mediaID, struct{}{}); loaded {
		return false
	}
	// 非阻塞取闸门：拿不到就丢弃，交给下一轮刮削重试
	select {
	case s.sem <- struct{}{}:
	default:
		s.inFlight.Delete(mediaID)
		return false
	}

	safego.Run(func() {
		defer func() {
			<-s.sem
			s.inFlight.Delete(mediaID)
		}()
		s.run(context.Background(), mediaID)
	})
	return true
}

// run 同步执行一次生成。独立成方法便于单测直接调用（Submit 只是它的调度外壳）。
func (s *ArtworkFallbackService) run(ctx context.Context, mediaID string) {
	if s.cfg == nil {
		return
	}
	if s.failCount(mediaID) >= artworkFallbackMaxAttempts {
		s.logger.Warnw("兜底海报已达重试上限，停止重试",
			"media", mediaID,
			"max_attempts", artworkFallbackMaxAttempts,
		)
		return
	}

	media, err := s.medias.FindByID(mediaID)
	if err != nil {
		// 记录不存在（条目可能刚被删除）与仓储层真实故障走不同日志级别；
		// 两者都不计失败次数——条目仍是 partial，下一轮刮削会重新投递。
		if errors.Is(err, gorm.ErrRecordNotFound) {
			s.logger.Debugw("兜底海报跳过：媒体不存在", "media", mediaID)
			return
		}
		s.logger.Warnw("兜底海报跳过：读取媒体失败，交由下一轮刮削重试",
			"media", mediaID,
			"error", err,
		)
		return
	}
	if media == nil {
		s.logger.Debugw("兜底海报跳过：媒体不存在", "media", mediaID)
		return
	}

	s.logger.Debugw("开始生成兜底海报",
		"media", mediaID,
		"title", media.DisplayTitle(),
		"path", media.FilePath,
	)
	if s.artworkReady(media) {
		return // 已有可展示的海报，且派生图未过期
	}

	// 按注册表优先级依次尝试：单来源失败（如内嵌封面流损坏）不阻断后续来源。
	// 逐个来源的失败只在 Debug 留痕，本轮最终只上报一次 Warn。
	var lastErr error
	var lastSource ArtworkSource
	stamp := artworkStamp(media.FilePath)
	for _, spec := range artworkSourceRegistry {
		if !spec.Enabled(s.cfg.Artwork.Fallback) {
			continue
		}
		dst := derivedArtworkPath(s.cfg.Cache.CacheDir, media.ID, spec.Source, stamp)
		generated, genErr := spec.New(s.cfg, s.logger).Generate(ctx, media, dst)
		if genErr != nil {
			lastErr, lastSource = genErr, spec.Source
			s.logger.Debugw("兜底海报来源生成失败，继续尝试下一来源",
				"media", mediaID,
				"source", spec.Source,
				"error", genErr,
			)
			continue
		}
		if generated {
			pruneDerivedArtwork(s.cfg.Cache.CacheDir, media.ID, spec.Source, dst)
			s.clearFailure(mediaID)
			return
		}
	}

	if lastErr == nil {
		return // 所有来源都"不适用"（无内嵌封面 / 全黑帧等），无需重试
	}
	s.logger.Warnw("兜底海报本轮失败",
		"media", mediaID,
		"source", lastSource,
		"attempt", s.recordFailure(mediaID),
		"max_attempts", artworkFallbackMaxAttempts,
		"error", lastErr,
	)
}

func (s *ArtworkFallbackService) enabled() bool {
	return s.cfg != nil && s.cfg.Artwork.Fallback.Enabled
}

// 失败计数：同一 mediaID 已由 inFlight 去重，这里的锁只防跨 mediaID 并发。
func (s *ArtworkFallbackService) failCount(mediaID string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.attempts[mediaID]
}

func (s *ArtworkFallbackService) recordFailure(mediaID string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.attempts[mediaID]++
	return s.attempts[mediaID]
}

func (s *ArtworkFallbackService) clearFailure(mediaID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.attempts, mediaID)
}

// artworkReady 判断现有海报是否无需重做：
// 没有可展示的图 → false；可展示的是真海报 → true；
// 可展示的是派生图 → 只有 stamp 与源文件 mtime 一致才算最新（源文件被替换后要重做）。
func (s *ArtworkFallbackService) artworkReady(media *model.Media) bool {
	if !s.hasUsableArtwork(media) {
		return false
	}
	path, _ := resolveDerivedArtwork(s.cfg.Cache.CacheDir, media.ID)
	if path == "" {
		return true
	}
	return strings.HasSuffix(path, fmt.Sprintf("-%d.jpg", artworkStamp(media.FilePath)))
}

// hasUsableArtwork 判断媒体是否已有可展示的海报，决定要不要生成兜底图。
//
// 注入了解析链就用整条链的结论（DB 指针 → 同目录侧车图 → 剧集海报）：只看 media.PosterPath
// 会让"靠侧车图 / 剧集海报展示"的条目被当成没有海报——白跑一轮探测与抽帧，而产出的派生图
// 还会被解析链的前序档位永久遮蔽（ResolvePoster 里真海报永远优先）。
// 解析链返回的就是派生图本身时同样判为"已有"：产物已存在，无需重复生成（幂等）。
func (s *ArtworkFallbackService) hasUsableArtwork(media *model.Media) bool {
	if s.probe != nil {
		return s.probe.ResolvePoster(media) != ""
	}
	return hasUsablePoster(media)
}

// hasUsablePoster 判断媒体是否已有可展示的真海报：
// 本地路径需文件存在，URL / 远程存储路径不在本地校验（视为可用）。
func hasUsablePoster(media *model.Media) bool {
	if media == nil {
		return false
	}
	p := strings.TrimSpace(media.PosterPath)
	if p == "" {
		return false
	}
	if !isLocalImagePath(p) {
		return true // http(s) / 远程存储路径不在本地校验，视为可用
	}
	_, err := os.Stat(p)
	return err == nil
}
