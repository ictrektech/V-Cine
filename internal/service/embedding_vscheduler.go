package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// vSchedulerProbeTimeout 健康探测的超时：探测走 5s 短超时，避免 V-Scheduler 不可达时
// 健康接口复用自己的 120s 计算超时把 GetHealth 挂死（v-scheduler 官方 poller 同为 5s）。
const vSchedulerProbeTimeout = 5 * time.Second

// vSchedulerMaxBody / vSchedulerMaxModelListBody 响应体上限：超限报明确错误，而非静默截断后
// 报出令人困惑的 JSON 解析失败。
const (
	vSchedulerMaxBody          = 4 << 20 // embedding 向量响应上限 4MiB
	vSchedulerMaxModelListBody = 2 << 20 // /v1/models 列表上限 2MiB
)

// vSchedulerClient 经 V-Scheduler 网关调用 ML Server 的 SigLIP2 模型。
// 协议约束：
//   - 模型名必须用完整限定名，如 ml-server/ViT-B-16-SigLIP2__webli（大小写敏感）
//   - 文本：POST /v1/embeddings（OpenAI 兼容），v-scheduler 内部转 ML Server clip.textual
//   - 图片：POST /v1/ml/predictions（multipart：model + image），响应透传 ML Server，
//     向量在 clip 字段（JSON 数组字符串）
type vSchedulerClient struct {
	baseURL     string        // 已去尾部斜杠，如 http://v-scheduler:8080/v1
	model       string        // ml-server/ViT-B-16-SigLIP2__webli
	apiKey      string        // 可选：REQUIRE_KEY 场景兜底
	vosToken    func() string // 注入的 VOS accessToken 提供者
	desensitize func(string) string
	httpClient  *http.Client

	prober *cachedProber
}

func newVSchedulerClient(
	baseURL string,
	model string,
	apiKey string,
	desensitize func(string) string,
	vosToken func() string,
) *vSchedulerClient {
	// vosToken 依赖注入：生产由工厂绑定 LatestVOSAccessToken；nil 时退回匿名（不发凭证）
	if vosToken == nil {
		vosToken = func() string { return "" }
	}
	c := &vSchedulerClient{
		baseURL:     strings.TrimRight(baseURL, "/"),
		model:       model,
		apiKey:      apiKey,
		vosToken:    vosToken,
		desensitize: desensitize,
		httpClient:  &http.Client{Timeout: 120 * time.Second},
	}
	c.prober = &cachedProber{ttl: probeCacheTTL, do: c.doProbe}
	return c
}

// IsAvailable 检查 embedding 服务是否可用（配置级）
func (c *vSchedulerClient) IsAvailable() bool {
	return c != nil && c.baseURL != "" && c.model != ""
}

// authHeader 凭证策略复用 ai.go 的 resolveCredential：配置 key > VOS 登录 token > 匿名。
// VOS token 通过构造注入（vosToken），生产由工厂绑定 LatestVOSAccessToken。
func (c *vSchedulerClient) authHeader() string {
	if c.apiKey != "" {
		return "Bearer " + c.apiKey
	}
	if t := c.vosToken(); t != "" {
		return "Bearer " + t
	}
	return ""
}

// checkModel 调用前确认模型可用（走探测缓存）；不可用直接返回可读错误
func (c *vSchedulerClient) checkModel(ctx context.Context) error {
	p := c.Probe(ctx)
	if !p.Available {
		return errors.New(p.Error)
	}
	return nil
}

// Probe 查 GET /v1/models 确认模型在列表；TTL 缓存由 cachedProber 统一提供
func (c *vSchedulerClient) Probe(ctx context.Context) EmbeddingProbe {
	return c.prober.Probe(ctx)
}

func (c *vSchedulerClient) doProbe(ctx context.Context) EmbeddingProbe {
	p := EmbeddingProbe{Mode: "vscheduler", Model: c.model}
	// 探测独立短超时：健康接口/调用前检查不应被慢网关挂起 120s（见 vSchedulerProbeTimeout）
	probeCtx, cancel := context.WithTimeout(ctx, vSchedulerProbeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(probeCtx, http.MethodGet, c.baseURL+"/models", nil)
	if err != nil {
		p.Error = err.Error()
		return p
	}
	if h := c.authHeader(); h != "" {
		req.Header.Set("Authorization", h)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		p.Error = "V-Scheduler 不可达：请检查 embedding api_base 配置（v-scheduler 网关是否已部署并可通过该地址访问）"
		return p
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, vSchedulerMaxModelListBody+1))
	if err != nil {
		p.Error = "读取 V-Scheduler 模型列表失败：" + err.Error()
		return p
	}
	if len(body) > vSchedulerMaxModelListBody {
		p.Error = fmt.Sprintf("V-Scheduler 模型列表响应超过 %d 字节上限", vSchedulerMaxModelListBody)
		return p
	}
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		p.Error = "V-Scheduler 鉴权失败：网关开启了 REQUIRE_KEY 或 VOS 账户校验，请在 embedding_ai 配置 api_key 或保持 VOS 登录"
		return p
	case resp.StatusCode < 200 || resp.StatusCode >= 300:
		p.Error = fmt.Sprintf("V-Scheduler 模型列表请求失败：http=%d", resp.StatusCode)
		return p
	}
	var out struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		p.Error = "V-Scheduler 模型列表响应解析失败：" + err.Error()
		return p
	}
	for _, m := range out.Data {
		if m.ID == c.model {
			p.Available = true
			return p
		}
	}
	p.Error = fmt.Sprintf("V-Scheduler 中未发现 %s：请确认 ML Server 已运行且在 V-Scheduler 模型列表中可见", c.model)
	return p
}

