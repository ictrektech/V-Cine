package service

import (
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
)

// keyfreeTestService 构造带 HTTP client 与 semaphore 的 AIService
//（chatCompletion 发真实请求时两者必需，testAIService 未初始化）。
func keyfreeTestService(app *config.Config) *AIService {
	return &AIService{
		appCfg:    app,
		provider:  NewAIConfigProvider(app),
		cache:     make(map[string]*aiCacheEntry),
		logger:    testLogger(),
		client:    &http.Client{Timeout: 5 * time.Second},
		semaphore: make(chan struct{}, 1),
	}
}

// keyfreeStubServer 返回一个记录 Authorization 头的 OpenAI 兼容 stub。
func keyfreeStubServer(t *testing.T, authHeader *string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*authHeader = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"OK"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

// TestKeyFreeVRouterEnabled 验证：vrouter 条目只配 APIBase（无 key）时 IsEnabled() 为 true。
// 免 key 依据：V-Router REQUIRE_KEY=false（默认）时容器网络内无凭证即可调用。
func TestKeyFreeVRouterEnabled(t *testing.T) {
	app := &config.Config{AI: config.AIConfig{
		Enabled:        true,
		ActiveProvider: "vrouter",
		Providers: []config.AIProviderEntry{{
			ID:      "vrouter",
			APIBase: "http://v-router:8080/v1",
			APIKey:  "", // 免 key
		}},
	}}
	p := NewAIConfigProvider(app)
	if !p.IsEnabled() {
		t.Fatal("vrouter 只配 APIBase（无 key）时 IsEnabled() 应为 true")
	}
}

// TestKeyFreeChatCompletionNoAuthHeader 验证：vrouter 无 key 调用时不发送 Authorization 头。
// 配置模型后调用（V-Router 网关要求请求体必须带 model）。
func TestKeyFreeChatCompletionNoAuthHeader(t *testing.T) {
	var gotAuth string
	srv := keyfreeStubServer(t, &gotAuth)

	app := &config.Config{AI: config.AIConfig{
		Enabled:        true,
		ActiveProvider: "vrouter",
		Providers: []config.AIProviderEntry{{
			ID:      "vrouter",
			APIBase: srv.URL, // httptest 地址，无 key
			Models:  []config.AIModelEntry{{Name: "test-model"}},
		}},
	}}
	svc := keyfreeTestService(app)

	resp, err := svc.ChatCompletion("sys", "user", 0.1, 10)
	if err != nil {
		t.Fatalf("vrouter 无 key 调用应成功，实际报错: %v", err)
	}
	if resp != "OK" {
		t.Errorf("resp = %q, 期望 OK", resp)
	}
	if gotAuth != "" {
		t.Errorf("无 key 时不应发送 Authorization 头，实际 %q", gotAuth)
	}
}

// TestChatCompletionRequiresModel 验证：vrouter 未配置模型时报可读错误，
// 而不是向网关发出无 model 的请求（会得到 400 "JSON body requires model"）。
// 依据 V-ChatCut model-selection 语义：vrouter 无模型即不可用。
func TestChatCompletionRequiresModel(t *testing.T) {
	app := &config.Config{AI: config.AIConfig{
		Enabled:        true,
		ActiveProvider: "vrouter",
		Providers: []config.AIProviderEntry{{
			ID:      "vrouter",
			APIBase: "http://v-router:8080/v1",
		}},
	}}
	svc := keyfreeTestService(app)

	_, err := svc.ChatCompletion("sys", "user", 0.1, 10)
	if err == nil {
		t.Fatal("未配置模型时调用应报错")
	}
	if !strings.Contains(err.Error(), "未配置模型") {
		t.Errorf("错误信息应指出未配置模型，实际: %v", err)
	}
}

// TestKeyFreeTestConnection 验证：TestConnection 对免 key provider（无 key）
// 不报"未配置"，能正常测试连接且不发 Authorization 头。
func TestKeyFreeTestConnection(t *testing.T) {
	var gotAuth string
	srv := keyfreeStubServer(t, &gotAuth)

	app := &config.Config{AI: config.AIConfig{
		Enabled:        true,
		ActiveProvider: "vrouter",
		Providers: []config.AIProviderEntry{{
			ID:      "vrouter",
			APIBase: srv.URL,
			Models:  []config.AIModelEntry{{Name: "test-model"}},
		}},
	}}
	svc := keyfreeTestService(app)

	result, err := svc.TestConnection("")
	if err != nil {
		t.Fatalf("vrouter 无 key 测试连接应成功，实际报错: %v", err)
	}
	if result["success"] != true {
		t.Errorf("success 应为 true，实际 %v (error: %v)", result["success"], result["error"])
	}
	if gotAuth != "" {
		t.Errorf("无 key 时不应发送 Authorization 头，实际 %q", gotAuth)
	}
}

// TestKeyedProviderStillRequiresKey 验证：deepseek 等非免 key provider 不配 key 时
// 行为与现状一致（IsEnabled false / 调用报"未配置"），无任何放水。
func TestKeyedProviderStillRequiresKey(t *testing.T) {
	app := &config.Config{AI: config.AIConfig{
		Enabled:        true,
		ActiveProvider: "deepseek",
		Providers: []config.AIProviderEntry{{
			ID:      "deepseek",
			APIBase: "http://x",
			APIKey:  "", // 未配 key
		}},
	}}
	p := NewAIConfigProvider(app)
	if p.IsEnabled() {
		t.Fatal("deepseek 未配 key 时 IsEnabled() 应为 false")
	}
	svc := keyfreeTestService(app)
	if _, err := svc.ChatCompletion("sys", "user", 0.1, 10); err == nil {
		t.Fatal("deepseek 未配 key 时调用应报错")
	}
}

// TestBlockLocalAIExemptsVRouter 验证：BlockLocalAI=true 时 vrouter 不被"禁止本地 AI"拦截。
// V-Router 是云模型网关，APIBase 为私网 IP（宿主机端口模式）也不代表本地推理。
func TestBlockLocalAIExemptsVRouter(t *testing.T) {
	var gotAuth string
	srv := keyfreeStubServer(t, &gotAuth) // httptest 监听 127.0.0.1，必命中本地地址特征

	app := &config.Config{AI: config.AIConfig{
		Enabled:        true,
		BlockLocalAI:   true,
		ActiveProvider: "vrouter",
		Providers: []config.AIProviderEntry{{
			ID:      "vrouter",
			APIBase: srv.URL,
			Models:  []config.AIModelEntry{{Name: "test-model"}},
		}},
	}}
	svc := keyfreeTestService(app)
	if _, err := svc.ChatCompletion("sys", "user", 0.1, 10); err != nil {
		t.Fatalf("BlockLocalAI=true 时 vrouter 不应被拦截，实际报错: %v", err)
	}
}

// TestChatCompletionJSONSchemaLayeredFallback 验证：json_schema 被后端 400 拒绝时
// 分层降级为 json_object 再试；json_object 也被拒绝时降级为纯 prompt（plain）。
func TestChatCompletionJSONSchemaLayeredFallback(t *testing.T) {
	var formats []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch {
		case strings.Contains(string(body), `"json_schema"`):
			formats = append(formats, "json_schema")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"response_format: json_schema unsupported"}}`))
		case strings.Contains(string(body), `"json_object"`):
			formats = append(formats, "json_object")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"response_format: json_object unsupported"}}`))
		default:
			formats = append(formats, "plain")
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"OK"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`))
		}
	}))
	t.Cleanup(srv.Close)

	app := &config.Config{AI: config.AIConfig{
		Enabled:        true,
		ActiveProvider: "vrouter",
		Providers: []config.AIProviderEntry{{
			ID:      "vrouter",
			APIBase: srv.URL,
			Models:  []config.AIModelEntry{{Name: "test-model"}},
		}},
	}}
	svc := keyfreeTestService(app)

	resp, err := svc.ChatCompletionJSONSchema("sys", "user", 0.3, 1000, `{"type":"object"}`)
	if err != nil {
		t.Fatalf("两级降级后应成功，实际报错: %v", err)
	}
	if resp != "OK" {
		t.Errorf("resp = %q, 期望 OK", resp)
	}
	want := []string{"json_schema", "json_object", "plain"}
	if !reflect.DeepEqual(formats, want) {
		t.Fatalf("应依次发出 %v 三种请求，实际 %v", want, formats)
	}
}
