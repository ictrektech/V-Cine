package service

import (
	"strings"

	"github.com/nowen-video/nowen-video/internal/config"
)

// ==================== 能力发现（capabilities）====================
//
// 本文件回答一个问题：某个功能现在能不能用，不能用的原因是什么。
// 状态只有三种：可用 / 未开启 / 缺依赖。前端据此决定渲染内容、隐藏入口或提示去配置。
//
// 只做配置级判定，不发起任何网络探测：首屏会调用本接口，必须零外部依赖。
// 真实连通性探测仍走 GET /admin/video-analysis/health。

// 编译期校验：两个运行时服务必须满足能力来源接口。
var (
	_ CapabilityAI            = (*AIService)(nil)
	_ CapabilityVideoAnalysis = (*VideoAnalysisService)(nil)
)

// CapabilityState 功能对外暴露的状态。
type CapabilityState string

const (
	// CapabilityAvailable 依赖齐备，功能可以运行。
	CapabilityAvailable CapabilityState = "available"
	// CapabilityDisabled 依赖齐备，但没有打开开关。
	CapabilityDisabled CapabilityState = "disabled"
	// CapabilityMissingDependency 缺少依赖，打开开关也无法运行。
	CapabilityMissingDependency CapabilityState = "missing_dependency"
)

// 前端 i18n 文案 key。后端只回 key，不拼中文，避免与前端语言不一致。
const (
	ReasonAIDisabled           = "capability.ai.disabled"
	ReasonAINoProvider         = "capability.ai.no_provider"
	ReasonAIMissingModel       = "capability.ai.missing_model"
	ReasonAIUnavailable        = "capability.ai.unavailable"
	ReasonAutoPilotDisabled    = "capability.ai.auto_pilot_disabled"
	ReasonAISubSwitchOff       = "capability.ai.sub_switch_off"
	ReasonVideoAnalysisOff     = "capability.video_analysis.disabled"
	ReasonVideoAnalysisInvalid = "capability.video_analysis.invalid"
	ReasonDescribeOff          = "capability.describe.disabled"
	ReasonRemoteVideoOff       = "capability.remote_video.disabled"
	ReasonEmbeddingNoEndpoint  = "capability.scene_search.no_endpoint"
	ReasonMetadataNoSource     = "capability.metadata.no_source"
)

// reasonDrawer 每个原因对应的设置分区。前端拼 /admin?drawer=<值>。
// describe 的模型在 AI 分区配置，其余视频分析项在 video-analysis 分区。
var reasonDrawer = map[string]string{
	ReasonMetadataNoSource:     "metadata",
	ReasonAIDisabled:           "ai",
	ReasonAINoProvider:         "ai",
	ReasonAIMissingModel:       "ai",
	ReasonAIUnavailable:        "ai",
	ReasonAutoPilotDisabled:    "ai",
	ReasonAISubSwitchOff:       "ai",
	ReasonVideoAnalysisOff:     "video-analysis",
	ReasonVideoAnalysisInvalid: "video-analysis",
	ReasonDescribeOff:          "video-analysis",
	ReasonRemoteVideoOff:       "video-analysis",
	ReasonEmbeddingNoEndpoint:  "video-analysis",
}

// CapabilityFix 告诉前端去哪里补依赖。
type CapabilityFix struct {
	// Drawer 设置分区标识，对应 /admin?drawer=<Drawer>。
	Drawer string `json:"drawer"`
}

// Capability 单个功能的状态。Reason 为 i18n key，可用时为空。
type Capability struct {
	ID     string          `json:"id"`
	State  CapabilityState `json:"state"`
	Reason string          `json:"reason,omitempty"`
	Fix    *CapabilityFix  `json:"fix,omitempty"`
}

// CapabilityAI AI 侧状态来源。*AIService 满足该接口。
type CapabilityAI interface {
	IsEnabled() bool
	IsAutoPilotEnabled() bool
	IsSmartSearchEnabled() bool
	IsRecommendReasonEnabled() bool
	IsMetadataEnhanceEnabled() bool
}

// CapabilityVideoAnalysis 视频分析侧状态来源。*VideoAnalysisService 满足该接口。
type CapabilityVideoAnalysis interface {
	IsAvailable() bool
}

// BuildCapabilities 汇总所有功能的三态。
// ai 或 va 为 nil 表示该服务没有创建。cfg 为 nil 时返回空列表，不 panic。
func BuildCapabilities(cfg *config.Config, ai CapabilityAI, va CapabilityVideoAnalysis) []Capability {
	if cfg == nil {
		return []Capability{}
	}
	aiCfg := cfg.AISnapshot()
	vaCfg := cfg.VideoAnalysisSnapshot()

	aiState, aiReason := aiCapabilityState(aiCfg, ai)
	vaState, vaReason := videoAnalysisCapabilityState(vaCfg, va)

	return []Capability{
		metadataCapability(cfg),
		newCapability("ai", aiState, aiReason),
		autoPilotCapability(ai, aiState, aiReason),
		aiSubCapability("ai_smart_search", ai != nil && ai.IsSmartSearchEnabled(), aiState, aiReason),
		aiSubCapability("ai_recommend_reason", ai != nil && ai.IsRecommendReasonEnabled(), aiState, aiReason),
		aiSubCapability("ai_metadata_enhance", ai != nil && ai.IsMetadataEnhanceEnabled(), aiState, aiReason),
		newCapability("video_analysis", vaState, vaReason),
		describeCapability(vaState, vaReason, vaCfg),
		remoteVideoCapability(vaState, vaReason, vaCfg),
		sceneSearchCapability(aiCfg, vaState, vaReason),
	}
}

