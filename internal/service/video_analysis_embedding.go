package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"
)

// EmbeddingClient 对接 emb_server，计算图片 CLIP embedding。
// 接口文档：~/workspace/emb_server/API.md
// POST /embed?model={model}  →  {"embeddings": [[...]], "dim": 768}
type EmbeddingClient struct {
	baseURL    string
	model      string
	httpClient *http.Client
}

// NewEmbeddingClient 创建 embedding 客户端
func NewEmbeddingClient(apiBase, model string) (*EmbeddingClient, error) {
	apiBase = strings.TrimRight(strings.TrimSpace(apiBase), "/")
	if apiBase == "" {
		return nil, fmt.Errorf("embedding api_base is required")
	}
	if _, err := url.Parse(apiBase); err != nil {
		return nil, fmt.Errorf("invalid embedding api_base: %w", err)
	}
	if model == "" {
		model = "vit-b-16-siglip2__webli"
	}
	return &EmbeddingClient{
		baseURL:    apiBase,
		model:      model,
		httpClient: &http.Client{Timeout: 120 * time.Second},
	}, nil
}

// imageEmbeddingItem 图片 embedding 请求项（使用 base64 而非路径）
type imageEmbeddingItem struct {
	ImageBase64 string `json:"image_base64"`
}

type imageEmbeddingRequest struct {
	Input     []imageEmbeddingItem `json:"input"`
	Normalize bool                 `json:"normalize"`
}

// ImageEmbeddingResponse 图片 embedding 响应
type ImageEmbeddingResponse struct {
	Embeddings [][]float64 `json:"embeddings"`
	Dim        int         `json:"dim"`
	Model      string      `json:"model"`
	Modality   string      `json:"modality"`
}

// ComputeImageEmbedding 读取本地图片文件，base64 编码后调用 emb_server 计算 CLIP embedding
func (c *EmbeddingClient) ComputeImageEmbedding(ctx context.Context, imagePath string) ([]float64, error) {
	if strings.TrimSpace(imagePath) == "" {
		return nil, fmt.Errorf("image path is required")
	}

	// 读取图片文件
	imgData, err := os.ReadFile(imagePath)
	if err != nil {
		return nil, fmt.Errorf("read image file: %w", err)
	}

	// base64 编码
	b64 := base64.StdEncoding.EncodeToString(imgData)
	dataURL := fmt.Sprintf("data:%s;base64,%s", detectVideoAnalysisImageContentType(imagePath), b64)

	reqBody := imageEmbeddingRequest{
		Input:     []imageEmbeddingItem{{ImageBase64: dataURL}},
		Normalize: true,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("encode embedding request: %w", err)
	}

	u, _ := url.Parse(c.baseURL)
	u.Path = path.Join(u.Path, "/embed")
	q := u.Query()
	q.Set("model", c.model)
	u.RawQuery = q.Encode()

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create embedding request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call embedding API: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20)) // 2MB limit
	if err != nil {
		return nil, fmt.Errorf("read embedding response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("embedding API error: http=%d body=%s", resp.StatusCode, string(respBody))
	}

	var result ImageEmbeddingResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decode embedding response: %w", err)
	}

	if len(result.Embeddings) == 0 {
		return nil, fmt.Errorf("embedding API returned empty embeddings")
	}

	return result.Embeddings[0], nil
}

// IsAvailable 检查 embedding 服务是否可用
func (c *EmbeddingClient) IsAvailable() bool {
	return c != nil && c.baseURL != "" && c.model != ""
}

// detectMimeType 根据文件扩展名推断 MIME 类型

