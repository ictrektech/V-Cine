package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
)

// vschedulerTestVec 构造 dim 维测试向量（第 pos 维 = 1，其余 0）
func vschedulerTestVec(pos int) []float64 {
	vec := make([]float64, clipEmbeddingDim)
	vec[pos] = 1
	return vec
}

// fakeVScheduler 记录最后一次请求的 model / 文本 / 图片字节，
// 并统计 /models 被调用次数。
type fakeVScheduler struct {
	modelsCalls int32
	lastModel   string
	lastText    string
	lastImage   []byte
}

// newFakeVScheduler 起一个假 v-scheduler：/models 返回 models 列表，/embeddings 返回 queryVec，
// /ml/predictions 解析 multipart 并返回 clip 字符串向量。
func newFakeVScheduler(t *testing.T, models []string, queryVec []float64) (*httptest.Server, *fakeVScheduler) {
	t.Helper()
	f := &fakeVScheduler{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			atomic.AddInt32(&f.modelsCalls, 1)
			data := make([]map[string]string, 0, len(models))
			for _, m := range models {
				data = append(data, map[string]string{"id": m, "object": "model"})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": data})
		case "/v1/embeddings":
			var in struct {
				Model string   `json:"model"`
				Input []string `json:"input"`
			}
			_ = json.NewDecoder(r.Body).Decode(&in)
			f.lastModel = in.Model
			if len(in.Input) > 0 {
				f.lastText = in.Input[0]
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"object": "list",
				"data":   []map[string]any{{"object": "embedding", "embedding": queryVec, "index": 0}},
				"model":  in.Model,
			})
		case "/v1/ml/predictions":
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Errorf("parse multipart: %v", err)
			}
			f.lastModel = r.FormValue("model")
			if file, _, err := r.FormFile("image"); err == nil {
				f.lastImage, _ = io.ReadAll(file)
				_ = file.Close()
			}
			clip, _ := json.Marshal(queryVec)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"clip": string(clip), "imageHeight": 224, "imageWidth": 224,
			})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, f
}

func TestVSchedulerClientComputeTextEmbedding(t *testing.T) {
	srv, f := newFakeVScheduler(t, []string{"ml-server/ViT-B-16-SigLIP2__webli"}, vschedulerTestVec(0))
	c := newVSchedulerClient(
		srv.URL+"/v1",
		"ml-server/ViT-B-16-SigLIP2__webli",
		"",
		nil,
		nil,
	)

	got, err := c.ComputeTextEmbedding(context.Background(), "海边日落")
	if err != nil {
		t.Fatalf("ComputeTextEmbedding: %v", err)
	}
	if len(got) != clipEmbeddingDim || got[0] != 1 {
		t.Fatalf("unexpected vector: len=%d first=%v", len(got), got[0])
	}
	if f.lastModel != "ml-server/ViT-B-16-SigLIP2__webli" {
		t.Fatalf("sent model = %q", f.lastModel)
	}
	if f.lastText != "海边日落" {
		t.Fatalf("sent text = %q", f.lastText)
	}
	if atomic.LoadInt32(&f.modelsCalls) != 1 {
		t.Fatalf("expected one /models probe, got %d", atomic.LoadInt32(&f.modelsCalls))
	}
}

