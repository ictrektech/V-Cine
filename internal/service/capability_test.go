package service

import (
	"testing"

	"github.com/nowen-video/nowen-video/internal/config"
)

// stubCapabilityAI 只回答开关，不读配置，便于隔离测状态机。
type stubCapabilityAI struct {
	enabled     bool
	autoPilot   bool
	smartSearch bool
	recommend   bool
	metadata    bool
}

func (s stubCapabilityAI) IsEnabled() bool                { return s.enabled }
func (s stubCapabilityAI) IsAutoPilotEnabled() bool       { return s.autoPilot }
func (s stubCapabilityAI) IsSmartSearchEnabled() bool     { return s.smartSearch }
func (s stubCapabilityAI) IsRecommendReasonEnabled() bool { return s.recommend }
func (s stubCapabilityAI) IsMetadataEnhanceEnabled() bool { return s.metadata }

type stubCapabilityVideoAnalysis struct{ available bool }

func (s stubCapabilityVideoAnalysis) IsAvailable() bool { return s.available }

// aiReadyConfig 构造「刮削源已配、供应商与模型都配好、开关未动」的配置。
func aiReadyConfig() *config.Config {
	cfg := &config.Config{}
	// 刮削源会影响 metadata 能力，这里先配好，避免干扰 AI 相关断言。
	cfg.Secrets.TMDbAPIKey = "test-tmdb-key"
	cfg.AI.ActiveProvider = "p1"
	cfg.AI.ActiveModel = "test-model"
	cfg.AI.Providers = []config.AIProviderEntry{{
		ID:      "p1",
		Name:    "test",
		APIBase: "http://127.0.0.1:1234/v1",
		Models:  []config.AIModelEntry{{Name: "test-model", IsDefault: true}},
	}}
	return cfg
}

func findCapability(t *testing.T, caps []Capability, id string) Capability {
	t.Helper()
	for _, c := range caps {
		if c.ID == id {
			return c
		}
	}
	t.Fatalf("未找到能力项 %q", id)
	return Capability{}
}

// assertState 同时校验状态、原因与跳转信息。
func assertState(t *testing.T, caps []Capability, id string, want CapabilityState, wantReason string) {
	t.Helper()
	got := findCapability(t, caps, id)
	if got.State != want {
		t.Fatalf("%s 状态 = %q, want %q（reason=%q）", id, got.State, want, got.Reason)
	}
	if got.Reason != wantReason {
		t.Fatalf("%s reason = %q, want %q", id, got.Reason, wantReason)
	}
	if want != CapabilityAvailable && (got.Fix == nil || got.Fix.Drawer == "") {
		t.Fatalf("%s 非可用状态必须带跳转信息", id)
	}
}

// 全新安装：AI 服务存在但没配供应商，视频分析未开启。
func TestBuildCapabilitiesFreshInstall(t *testing.T) {
	caps := BuildCapabilities(&config.Config{}, stubCapabilityAI{}, nil)

	assertState(t, caps, "metadata", CapabilityMissingDependency, ReasonMetadataNoSource)
	assertState(t, caps, "ai", CapabilityMissingDependency, ReasonAINoProvider)
	assertState(t, caps, "ai_auto_pilot", CapabilityMissingDependency, ReasonAINoProvider)
	assertState(t, caps, "ai_smart_search", CapabilityMissingDependency, ReasonAINoProvider)
	assertState(t, caps, "video_analysis", CapabilityDisabled, ReasonVideoAnalysisOff)
	assertState(t, caps, "video_analysis_describe", CapabilityMissingDependency, ReasonVideoAnalysisOff)
	assertState(t, caps, "video_analysis_remote", CapabilityMissingDependency, ReasonVideoAnalysisOff)
	assertState(t, caps, "scene_search", CapabilityMissingDependency, ReasonVideoAnalysisOff)
}

