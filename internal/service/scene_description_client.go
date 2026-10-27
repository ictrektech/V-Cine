package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"go.uber.org/zap"
)

// SceneDescriptionClient 单张场景九宫格图片 → 自然语言场景描述。
//
// 实现约定：
//   - 成功返回非空描述文本（调用方负责 TrimSpace 校验）；
//   - 失败返回 error，可重试性由 sceneDescribeError 承载（不可重试的失败必须
//     包装成 *sceneDescribeError 且 Retryable=false）。
type SceneDescriptionClient interface {
	DescribeImage(ctx context.Context, imagePath string) (string, error)
}

const (
	// sceneDescribeMaxBody 单次视觉调用响应体上限：超限报明确错误而非静默截断。
	sceneDescribeMaxBody = 4 << 20
	// sceneDescribeMaxAttempts 单场景总尝试次数：首次 + 1 次重试（含 400 字段降级）。
	sceneDescribeMaxAttempts = 2
	// sceneDescribeEscalatedMaxTokens 预算被思维链烧穿（finish_reason=length 且 content 为空）时的重试预算。
	sceneDescribeEscalatedMaxTokens = 2048
	// sceneDescribeHTTPTimeout 单次 HTTP 往返上限；单场景超时由扇出层另行控制。
	sceneDescribeHTTPTimeout = 120 * time.Second
	// sceneDescribeMaxTokens 场景描述输出上限。
	sceneDescribeMaxTokens = 512
	// sceneDescribeTemperature 低温度。
	sceneDescribeTemperature = 0.2

	sceneDescribeSystemPrompt = "你是视频场景描述助手。只描述画面中确实可见的内容，" +
		"不要推测剧情、人物身份、台词或镜头外的信息。"
	sceneDescribeUserPrompt = "这张图是一个视频场景的九宫格拼图（按从左到右、从上到下顺序采样同一场景）。" +
		"请用一到两句中文客观描述该场景：地点环境、主要对象、正在发生的动作与整体氛围。"
)

// openAIVisionConfig 构造 OpenAI 兼容视觉客户端的配置。
type openAIVisionConfig struct {
	// BaseURL 供应商 API 根地址（可带 /v1 后缀，客户端统一去掉尾部斜杠）。
	BaseURL string
	Model   string
	APIKey  string
	// ProviderID 仅用于网关判定（凭证策略与错误文案），不参与请求。
	ProviderID string
	// Desensitize 可选图片脱敏回调（作用于 dataURL 字符串）。
	Desensitize func(dataURL string) string
	// Logger 可选：注入后传输层会记录重试/降级日志。
	Logger *zap.SugaredLogger
}

// openAIVisionClient 通过 OpenAI 兼容的 /chat/completions 视觉接口生成场景描述。
type openAIVisionClient struct {
	baseURL     string
	model       string
	apiKey      string
	isGateway   bool
	desensitize func(dataURL string) string
	httpClient  *http.Client
	logger      *zap.SugaredLogger
}

// newOpenAIVisionClient 构造视觉客户端；baseURL/model 缺失时返回 nil（调用方据此回退远端路径）。
func newOpenAIVisionClient(cfg openAIVisionConfig) *openAIVisionClient {
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	model := strings.TrimSpace(cfg.Model)
	if baseURL == "" || model == "" {
		return nil
	}
	return &openAIVisionClient{
		baseURL:     baseURL,
		model:       model,
		apiKey:      strings.TrimSpace(cfg.APIKey),
		isGateway:   config.IsVSchedulerGateway(cfg.ProviderID, baseURL),
		desensitize: cfg.Desensitize,
		httpClient:  &http.Client{Timeout: sceneDescribeHTTPTimeout},
		logger:      cfg.Logger,
	}
}

// authHeader 凭证策略：配置 key > VOS 登录 token（仅网关） > 匿名（不发 Authorization 头）。
func (c *openAIVisionClient) authHeader() string {
	if c.apiKey != "" {
		return "Bearer " + c.apiKey
	}
	if c.isGateway {
		if t := LatestVOSAccessToken(); t != "" {
			return "Bearer " + t
		}
	}
	return ""
}

