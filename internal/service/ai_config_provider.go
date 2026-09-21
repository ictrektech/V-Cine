package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
)

// AIConfigProvider 是所有业务访问 AI 配置的唯一入口。
//
// 设计目的：
//   - 收口：业务代码不再直接读 config.AIConfig 字段，统一通过此 Provider 的方法访问
//   - 实时：读方法内部通过 Config.AISnapshot() 读取权威状态 app.AI，
//     运行期修改（UI 保存 / Update）立即对全部调用方生效，无快照过期问题
//   - 持久化：写操作（Update / SetActive）自动持久化到 config/ai.yaml
//
// 使用方式：
//
//	// 读
//	provider.ActiveModel()
//	provider.APIBase()
//
//	// 写
//	provider.Update(func(cfg *config.AIConfig) {
//	    cfg.Enabled = true
//	})
//
//	// 一键切换 provider（"一键配置"按钮）
//	provider.SetActive("deepseek", "deepseek-chat")
type AIConfigProvider struct {
	app *config.Config
}

// NewAIConfigProvider 创建 AI 配置访问入口。
// 不持有任何配置副本，所有读操作实时读取权威状态 app.AI。
func NewAIConfigProvider(app *config.Config) *AIConfigProvider {
	return &AIConfigProvider{app: app}
}

// snapshot 返回最新 AI 配置快照（读自权威状态 app.AI，加锁拷贝）。
func (p *AIConfigProvider) snapshot() config.AIConfig {
	return p.app.AISnapshot()
}

// ==================== 读方法 ====================

// ActiveProvider 返回当前激活的 LLM 服务商 ID。
func (p *AIConfigProvider) ActiveProvider() string {
	return p.snapshot().ActiveProvider
}

// ActiveModel 返回当前激活的模型名称。
func (p *AIConfigProvider) ActiveModel() string {
	return p.snapshot().ActiveModel
}

// APIBase 返回当前激活 provider 的 API 地址（从 Providers 列表解析）。
func (p *AIConfigProvider) APIBase() string {
	cfg := p.snapshot()
	if ap := cfg.ActiveProfile(); ap != nil {
		return ap.APIBase
	}
	return ""
}

// APIKey 返回当前激活 provider 的 API 密钥（从 Providers 列表解析）。
func (p *AIConfigProvider) APIKey() string {
	cfg := p.snapshot()
	if ap := cfg.ActiveProfile(); ap != nil {
		return ap.APIKey
	}
	return ""
}

// IsEnabled 检查 AI 服务是否可用。
// API Key 可选：空 key = 不发 Authorization，是否需要 key 由服务端 401 事实回答；只需配 APIBase。
func (p *AIConfigProvider) IsEnabled() bool {
	cfg := p.snapshot()
	if ap := cfg.ActiveProfile(); ap == nil || ap.APIBase == "" {
		return false
	}
	if cfg.AutoPilot {
		return true
	}
	return cfg.Enabled
}

// IsAutoPilotEnabled 是否处于全自动托管模式。
func (p *AIConfigProvider) IsAutoPilotEnabled() bool {
	return p.IsEnabled() && p.AutoPilot()
}

// IsSmartSearchEnabled 检查智能搜索是否启用。
func (p *AIConfigProvider) IsSmartSearchEnabled() bool {
	if !p.IsEnabled() {
		return false
	}
	cfg := p.snapshot()
	return cfg.AutoPilot || cfg.EnableSmartSearch
}

// IsRecommendReasonEnabled 检查推荐理由生成是否启用。
func (p *AIConfigProvider) IsRecommendReasonEnabled() bool {
	if !p.IsEnabled() {
		return false
	}
	cfg := p.snapshot()
	return cfg.AutoPilot || cfg.EnableRecommendReason
}

// IsMetadataEnhanceEnabled 检查元数据增强是否启用。
func (p *AIConfigProvider) IsMetadataEnhanceEnabled() bool {
	if !p.IsEnabled() {
		return false
	}
	cfg := p.snapshot()
	return cfg.AutoPilot || cfg.EnableMetadataEnhance
}

// Timeout 返回 AI 请求超时（带默认值 30 秒）。
func (p *AIConfigProvider) Timeout() time.Duration {
	t := p.snapshot().Timeout
	if t <= 0 {
		t = 30
	}
	return time.Duration(t) * time.Second
}

// AutoPilot 返回全自动托管模式开关。
func (p *AIConfigProvider) AutoPilot() bool {
	return p.snapshot().AutoPilot
}

// BlockLocalAI 返回是否禁止本地 AI。
func (p *AIConfigProvider) BlockLocalAI() bool {
	return p.snapshot().BlockLocalAI
}

// MonthlyBudget 返回月度调用预算（0 表示不限）。
func (p *AIConfigProvider) MonthlyBudget() int {
	return p.snapshot().MonthlyBudget
}

