package service

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
)

// ==================== Artwork 解析链 ====================
//
// 只读：全部是 stat 探测，不解码、不生成、不写 DB。
// 依赖两个仓储 + 配置 + VFS（远程路径的 stat 需要）。
// 真海报永远优先——派生图探测固定在各自解析链的最后一档（见 ResolvePoster / ResolveBackdrop）。

// artworkImageExts 图片扩展名候选（海报链与背景图链共用，顺序即探测顺序）。
var artworkImageExts = []string{".jpg", ".jpeg", ".png", ".webp"}

// artworkBackdropNames 同目录 / 剧集根目录的横版图候选名（不含扩展名）。
var artworkBackdropNames = []string{"fanart", "backdrop"}

// artworkSeriesPosterNames 剧集根目录的竖版海报候选名（不含扩展名）。
var artworkSeriesPosterNames = []string{"poster", "cover", "folder", "show"}

// ArtworkResolver 图片（海报 / 背景图）解析器。
type ArtworkResolver struct {
	mediaRepo  *repository.MediaRepo
	seriesRepo *repository.SeriesRepo
	cfg        *config.Config
	vfsMgr     *VFSManager
}

func NewArtworkResolver(
	mediaRepo *repository.MediaRepo,
	seriesRepo *repository.SeriesRepo,
	cfg *config.Config,
) *ArtworkResolver {
	return &ArtworkResolver{
		mediaRepo:  mediaRepo,
		seriesRepo: seriesRepo,
		cfg:        cfg,
	}
}

// SetVFSManager 注入 VFS 管理器（远程路径的 stat 需要它）。
// 由 StreamService.SetVFSManager 转发，不要在别处单独调用。
func (r *ArtworkResolver) SetVFSManager(vfsMgr *VFSManager) {
	r.vfsMgr = vfsMgr
}

// statFile 文件判断：同时支持本地路径和远程路径
func (r *ArtworkResolver) statFile(p string) (os.FileInfo, error) {
	if r.vfsMgr != nil && IsRemotePath(p) {
		return r.vfsMgr.Stat(p)
	}
	return os.Stat(p)
}

// fileExists 路径是否存在（本地 / 远程存储统一探测）——解析链各档位只关心"在不在"。
func (r *ArtworkResolver) fileExists(p string) bool {
	_, err := r.statFile(p)
	return err == nil
}

// findFirstImage 在 dir 下按"候选名 × 图片扩展名"探测，返回首个命中路径，均未命中返回空串。
// dir 为空时直接返回空：否则会拼出相对路径，被 os.Stat 按当前工作目录误判为命中。
func (r *ArtworkResolver) findFirstImage(dir string, names []string) string {
	if dir == "" {
		return ""
	}
	for _, name := range names {
		for _, ext := range artworkImageExts {
			if candidate := vfsJoinPath(dir, name+ext); r.fileExists(candidate) {
				return candidate
			}
		}
	}
	return ""
}

// seriesArtwork 剧集回退：剧集 DB 指针（pick 指定取哪个字段）优先，其次扫剧集根目录候选名。
// 海报链与背景图链共用这一份实现：两者只差"字段 + 候选名"。
func (r *ArtworkResolver) seriesArtwork(
	media *model.Media,
	names []string,
	pick func(*model.Series) string,
) string {
	if media.SeriesID == "" || r.seriesRepo == nil {
		return ""
	}
	series, err := r.seriesRepo.FindByIDOnly(media.SeriesID)
	if err != nil || series == nil {
		return ""
	}
	if dbPath := pick(series); dbPath != "" && r.fileExists(dbPath) {
		return dbPath
	}
	return r.findFirstImage(series.FolderPath, names)
}

// derivedPoster 派生兜底图路径（只探测不生成）。cfg 缺失时安全返回空串。
func (r *ArtworkResolver) derivedPoster(mediaID string) string {
	path, _ := r.derivedPosterWithSource(mediaID)
	return path
}

// derivedPosterWithSource 同上，并给出派生来源（embedded / frame）。
func (r *ArtworkResolver) derivedPosterWithSource(mediaID string) (string, ArtworkSource) {
	if r.cfg == nil {
		return "", ""
	}
	return resolveDerivedArtwork(r.cfg.Cache.CacheDir, mediaID)
}

// PosterPath 获取海报文件路径
// 对于剧集（episode），如果自身没有海报，会自动 fallback 到所属 Series 的海报；
// 仍无则回退到派生兜底图（内嵌封面 / 抽帧，见 artwork.go）。
func (r *ArtworkResolver) PosterPath(mediaID string) (string, error) {
	media, err := r.mediaRepo.FindByID(mediaID)
	if err != nil {
		return "", mediaLookupError(err)
	}
	return r.ResolvePoster(media), nil
}

