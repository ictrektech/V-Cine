package service

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"go.uber.org/zap"
)

// ==================== OpenAI 兼容 API 数据结构 ====================

// ChatMessage OpenAI 聊天消息
type ChatMessage struct {
	Role    string `json:"role"` // system / user / assistant
	Content string `json:"content"`
	// 思考模型的思维链（响应侧字段，只读）。不同后端字段名不一致：
	// vLLM / DeepSeek 系用 reasoning_content，部分网关（如本项目的 custom 网关与 GLM 系）用 reasoning，
	// 两者都解析才能判断"content 为空"是思维链烧穿预算还是答案被放进了思考字段。
	ReasoningContent string `json:"reasoning_content,omitempty"`
	Reasoning        string `json:"reasoning,omitempty"`
}

// reasoningText 返回实际存在的思考内容（兼容两种字段名）
func (m ChatMessage) reasoningText() string {
	if strings.TrimSpace(m.ReasoningContent) != "" {
		return strings.TrimSpace(m.ReasoningContent)
	}
	return strings.TrimSpace(m.Reasoning)
}

// ChatCompletionRequest OpenAI 聊天补全请求
type ChatCompletionRequest struct {
	Model          string                        `json:"model"`
	Messages       []ChatMessage                 `json:"messages"`
	Temperature    float64                       `json:"temperature,omitempty"`
	TopP           float64                       `json:"top_p,omitempty"`
	MaxTokens      int                           `json:"max_tokens,omitempty"`
	ResponseFormat *ChatCompletionResponseFormat `json:"response_format,omitempty"`
	// ReasoningEffort 是 OpenAI 标准思考控制字段（none/low/medium/high），
	// Ollama OpenAI 兼容端点、vLLM 与 vrouter 均识别（vLLM 映射为 enable_thinking）。
	// reasoning 模型的思维链会烧穿 max_tokens 导致 content 为空，禁用思考时发 "none"；
	// 后端不识别时静默忽略或由 400 兜底剥离。
	ReasoningEffort string `json:"reasoning_effort,omitempty"`
}

type ChatCompletionResponseFormat struct {
	Type       string                    `json:"type"`
	JSONSchema *ChatCompletionJSONSchema `json:"json_schema,omitempty"`
}

// ChatCompletionJSONSchema OpenAI 结构化输出（Structured Outputs）参数：
// strict + additionalProperties:false 时后端在解码层做语法约束，模型无法输出
// schema 之外的结构（XML/伪 JSON/发明非标准键），与模型能力无关。
type ChatCompletionJSONSchema struct {
	Name   string      `json:"name"`
	Strict bool        `json:"strict"`
	Schema interface{} `json:"schema"`
}