// CacheTTLHours 返回 AI 缓存 TTL（小时）。
func (p *AIConfigProvider) CacheTTLHours() int {
	return p.snapshot().CacheTTLHours
}

// MaxConcurrent 返回 AI 最大并发数（默认 1）。
func (p *AIConfigProvider) MaxConcurrent() int {
	mc := p.snapshot().MaxConcurrent
	if mc <= 0 {
		return 1
	}
	return mc
}

// RequestIntervalMs 返回 AI 请求间隔（毫秒，默认 1100）。
func (p *AIConfigProvider) RequestIntervalMs() int {
	if v := p.snapshot().RequestIntervalMs; v > 0 {
		return v
	}
	return 1100
}

// SceneDescribeConfig 返回场景描述视觉模型配置的副本。
func (p *AIConfigProvider) SceneDescribeConfig() config.SceneDescribeAIConfig {
	return p.snapshot().SceneDescribeAI
}

// EmbeddingConfig 返回 Embedding 服务配置的副本。
func (p *AIConfigProvider) EmbeddingConfig() config.EmbeddingAIConfig {
	return p.snapshot().EmbeddingAI
}

// WhisperAPIBase 返回 Whisper API 地址（留空则复用主 AI APIBase）。
func (p *AIConfigProvider) WhisperAPIBase() string {
	cfg := p.snapshot()
	if cfg.WhisperAPIBase != "" {
		return cfg.WhisperAPIBase
	}
	if ap := cfg.ActiveProfile(); ap != nil {
		return ap.APIBase
	}
	return ""
}

// WhisperAPIKey 返回 Whisper API 密钥（留空则复用主 AI APIKey）。
func (p *AIConfigProvider) WhisperAPIKey() string {
	cfg := p.snapshot()
	if cfg.WhisperAPIKey != "" {
		return cfg.WhisperAPIKey
	}
	if ap := cfg.ActiveProfile(); ap != nil {
		return ap.APIKey
	}
	return ""
}

// WhisperModel 返回 Whisper 模型名称（默认 whisper-1）。
func (p *AIConfigProvider) WhisperModel() string {
	if m := p.snapshot().WhisperModel; m != "" {
		return m
	}
	return "whisper-1"
}

// WhisperTimeout 返回 Whisper 请求超时（秒，默认 300）。
func (p *AIConfigProvider) WhisperTimeout() int {
	cfg := p.snapshot()
	t := cfg.WhisperTimeout
	if t <= 0 {
		// 回退到主 AI Timeout
		t = cfg.Timeout
	}
	if t <= 0 {
		return 300
	}
	return t
}

// WhisperCppPath 返回本地 whisper.cpp 可执行文件路径。
func (p *AIConfigProvider) WhisperCppPath() string {
	return p.snapshot().WhisperCppPath
}

// WhisperModelPath 返回本地 Whisper 模型文件路径。
func (p *AIConfigProvider) WhisperModelPath() string {
	return p.snapshot().WhisperModelPath
}

// WhisperThreads 返回本地 Whisper 线程数（默认 4）。
func (p *AIConfigProvider) WhisperThreads() int {
	t := p.snapshot().WhisperThreads
	if t <= 0 {
		return 4
	}
	return t
}

// PreferLocalWhisper 返回是否优先使用本地 whisper 引擎。
func (p *AIConfigProvider) PreferLocalWhisper() bool {
	return p.snapshot().PreferLocalWhisper
}

// AutoSubtitlePreprocess 返回是否在扫描后自动触发字幕预处理。
func (p *AIConfigProvider) AutoSubtitlePreprocess() bool {
	return p.snapshot().AutoSubtitlePreprocess
}

// SubtitleTargetLangs 返回字幕预处理目标翻译语言列表。
func (p *AIConfigProvider) SubtitleTargetLangs() string {
	return p.snapshot().SubtitleTargetLangs
}

// SubtitlePreprocessWorkers 返回字幕预处理最大并发数（默认 1）。
func (p *AIConfigProvider) SubtitlePreprocessWorkers() int {
	w := p.snapshot().SubtitlePreprocessWorkers
	if w <= 0 {
		return 1
	}
	return w
}

// PreferExistingSubtitle 返回是否优先使用已有字幕。
func (p *AIConfigProvider) PreferExistingSubtitle() bool {
	return p.snapshot().PreferExistingSubtitle
}

// OCREnabled 返回是否启用图形字幕 OCR。
func (p *AIConfigProvider) OCREnabled() bool {
	return p.snapshot().OCREnabled
}

// TesseractPath 返回 Tesseract 可执行文件路径。
func (p *AIConfigProvider) TesseractPath() string {
	return p.snapshot().TesseractPath
}

// TesseractLang 返回 Tesseract OCR 语言包。
func (p *AIConfigProvider) TesseractLang() string {
	if lang := p.snapshot().TesseractLang; lang != "" {
		return lang
	}
	return "eng"
}