// DescribeImage 读取本地九宫格图片 → dataURL（可选脱敏）→ 视觉模型 → 描述文本。
func (c *openAIVisionClient) DescribeImage(ctx context.Context, imagePath string) (string, error) {
	imagePath = strings.TrimSpace(imagePath)
	if imagePath == "" {
		return "", errors.New("scene description: image path is required")
	}
	dataURL, err := sceneDescriptionImageDataURL(imagePath, c.desensitize)
	if err != nil {
		return "", err
	}

	budgets := []int{sceneDescribeMaxTokens, sceneDescribeEscalatedMaxTokens}
	var emptyErr error
	// 网关 400 拒绝过 reasoning_effort 后，后续预算尝试不再重复发送该字段。
	reasoningUnsupported := false
	for index, maxTokens := range budgets {
		request := openAIVisionRequest{
			Model: c.model,
			Messages: []openAIVisionMessage{
				{Role: "system", Content: []openAIVisionContentPart{{Type: "text", Text: sceneDescribeSystemPrompt}}},
				{Role: "user", Content: []openAIVisionContentPart{
					{Type: "text", Text: sceneDescribeUserPrompt},
					{Type: "image_url", ImageURL: &openAIVisionImageURL{URL: dataURL}},
				}},
			},
			Temperature: sceneDescribeTemperature,
			MaxTokens:   maxTokens,
		}
		if !reasoningUnsupported {
			request.ReasoningEffort = ReasoningEffortNone
		}

		respBody, statusCode, stripped, err := c.doDescribeRequest(ctx, request)
		if stripped {
			reasoningUnsupported = true
		}
		if err != nil {
			return "", err
		}
		if statusCode < 200 || statusCode >= 300 {
			return "", classifySceneDescribeStatus(c.isGateway, c.apiKey != "", statusCode, respBody, c.model)
		}

		var out openAIVisionResponse
		if err := json.Unmarshal(respBody, &out); err != nil {
			return "", &sceneDescribeError{
				Message: "场景描述响应解析失败：" + err.Error(),
				Detail:  describeRawBody(respBody),
				Err:     err,
			}
		}
		if len(out.Choices) == 0 {
			return "", &sceneDescribeError{Message: "场景描述响应缺少 choices", Detail: describeUpstreamDetail(out, respBody)}
		}
		desc := strings.TrimSpace(out.Choices[0].Message.Content)
		if desc != "" {
			return desc, nil
		}
		// 空描述不能只报“返回空内容”：上游 finish_reason / usage / 错误体放进 Detail。
		// requested_max_tokens 记录本次实际请求的预算。
		emptyErr = &sceneDescribeError{
			Retryable: true,
			Message:   "场景描述模型返回空内容",
			Detail:    fmt.Sprintf("requested_max_tokens=%d, %s", maxTokens, describeUpstreamDetail(out, respBody)),
		}
		// 仅“预算被思考烧穿”（length）值得加预算重试；内容过滤等其他空返回直接失败。
		if out.Choices[0].FinishReason != "length" {
			return "", emptyErr
		}
		if c.logger != nil && index+1 < len(budgets) {
			c.logger.Warnw("Scene description hit max_tokens, retrying with larger budget",
				"model", c.model, "max_tokens", maxTokens, "next_max_tokens", budgets[index+1])
		}
	}
	return "", emptyErr
}

// doDescribeRequest 发送视觉请求：复用统一传输层（重试/退避/400 降级/日志）。
// 后端 400 且明确拒绝 reasoning_effort（或响应体为空无法判断）时，剥离该字段重试一次。
// 返回值 stripped 表示本次调用因 400 剥离过 reasoning_effort。
func (c *openAIVisionClient) doDescribeRequest(ctx context.Context, request openAIVisionRequest) ([]byte, int, bool, error) {
	stripped := false
	// 请求体含 base64 图片（数 MB）：序列化一次后复用，只有 400 降级改了字段才重建。
	var bodyCache []byte
	resp, err := doChatTransport(ctx, c.httpClient, chatTransportRequest{
		URL:           c.baseURL + "/chat/completions",
		Authorization: c.authHeader(),
		MaxAttempts:   sceneDescribeMaxAttempts,
		MaxBody:       sceneDescribeMaxBody,
		BuildBody: func() ([]byte, error) {
			if bodyCache != nil {
				return bodyCache, nil
			}
			body, err := json.Marshal(request)
			if err != nil {
				return nil, fmt.Errorf("scene description: marshal request: %w", err)
			}
			bodyCache = body
			return body, nil
		},
		OnClientError: func(_ int, body []byte) bool {
			if request.ReasoningEffort == "" || !rejectsRequestField(body, "reasoning_effort") {
				return false
			}
			request.ReasoningEffort = ""
			bodyCache = nil
			stripped = true
			return true
		},
		NewNetworkError: func(err error) error {
			return &sceneDescribeError{Retryable: true, Message: "场景描述模型不可达：" + err.Error(), Err: err}
		},
		NewReadError: func(err error) error {
			return &sceneDescribeError{Retryable: true, Message: "读取场景描述响应失败：" + err.Error(), Err: err}
		},
		Logger:    c.logger,
		LogFields: []any{"model", c.model},
	})
	if err != nil {
		var limitErr *chatTransportBodyLimitError
		if errors.As(err, &limitErr) {
			return nil, 0, stripped, &sceneDescribeError{
				Message: fmt.Sprintf("场景描述响应超过 %d 字节上限", limitErr.Limit),
			}
		}
		// 400 降级用尽了重试次数：传输层返回的是上游状态错误，必须按状态码与响应体分类。
		var statusErr *chatTransportStatusError
		if errors.As(err, &statusErr) {
			return nil, 0, stripped, classifySceneDescribeStatus(c.isGateway, c.apiKey != "", statusErr.StatusCode, statusErr.Body, c.model)
		}
		var describeErr *sceneDescribeError
		if errors.As(err, &describeErr) {
			return nil, 0, stripped, err
		}
		// 上下文取消等非上游错误：包成可重试。
		return nil, 0, stripped, &sceneDescribeError{Retryable: true, Message: "场景描述请求中断：" + err.Error(), Err: err}
	}
	return resp.Body, resp.StatusCode, stripped, nil
}

