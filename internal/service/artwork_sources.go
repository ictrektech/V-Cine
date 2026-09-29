package service

import (
	"github.com/nowen-video/nowen-video/internal/config"
	"go.uber.org/zap"
)

// ==================== 派生来源注册表 ====================
//
// 唯一真相来源：解析链（探测哪些派生图已存在）与生成链（按优先级生成）都遍历这份注册表，
// 顺序即优先级（高 → 低）。新增来源 = 实现 ArtworkGenerator + 在此追加一项，
// 解析侧与调度侧都无需改动。

// artworkSourceSpec 一个派生来源的完整描述。
type artworkSourceSpec struct {
	// Source 来源标识，决定派生图文件名（如 poster-frame.jpg）
	Source ArtworkSource
	// Enabled 该来源当前是否启用（读配置，支持运行期切换）
	Enabled func(config.ArtworkFallbackConfig) bool
	// New 构造生成器
	New func(cfg *config.Config, logger *zap.SugaredLogger) ArtworkGenerator
}

// artworkSourceRegistry 派生来源注册表，顺序即优先级（高 → 低）。
var artworkSourceRegistry = []artworkSourceSpec{
	{
		// 发布方附带的封面属"作者意图"，优先于机器抽帧
		Source:  ArtworkSourceEmbedded,
		Enabled: func(c config.ArtworkFallbackConfig) bool { return c.Embedded },
		New: func(cfg *config.Config, logger *zap.SugaredLogger) ArtworkGenerator {
			return NewEmbeddedArtworkGenerator(cfg, logger)
		},
	},
	{
		Source:  ArtworkSourceFrame,
		Enabled: func(c config.ArtworkFallbackConfig) bool { return c.Frame },
		New: func(cfg *config.Config, logger *zap.SugaredLogger) ArtworkGenerator {
			return NewFrameArtworkGenerator(cfg, logger)
		},
	},
}
