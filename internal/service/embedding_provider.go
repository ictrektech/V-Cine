package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
)

// clipEmbeddingDim SigLIP2（ViT-B-16-SigLIP2__webli）输出维度。
// DB 场景向量列（Embedding / DescriptionEmbedding）为 768 维 float32。
const clipEmbeddingDim = 768

// defaultVRouterModel embedding 模型默认值（model 留空时兜底）
const defaultVRouterModel = "ml-server/ViT-B-16-SigLIP2__webli"

// probeCacheTTL Probe 探测结果缓存时长（避免每次调用都打 /v1/models）
const probeCacheTTL = 30 * time.Second

// EmbeddingProvider 图片/文本 CLIP 向量计算（同一 CLIP 空间，可跨模态余弦检索）。
//
// Compute* 契约（实现共同遵守，保证可替换）：
//   - 后端不可达 / 模型不在列表 / 请求失败时，一律返回包含可读原因的错误；
//   - 健康展示统一用 Probe，不使用 Compute* 的错误与否做健康判断。
type EmbeddingProvider interface {
	// ComputeImageEmbedding 读取本地图片文件 → CLIP 图片向量（clipEmbeddingDim 维）
	ComputeImageEmbedding(ctx context.Context, imagePath string) ([]float64, error)
	// ComputeTextEmbedding 文本 → CLIP 文本向量（clipEmbeddingDim 维）
	ComputeTextEmbedding(ctx context.Context, text string) ([]float64, error)
	// IsAvailable 配置级可用性：纯内存判断（baseURL/model 非空），热路径零网络开销
	IsAvailable() bool
	// Probe 健康 / 模型可用性探测：查 v-router /v1/models 确认模型在列表中。
	// 结果带短 TTL 缓存，供健康展示与调用前生成明确报错。
	Probe(ctx context.Context) EmbeddingProbe
}

// EmbeddingProbe 各后端统一的健康/可用性视图（供"获取不到就提示"使用）
type EmbeddingProbe struct {
	// Mode 后端类型
	Mode string `json:"mode"`
	// Model 实际请求使用的模型名
	Model string `json:"model"`
	// Available 后端可达且模型可用
	Available bool `json:"available"`
	// Error 用户可读中文提示（Available 为 false 时非空）
	Error string `json:"error,omitempty"`
}

// NewEmbeddingProvider 构造 embedding 后端。
// desensitize 为可选的图片脱敏回调（作用于 dataURL 字符串，见 DesensitizeImageScopeEmbedding）。
func NewEmbeddingProvider(cfg config.EmbeddingAIConfig, desensitize func(string) string) (EmbeddingProvider, error) {
	apiBase := strings.TrimRight(strings.TrimSpace(cfg.APIBase), "/")
	if apiBase == "" {
		return nil, fmt.Errorf("embedding api_base is required")
	}
	if _, err := url.Parse(apiBase); err != nil {
		return nil, fmt.Errorf("invalid embedding api_base: %w", err)
	}
	model := strings.TrimSpace(cfg.Model)
	if model == "" {
		model = defaultVRouterModel
	}
	return newVRouterClient(
		apiBase,
		model,
		strings.TrimSpace(cfg.APIKey),
		desensitize,
		LatestVOSAccessToken,
	), nil
}

// cachedProber 给真实探测结果加 TTL 缓存；后端实现只提供 do（真实探测逻辑），不关心缓存。
type cachedProber struct {
	mu      sync.Mutex
	probe   EmbeddingProbe
	probeAt time.Time
	ttl     time.Duration
	do      func(ctx context.Context) EmbeddingProbe
}

// Probe 返回缓存的探测结果；超过 TTL 时调用 do 重新探测。
func (p *cachedProber) Probe(ctx context.Context) EmbeddingProbe {
	p.mu.Lock()
	if time.Since(p.probeAt) < p.ttl {
		res := p.probe
		p.mu.Unlock()
		return res
	}
	p.mu.Unlock()

	res := p.do(ctx)
	p.mu.Lock()
	p.probe, p.probeAt = res, time.Now()
	p.mu.Unlock()
	return res
}

// dataURLToBytes 把 dataURL（data:<mime>;base64,<data>）还原为字节；
// 兼容脱敏服务可能返回的纯 base64（无 "data:" 前缀 / 无逗号）形态。
func dataURLToBytes(dataURL string) ([]byte, error) {
	s := strings.TrimSpace(dataURL)
	if i := strings.Index(s, ","); i >= 0 && strings.HasPrefix(s, "data:") {
		s = s[i+1:]
	}
	return base64.StdEncoding.DecodeString(s)
}

// checkEmbeddingDim 校验向量维度与数据库列一致
func checkEmbeddingDim(vec []float64) error {
	if len(vec) != clipEmbeddingDim {
		return fmt.Errorf("embedding 维度异常：got=%d want=%d", len(vec), clipEmbeddingDim)
	}
	return nil
}
