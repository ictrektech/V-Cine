package service

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
)

// AIConfigProvider 是所有业务访问 AI 配置的唯一入口。
//
// 设计目的：
//   - 收口：业务代码不再直接读 config.AIConfig 字段，统一通过此 Provider 的方法访问
//   - 线程安全：内部用 RWMutex 保护，热更新时读操作不会竞争
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
	mu  sync.RWMutex
	cfg config.AIConfig
	app *config.Config
}

// NewAIConfigProvider 创建 AI 配置访问入口。
// 从 app.AI 拷贝初始值，后续 Update 会同步回 app.AI。
//
// 注意：Config 的 mu 为未导出字段，这里直接读取 app.AI。
// Load() 完成后 app.AI 在主流程中不会再被并发修改（只在 handler/service 中通过
// AIConfigProvider.Update 或 Config.Save* 方法修改，均会自行加锁），
// 因此此处的无锁读取在启动阶段是安全的。
func NewAIConfigProvider(app *config.Config) *AIConfigProvider {
	return &AIConfigProvider{cfg: app.AI, app: app}
}

// ==================== 读方法 ====================

// ActiveProvider 返回当前激活的 LLM 服务商 ID。
func (p *AIConfigProvider) ActiveProvider() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.ActiveProvider
}

// ActiveModel 返回当前激活的模型名称。
func (p *AIConfigProvider) ActiveModel() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.ActiveModel
}

// APIBase 返回当前激活 provider 的 API 地址（从 Providers 列表解析）。
func (p *AIConfigProvider) APIBase() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if ap := p.cfg.ActiveProfile(); ap != nil {
		return ap.APIBase
	}
	return ""
}

// APIKey 返回当前激活 provider 的 API 密钥（从 Providers 列表解析）。
func (p *AIConfigProvider) APIKey() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if ap := p.cfg.ActiveProfile(); ap != nil {
		return ap.APIKey
	}
	return ""
}

// IsEnabled 检查 AI 服务是否可用（有激活 provider 且配了 APIKey + APIBase）。
func (p *AIConfigProvider) IsEnabled() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if ap := p.cfg.ActiveProfile(); ap == nil || ap.APIKey == "" || ap.APIBase == "" {
		return false
	}
	if p.cfg.AutoPilot {
		return true
	}
	return p.cfg.Enabled
}

// IsAutoPilotEnabled 是否处于全自动托管模式。
func (p *AIConfigProvider) IsAutoPilotEnabled() bool {
	if !p.IsEnabled() {
		return false
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.AutoPilot
}

// IsSmartSearchEnabled 检查智能搜索是否启用。
func (p *AIConfigProvider) IsSmartSearchEnabled() bool {
	if !p.IsEnabled() {
		return false
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.AutoPilot || p.cfg.EnableSmartSearch
}

// IsMetadataEnhanceEnabled 检查元数据增强是否启用。
func (p *AIConfigProvider) IsMetadataEnhanceEnabled() bool {
	if !p.IsEnabled() {
		return false
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.AutoPilot || p.cfg.EnableMetadataEnhance
}

// Timeout 返回 AI 请求超时（带默认值 30 秒）。
func (p *AIConfigProvider) Timeout() time.Duration {
	p.mu.RLock()
	defer p.mu.RUnlock()
	t := p.cfg.Timeout
	if t <= 0 {
		t = 30
	}
	return time.Duration(t) * time.Second
}

// AutoPilot 返回全自动托管模式开关。
func (p *AIConfigProvider) AutoPilot() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.AutoPilot
}

// BlockLocalAI 返回是否禁止本地 AI。
func (p *AIConfigProvider) BlockLocalAI() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.BlockLocalAI
}

// MonthlyBudget 返回月度调用预算（0 表示不限）。
func (p *AIConfigProvider) MonthlyBudget() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.MonthlyBudget
}

// CacheTTLHours 返回 AI 缓存 TTL（小时）。
func (p *AIConfigProvider) CacheTTLHours() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.CacheTTLHours
}