// 供应商与模型齐备、开关关闭：归为「未开启」，不是「缺依赖」。
func TestBuildCapabilitiesAIDisabledBySwitch(t *testing.T) {
	caps := BuildCapabilities(aiReadyConfig(), stubCapabilityAI{}, nil)

	assertState(t, caps, "ai", CapabilityDisabled, ReasonAIDisabled)
	// 子功能继承根节点状态与原因：先解决 AI 总开关，再谈子开关。
	assertState(t, caps, "ai_auto_pilot", CapabilityDisabled, ReasonAIDisabled)
	assertState(t, caps, "ai_smart_search", CapabilityDisabled, ReasonAIDisabled)
	assertState(t, caps, "ai_recommend_reason", CapabilityDisabled, ReasonAIDisabled)
	assertState(t, caps, "ai_metadata_enhance", CapabilityDisabled, ReasonAIDisabled)
}

// AI 可用但子开关未开：归为未开启，提示指向子开关。
func TestBuildCapabilitiesAISubSwitchOff(t *testing.T) {
	// stub 只有 enabled，托管与三个子开关保持关闭。
	caps := BuildCapabilities(aiReadyConfig(), stubCapabilityAI{enabled: true}, nil)

	assertState(t, caps, "ai", CapabilityAvailable, "")
	assertState(t, caps, "ai_auto_pilot", CapabilityDisabled, ReasonAutoPilotDisabled)
	assertState(t, caps, "ai_smart_search", CapabilityDisabled, ReasonAISubSwitchOff)
	assertState(t, caps, "ai_recommend_reason", CapabilityDisabled, ReasonAISubSwitchOff)
	assertState(t, caps, "ai_metadata_enhance", CapabilityDisabled, ReasonAISubSwitchOff)
}

// 有供应商但没有可用模型：开关打开也无法调用，归为缺依赖。
func TestBuildCapabilitiesAIMissingModel(t *testing.T) {
	cfg := aiReadyConfig()
	cfg.AI.ActiveModel = ""
	cfg.AI.Providers[0].Models = nil

	caps := BuildCapabilities(cfg, stubCapabilityAI{enabled: true}, nil)

	assertState(t, caps, "ai", CapabilityMissingDependency, ReasonAIMissingModel)
	assertState(t, caps, "ai_smart_search", CapabilityMissingDependency, ReasonAIMissingModel)
}

// 全开：所有项都可用，且不带提示信息。
func TestBuildCapabilitiesAllAvailable(t *testing.T) {
	cfg := aiReadyConfig()
	cfg.AI.Enabled = true
	cfg.AI.AutoPilot = true
	cfg.AI.EmbeddingAI.APIBase = "http://127.0.0.1:8080/v1"
	cfg.AI.SceneDescribeAI = config.SceneDescribeAIConfig{ProviderID: "p1", Model: "vision-model"}
	cfg.VideoAnalysis.Enabled = true
	cfg.VideoAnalysis.DescribeEnabled = true
	cfg.VideoAnalysis.RemoteVideoEnabled = true

	ai := stubCapabilityAI{enabled: true, autoPilot: true, smartSearch: true, recommend: true, metadata: true}
	caps := BuildCapabilities(cfg, ai, stubCapabilityVideoAnalysis{available: true})

	if len(caps) == 0 {
		t.Fatal("能力清单不得为空")
	}
	for _, c := range caps {
		if c.State != CapabilityAvailable {
			t.Fatalf("%s 应为 available，实际 %q（reason=%q）", c.ID, c.State, c.Reason)
		}
		if c.Reason != "" || c.Fix != nil {
			t.Fatalf("%s 可用时不得带 reason 与 fix", c.ID)
		}
	}
}