// doRequest 公共 HTTP 往返：构造带凭证请求 → 执行 → 限流读取 → 状态码校验。
// 返回上游响应体（调用方负责解析）。
func (c *vSchedulerClient) doRequest(
	ctx context.Context,
	method, path, contentType string,
	body io.Reader,
) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return nil, fmt.Errorf("create v-scheduler request: %w", err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if h := c.authHeader(); h != "" {
		req.Header.Set("Authorization", h)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call v-scheduler API: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, vSchedulerMaxBody+1))
	if err != nil {
		return nil, fmt.Errorf("read v-scheduler response: %w", err)
	}
	if len(respBody) > vSchedulerMaxBody {
		return nil, fmt.Errorf("v-scheduler API 响应超过 %d 字节上限", vSchedulerMaxBody)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// 截断错误 body 到 400 字符：避免上游大量错误输出进日志
		tail := string(respBody)
		if len(tail) > 400 {
			tail = tail[:400]
		}
		return nil, fmt.Errorf("v-scheduler API error: http=%d body=%s", resp.StatusCode, tail)
	}
	return respBody, nil
}

// ComputeTextEmbedding 调用 v-scheduler 标准 OpenAI /v1/embeddings（仅文本）
func (c *vSchedulerClient) ComputeTextEmbedding(ctx context.Context, text string) ([]float64, error) {
	if strings.TrimSpace(text) == "" {
		return nil, fmt.Errorf("text is required")
	}
	if err := c.checkModel(ctx); err != nil {
		return nil, err
	}
	body, err := json.Marshal(map[string]any{
		"model": c.model,
		"input": []string{text},
	})
	if err != nil {
		return nil, fmt.Errorf("marshal embedding request: %w", err)
	}
	respBody, err := c.doRequest(ctx, http.MethodPost, "/embeddings", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	var out struct {
		Data []struct {
			Embedding []float64 `json:"embedding"`
			Index     int       `json:"index"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return nil, fmt.Errorf("decode embedding response: %w", err)
	}
	if len(out.Data) == 0 {
		return nil, fmt.Errorf("embedding API returned empty embeddings")
	}
	vec := out.Data[0].Embedding
	if err := checkEmbeddingDim(vec); err != nil {
		return nil, err
	}
	return vec, nil
}

// ComputeImageEmbedding 读取本地图片文件，经脱敏后以 multipart 上传
// POST /v1/ml/predictions 计算 CLIP 图片向量。
// 脱敏钩子作用在 dataURL 字符串上，这里还原为字节后上传。
func (c *vSchedulerClient) ComputeImageEmbedding(ctx context.Context, imagePath string) ([]float64, error) {
	if strings.TrimSpace(imagePath) == "" {
		return nil, fmt.Errorf("image path is required")
	}
	if err := c.checkModel(ctx); err != nil {
		return nil, err
	}
	imgData, err := os.ReadFile(imagePath)
	if err != nil {
		return nil, fmt.Errorf("read image file: %w", err)
	}
	b64 := base64.StdEncoding.EncodeToString(imgData)
	dataURL := fmt.Sprintf("data:%s;base64,%s", detectVideoAnalysisImageContentType(imagePath), b64)
	if c.desensitize != nil {
		dataURL = c.desensitize(dataURL)
	}
	upload, err := dataURLToBytes(dataURL)
	if err != nil {
		return nil, fmt.Errorf("decode image after desensitize: %w", err)
	}

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if err := mw.WriteField("model", c.model); err != nil {
		return nil, fmt.Errorf("write multipart field: %w", err)
	}
	part, err := mw.CreateFormFile("image", filepath.Base(imagePath))
	if err != nil {
		return nil, fmt.Errorf("create multipart part: %w", err)
	}
	if _, err := part.Write(upload); err != nil {
		return nil, fmt.Errorf("write image to multipart: %w", err)
	}
	// Close 写入结束边界；失败则请求体不完整，必须返回而不是继续
	if err := mw.Close(); err != nil {
		return nil, fmt.Errorf("close multipart body: %w", err)
	}

	respBody, err := c.doRequest(ctx, http.MethodPost, "/ml/predictions", mw.FormDataContentType(), &buf)
	if err != nil {
		return nil, err
	}
	// ML Server /predict 透传响应：{"clip": "[...序列化数组...]", "imageHeight":.., "imageWidth":..}
	var out struct {
		Clip string `json:"clip"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return nil, fmt.Errorf("decode image embedding response: %w", err)
	}
	var vec []float64
	if err := json.Unmarshal([]byte(out.Clip), &vec); err != nil {
		return nil, fmt.Errorf("invalid clip embedding: %w", err)
	}
	if err := checkEmbeddingDim(vec); err != nil {
		return nil, err
	}
	return vec, nil
}