// metadataCapability 元数据刮削：TMDb Key 或豆瓣 Cookie 至少配置一个。
// 两者都是可选的第三方凭据，缺失时刮削不可用，因此归为缺依赖而不是未开启。
func metadataCapability(cfg *config.Config) Capability {
	if strings.TrimSpace(cfg.GetTMDbAPIKey()) != "" || strings.TrimSpace(cfg.GetDoubanCookie()) != "" {
		return Capability{ID: "metadata", State: CapabilityAvailable}
	}
	return newCapability("metadata", CapabilityMissingDependency, ReasonMetadataNoSource)
}

// newCapability 构造一项能力。非可用状态一律带跳转信息。
func newCapability(id string, state CapabilityState, reason string) Capability {
	item := Capability{ID: id, State: state, Reason: reason}
	if state != CapabilityAvailable {
		item.Fix = &CapabilityFix{Drawer: reasonDrawer[reason]}
	}
	return item
}

// aiCapabilityState AI 根节点状态。顺序：供应商 → 模型 → 开关。
// 供应商或模型缺失时，打开开关也无法调用，因此归为缺依赖。
func aiCapabilityState(aiCfg config.AIConfig, ai CapabilityAI) (CapabilityState, string) {
	if ai == nil {
		return CapabilityMissingDependency, ReasonAIUnavailable
	}
	profile := aiCfg.ActiveProfile()
	if profile == nil || strings.TrimSpace(profile.APIBase) == "" {
		return CapabilityMissingDependency, ReasonAINoProvider
	}
	if strings.TrimSpace(aiCfg.ActiveModelName()) == "" {
		return CapabilityMissingDependency, ReasonAIMissingModel
	}
	if !ai.IsEnabled() {
		return CapabilityDisabled, ReasonAIDisabled
	}
	return CapabilityAvailable, ""
}

// autoPilotCapability 全自动托管依赖 AI 根节点。
// 根节点不可用时继承根节点状态与原因：先解决 AI，再谈托管。
func autoPilotCapability(ai CapabilityAI, aiState CapabilityState, aiReason string) Capability {
	if ai != nil && ai.IsAutoPilotEnabled() {
		return Capability{ID: "ai_auto_pilot", State: CapabilityAvailable}
	}
	if aiState != CapabilityAvailable {
		return newCapability("ai_auto_pilot", aiState, aiReason)
	}
	return newCapability("ai_auto_pilot", CapabilityDisabled, ReasonAutoPilotDisabled)
}

// aiSubCapability AI 子功能。根节点不可用时继承根节点状态与原因，不做二次提示。
func aiSubCapability(id string, effective bool, aiState CapabilityState, aiReason string) Capability {
	if effective {
		return Capability{ID: id, State: CapabilityAvailable}
	}
	if aiState != CapabilityAvailable {
		return newCapability(id, aiState, aiReason)
	}
	return newCapability(id, CapabilityDisabled, ReasonAISubSwitchOff)
}

// videoAnalysisCapabilityState 视频分析根节点状态。
func videoAnalysisCapabilityState(vaCfg config.VideoAnalysisConfig, va CapabilityVideoAnalysis) (CapabilityState, string) {
	if !vaCfg.Enabled {
		return CapabilityDisabled, ReasonVideoAnalysisOff
	}
	if va == nil || !va.IsAvailable() {
		return CapabilityMissingDependency, ReasonVideoAnalysisInvalid
	}
	return CapabilityAvailable, ""
}

// describeCapability 场景描述依赖视频分析可用。
// 自定义视觉模型是可选项：不配置时回退结构化服务的默认模型
// （见 video_analysis_describe.go 的 describeLocalClient），因此不作为阻塞条件。
func describeCapability(vaState CapabilityState, vaReason string, vaCfg config.VideoAnalysisConfig) Capability {
	if vaState != CapabilityAvailable {
		return newCapability("video_analysis_describe", CapabilityMissingDependency, vaReason)
	}
	if !vaCfg.DescribeEnabled {
		return newCapability("video_analysis_describe", CapabilityDisabled, ReasonDescribeOff)
	}
	return Capability{ID: "video_analysis_describe", State: CapabilityAvailable}
}

// remoteVideoCapability 远程视频结构化依赖视频分析可用。
func remoteVideoCapability(vaState CapabilityState, vaReason string, vaCfg config.VideoAnalysisConfig) Capability {
	if vaState != CapabilityAvailable {
		return newCapability("video_analysis_remote", CapabilityMissingDependency, vaReason)
	}
	if !vaCfg.RemoteVideoEnabled {
		return newCapability("video_analysis_remote", CapabilityDisabled, ReasonRemoteVideoOff)
	}
	return Capability{ID: "video_analysis_remote", State: CapabilityAvailable}
}

// sceneSearchCapability 场景检索依赖视频分析可用，且需要 embedding 地址。
// 这里只判配置，不探测后端：地址存在即视为可用，真实连通性由健康接口回答。
func sceneSearchCapability(aiCfg config.AIConfig, vaState CapabilityState, vaReason string) Capability {
	if vaState != CapabilityAvailable {
		return newCapability("scene_search", CapabilityMissingDependency, vaReason)
	}
	if strings.TrimSpace(aiCfg.EmbeddingAI.APIBase) == "" {
		return newCapability("scene_search", CapabilityMissingDependency, ReasonEmbeddingNoEndpoint)
	}
	return Capability{ID: "scene_search", State: CapabilityAvailable}
}