// ChatCompletionResponse OpenAI 聊天补全响应
type ChatCompletionResponse struct {
	ID      string `json:"id"`
	Choices []struct {
		Message ChatMessage `json:"message"`
		// FinishReason: stop（正常结束）/ length（被 max_tokens 截断）/ tool_calls 等
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

// ==================== AI 服务 ====================

// AIErrorLog AI 调用错误日志条目
type AIErrorLog struct {
	Time    string `json:"time"`
	Action  string `json:"action"`
	Error   string `json:"error"`
	Latency int64  `json:"latency_ms"`
}

// AIService AI 功能统一服务
type AIService struct {
	// routerMu 保护 router 的读/写（SetRouter 在启动期注入，读取并发安全）。
	routerMu sync.RWMutex
	router   *AIRouter
	appCfg   *config.Config

	// provider 是 AI 配置的唯一访问入口（无状态，实时读取权威状态 app.AI）
	provider *AIConfigProvider

	mediaRepo *repository.MediaRepo
	logger    *zap.SugaredLogger
	client    *http.Client

	// 双层缓存：内存缓存（快速读取）+ 持久化缓存（重启不丢失）
	cache     map[string]*aiCacheEntry
	cacheMu   sync.RWMutex
	cacheRepo *repository.AICacheRepo // 持久化缓存仓储

	// 并发控制
	semaphore chan struct{}

	// 限流
	lastRequest time.Time
	rateMu      sync.Mutex

	// 全局 429 冷却闸（cooldownMu 同时保护 cooldownUntil 和 cooldownReason）。
	// 任何一次请求收到 429（或 Retry-After）都会把 cooldownUntil 设到未来时刻，
	// 期间所有请求（含重试请求）在 rateLimit() 中统一阻塞等待，
	// 避免高并发下"A 在退避、B/C 还在打"的恶性循环导致整批被服务端拉黑。
	cooldownMu     sync.Mutex
	cooldownUntil  time.Time
	cooldownReason string

	// 月度调用计数
	monthlyCount int
	countMonth   int // 当前月份
	countMu      sync.Mutex

	// Token 消耗统计
	totalPromptTokens     int
	totalCompletionTokens int
	tokenMu               sync.Mutex

	// 错误日志（保留最近 50 条）
	errorLogs []AIErrorLog
	errorMu   sync.Mutex

	describeEnabledSetter func(bool)
}

// aiCacheEntry 缓存条目
type aiCacheEntry struct {
	Value     string
	ExpiresAt time.Time
}

// NewAIService 创建 AI 服务
func NewAIService(cfg config.AIConfig, appCfg *config.Config, mediaRepo *repository.MediaRepo, cacheRepo *repository.AICacheRepo, logger *zap.SugaredLogger, provider *AIConfigProvider) *AIService {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 30
	}

	// 默认参数：偏保守，避开主流云端 LLM 服务（OpenAI / 阿里云百炼 / DeepSeek）的免费/低档限流
	//   - max_concurrent = 1   ：避免单 Key 多通道并行打 API 触发 RPM 限流
	//   - request_interval_ms = 1100 ：≈ 0.9 QPS，远低于 60 QPM 免费档上限
	// 用户在前端"AI 高级设置"里可显式调高（专业版套餐通常没有 RPM 限制）。
	maxConcurrent := cfg.MaxConcurrent
	if maxConcurrent <= 0 {
		maxConcurrent = 1
	}
	if cfg.RequestIntervalMs <= 0 {
		cfg.RequestIntervalMs = 1100
	}
	if cfg.CacheTTLHours <= 0 {
		cfg.CacheTTLHours = 24 * 30 // 默认缓存 30 天，命名识别结果几乎不变
	}

	s := &AIService{
		appCfg:    appCfg,
		provider:  provider,
		mediaRepo: mediaRepo,
		cacheRepo: cacheRepo,
		logger:    logger,
		client: &http.Client{
			Timeout: time.Duration(timeout) * time.Second,
		},
		cache:     make(map[string]*aiCacheEntry),
		semaphore: make(chan struct{}, maxConcurrent),
	}

	if cfg.Enabled {
		if ap := cfg.ActiveProfile(); ap != nil {
			logger.Infof("AI 服务已启用 (提供商: %s, 模型: %s, API: %s)",
				cfg.ActiveProvider, cfg.ActiveModelName(), maskAPIBase(ap.APIBase))
		} else {
			logger.Infof("AI 服务已启用但未配置供应商 (提供商: %s)", cfg.ActiveProvider)
		}
		logger.Infof("AI 功能开关 — 智能搜索: %v, 推荐理由: %v, 元数据增强: %v",
			cfg.EnableSmartSearch, cfg.EnableRecommendReason, cfg.EnableMetadataEnhance)
	} else {
		logger.Info("AI 服务未启用（如需启用，请配置 config/ai.yaml）")
	}

	return s
}

// desensitizeClient 返回脱敏服务专用 HTTP 客户端（TLS 跳过验证 + 独立超时）。
func desensitizeClient(timeout int) *http.Client {
	if timeout <= 0 {
		timeout = 3
	}
	return &http.Client{
		Timeout:   time.Duration(timeout) * time.Second,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
	}
}

// SetRouter 注入 AI 智能路由器（V7：故障转移与用量监控）
//
// 与 NewAIRouter 配合：
//   - NewAIRouter(ai, ...) 内部会调用 ai.SetRouter(r)
//   - 之后 ChatCompletion 的成功/失败钩子都会回调 router
//
// 二次设置会覆盖（用于运行时替换 router 实现，例如热升级测试）。
func (s *AIService) SetRouter(r *AIRouter) {
	s.routerMu.Lock()
	s.router = r
	s.routerMu.Unlock()
}

// Router 返回当前注入的 router（可能为 nil）
func (s *AIService) Router() *AIRouter {
	s.routerMu.RLock()
	defer s.routerMu.RUnlock()
	return s.router
}

// IsEnabled 检查 AI 服务是否启用
//
// AutoPilot 语义：只要 profiles 中有配了 APIKey 与 APIBase 的激活 provider，
// 即使 Enabled=false 也会被视为启用，从而避免「用户填了 key 却忘记打 enabled 开关」造成的 AI 不生效。
func (s *AIService) IsEnabled() bool {
	return s.provider.IsEnabled()
}

// Provider 返回当前生效的 AI 服务商（来自 AI 配置中心，可在管理面板动态切换）
func (s *AIService) Provider() string {
	return s.provider.ActiveProvider()
}

// Model 返回当前生效的 AI 模型
func (s *AIService) Model() string {
	return s.provider.ActiveModel()
}

// IsSmartSearchEnabled 检查智能搜索是否启用
func (s *AIService) IsSmartSearchEnabled() bool {
	return s.provider.IsSmartSearchEnabled()
}

// IsRecommendReasonEnabled 检查推荐理由生成是否启用
func (s *AIService) IsRecommendReasonEnabled() bool {
	return s.provider.IsRecommendReasonEnabled()
}

// IsMetadataEnhanceEnabled 检查元数据增强是否启用
func (s *AIService) IsMetadataEnhanceEnabled() bool {
	return s.provider.IsMetadataEnhanceEnabled()
}

// IsAutoPilotEnabled 是否处于全自动托管模式
func (s *AIService) IsAutoPilotEnabled() bool {
	return s.provider.IsAutoPilotEnabled()
}

// snapshotCfg 返回当前 AI 配置的一个值拷贝（实时读自权威状态 app.AI，
// 供单个请求/调用内部使用，期间配置变化不影响本次处理）。
func (s *AIService) snapshotCfg() config.AIConfig {
	return s.provider.Snapshot()
}

// ==================== LLM 调用核心 ====================

// ChatCompletion 调用 LLM 聊天补全 API
//
// 重试策略（针对常见的限流/瞬时错误）：
//   - HTTP 429 / 5xx / 网络错误自动指数退避重试（最多 4 次：1s -> 2s -> 4s -> 8s）
//   - 优先读取响应头中的 `Retry-After`（秒）作为退避时长
//   - 4xx（除 429 外）直接返回，不重试，避免无效请求消耗配额
//   - 整体最长等待 ≈ 15s，超过后返回最后一次错误
//
func (s *AIService) ChatCompletion(systemPrompt, userPrompt string, temperature float64, maxTokens int) (string, error) {
	return s.chatCompletion(systemPrompt, userPrompt, temperature, maxTokens, false, "", nil)
}

// ChatCompletionJSONSchema 结构化输出补全（response_format=json_schema + strict），
// 用于意图解析等结构化任务。后端在解码层做语法约束，即使小模型也强制遵循 schema。
// 不支持的后端由 400 兜底降级为 json_object 再降级为纯 prompt。
// reasoningEffort 思考控制（OpenAI 标准，Ollama/vLLM/vrouter 均识别）：
// "" 不发字段（保留后端默认思考）；"none" 禁用思考；"low"/"medium"/"high" 指定思考强度。
func (s *AIService) ChatCompletionJSONSchema(systemPrompt, userPrompt string, temperature float64, maxTokens int, schema string, reasoningEffort string) (string, error) {
	return s.chatCompletion(systemPrompt, userPrompt, temperature, maxTokens, false, reasoningEffort, &ChatCompletionJSONSchema{
		Name:   "assistant_response",
		Strict: true,
		Schema: json.RawMessage(schema),
	})
}

func (s *AIService) chatCompletion(systemPrompt, userPrompt string, temperature float64, maxTokens int, forceJSON bool, reasoningEffort string, schema *ChatCompletionJSONSchema) (string, error) {
	if !s.IsEnabled() {
		return "", fmt.Errorf("AI 服务未启用")
	}

	// 以“一次快照”在本次调用全程使用同一份 cfg，避免中途热更新导致 model/url 不一致，
	cfg := s.snapshotCfg()

	// V7：走热路径时顺便检查主 provider 是否可自动恢复
	if s.router != nil {
		s.router.MaybeAutoRecover()
		cfg = s.snapshotCfg()
	}

	// 从 Providers 列表解析激活 provider 的配置
	// 免 key provider（vrouter / ollama）只需 APIBase，无需 APIKey。
	ap := cfg.ActiveProfile()
	if ap == nil || ap.APIBase == "" || (ap.APIKey == "" && !config.IsKeyFreeProvider(cfg.ActiveProvider, ap.APIBase)) {
		return "", fmt.Errorf("未配置 AI 供应商（provider=%s）", cfg.ActiveProvider)
	}
	apiBase := ap.APIBase
	apiKey := ap.APIKey
	model := cfg.ActiveModelName()

	// V-Router 网关要求请求体必须带 model（V-ChatCut 同款语义：vrouter 无模型即不可用）。
	// 空 model 提前报可读错误，而不是让网关返回 400 "JSON body requires model"。
	if model == "" {
		return "", fmt.Errorf("AI 供应商 %s 未配置模型，请在 AI 设置中为该供应商拉取模型或手动添加后重试", cfg.ActiveProvider)
	}

	// 云端强制：拦截本地 AI（如 ollama），避免「全自动托管」语义下走本地推理。
	// vrouter 豁免：V-Router 是云模型网关而非本地推理，APIBase 为私网 IP
	// （宿主机端口模式）不代表本地推理。
	if cfg.BlockLocalAI && cfg.ActiveProvider != "vrouter" && isLocalAIProvider(cfg.ActiveProvider, apiBase) {
		return "", fmt.Errorf("当前系统禁止本地 AI（provider=%s），请在 AI 配置中选择云端服务商（OpenAI/DeepSeek/通义千问）", cfg.ActiveProvider)
	}

	// 预算检查
	if !s.checkBudget() {
		return "", fmt.Errorf("AI 月度调用预算已用尽")
	}

	// 并发控制
	s.semaphore <- struct{}{}
	defer func() { <-s.semaphore }()

	// 数据脱敏：对发给 LLM 的文本做敏感信息脱敏
	systemPrompt = s.desensitizeText(systemPrompt)
	userPrompt = s.desensitizeText(userPrompt)

	// 构建请求体（一次构建，多次重试复用）
	reqBody := ChatCompletionRequest{
		Model: model,
		Messages: []ChatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		Temperature: temperature,
		MaxTokens:   maxTokens,
	}
	// 低温 JSON/短文本任务进一步收窄 top_p，降低 deepseek-v4-flash 冗长/发散输出概率。
	if temperature <= 0.1 && maxTokens > 0 && maxTokens <= 1024 {
		reqBody.TopP = 0.1
	}
	// 结构化输出：schema（json_schema + strict）优先——解码层语法约束，格式漂移不可能发生；
	// 不支持的后端由 400 兜底降级为 json_object 再降级为纯 prompt。
	// forceJSON（意图解析等结构化任务）不受温度/长度门槛限制直接启用 json_object；
	// 普通补全仅在低温短文本任务启用。
	// 所有 provider 走同一 OpenAI 兼容路径，统一发送。
	switch {
	case schema != nil:
		reqBody.ResponseFormat = &ChatCompletionResponseFormat{
			Type:       "json_schema",
			JSONSchema: schema,
		}
	case maxTokens >= 128 && (forceJSON || (temperature <= 0.1 && maxTokens <= 1024)):
		reqBody.ResponseFormat = &ChatCompletionResponseFormat{Type: "json_object"}
	}
	if reasoningEffort != "" {
		reqBody.ReasoningEffort = reasoningEffort
	}
	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("序列化请求失败: %w", err)
	}
	apiURL := strings.TrimRight(apiBase, "/") + "/chat/completions"

	// 凭证方式（可观测）：configured=用户配置的 key；vos_token=VOS 登录态转发；
	// none=无凭证（网关归 internal）。用于日志区分 vrouter 调用的用量归属。
	vosToken := ""
	if apiKey == "" && cfg.ActiveProvider == "vrouter" && config.IsKeyFreeProvider(cfg.ActiveProvider, apiBase) {
		vosToken = LatestVOSAccessToken()
	}
	credential := "none"
	if apiKey != "" {
		credential = "configured"
	} else if vosToken != "" {
		credential = "vos_token"
	}

	const maxAttempts = 4
	var lastErr error
	var respBody []byte

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		// 限流（每次重试前都过一遍间隔限流）
		s.rateLimit()

		req, err := http.NewRequest("POST", apiURL, bytes.NewReader(bodyBytes))
		if err != nil {
			return "", fmt.Errorf("创建请求失败: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		// 免 key provider（vrouter 无 key / ollama）不发 Authorization 头，
		// 避免发出空值的 "Bearer "。
		// vrouter 对齐 V-ChatCut：有 VOS 登录态时转发 accessToken 做用量归属；
		// 无登录态时完全不带（网关归 internal）。
		if apiKey != "" {
			req.Header.Set("Authorization", "Bearer "+apiKey)
		} else if vosToken != "" {
			req.Header.Set("Authorization", "Bearer "+vosToken)
		}

		resp, err := s.client.Do(req)
		if err != nil {
			// 网络错误：可重试，写入全局冷却闸（让其他并发请求一起等）
			lastErr = fmt.Errorf("AI API 请求失败: %w", err)
			if attempt < maxAttempts {
				wait := backoffDuration(attempt, "")
				s.logger.Warnf("AI 调用网络错误 (provider=%s, credential=%s)，%v 后重试 (第 %d/%d 次): %v",
					cfg.ActiveProvider, credential, wait, attempt, maxAttempts, err)
				s.triggerCooldown(wait, fmt.Sprintf("network err: %v", err))
				continue // rateLimit() 会在下次循环顶部尊重冷却闸
			}
			break
		}

		respBody, err = io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if err != nil {
			lastErr = fmt.Errorf("读取响应失败: %w", err)
			if attempt < maxAttempts {
				wait := backoffDuration(attempt, "")
				s.triggerCooldown(wait, "read body err")
				continue
			}
			break
		}

		// 成功
		if resp.StatusCode == http.StatusOK {
			var chatResp ChatCompletionResponse
			if err := json.Unmarshal(respBody, &chatResp); err != nil {
				return "", fmt.Errorf("解析 AI 响应失败: %w", err)
			}
			if len(chatResp.Choices) == 0 {
				return "", fmt.Errorf("AI 未返回任何结果")
			}
			s.incrementCount()
			s.tokenMu.Lock()
			s.totalPromptTokens += chatResp.Usage.PromptTokens
			s.totalCompletionTokens += chatResp.Usage.CompletionTokens
			s.tokenMu.Unlock()
			result := strings.TrimSpace(chatResp.Choices[0].Message.Content)
			reasoning := chatResp.Choices[0].Message.reasoningText()
			finishReason := chatResp.Choices[0].FinishReason
			// 原始响应随成功日志一并输出（同一行单次写入，减少并发交错），
			// 便于 debug 时观察模型格式漂移（XML 函数调用 / 截断 / 伪 JSON 等）。
			// 同时输出 finish_reason 与思考内容长度：content 为空时这两项才能定位原因。
			s.logger.Debugf("AI 调用成功 (provider=%s, model=%s, credential=%s, tokens: %d+%d=%d, attempt=%d, finish=%s, reasoning_len=%d) 原始响应: %s",
				cfg.ActiveProvider, model, credential,
				chatResp.Usage.PromptTokens, chatResp.Usage.CompletionTokens, chatResp.Usage.TotalTokens, attempt,
				finishReason, len(reasoning), truncateForLog(result, 500))
			// V7：通知路由器记录用量
			if s.router != nil {
				s.router.MarkSuccess(cfg.ActiveProvider, model,
					chatResp.Usage.PromptTokens, chatResp.Usage.CompletionTokens, 0, "chat_completion")
			}
			// 空 content 提前拦下：直接报"空内容"而不是把空串交给上层做 JSON 解析
			// （否则上层只会得到 "unexpected end of JSON input" 这种看不出原因的报错）
			if result == "" {
				s.logger.Warnf("AI 返回空内容 (provider=%s, model=%s, finish_reason=%s, completion_tokens=%d/%d, reasoning_len=%d, reasoning: %s, raw: %s)",
					cfg.ActiveProvider, model, finishReason,
					chatResp.Usage.CompletionTokens, maxTokens, len(reasoning),
					truncateForLog(reasoning, 300), truncateForLog(string(respBody), 600))
				hint := "输出为空"
				switch {
				case finishReason == "length":
					hint = "输出被 max_tokens 截断（思考模型把预算全用在思维链上，正文未产出）；请为该调用关闭思考或提高 max_tokens"
				case len(reasoning) > 0:
					hint = "content 为空但存在思考内容（后端把思考放在了 reasoning/reasoning_content，正文未产出）"
				}
				return "", fmt.Errorf("AI 返回空内容：%s（finish_reason=%s, completion_tokens=%d/%d）",
					hint, finishReason, chatResp.Usage.CompletionTokens, maxTokens)
			}
			return result, nil
		}

		// 非 200：判断是否可重试
		retryAfter := resp.Header.Get("Retry-After")
		errMsg := fmt.Errorf("AI API 返回 HTTP %d", resp.StatusCode)
		lastErr = errMsg

		// HTTP 400 兜底：少数严格的 OpenAI 兼容后端会不识别/拒绝 response_format 或 reasoning_effort 字段。
		// 分层降级：json_schema → json_object → 纯 prompt（每次 400 只降级一级），
		// 结构化任务退化为纯 prompt 时由上层解析容错。
		// 仅当 400 与 response_format / reasoning_effort 相关（响应体提及对应字段，或响应体为空无法判断）时降级；
		// 无关的 400（缺 model 等）直接走错误路径，避免多耗往返。
		if resp.StatusCode == http.StatusBadRequest {
			bodyLower := strings.ToLower(string(respBody))
			bodyEmpty := strings.TrimSpace(string(respBody)) == ""
			formatProblem := reqBody.ResponseFormat != nil &&
				(strings.Contains(bodyLower, "response_format") || bodyEmpty)
			// 仅后端拒绝已发送字段时才降级
			reasoningProblem := reqBody.ReasoningEffort != "" &&
				(strings.Contains(bodyLower, "reasoning_effort") || bodyEmpty)
			if formatProblem || reasoningProblem {
				s.logger.Warnf("AI API HTTP 400，疑似后端不支持 response_format/reasoning_effort 字段，降级重试 (provider=%s, credential=%s): %s",
					cfg.ActiveProvider, credential, truncateForLog(string(respBody), 200))
				if formatProblem {
					if reqBody.ResponseFormat.Type == "json_schema" {
						// json_schema 不被支持：降级为 json_object 再试
						reqBody.ResponseFormat = &ChatCompletionResponseFormat{Type: "json_object"}
					} else {
						// json_object 也不被支持：去掉该字段纯 prompt 重试
						reqBody.ResponseFormat = nil
					}
				}
				// reasoning_effort 被拒（如旧 o 系不认 none）时剥离重试，
				// 上层解析容错兜底思考开启导致的形状漂移
				if reasoningProblem {
					reqBody.ReasoningEffort = ""
				}
				bodyBytes, err = json.Marshal(reqBody)
				if err != nil {
					return "", fmt.Errorf("序列化请求失败: %w", err)
				}
				continue
			}
		}

		retryable := resp.StatusCode == http.StatusTooManyRequests ||
			resp.StatusCode == http.StatusServiceUnavailable ||
			resp.StatusCode == http.StatusBadGateway ||
			resp.StatusCode == http.StatusGatewayTimeout ||
			(resp.StatusCode >= 500 && resp.StatusCode < 600)

		if retryable && attempt < maxAttempts {
			wait := backoffDuration(attempt, retryAfter)
			s.logger.Warnf("AI API HTTP %d (provider=%s, credential=%s)，%v 后重试 (第 %d/%d 次, 触发全局冷却): %s",
				resp.StatusCode, cfg.ActiveProvider, credential, wait, attempt, maxAttempts, truncateForLog(string(respBody), 200))
			// 关键：写入全局冷却闸，所有并发请求（包括其他 worker）会在 rateLimit() 一起等
			s.triggerCooldown(wait, fmt.Sprintf("HTTP %d", resp.StatusCode))
			continue
		}

		// 不可重试 / 已达上限
		s.logger.Warnf("AI API 返回错误 (provider=%s, credential=%s, HTTP %d): %s",
			cfg.ActiveProvider, credential, resp.StatusCode, string(respBody))
		s.addErrorLog("chat_completion", errMsg, 0)
		// V7：通知路由器试图切换（这里不另外重试，避免双重试逻辑交叉）
		if s.router != nil {
			s.router.MarkFailure(cfg.ActiveProvider, resp.StatusCode, string(respBody))
		}
		return "", errMsg
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("AI 调用失败（未知原因）")
	}
	s.addErrorLog("chat_completion", lastErr, 0)
	// V7：重试后仍失败（网络错误路径），同样平衡给 router
	if s.router != nil {
		s.router.MarkFailure(cfg.ActiveProvider, 0, lastErr.Error())
	}
	return "", lastErr
}

// backoffDuration 计算重试退避时长。
//
// 优先使用 Retry-After 头（OpenAI / 阿里云百炼 / 多数兼容服务返回 N 秒整数）。
// 否则使用指数退避：1s -> 2s -> 4s -> 8s（最多 8s 单次）。
func backoffDuration(attempt int, retryAfter string) time.Duration {
	// 解析 Retry-After（秒数）
	if retryAfter != "" {
		if secs, err := strconv.Atoi(strings.TrimSpace(retryAfter)); err == nil && secs > 0 {
			if secs > 30 {
				secs = 30 // 上限保护
			}
			return time.Duration(secs) * time.Second
		}
	}
	// 指数退避：1s, 2s, 4s, 8s
	wait := time.Second << (attempt - 1)
	if wait > 8*time.Second {
		wait = 8 * time.Second
	}
	return wait
}

// truncateForLog 截断长字符串，仅用于日志展示
func truncateForLog(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// ==================== 数据脱敏 ====================

var allowedImageScopes = map[string]bool{config.DesensitizeImageScopeEmbedding: true, config.DesensitizeImageScopeAIAssistant: true}

func sanitizeDesensitizeImageScopes(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || !allowedImageScopes[s] || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

// IsImageScopeEnabled 供外部按 scope 判断是否启用图片脱敏。
func (s *AIService) IsImageScopeEnabled(scope string) bool {
	cfg := s.snapshotCfg()
	if !cfg.Desensitize.ImageEnabled || strings.TrimSpace(cfg.Desensitize.BaseURL) == "" || scope == "" {
		return false
	}
	return slices.Contains(cfg.Desensitize.ImageScopes, scope)
}

// DesensitizeImageForScope 统一图片脱敏入口：按 scope 校验开关与范围，不命中则原样返回。
// 供 embedding / AI 助手等所有图片上传路径复用。
func (s *AIService) DesensitizeImageForScope(dataURL, scope string) string {
	cfg := s.snapshotCfg()
	if !cfg.Desensitize.ImageEnabled || strings.TrimSpace(cfg.Desensitize.BaseURL) == "" || scope == "" {
		return dataURL
	}
	if !slices.Contains(cfg.Desensitize.ImageScopes, scope) {
		return dataURL
	}
	if strings.TrimSpace(dataURL) == "" {
		return dataURL
	}
	return s.desensitizeImage(dataURL)
}

func (s *AIService) desensitizeImage(dataURL string) string {
	cfg := s.snapshotCfg()
	if strings.TrimSpace(cfg.Desensitize.BaseURL) == "" {
		return dataURL
	}
	timeout := cfg.Desensitize.ImageTimeout
	if timeout <= 0 {
		timeout = 30
	}
	type reqBody struct {
		ImageBase64 string `json:"image_base64"`
	}
	type replacedItem struct {
		Rule string `json:"rule"`
	}
	type respBody struct {
		ImageBase64 string         `json:"image_base64"`
		Replaced    []replacedItem `json:"replaced"`
	}
	body, _ := json.Marshal(reqBody{ImageBase64: dataURL})
	apiURL := strings.TrimRight(cfg.Desensitize.BaseURL, "/") + "/api/v1/desensitize/image"
	req, err := http.NewRequest("POST", apiURL, bytes.NewReader(body))
	if err != nil {
		return dataURL
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := desensitizeClient(timeout).Do(req)
	if err != nil {
		s.logger.Warnf("desensitize image unavailable, passing through: %v", err)
		return dataURL
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		s.logger.Warnf("desensitize image returned HTTP %d, passing through", resp.StatusCode)
		return dataURL
	}
	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		s.logger.Warnf("desensitize image read error, passing through: %v", err)
		return dataURL
	}
	var result respBody
	if err := json.Unmarshal(respBytes, &result); err != nil {
		s.logger.Warnf("desensitize image parse error, passing through: %v", err)
		return dataURL
	}
	if result.ImageBase64 == "" {
		return dataURL
	}
	if len(result.Replaced) > 0 {
		s.logger.Debugf("desensitized image %d rule(s)", len(result.Replaced))
	}
	return result.ImageBase64
}

// desensitizeText 调用 desensitize 服务对文本做敏感信息脱敏。
// 脱敏服务不可用时返回原文，不阻断业务。
func (s *AIService) desensitizeText(text string) string {
	cfg := s.snapshotCfg()
	if !cfg.Desensitize.Enabled || strings.TrimSpace(cfg.Desensitize.BaseURL) == "" {
		return text
	}
	if strings.TrimSpace(text) == "" {
		return text
	}

	type desensitizeReq struct {
		Text string `json:"text"`
		NER  bool   `json:"ner"`
	}
	type desensitizeReplaced struct {
		Rule        string `json:"rule"`
		Placeholder string `json:"placeholder"`
		Occurrences int    `json:"occurrences"`
	}
	type desensitizeResp struct {
		Text     string                `json:"text"`
		Replaced []desensitizeReplaced `json:"replaced"`
	}

	reqBody, _ := json.Marshal(desensitizeReq{Text: text, NER: cfg.Desensitize.NER})
	apiURL := strings.TrimRight(cfg.Desensitize.BaseURL, "/") + "/api/v1/desensitize/text"

	req, err := http.NewRequest("POST", apiURL, bytes.NewReader(reqBody))
	if err != nil {
		return text
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := desensitizeClient(cfg.Desensitize.Timeout).Do(req)
	if err != nil {
		s.logger.Warnf("desensitize unavailable, passing through: %v", err)
		return text
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		s.logger.Warnf("desensitize returned HTTP %d, passing through", resp.StatusCode)
		return text
	}

	var result desensitizeResp
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		s.logger.Warnf("desensitize read error, passing through: %v", err)
		return text
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		s.logger.Warnf("desensitize parse error, passing through: %v", err)
		return text
	}
	if len(result.Replaced) > 0 {
		s.logger.Debugf("desensitized %d rule(s)", len(result.Replaced))
	}
	return result.Text
}

// TestDesensitize 测试脱敏服务是否健康：POST 真实接口，成功即健康。
// 返回 success / latency / 命中规则数 / 脱敏结果或错误信息。
func (s *AIService) TestDesensitize() map[string]interface{} {
	cfg := s.snapshotCfg()
	base := strings.TrimRight(cfg.Desensitize.BaseURL, "/")
	if base == "" {
		return map[string]interface{}{"success": false, "error": "未配置脱敏服务地址", "configured": false}
	}

	// 直接 POST 真实接口：成功即健康，失败即不可达
	sample := "请联系 13800138000 或本人身份证 110101199003078899，地址：北京市朝阳区建国路 88 号"
	apiURL := base + "/api/v1/desensitize/text"

	start := time.Now()
	reqBody, _ := json.Marshal(map[string]interface{}{"text": sample, "ner": cfg.Desensitize.NER})

	req, err := http.NewRequest("POST", apiURL, bytes.NewReader(reqBody))
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := desensitizeClient(cfg.Desensitize.Timeout).Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return map[string]interface{}{"success": false, "latency_ms": latency, "error": "请求脱敏接口失败: " + err.Error()}
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return map[string]interface{}{
			"success": false, "latency_ms": latency,
			"error": fmt.Sprintf("脱敏接口 %s 返回 HTTP %d，请核对服务地址/路径（base_url=%s）", apiURL, resp.StatusCode, base),
		}
	}

	var result struct {
		Text     string `json:"text"`
		Replaced []struct {
			Rule string `json:"rule"`
		} `json:"replaced"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return map[string]interface{}{"success": false, "latency_ms": latency, "error": "响应解析失败: " + err.Error()}
	}

	return map[string]interface{}{
		"success":    true,
		"latency_ms": latency,
		"rules":      len(result.Replaced),
		"result":     result.Text,
	}
}

// ==================== 缓存 ====================

// GetCache 从缓存获取（双层：先查内存，再查持久化存储）
func (s *AIService) GetCache(key string) (string, bool) {
	// 第一层：内存缓存
	s.cacheMu.RLock()
	entry, ok := s.cache[key]
	s.cacheMu.RUnlock()
	if ok && time.Now().Before(entry.ExpiresAt) {
		return entry.Value, true
	}

	// 第二层：持久化缓存
	if s.cacheRepo != nil {
		if val, found := s.cacheRepo.Get(key); found {
			ttl := s.provider.Snapshot().CacheTTLHours
			// 回填内存缓存
			s.cacheMu.Lock()
			s.cache[key] = &aiCacheEntry{
				Value:     val,
				ExpiresAt: time.Now().Add(time.Duration(ttl) * time.Hour),
			}
			s.cacheMu.Unlock()
			return val, true
		}
	}

	return "", false
}

// SetCache 写入缓存（双层：同时写入内存和持久化存储）
func (s *AIService) SetCache(key, value string) {
	ttl := s.provider.Snapshot().CacheTTLHours
	if ttl <= 0 {
		return // 不缓存
	}

	// 写入内存缓存
	s.cacheMu.Lock()
	s.cache[key] = &aiCacheEntry{
		Value:     value,
		ExpiresAt: time.Now().Add(time.Duration(ttl) * time.Hour),
	}

	// 简单的内存缓存淘汰：超过 500 条时清理过期的
	if len(s.cache) > 500 {
		now := time.Now()
		for k, v := range s.cache {
			if now.After(v.ExpiresAt) {
				delete(s.cache, k)
			}
		}
	}
	s.cacheMu.Unlock()

	// 写入持久化缓存（异步，不阻塞主流程）
	if s.cacheRepo != nil {
		go func() {
			if err := s.cacheRepo.Set(key, value, ttl); err != nil {
				s.logger.Debugf("AI 缓存持久化失败: %v", err)
			}
		}()
	}
}

// ==================== 限流与预算 ====================

// rateLimit 请求间隔限流 + 全局 429 冷却闸。
//
// 顺序：
//  1. 若全局冷却闸生效（来自上一次 429 / Retry-After），先阻塞等待到冷却结束；
//  2. 再走最小请求间隔限流（避免同一秒内挤压新请求）。
//
// 关键点：cooldownUntil 用 cooldownMu 短暂上锁读取，sleep 时不持锁，
// 防止 N 个请求互相阻塞导致退避后再次同时打 API。
func (s *AIService) rateLimit() {
	// 1) 全局 429 冷却闸
	for {
		s.cooldownMu.Lock()
		until := s.cooldownUntil
		reason := s.cooldownReason
		s.cooldownMu.Unlock()
		now := time.Now()
		if !until.After(now) {
			break
		}
		wait := until.Sub(now)
		if wait > 30*time.Second {
			wait = 30 * time.Second // 上限保护
		}
		s.logger.Debugf("AI 全局冷却中，等待 %v（原因: %s）", wait, reason)
		time.Sleep(wait)
		// 循环再次确认（其他请求可能在我们 sleep 期间又触发了新的 cooldown 延期）
	}

	// 2) 最小请求间隔
	interval := time.Duration(s.provider.Snapshot().RequestIntervalMs) * time.Millisecond
	if interval <= 0 {
		return
	}

	s.rateMu.Lock()
	defer s.rateMu.Unlock()

	elapsed := time.Since(s.lastRequest)
	if elapsed < interval {
		time.Sleep(interval - elapsed)
	}
	s.lastRequest = time.Now()
}

// triggerCooldown 触发全局 429 冷却闸。
//
// 入参 wait 为本次需要等待的时长（已由调用方综合 Retry-After / 指数退避算好）。
// 函数将 cooldownUntil 推到 max(原 until, now+wait)：取较远者，
// 保证多个请求"同时挨打"时不会被某个较早完成的退避把闸提前抬起。
//
// reason 仅用于日志展示。
func (s *AIService) triggerCooldown(wait time.Duration, reason string) {
	if wait <= 0 {
		return
	}
	target := time.Now().Add(wait)
	s.cooldownMu.Lock()
	if target.After(s.cooldownUntil) {
		s.cooldownUntil = target
		s.cooldownReason = reason
	}
	s.cooldownMu.Unlock()
}

// checkBudget 检查月度预算
func (s *AIService) checkBudget() bool {
	budget := s.provider.Snapshot().MonthlyBudget
	if budget <= 0 {
		return true // 不限制
	}

	s.countMu.Lock()
	defer s.countMu.Unlock()

	currentMonth := time.Now().Month()
	if int(currentMonth) != s.countMonth {
		s.monthlyCount = 0
		s.countMonth = int(currentMonth)
	}

	return s.monthlyCount < budget
}

// incrementCount 增加调用计数
func (s *AIService) incrementCount() {
	s.countMu.Lock()
	defer s.countMu.Unlock()
	s.monthlyCount++
}

// ==================== 辅助 ====================

// maskAPIBase 掩码 API 地址（日志用）
func maskAPIBase(base string) string {
	if len(base) <= 20 {
		return base
	}
	return base[:20] + "..."
}

// isLocalAIProvider 判断是否为本地 AI 推理实例（provider 名或 api_base 是本地地址）
// AutoPilot/BlockLocalAI 语义下会拒绝调用，确保「全部调用服务商提供的 AI API」。
func isLocalAIProvider(provider, apiBase string) bool {
	p := strings.ToLower(strings.TrimSpace(provider))
	if p == "ollama" || p == "local" || p == "localai" || p == "llamacpp" || p == "llama-cpp" {
		return true
	}
	b := strings.ToLower(strings.TrimSpace(apiBase))
	if b == "" {
		return false
	}
	// 常见本地地址特征
	localHints := []string{
		"localhost", "127.0.0.1", "0.0.0.0",
		"://192.168.", "://10.", "://172.16.", "://172.17.", "://172.18.", "://172.19.",
		"://172.20.", "://172.21.", "://172.22.", "://172.23.", "://172.24.",
		"://172.25.", "://172.26.", "://172.27.", "://172.28.", "://172.29.",
		"://172.30.", "://172.31.",
		":11434", // Ollama 默认端口
	}
	for _, h := range localHints {
		if strings.Contains(b, h) {
			return true
		}
	}
	return false
}

// GetStatus 获取 AI 服务状态（用于前端展示）
func (s *AIService) GetStatus() map[string]interface{} {
	cfg := s.snapshotCfg()
	ap := cfg.ActiveProfile()
	// 免 key provider（vrouter / ollama）只需 APIBase 即视为已配置，
	// 与 IsEnabled / chatCompletion 的判定口径一致。
	apiConfigured := ap != nil && ap.APIBase != "" &&
		(ap.APIKey != "" || config.IsKeyFreeProvider(cfg.ActiveProvider, ap.APIBase))

	apiBase := ""
	if ap != nil {
		apiBase = ap.APIBase
	}

	status := map[string]interface{}{
		"enabled":                 cfg.Enabled,
		"auto_pilot":              cfg.AutoPilot,
		"block_local_ai":          cfg.BlockLocalAI,
		"active_provider":         cfg.ActiveProvider,
		"active_model":            cfg.ActiveModelName(),
		"api_base":                apiBase,
		"api_configured":          apiConfigured,
		"timeout":                 cfg.Timeout,
		"enable_smart_search":     cfg.EnableSmartSearch,
		"enable_recommend_reason": cfg.EnableRecommendReason,
		"enable_metadata_enhance": cfg.EnableMetadataEnhance,
		"describe_enabled":        s.appCfg.VideoAnalysisSnapshot().DescribeEnabled,
		"scene_describe_ai": map[string]interface{}{
			"provider_id": cfg.SceneDescribeAI.ProviderID,
			"model":       cfg.SceneDescribeAI.Model,
		},
		"cache_ttl_hours":     cfg.CacheTTLHours,
		"max_concurrent":      cfg.MaxConcurrent,
		"request_interval_ms": cfg.RequestIntervalMs,
		"desensitize": map[string]interface{}{
			"enabled":       cfg.Desensitize.Enabled,
			"base_url":      cfg.Desensitize.BaseURL,
			"timeout":       cfg.Desensitize.Timeout,
			"ner":           cfg.Desensitize.NER,
			"image_enabled": cfg.Desensitize.ImageEnabled,
			"image_timeout": cfg.Desensitize.ImageTimeout,
			"image_scopes":  cfg.Desensitize.ImageScopes,
		},
	}

	// 供应商列表（脱敏：不返回 api_key，只返回 api_key_configured）
	providersView := make([]map[string]interface{}, 0, len(cfg.Providers))
	for _, p := range cfg.Providers {
		providersView = append(providersView, p.ViewMap(cfg.ActiveProvider))
	}
	status["providers"] = providersView

	s.countMu.Lock()
	status["monthly_calls"] = s.monthlyCount
	status["monthly_budget"] = cfg.MonthlyBudget
	s.countMu.Unlock()

	s.tokenMu.Lock()
	status["total_prompt_tokens"] = s.totalPromptTokens
	status["total_completion_tokens"] = s.totalCompletionTokens
	status["total_tokens"] = s.totalPromptTokens + s.totalCompletionTokens
	s.tokenMu.Unlock()

	s.cacheMu.RLock()
	status["cache_entries"] = len(s.cache)
	s.cacheMu.RUnlock()

	return status
}

func (s *AIService) SetDescribeEnabledCallback(fn func(bool)) {
	s.describeEnabledSetter = fn
}

// ==================== 配置更新 ====================

// UpdateConfig 动态更新 AI 配置
//
// 处理流程：
//  1. provider.Update 在 c.mu 锁内应用 updates 到权威状态 app.AI 并持久化
//  2. 应用非配置类副作用（HTTP client 超时、视频分析 describe 开关）
func (s *AIService) UpdateConfig(updates map[string]interface{}) error {
	if err := s.provider.Update(func(cfg *config.AIConfig) {
		applyAIConfigUpdates(cfg, updates)
	}); err != nil {
		return err
	}

	// 副作用：热更新 HTTP client 超时与视频分析 describe 开关（非配置字段）
	if v, ok := updates["timeout"].(float64); ok {
		s.client.Timeout = time.Duration(int(v)) * time.Second
	}
	if v, ok := updates["describe_enabled"].(bool); ok {
		s.appCfg.SetVideoAnalysisDescribeEnabled(v)
		if s.describeEnabledSetter != nil {
			s.describeEnabledSetter(v)
		}
	}
	s.logger.Infof("AI 配置已更新并写入 config/ai.yaml")
	return nil
}

// applyAIConfigUpdates 将 updates 应用到 AI 配置（纯配置变更，不含副作用）。
// 唯一调用方：AIService.UpdateConfig（经 provider.Update 在 c.mu 锁内执行）。
func applyAIConfigUpdates(cfg *config.AIConfig, updates map[string]interface{}) {
	for key, val := range updates {
		switch key {
		case "enabled":
			if v, ok := val.(bool); ok {
				cfg.Enabled = v
			}
		case "auto_pilot":
			if v, ok := val.(bool); ok {
				cfg.AutoPilot = v
				// 开启 AutoPilot 时隐式点亮主开关与子功能开关，避免老配置遗留中的 false 干扰「一键设为」体验
				if v {
					cfg.Enabled = true
					cfg.EnableSmartSearch = true
					cfg.EnableRecommendReason = true
					cfg.EnableMetadataEnhance = true
				}
			}
		case "block_local_ai":
			if v, ok := val.(bool); ok {
				cfg.BlockLocalAI = v
			}
		case "active_provider":
			if v, ok := val.(string); ok {
				cfg.ActiveProvider = v
			}
		case "active_model":
			if v, ok := val.(string); ok {
				cfg.ActiveModel = v
			}
		case "timeout":
			if v, ok := val.(float64); ok {
				cfg.Timeout = int(v)
			}
		case "enable_smart_search":
			if v, ok := val.(bool); ok {
				cfg.EnableSmartSearch = v
			}
		case "enable_recommend_reason":
			if v, ok := val.(bool); ok {
				cfg.EnableRecommendReason = v
			}
		case "enable_metadata_enhance":
			if v, ok := val.(bool); ok {
				cfg.EnableMetadataEnhance = v
			}
		case "monthly_budget":
			if v, ok := val.(float64); ok {
				cfg.MonthlyBudget = int(v)
			}
		case "cache_ttl_hours":
			if v, ok := val.(float64); ok {
				cfg.CacheTTLHours = int(v)
			}
		case "max_concurrent":
			if v, ok := val.(float64); ok {
				cfg.MaxConcurrent = int(v)
			}
		case "request_interval_ms":
			if v, ok := val.(float64); ok {
				cfg.RequestIntervalMs = int(v)
			}
		case "desensitize":
			if v, ok := val.(map[string]interface{}); ok {
				if enabled, ok := v["enabled"].(bool); ok {
					cfg.Desensitize.Enabled = enabled
				}
				if baseURL, ok := v["base_url"].(string); ok {
					cfg.Desensitize.BaseURL = baseURL
				}
				if timeout, ok := v["timeout"].(float64); ok {
					cfg.Desensitize.Timeout = int(timeout)
				}
				if ner, ok := v["ner"].(bool); ok {
					cfg.Desensitize.NER = ner
				}
				if imageEnabled, ok := v["image_enabled"].(bool); ok {
					cfg.Desensitize.ImageEnabled = imageEnabled
				}
				if imageTimeout, ok := v["image_timeout"].(float64); ok {
					cfg.Desensitize.ImageTimeout = int(imageTimeout)
				}
				if scopes, ok := v["image_scopes"].([]interface{}); ok {
					raw := make([]string, 0, len(scopes))
					for _, it := range scopes {
						if s, ok := it.(string); ok {
							raw = append(raw, s)
						}
					}
					cfg.Desensitize.ImageScopes = sanitizeDesensitizeImageScopes(raw)
				}
			}
		case "scene_describe_ai":
			if v, ok := val.(map[string]interface{}); ok {
				if providerID, ok := v["provider_id"].(string); ok {
					cfg.SceneDescribeAI.ProviderID = providerID
				}
				if model, ok := v["model"].(string); ok {
					cfg.SceneDescribeAI.Model = model
				}
			}
		}
	}
}

// ==================== 连接测试 ====================

// friendlyGatewayError 把 V-Router 网关的常见错误翻译成中文可读提示，
// 指出原因与下一步。返回空串表示非已知模式，沿用原始错误。
func friendlyGatewayError(statusCode int, body string) string {
	switch {
	case statusCode == http.StatusBadRequest && strings.Contains(body, "requires model"):
		return "V-Router 网关要求先选择模型：请点击「设置」拉取模型并添加后重试"
	case statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden:
		return "V-Router 网关鉴权失败：网关开启了 REQUIRE_KEY 或 VOS 账户校验，请检查网关配置或 API Key"
	default:
		return ""
	}
}

// TestConnection 测试指定 provider 的 API 连接。
// providerID 为空时测试当前激活的 provider。
func (s *AIService) TestConnection(providerID string) (map[string]interface{}, error) {
	cfg := s.snapshotCfg()

	// 解析 provider 连接信息
	var apiBase, apiKey, model string
	if providerID != "" {
		p := cfg.FindProvider(providerID)
		if p == nil {
			return map[string]interface{}{
				"success": false,
				"error":   fmt.Sprintf("供应商 %q 不存在", providerID),
			}, fmt.Errorf("供应商 %q 不存在", providerID)
		}
		apiBase, apiKey, model = p.APIBase, p.APIKey, p.DefaultModel()
	} else {
		ap := cfg.ActiveProfile()
		if ap == nil || ap.APIBase == "" || (ap.APIKey == "" && !config.IsKeyFreeProvider(cfg.ActiveProvider, ap.APIBase)) {
			return map[string]interface{}{
				"success": false,
				"error":   "当前激活的供应商未配置 API Base 或 API Key",
			}, fmt.Errorf("未配置")
		}
		apiBase, apiKey, model = ap.APIBase, ap.APIKey, cfg.ActiveModelName()
	}
	// 免 key provider（vrouter / ollama）只需 APIBase；常规 provider 仍需 API Key
	testProvider := providerID
	if testProvider == "" {
		testProvider = cfg.ActiveProvider
	}
	// 错误消息用的显示名（优先配置的 Name，回退 ID）
	label := testProvider
	if p := cfg.FindProvider(testProvider); p != nil && p.Name != "" {
		label = p.Name
	}
	if apiBase == "" || (apiKey == "" && !config.IsKeyFreeProvider(testProvider, apiBase)) {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("供应商 %q 未配置 API Base 或 API Key", label),
		}, fmt.Errorf("供应商 %q 未配置", label)
	}
	// V-Router 网关要求请求体必须带 model：空 model 提前报可读错误，
	// 而不是让网关返回 400 "JSON body requires model"。
	if model == "" {
		errMsg := fmt.Sprintf("供应商 %q 未配置模型，请点击「设置」拉取模型或手动添加后重试", label)
		return map[string]interface{}{"success": false, "error": errMsg}, fmt.Errorf("未配置模型")
	}

	start := time.Now()

	// 直接构建请求，绕过 ChatCompletion 中的 IsEnabled/预算检查
	reqBody := ChatCompletionRequest{
		Model: model,
		Messages: []ChatMessage{
			{Role: "system", Content: "你是一个测试助手。"},
			{Role: "user", Content: "请回复 OK"},
		},
		Temperature: 0.0,
		MaxTokens:   10,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return map[string]interface{}{"success": false, "error": fmt.Sprintf("序列化请求失败: %v", err)}, fmt.Errorf("序列化请求失败: %w", err)
	}

	apiURL := strings.TrimRight(apiBase, "/") + "/chat/completions"
	req, err := http.NewRequest("POST", apiURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return map[string]interface{}{"success": false, "error": fmt.Sprintf("创建请求失败: %v", err)}, fmt.Errorf("创建请求失败: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	// 免 key provider（vrouter 无 key）不发 Authorization 头，避免空值的 "Bearer "。
	// vrouter 对齐 V-ChatCut：有 VOS 登录态时转发 accessToken 做用量归属。
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	} else if testProvider == "vrouter" && config.IsKeyFreeProvider(testProvider, apiBase) {
		if vosToken := LatestVOSAccessToken(); vosToken != "" {
			req.Header.Set("Authorization", "Bearer "+vosToken)
		}
	}

	resp, err := s.client.Do(req)
	latency := time.Since(start).Milliseconds()

	if err != nil {
		s.addErrorLog("connection_test", err, latency)
		return map[string]interface{}{
			"success":    false,
			"error":      fmt.Sprintf("网络请求失败: %v", err),
			"latency_ms": latency,
		}, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		errMsg := fmt.Errorf("读取响应失败: %w", err)
		s.addErrorLog("connection_test", errMsg, latency)
		return map[string]interface{}{
			"success":    false,
			"error":      errMsg.Error(),
			"latency_ms": latency,
		}, errMsg
	}

	if resp.StatusCode != http.StatusOK {
		errMsg := fmt.Errorf("API 返回 HTTP %d: %s", resp.StatusCode, string(respBody))
		// 网关错误的友好翻译：指出原因与下一步（设计验收标准 5）。
		if friendly := friendlyGatewayError(resp.StatusCode, string(respBody)); friendly != "" {
			s.addErrorLog("connection_test", fmt.Errorf("%s（原始: %s）", friendly, string(respBody)), latency)
			return map[string]interface{}{
				"success":    false,
				"error":      friendly,
				"latency_ms": latency,
			}, errMsg
		}
		s.addErrorLog("connection_test", errMsg, latency)
		return map[string]interface{}{
			"success":    false,
			"error":      errMsg.Error(),
			"latency_ms": latency,
		}, errMsg
	}

	var chatResp ChatCompletionResponse
	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		errMsg := fmt.Errorf("解析响应失败: %w", err)
		s.addErrorLog("connection_test", errMsg, latency)
		return map[string]interface{}{
			"success":    false,
			"error":      errMsg.Error(),
			"latency_ms": latency,
		}, errMsg
	}

	result := ""
	if len(chatResp.Choices) > 0 {
		result = strings.TrimSpace(chatResp.Choices[0].Message.Content)
	}

	return map[string]interface{}{
		"success":    true,
		"response":   result,
		"latency_ms": latency,
		"provider":   cfg.ActiveProvider,
		"model":      model,
	}, nil
}

// ==================== 缓存管理 ====================

// ClearCache 清空所有 AI 缓存（包括内存和持久化）
func (s *AIService) ClearCache() int {
	s.cacheMu.Lock()
	count := len(s.cache)
	s.cache = make(map[string]*aiCacheEntry)
	s.cacheMu.Unlock()

	// 清空持久化缓存
	if s.cacheRepo != nil {
		dbCount, _ := s.cacheRepo.ClearAll()
		count += int(dbCount)
	}

	s.logger.Infof("AI 缓存已清空，共清理 %d 条", count)
	return count
}

// GetCacheStats 获取缓存统计（包括持久化层）
func (s *AIService) GetCacheStats() map[string]interface{} {
	s.cacheMu.RLock()
	total := len(s.cache)
	expired := 0
	now := time.Now()
	for _, entry := range s.cache {
		if now.After(entry.ExpiresAt) {
			expired++
		}
	}
	s.cacheMu.RUnlock()

	stats := map[string]interface{}{
		"memory_total":   total,
		"memory_active":  total - expired,
		"memory_expired": expired,
		"ttl_hours":      s.provider.Snapshot().CacheTTLHours,
	}

	// 持久化缓存统计
	if s.cacheRepo != nil {
		dbTotal, _ := s.cacheRepo.Count()
		dbActive, _ := s.cacheRepo.CountActive()
		stats["db_total"] = dbTotal
		stats["db_active"] = dbActive
	}

	return stats
}

// ==================== 错误日志 ====================

// addErrorLog 添加错误日志
func (s *AIService) addErrorLog(action string, err error, latencyMs int64) {
	s.errorMu.Lock()
	defer s.errorMu.Unlock()

	entry := AIErrorLog{
		Time:    time.Now().Format("2006-01-02 15:04:05"),
		Action:  action,
		Error:   err.Error(),
		Latency: latencyMs,
	}

	s.errorLogs = append([]AIErrorLog{entry}, s.errorLogs...)
	if len(s.errorLogs) > 50 {
		s.errorLogs = s.errorLogs[:50]
	}
}

// GetErrorLogs 获取最近的错误日志
func (s *AIService) GetErrorLogs() []AIErrorLog {
	s.errorMu.Lock()
	defer s.errorMu.Unlock()

	result := make([]AIErrorLog, len(s.errorLogs))
	copy(result, s.errorLogs)
	return result
}

// ==================== 功能测试 ====================

// TestSmartSearch 测试智能搜索功能
func (s *AIService) TestSmartSearch(query string) (map[string]interface{}, error) {
	start := time.Now()
	intent, err := s.ParseSearchIntent(query)
	latency := time.Since(start).Milliseconds()

	if err != nil {
		s.addErrorLog("test_smart_search", err, latency)
		return nil, err
	}

	return map[string]interface{}{
		"success":    true,
		"intent":     intent,
		"latency_ms": latency,
	}, nil
}

// TestRecommendReason 测试推荐理由生成
func (s *AIService) TestRecommendReason(title string, genres string) (map[string]interface{}, error) {
	start := time.Now()

	// 构建一个模拟的 media 对象
	mockMedia := &model.Media{
		Title:  title,
		Genres: genres,
		Rating: 8.5,
	}

	reason := s.GenerateRecommendReason(mockMedia, strings.Split(genres, ","), "基于你的观影偏好推荐")
	latency := time.Since(start).Milliseconds()

	return map[string]interface{}{
		"success":    true,
		"reason":     reason,
		"latency_ms": latency,
	}, nil
}