// DerivedPosterSource 回答"这张封面是不是程序生成的"：命中派生图时返回其来源
// （embedded / frame），刮削海报、同目录图、剧集海报一律返回空串。
// 只探测本地 cache，不跑 sidecar / 剧集回退——列表逐条调用，禁止引入远程 stat。
func (r *ArtworkResolver) DerivedPosterSource(media *model.Media) ArtworkSource {
	if media == nil || strings.TrimSpace(media.PosterPath) != "" {
		return ""
	}
	_, src := r.derivedPosterWithSource(media.ID)
	return src
}

// BackdropPath 获取横版背景图路径。
// 解析链（优先级从高到低）：
//  1. media.BackdropPath —— 刮削 / 手工上传，DB 指针（可能是远程 URL）
//  2. 同目录 sidecar —— fanart / backdrop
//  3. 剧集回退 —— Series.BackdropPath → series 根目录 fanart / backdrop
//  4. 派生兜底图 —— 抽帧竖版图（前端 object-cover 裁切）
//
// 与海报链一样：派生图只探测不生成、不回写 DB 指针。
// 第 4 步意味着本端点**可能返回竖图**——这是刻意为之：对首页"继续观看"、分集卡
// 这类横版槽位，有一张竖图裁切后也比空占位好。
func (r *ArtworkResolver) BackdropPath(mediaID string) (string, error) {
	media, err := r.mediaRepo.FindByID(mediaID)
	if err != nil {
		return "", mediaLookupError(err)
	}
	return r.ResolveBackdrop(media), nil
}

// mediaLookupError 媒体查询失败时向外返回 ErrMediaNotFound（handler / Emby 据此回退占位图），
// 并以 %w 保留底层原因。
func mediaLookupError(err error) error {
	return fmt.Errorf("%w: %w", ErrMediaNotFound, err)
}

// seriesPosterPath / seriesBackdropPath 是 seriesArtwork 的字段选择器：取剧集上的对应字段。
func seriesPosterPath(s *model.Series) string { return s.PosterPath }

func seriesBackdropPath(s *model.Series) string { return s.BackdropPath }

// ResolveBackdrop 背景图解析链。
func (r *ArtworkResolver) ResolveBackdrop(media *model.Media) string {
	if media == nil {
		return ""
	}

	// 1) 媒体自身的背景图指针
	if media.BackdropPath != "" && r.fileExists(media.BackdropPath) {
		return media.BackdropPath
	}

	// 2) 同目录下的 fanart / backdrop
	if path := r.findFirstImage(vfsDir(media.FilePath), artworkBackdropNames); path != "" {
		return path
	}

	// 3) 剧集回退：Series.BackdropPath → series 根目录 fanart / backdrop
	if path := r.seriesArtwork(media, artworkBackdropNames, seriesBackdropPath); path != "" {
		return path
	}

	// 4) 派生兜底图（竖版抽帧图，横版槽位由调用方裁切）
	return r.derivedPoster(media.ID)
}

// ResolvePoster 海报解析链（优先级从高到低）：
//  1. media.PosterPath —— 刮削（tmdb/douban/…）或手工上传，DB 指针
//  2. 同目录 sidecar —— {视频同名} / poster / cover / folder
//  3. 剧集回退 —— Series.PosterPath → series 根目录 poster / cover / folder / show
//  4. 派生兜底图 —— 内嵌封面 → 抽帧（只探测不生成）
//
// 派生图刻意不写回 media.PosterPath：metadata.go 用 "PosterPath == \"\"" 判定 partial
// 并驱动重试补真海报，写回会让兜底图被当成真海报。
func (r *ArtworkResolver) ResolvePoster(media *model.Media) string {
	if media == nil {
		return ""
	}

	// 1) 刮削 / 手工上传写下的 DB 指针
	if media.PosterPath != "" && r.fileExists(media.PosterPath) {
		return media.PosterPath
	}

	// 2) 同目录 sidecar：{视频同名} / poster / cover / folder
	dir := vfsDir(media.FilePath)
	base := strings.TrimSuffix(filepath.Base(media.FilePath), filepath.Ext(media.FilePath))
	names := []string{
		base,     // 同名
		"poster", // poster.jpg
		"cover",  // cover.jpg
		"folder", // folder.jpg
	}
	if path := r.findFirstImage(dir, names); path != "" {
		return path
	}

	// 3) 剧集回退：Series.PosterPath → series 根目录 poster / cover / folder / show
	if path := r.seriesArtwork(media, artworkSeriesPosterNames, seriesPosterPath); path != "" {
		return path
	}

	// 4) 最后一道兜底：派生图（内嵌封面 → 抽帧），由后台生成器产出，这里只探测不生成。
	// 放在真海报之后——上面任一档命中即已返回，因此派生图仅在"完全无海报"时生效。
	return r.derivedPoster(media.ID)
}