// MaxConcurrent 返回 AI 最大并发数（默认 1）。
func (p *AIConfigProvider) MaxConcurrent() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	mc := p.cfg.MaxConcurrent
	if mc <= 0 {
		return 1
	}
	return mc
}

// RequestIntervalMs 返回 AI 请求间隔（毫秒，默认 1100）。
func (p *AIConfigProvider) RequestIntervalMs() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.cfg.RequestIntervalMs <= 0 {
		return 1100
	}
	return p.cfg.RequestIntervalMs
}

// SceneDescribeConfig 返回场景描述视觉模型配置的副本。
func (p *AIConfigProvider) SceneDescribeConfig() config.SceneDescribeAIConfig {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SceneDescribeAI
}

// EmbeddingConfig 返回 Embedding 服务配置的副本。
func (p *AIConfigProvider) EmbeddingConfig() config.EmbeddingAIConfig {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.EmbeddingAI
}

// WhisperAPIBase 返回 Whisper API 地址（留空则复用主 AI APIBase）。
func (p *AIConfigProvider) WhisperAPIBase() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.cfg.WhisperAPIBase != "" {
		return p.cfg.WhisperAPIBase
	}
	if ap := p.cfg.ActiveProfile(); ap != nil {
		return ap.APIBase
	}
	return ""
}

// WhisperAPIKey 返回 Whisper API 密钥（留空则复用主 AI APIKey）。
func (p *AIConfigProvider) WhisperAPIKey() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.cfg.WhisperAPIKey != "" {
		return p.cfg.WhisperAPIKey
	}
	if ap := p.cfg.ActiveProfile(); ap != nil {
		return ap.APIKey
	}
	return ""
}

// WhisperModel 返回 Whisper 模型名称（默认 whisper-1）。
func (p *AIConfigProvider) WhisperModel() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.cfg.WhisperModel != "" {
		return p.cfg.WhisperModel
	}
	return "whisper-1"
}

// WhisperTimeout 返回 Whisper 请求超时（秒，默认 300）。
func (p *AIConfigProvider) WhisperTimeout() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	t := p.cfg.WhisperTimeout
	if t <= 0 {
		// 回退到主 AI Timeout
		t = p.cfg.Timeout
	}
	if t <= 0 {
		return 300
	}
	return t
}

// WhisperCppPath 返回本地 whisper.cpp 可执行文件路径。
func (p *AIConfigProvider) WhisperCppPath() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.WhisperCppPath
}

// WhisperModelPath 返回本地 Whisper 模型文件路径。
func (p *AIConfigProvider) WhisperModelPath() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.WhisperModelPath
}

// WhisperThreads 返回本地 Whisper 线程数（默认 4）。
func (p *AIConfigProvider) WhisperThreads() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	t := p.cfg.WhisperThreads
	if t <= 0 {
		return 4
	}
	return t
}

// PreferLocalWhisper 返回是否优先使用本地 whisper 引擎。
func (p *AIConfigProvider) PreferLocalWhisper() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.PreferLocalWhisper
}

// AutoSubtitlePreprocess 返回是否在扫描后自动触发字幕预处理。
func (p *AIConfigProvider) AutoSubtitlePreprocess() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.AutoSubtitlePreprocess
}

// SubtitleTargetLangs 返回字幕预处理目标翻译语言列表。
func (p *AIConfigProvider) SubtitleTargetLangs() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubtitleTargetLangs
}

// SubtitlePreprocessWorkers 返回字幕预处理最大并发数（默认 1）。
func (p *AIConfigProvider) SubtitlePreprocessWorkers() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	w := p.cfg.SubtitlePreprocessWorkers
	if w <= 0 {
		return 1
	}
	return w
}

// PreferExistingSubtitle 返回是否优先使用已有字幕。
func (p *AIConfigProvider) PreferExistingSubtitle() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.PreferExistingSubtitle
}

