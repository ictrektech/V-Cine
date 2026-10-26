package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
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
	// sceneDescribeHTTPTimeout 单次 HTTP 往返上限；单场景超时由扇出层另行控制。
	sceneDescribeHTTPTimeout = 120 * time.Second
	// sceneDescribeMaxTokens 场景描述输出上限（一到两句话足够）。
	sceneDescribeMaxTokens = 512
	// sceneDescribeTemperature 低温度：场景描述要求客观稳定，避免发散。
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
}

// openAIVisionClient 通过 OpenAI 兼容的 /chat/completions 视觉接口生成场景描述。
type openAIVisionClient struct {
	baseURL     string
	model       string
	apiKey      string
	isGateway   bool
	desensitize func(dataURL string) string
	httpClient  *http.Client
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
		isGateway:   config.IsVRouterGateway(cfg.ProviderID, baseURL),
		desensitize: cfg.Desensitize,
		httpClient:  &http.Client{Timeout: sceneDescribeHTTPTimeout},
	}
}

// authHeader 凭证策略与 ai.go 的 resolveCredential 一致：
// 配置 key > VOS 登录 token（仅网关） > 匿名（不发 Authorization 头）。
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

	body, err := json.Marshal(openAIVisionRequest{
		Model: c.model,
		Messages: []openAIVisionMessage{
			{Role: "system", Content: []openAIVisionContentPart{{Type: "text", Text: sceneDescribeSystemPrompt}}},
			{Role: "user", Content: []openAIVisionContentPart{
				{Type: "text", Text: sceneDescribeUserPrompt},
				{Type: "image_url", ImageURL: &openAIVisionImageURL{URL: dataURL}},
			}},
		},
		Temperature: sceneDescribeTemperature,
		MaxTokens:   sceneDescribeMaxTokens,
	})
	if err != nil {
		return "", fmt.Errorf("scene description: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("scene description: create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	authorization := c.authHeader()
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", &sceneDescribeError{Retryable: true, Message: "场景描述模型不可达：" + err.Error(), Err: err}
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, sceneDescribeMaxBody+1))
	if err != nil {
		return "", &sceneDescribeError{Retryable: true, Message: "读取场景描述响应失败：" + err.Error(), Err: err}
	}
	if len(respBody) > sceneDescribeMaxBody {
		return "", &sceneDescribeError{
			Message: fmt.Sprintf("场景描述响应超过 %d 字节上限", sceneDescribeMaxBody),
		}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", classifySceneDescribeStatus(c.isGateway, c.apiKey != "", resp.StatusCode, respBody)
	}

	var out openAIVisionResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		return "", &sceneDescribeError{Message: "场景描述响应解析失败：" + err.Error(), Err: err}
	}
	if len(out.Choices) == 0 {
		return "", &sceneDescribeError{Message: "场景描述响应缺少 choices"}
	}
	desc := strings.TrimSpace(out.Choices[0].Message.Content)
	if desc == "" {
		return "", &sceneDescribeError{Retryable: true, Message: "场景描述模型返回空内容"}
	}
	return desc, nil
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
func classifySceneDescribeStatus(isGateway, hasKey bool, status int, body []byte) error {
	tail := strings.TrimSpace(string(body))
	if len(tail) > 400 {
		tail = tail[:400]
	}
	message := friendlyProviderError(isGateway, hasKey, status, tail)
	if message == "" {
		message = fmt.Sprintf("场景描述请求失败：http=%d", status)
	}
	if tail != "" {
		// 附带上游响应原文，供 extractMissingModel 识别缺失模型名。
		message = message + " | " + tail
	}
	return &sceneDescribeError{
		Retryable: status == http.StatusRequestTimeout || status == http.StatusTooManyRequests || status >= 500,
		Message:   message,
	}
}

// sceneDescribeError 场景描述调用失败。
// Retryable=false 表示配置/输入层面的确定性失败，扇出应立即中止而不是逐个重试。
type sceneDescribeError struct {
	Retryable bool
	Message   string
	Err       error
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
}

type openAIVisionResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}