// 视频分析已开启但服务未创建（配置无效）：缺依赖，不是未开启。
func TestBuildCapabilitiesVideoAnalysisInvalid(t *testing.T) {
	cfg := &config.Config{}
	cfg.VideoAnalysis.Enabled = true

	caps := BuildCapabilities(cfg, nil, nil)

	assertState(t, caps, "video_analysis", CapabilityMissingDependency, ReasonVideoAnalysisInvalid)
	assertState(t, caps, "video_analysis_describe", CapabilityMissingDependency, ReasonVideoAnalysisInvalid)
	assertState(t, caps, "scene_search", CapabilityMissingDependency, ReasonVideoAnalysisInvalid)
}

// 视频分析可用但未开场景描述：归为未开启。
func TestBuildCapabilitiesDescribeDisabled(t *testing.T) {
	cfg := aiReadyConfig()
	cfg.VideoAnalysis.Enabled = true

	caps := BuildCapabilities(cfg, stubCapabilityAI{enabled: true}, stubCapabilityVideoAnalysis{available: true})

	assertState(t, caps, "video_analysis", CapabilityAvailable, "")
	assertState(t, caps, "video_analysis_describe", CapabilityDisabled, ReasonDescribeOff)
	assertState(t, caps, "video_analysis_remote", CapabilityDisabled, ReasonRemoteVideoOff)
	assertState(t, caps, "scene_search", CapabilityMissingDependency, ReasonEmbeddingNoEndpoint)
}

// 自定义视觉模型可选：不配置时回退结构化服务的默认模型，仍算可用。
func TestBuildCapabilitiesDescribeWithoutCustomModel(t *testing.T) {
	cfg := aiReadyConfig()
	cfg.VideoAnalysis.Enabled = true
	cfg.VideoAnalysis.DescribeEnabled = true
	cfg.AI.SceneDescribeAI = config.SceneDescribeAIConfig{}

	caps := BuildCapabilities(cfg, stubCapabilityAI{enabled: true}, stubCapabilityVideoAnalysis{available: true})

	assertState(t, caps, "video_analysis_describe", CapabilityAvailable, "")
}

// 跳转目标必须指向正确的设置分区。
func TestBuildCapabilitiesFixDrawer(t *testing.T) {
	caps := BuildCapabilities(&config.Config{}, nil, nil)

	if got := findCapability(t, caps, "ai"); got.Fix == nil || got.Fix.Drawer != "ai" {
		t.Fatalf("ai 跳转目标 = %+v, want drawer=ai", got.Fix)
	}
	if got := findCapability(t, caps, "video_analysis"); got.Fix == nil || got.Fix.Drawer != "video-analysis" {
		t.Fatalf("video_analysis 跳转目标 = %+v, want drawer=video-analysis", got.Fix)
	}
}

// 刮削源：只配豆瓣 Cookie 也算可用，不要求 TMDb。
func TestBuildCapabilitiesMetadataDoubanOnly(t *testing.T) {
	cfg := &config.Config{}
	cfg.Secrets.DoubanCookie = "dbcl2=abc"

	caps := BuildCapabilities(cfg, stubCapabilityAI{}, nil)

	assertState(t, caps, "metadata", CapabilityAvailable, "")
}

// 刮削源的跳转目标必须指向 metadata 分区。
func TestBuildCapabilitiesMetadataFixDrawer(t *testing.T) {
	caps := BuildCapabilities(&config.Config{}, stubCapabilityAI{}, nil)

	if got := findCapability(t, caps, "metadata"); got.Fix == nil || got.Fix.Drawer != "metadata" {
		t.Fatalf("metadata 跳转目标 = %+v, want drawer=metadata", got.Fix)
	}
}

// 配置为空指针时不 panic，返回空清单。
func TestBuildCapabilitiesNilConfig(t *testing.T) {
	caps := BuildCapabilities(nil, nil, nil)
	if caps == nil {
		t.Fatal("应返回空切片而不是 nil")
	}
	if len(caps) != 0 {
		t.Fatalf("配置为 nil 时应返回空清单，实际 %d 项", len(caps))
	}
}