// describeUpstreamDetail 汇总上游响应中排查失败所需的信息（错误体、模型、结束原因、用量、原始响应）。
func describeUpstreamDetail(out openAIVisionResponse, body []byte) string {
	parts := make([]string, 0, 2)
	if errMessage := strings.TrimSpace(openAIVisionErrorMessage(out.Error)); errMessage != "" {
		parts = append(parts, "上游错误："+errMessage)
	}
	if diagnostics := describeResponseDiagnostics(out); diagnostics != "" {
		parts = append(parts, diagnostics)
	}
	detail := strings.Join(parts, "；")
	if raw := describeRawBody(body); raw != "" {
		if detail != "" {
			detail += "\n"
		}
		detail += raw
	}
	return detail
}

// describeRawBody 上游响应原文（单行、限长），便于直接定位返回内容。
func describeRawBody(body []byte) string {
	snippet := sceneDescribeBodySnippet(body, 300)
	if snippet == "" {
		return ""
	}
	return "raw=" + snippet
}

// describeResponseDiagnostics 提取 OpenAI 兼容响应中的关键诊断字段。
func describeResponseDiagnostics(out openAIVisionResponse) string {
	parts := make([]string, 0, 6)
	if out.Model != "" {
		parts = append(parts, "model="+out.Model)
	}
	if out.ID != "" {
		parts = append(parts, "response_id="+out.ID)
	}
	if len(out.Choices) > 0 {
		choice := out.Choices[0]
		if finishReason := strings.TrimSpace(choice.FinishReason); finishReason != "" {
			parts = append(parts, "finish_reason="+finishReason)
		}
		reasoning := strings.TrimSpace(choice.Message.ReasoningContent)
		if reasoning == "" {
			reasoning = strings.TrimSpace(choice.Message.Reasoning)
		}
		if reasoning != "" {
			parts = append(parts, "reasoning="+truncateSceneDescribeText(reasoning, 120))
		}
		if refusal := strings.TrimSpace(choice.Message.Refusal); refusal != "" {
			parts = append(parts, "refusal="+truncateSceneDescribeText(refusal, 120))
		}
	}
	usage := out.Usage
	if usage.PromptTokens > 0 || usage.CompletionTokens > 0 || usage.TotalTokens > 0 {
		parts = append(parts, fmt.Sprintf("usage=prompt:%d,completion:%d,total:%d", usage.PromptTokens, usage.CompletionTokens, usage.TotalTokens))
	}
	return strings.Join(parts, ", ")
}

// openAIVisionErrorMessage 取出上游 error 对象的可读信息（部分网关 200 也返回 error）。
func openAIVisionErrorMessage(err *openAIVisionError) string {
	if err == nil {
		return ""
	}
	message := strings.TrimSpace(err.Message)
	if message == "" {
		message = strings.TrimSpace(err.Type)
	}
	if message == "" && err.Code != nil {
		message = strings.TrimSpace(fmt.Sprint(err.Code))
	}
	return message
}

// sceneDescribeBodySnippet 把响应体压成单行并限长。
func sceneDescribeBodySnippet(body []byte, limit int) string {
	text := strings.Join(strings.Fields(string(body)), " ")
	return truncateSceneDescribeText(text, limit)
}

// truncateSceneDescribeText 按字符（rune）截断。
func truncateSceneDescribeText(text string, limit int) string {
	if limit <= 0 {
		return text
	}
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit]) + "…"
}