func TestVSchedulerClientComputeImageEmbedding(t *testing.T) {
	imgBytes := []byte("fake-image-content")
	srv, f := newFakeVScheduler(t, []string{"ml-server/ViT-B-16-SigLIP2__webli"}, vschedulerTestVec(2))
	var desensitized string
	// 脱敏回调返回纯 base64（真实脱敏服务返回 image_base64 裸串形态）→ 验证 dataURLToBytes 容错
	c := newVSchedulerClient(
		srv.URL+"/v1",
		"ml-server/ViT-B-16-SigLIP2__webli",
		"",
		func(dataURL string) string {
			desensitized = dataURL
			return dataURL[strings.Index(dataURL, ",")+1:]
		},
		nil,
	)

	dir := t.TempDir()
	imgPath := filepath.Join(dir, "shot.jpg")
	if err := os.WriteFile(imgPath, imgBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := c.ComputeImageEmbedding(context.Background(), imgPath)
	if err != nil {
		t.Fatalf("ComputeImageEmbedding: %v", err)
	}
	if len(got) != clipEmbeddingDim || got[2] != 1 {
		t.Fatalf("unexpected vector: len=%d third=%v", len(got), got[2])
	}
	if !strings.HasPrefix(desensitized, "data:image/jpeg;base64,") {
		t.Fatalf("desensitize did not receive dataURL, got %q", desensitized)
	}
	if f.lastModel != "ml-server/ViT-B-16-SigLIP2__webli" {
		t.Fatalf("sent model = %q", f.lastModel)
	}
	if !bytes.Equal(f.lastImage, imgBytes) {
		t.Fatalf("uploaded image bytes mismatch: got %d want %d", len(f.lastImage), len(imgBytes))
	}
}

func TestVSchedulerClientProbeModelMissing(t *testing.T) {
	srv, _ := newFakeVScheduler(t, []string{"ml-server/qwen3-embedding-0.6b"}, vschedulerTestVec(0))
	c := newVSchedulerClient(
		srv.URL+"/v1",
		"ml-server/ViT-B-16-SigLIP2__webli",
		"",
		nil,
		nil,
	)

	p := c.Probe(context.Background())
	if p.Available {
		t.Fatal("expected model missing")
	}
	if !strings.Contains(p.Error, "未发现") || !strings.Contains(p.Error, "ml-server/ViT-B-16-SigLIP2__webli") {
		t.Fatalf("unexpected probe error: %q", p.Error)
	}
	if _, err := c.ComputeTextEmbedding(context.Background(), "q"); err == nil || !strings.Contains(err.Error(), "未发现") {
		t.Fatalf("compute should surface model-missing error, got %v", err)
	}
}

func TestVSchedulerClientProbeUnreachable(t *testing.T) {
	c := newVSchedulerClient(
		"http://127.0.0.1:1/v1",
		"ml-server/ViT-B-16-SigLIP2__webli",
		"",
		nil,
		nil,
	)
	p := c.Probe(context.Background())
	if p.Available {
		t.Fatal("expected unreachable")
	}
	if !strings.Contains(p.Error, "不可达") {
		t.Fatalf("unexpected probe error: %q", p.Error)
	}
}

func TestVSchedulerClientProbeCache(t *testing.T) {
	srv, f := newFakeVScheduler(t, []string{"ml-server/ViT-B-16-SigLIP2__webli"}, vschedulerTestVec(0))
	c := newVSchedulerClient(
		srv.URL+"/v1",
		"ml-server/ViT-B-16-SigLIP2__webli",
		"",
		nil,
		nil,
	)
	ctx := context.Background()

	_ = c.Probe(ctx)
	_ = c.Probe(ctx) // TTL 内命中缓存
	if atomic.LoadInt32(&f.modelsCalls) != 1 {
		t.Fatalf("probe should hit cache within TTL, /models calls=%d", atomic.LoadInt32(&f.modelsCalls))
	}
	// 过期后重新探测
	c.prober.mu.Lock()
	c.prober.probeAt = time.Now().Add(-probeCacheTTL - time.Second)
	c.prober.mu.Unlock()
	_ = c.Probe(ctx)
	if atomic.LoadInt32(&f.modelsCalls) != 2 {
		t.Fatalf("probe should re-check after TTL, /models calls=%d", atomic.LoadInt32(&f.modelsCalls))
	}
}

func TestVSchedulerClientDimensionMismatch(t *testing.T) {
	vec := make([]float64, 3)
	srv, _ := newFakeVScheduler(t, []string{"ml-server/ViT-B-16-SigLIP2__webli"}, vec)
	c := newVSchedulerClient(
		srv.URL+"/v1",
		"ml-server/ViT-B-16-SigLIP2__webli",
		"",
		nil,
		nil,
	)
	if _, err := c.ComputeTextEmbedding(context.Background(), "q"); err == nil || !strings.Contains(err.Error(), "维度") {
		t.Fatalf("expected dimension error, got %v", err)
	}
}

func TestVSchedulerClientAuthHeader(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/models" {
			gotAuth = r.Header.Get("Authorization")
			_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": []map[string]string{{"id": "ml-server/ViT-B-16-SigLIP2__webli"}}})
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	c := newVSchedulerClient(
		srv.URL+"/v1",
		"ml-server/ViT-B-16-SigLIP2__webli",
		"sk-gateway-key",
		nil,
		nil,
	)
	_ = c.Probe(context.Background())
	if gotAuth != "Bearer sk-gateway-key" {
		t.Fatalf("auth header = %q", gotAuth)
	}
}

// TestVSchedulerClientVOSTokenInjection 验证凭证源是注入的（依赖抽象而非全局单例）：
// 未配 api_key 时转发注入的 VOS token。
func TestVSchedulerClientVOSTokenInjection(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/models" {
			gotAuth = r.Header.Get("Authorization")
			_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": []map[string]string{{"id": "ml-server/ViT-B-16-SigLIP2__webli"}}})
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	c := newVSchedulerClient(
		srv.URL+"/v1",
		"ml-server/ViT-B-16-SigLIP2__webli",
		"",
		nil,
		func() string { return "vos-access-token" },
	)
	_ = c.Probe(context.Background())
	if gotAuth != "Bearer vos-access-token" {
		t.Fatalf("auth header = %q", gotAuth)
	}
}

func TestNewEmbeddingProvider(t *testing.T) {
	// 合法配置 → vSchedulerClient
	p1, err := NewEmbeddingProvider(config.EmbeddingAIConfig{APIBase: "http://v-scheduler:8080/v1", Model: "ml-server/ViT-B-16-SigLIP2__webli"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := p1.(*vSchedulerClient); !ok {
		t.Fatalf("expected vSchedulerClient, got %T", p1)
	}
	// model 留空 → 兜底默认模型
	p2, err := NewEmbeddingProvider(config.EmbeddingAIConfig{APIBase: "http://v-scheduler:8080/v1"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if vr, ok := p2.(*vSchedulerClient); !ok || vr.model != defaultVSchedulerModel {
		t.Fatalf("default model = %q, want %q", vr.model, defaultVSchedulerModel)
	}
	// 空 api_base 报错（地址即开关）
	if _, err := NewEmbeddingProvider(config.EmbeddingAIConfig{}, nil); err == nil {
		t.Fatal("empty api_base should error")
	}
}

func TestDataURLToBytes(t *testing.T) {
	raw := []byte{1, 2, 3}
	b64 := base64.StdEncoding.EncodeToString(raw)
	got, err := dataURLToBytes("data:image/png;base64," + b64)
	if err != nil || !bytes.Equal(got, raw) {
		t.Fatalf("dataURL decode: %v, %v", got, err)
	}
	got, err = dataURLToBytes(b64) // 脱敏服务返回的裸 base64
	if err != nil || !bytes.Equal(got, raw) {
		t.Fatalf("bare base64 decode: %v, %v", got, err)
	}
}

// TestVSchedulerClientResponseTooLarge 响应超过上限时报明确错误，而不是静默截断后报 JSON 解析失败
func TestVSchedulerClientResponseTooLarge(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": []map[string]string{{"id": "ml-server/ViT-B-16-SigLIP2__webli"}}})
		case "/v1/embeddings":
			_, _ = w.Write(bytes.Repeat([]byte("a"), vSchedulerMaxBody+1)) // 超过 4MiB 上限
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	c := newVSchedulerClient(
		srv.URL+"/v1",
		"ml-server/ViT-B-16-SigLIP2__webli",
		"",
		nil,
		nil,
	)
	if _, err := c.ComputeTextEmbedding(context.Background(), "q"); err == nil || !strings.Contains(err.Error(), "字节上限") {
		t.Fatalf("expected too-large error, got %v", err)
	}
}

// TestVideoAnalysisServiceGetHealthShowsEmbeddingWhenServiceUnavailable
// 视频分析主服务不可用（Available=false）时，embedding 健康仍应被探测并返回
func TestVideoAnalysisServiceGetHealthShowsEmbeddingWhenServiceUnavailable(t *testing.T) {
	srv, _ := newFakeVScheduler(t, []string{"ml-server/ViT-B-16-SigLIP2__webli"}, vschedulerTestVec(0))
	ec := newVSchedulerClient(
		srv.URL+"/v1",
		"ml-server/ViT-B-16-SigLIP2__webli",
		"",
		nil,
		nil,
	)
	svc := &VideoAnalysisService{embeddingProvider: ec} // client/tasks/media 缺失 → IsAvailable()=false
	info := svc.GetHealth(context.Background())
	if info.Available {
		t.Fatal("expected service unavailable")
	}
	if info.EmbeddingMode != "vscheduler" || info.EmbeddingModel == "" || !info.EmbeddingAvailable || info.EmbeddingError != "" {
		t.Fatalf("embedding health must be reported even when service unavailable: %+v", info)
	}
}