// OCRDPI 返回图形字幕导出图片 DPI（默认 150）。
func (p *AIConfigProvider) OCRDPI() int {
	if dpi := p.snapshot().OCRDPI; dpi > 0 {
		return dpi
	}
	return 150
}

// SubCleanEnabled 返回是否启用字幕清洗。
func (p *AIConfigProvider) SubCleanEnabled() bool {
	return p.snapshot().SubCleanEnabled
}

// SubCleanRemoveHTML 返回是否去除 HTML 标签。
func (p *AIConfigProvider) SubCleanRemoveHTML() bool {
	return p.snapshot().SubCleanRemoveHTML
}

// SubCleanRemoveASSStyle 返回是否去除 ASS 样式标签。
func (p *AIConfigProvider) SubCleanRemoveASSStyle() bool {
	return p.snapshot().SubCleanRemoveASSStyle
}

// SubCleanNormalizePunct 返回是否统一标点符号。
func (p *AIConfigProvider) SubCleanNormalizePunct() bool {
	return p.snapshot().SubCleanNormalizePunct
}

// SubCleanRemoveSDH 返回是否去除 SDH 标注。
func (p *AIConfigProvider) SubCleanRemoveSDH() bool {
	return p.snapshot().SubCleanRemoveSDH
}

// SubCleanRemoveAds 返回是否去除广告水印字幕。
func (p *AIConfigProvider) SubCleanRemoveAds() bool {
	return p.snapshot().SubCleanRemoveAds
}

// SubCleanMergeShort 返回是否合并过短字幕条目。
func (p *AIConfigProvider) SubCleanMergeShort() bool {
	return p.snapshot().SubCleanMergeShort
}

// SubCleanSplitLong 返回是否拆分过长字幕条目。
func (p *AIConfigProvider) SubCleanSplitLong() bool {
	return p.snapshot().SubCleanSplitLong
}

// SubCleanBackup 返回是否处理前备份原始字幕。
func (p *AIConfigProvider) SubCleanBackup() bool {
	return p.snapshot().SubCleanBackup
}

// SubCleanFallbackEnc 返回编码检测失败时的回退编码。
func (p *AIConfigProvider) SubCleanFallbackEnc() string {
	return p.snapshot().SubCleanFallbackEnc
}

// SubCleanTimeOffsetMs 返回全局时间轴偏移（毫秒）。
func (p *AIConfigProvider) SubCleanTimeOffsetMs() int64 {
	return p.snapshot().SubCleanTimeOffsetMs
}

// SubCleanMinDurationMs 返回最小字幕显示时长（毫秒）。
func (p *AIConfigProvider) SubCleanMinDurationMs() int64 {
	return p.snapshot().SubCleanMinDurationMs
}

// SubCleanMaxDurationMs 返回最大字幕显示时长（毫秒）。
func (p *AIConfigProvider) SubCleanMaxDurationMs() int64 {
	return p.snapshot().SubCleanMaxDurationMs
}

// SubCleanMinGapMs 返回合并间隔阈值（毫秒）。
func (p *AIConfigProvider) SubCleanMinGapMs() int64 {
	return p.snapshot().SubCleanMinGapMs
}

// SubCleanMaxCharsPerLine 返回每行最大字符数。
func (p *AIConfigProvider) SubCleanMaxCharsPerLine() int {
	return p.snapshot().SubCleanMaxCharsPerLine
}

// SubCleanMaxLinesPerCue 返回每条字幕最大行数。
func (p *AIConfigProvider) SubCleanMaxLinesPerCue() int {
	return p.snapshot().SubCleanMaxLinesPerCue
}

// Snapshot 返回当前 AIConfig 的完整副本。
// 用于 AIService 内部需要一次性快照的场景。
func (p *AIConfigProvider) Snapshot() config.AIConfig {
	return p.app.AISnapshot()
}

// ==================== 写方法 ====================

// Update 在锁内修改 AI 配置，修改后自动同步到 app.AI 并持久化。
//
// 所有写操作必须走这个方法，禁止直接改 app.AI 字段。
// fn 闭包内可修改 cfg 的任意字段，修改后会自动写盘。
//
// 示例：
//
//	provider.Update(func(cfg *config.AIConfig) {
//	    cfg.Enabled = true
//	    cfg.Provider = "deepseek"
//	})
func (p *AIConfigProvider) Update(fn func(cfg *config.AIConfig)) error {
	return p.app.UpdateAIConfig(fn)
}

// SetActive 一键切换激活的 provider 和 model。
func (p *AIConfigProvider) SetActive(provider, model string) error {
	provider = strings.ToLower(strings.TrimSpace(provider))
	model = strings.TrimSpace(model)
	if provider == "" {
		return fmt.Errorf("provider 不能为空")
	}

	return p.Update(func(cfg *config.AIConfig) {
		cfg.ActiveProvider = provider
		if model != "" {
			cfg.ActiveModel = model
		}
	})
}