// sceneDescriptionImageDataURL 读取图片并编码为 dataURL，按需先做图片脱敏。
// 脱敏回调可能返回 dataURL 或裸 base64，统一归一化为 dataURL。
func sceneDescriptionImageDataURL(imagePath string, desensitize func(string) string) (string, error) {
	raw, err := os.ReadFile(imagePath)
	if err != nil {
		return "", fmt.Errorf("scene description: read grid image: %w", err)
	}
	if len(raw) == 0 {
		return "", fmt.Errorf("scene description: grid image is empty: %s", imagePath)
	}
	contentType := detectVideoAnalysisImageContentType(imagePath)
	dataURL := fmt.Sprintf("data:%s;base64,%s", contentType, base64.StdEncoding.EncodeToString(raw))
	if desensitize == nil {
		return dataURL, nil
	}
	masked := strings.TrimSpace(desensitize(dataURL))
	if masked == "" {
		return dataURL, nil
	}
	if strings.HasPrefix(masked, "data:") {
		return masked, nil
	}
	// 裸 base64：去掉可能残留的换行后重建 dataURL。
	return fmt.Sprintf("data:%s;base64,%s", contentType, strings.ReplaceAll(masked, "\n", "")), nil
}

// classifySceneDescribeStatus 把上游 HTTP 失败翻译成可读原因并标记可重试性。
// 400/401/403/404/422 标记为不可重试，429/5xx 标记为可重试。
// model 是本次请求的模型名：网关 404 不回显 model id，只有调用方知道自己请求了什么，
// 命中"模型缺失"时带上它，上层才能定位到具体模型。
func classifySceneDescribeStatus(isGateway, hasKey bool, status int, body []byte, model string) error {
	tail := strings.TrimSpace(string(body))
	tail = truncateSceneDescribeText(tail, 400)
	message := friendlyProviderError(isGateway, hasKey, status, tail)
	if message == "" {
		message = fmt.Sprintf("场景描述请求失败：http=%d", status)
	}
	if tail != "" {
		// 附带上游响应原文。
		message = message + " | " + tail
	}
	missingModel := ""
	if status == http.StatusNotFound && mentionsMissingModel(body) {
		missingModel = strings.TrimSpace(model)
	}
	return &sceneDescribeError{
		Retryable:    status == http.StatusRequestTimeout || status == http.StatusTooManyRequests || status >= 500,
		Message:      message,
		MissingModel: missingModel,
	}
}

// mentionsMissingModel 识别网关"模型不存在"的 404：V-Scheduler 回
// {"code":"NOT_FOUND","msg":"unknown model or upstream"}，旧格式为 unknown model: model-hub/<name>。
func mentionsMissingModel(body []byte) bool {
	text := strings.ToLower(string(body))
	return strings.Contains(text, "unknown model") || strings.Contains(text, "not_found")
}

// sceneDescribeError 场景描述调用失败。
// Retryable=false 表示配置/输入层面的确定性失败，扇出应立即中止而不是逐个重试。
// Message 面向用户的简短原因；Detail 保存上游原始诊断，供结果明细与日志排查。
// MissingModel 非空表示失败原因是该模型未在网关注册（网关不回显 model id，由调用方补上）。
type sceneDescribeError struct {
	Retryable    bool
	Message      string
	Detail       string
	MissingModel string
	Err          error
}

func (e *sceneDescribeError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func (e *sceneDescribeError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

// ==================== OpenAI 兼容视觉接口数据结构 ====================

type openAIVisionContentPart struct {
	Type     string                `json:"type"`
	Text     string                `json:"text,omitempty"`
	ImageURL *openAIVisionImageURL `json:"image_url,omitempty"`
}

type openAIVisionImageURL struct {
	URL string `json:"url"`
}

type openAIVisionMessage struct {
	Role    string                    `json:"role"`
	Content []openAIVisionContentPart `json:"content"`
}

type openAIVisionRequest struct {
	Model       string                `json:"model"`
	Messages    []openAIVisionMessage `json:"messages"`
	Temperature float64               `json:"temperature,omitempty"`
	MaxTokens   int                   `json:"max_tokens,omitempty"`
	// ReasoningEffort 思考控制：none 关闭思考。
	ReasoningEffort string `json:"reasoning_effort,omitempty"`
}

type openAIVisionResponse struct {
	ID      string               `json:"id"`
	Model   string               `json:"model"`
	Error   *openAIVisionError   `json:"error"`
	Choices []openAIVisionChoice `json:"choices"`
	Usage   openAIVisionUsage    `json:"usage"`
}

// openAIVisionError 上游错误对象（OpenAI 兼容网关通用结构）。
type openAIVisionError struct {
	Message string `json:"message"`
	Type    string `json:"type"`
	Code    any    `json:"code"`
}

type openAIVisionChoice struct {
	FinishReason string            `json:"finish_reason"`
	Message      openAIVisionReply `json:"message"`
}

type openAIVisionReply struct {
	Content string `json:"content"`
	// ReasoningContent/Reasoning：推理模型把思考过程放在这里，content 可能为空。
	ReasoningContent string `json:"reasoning_content"`
	Reasoning        string `json:"reasoning"`
	Refusal          string `json:"refusal"`
}

type openAIVisionUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}