// OCREnabled 返回是否启用图形字幕 OCR。
func (p *AIConfigProvider) OCREnabled() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.OCREnabled
}

// TesseractPath 返回 Tesseract 可执行文件路径。
func (p *AIConfigProvider) TesseractPath() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.TesseractPath
}

// TesseractLang 返回 Tesseract OCR 语言包。
func (p *AIConfigProvider) TesseractLang() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.cfg.TesseractLang == "" {
		return "eng"
	}
	return p.cfg.TesseractLang
}

// OCRDPI 返回图形字幕导出图片 DPI（默认 150）。
func (p *AIConfigProvider) OCRDPI() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.cfg.OCRDPI <= 0 {
		return 150
	}
	return p.cfg.OCRDPI
}

// SubCleanEnabled 返回是否启用字幕清洗。
func (p *AIConfigProvider) SubCleanEnabled() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubCleanEnabled
}

// SubCleanRemoveHTML 返回是否去除 HTML 标签。
func (p *AIConfigProvider) SubCleanRemoveHTML() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubCleanRemoveHTML
}

// SubCleanRemoveASSStyle 返回是否去除 ASS 样式标签。
func (p *AIConfigProvider) SubCleanRemoveASSStyle() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubCleanRemoveASSStyle
}

// SubCleanNormalizePunct 返回是否统一标点符号。
func (p *AIConfigProvider) SubCleanNormalizePunct() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubCleanNormalizePunct
}

// SubCleanRemoveSDH 返回是否去除 SDH 标注。
func (p *AIConfigProvider) SubCleanRemoveSDH() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubCleanRemoveSDH
}

// SubCleanRemoveAds 返回是否去除广告水印字幕。
func (p *AIConfigProvider) SubCleanRemoveAds() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubCleanRemoveAds
}

// SubCleanMergeShort 返回是否合并过短字幕条目。
func (p *AIConfigProvider) SubCleanMergeShort() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubCleanMergeShort
}

// SubCleanSplitLong 返回是否拆分过长字幕条目。
func (p *AIConfigProvider) SubCleanSplitLong() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubCleanSplitLong
}

// SubCleanBackup 返回是否处理前备份原始字幕。
func (p *AIConfigProvider) SubCleanBackup() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubCleanBackup
}

// SubCleanFallbackEnc 返回编码检测失败时的回退编码。
func (p *AIConfigProvider) SubCleanFallbackEnc() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubCleanFallbackEnc
}

// SubCleanTimeOffsetMs 返回全局时间轴偏移（毫秒）。
func (p *AIConfigProvider) SubCleanTimeOffsetMs() int64 {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubCleanTimeOffsetMs
}

// SubCleanMinDurationMs 返回最小字幕显示时长（毫秒）。
func (p *AIConfigProvider) SubCleanMinDurationMs() int64 {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubCleanMinDurationMs
}

// SubCleanMaxDurationMs 返回最大字幕显示时长（毫秒）。
func (p *AIConfigProvider) SubCleanMaxDurationMs() int64 {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubCleanMaxDurationMs
}

// SubCleanMinGapMs 返回合并间隔阈值（毫秒）。
func (p *AIConfigProvider) SubCleanMinGapMs() int64 {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubCleanMinGapMs
}

// SubCleanMaxCharsPerLine 返回每行最大字符数。
func (p *AIConfigProvider) SubCleanMaxCharsPerLine() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubCleanMaxCharsPerLine
}

// SubCleanMaxLinesPerCue 返回每条字幕最大行数。
func (p *AIConfigProvider) SubCleanMaxLinesPerCue() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg.SubCleanMaxLinesPerCue
}

// Snapshot 返回当前 AIConfig 的完整副本。
// 用于 AIService 内部需要一次性快照的场景。
func (p *AIConfigProvider) Snapshot() config.AIConfig {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg
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
	p.mu.Lock()
	fn(&p.cfg)
	p.app.AI = p.cfg
	p.mu.Unlock()
	return p.app.SaveAIConfig()
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
