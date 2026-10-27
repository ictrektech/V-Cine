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

// TestKeyFreeVSchedulerEnabled 验证：vscheduler 条目只配 APIBase（无 key）时 IsEnabled() 为 true。
// 免 key 依据：V-Scheduler REQUIRE_KEY=false（默认）时容器网络内无凭证即可调用。
func TestKeyFreeVSchedulerEnabled(t *testing.T) {
	app := &config.Config{AI: config.AIConfig{
		Enabled:        true,
		ActiveProvider: "vscheduler",
		Providers: []config.AIProviderEntry{{
			ID:      "vscheduler",
			APIBase: "http://v-scheduler:8080/v1",
			APIKey:  "", // 免 key
		}},
	}}
	p := NewAIConfigProvider(app)
	if !p.IsEnabled() {
		t.Fatal("vscheduler 只配 APIBase（无 key）时 IsEnabled() 应为 true")
	}
}

// TestKeyFreeChatCompletionNoAuthHeader 验证：vscheduler 无 key 调用时不发送 Authorization 头。
// 配置模型后调用（V-Scheduler 网关要求请求体必须带 model）。
func TestKeyFreeChatCompletionNoAuthHeader(t *testing.T) {
	var gotAuth string
	srv := keyfreeStubServer(t, &gotAuth)

	app := &config.Config{AI: config.AIConfig{
		Enabled:        true,
		ActiveProvider: "vscheduler",
		Providers: []config.AIProviderEntry{{
			ID:      "vscheduler",
			APIBase: srv.URL, // httptest 地址，无 key
			Models:  []config.AIModelEntry{{Name: "test-model"}},
		}},
	}}
	svc := keyfreeTestService(app)

	resp, err := svc.ChatCompletion("sys", "user", 0.1, 10)
	if err != nil {
		t.Fatalf("vscheduler 无 key 调用应成功，实际报错: %v", err)
	}
	if resp != "OK" {
		t.Errorf("resp = %q, 期望 OK", resp)
	}
	if gotAuth != "" {
		t.Errorf("无 key 时不应发送 Authorization 头，实际 %q", gotAuth)
	}
}

// TestChatCompletionRequiresModel 验证：vscheduler 未配置模型时报可读错误，
// 而不是向网关发出无 model 的请求（会得到 400 "JSON body requires model"）。
// 依据 V-ChatCut model-selection 语义：vscheduler 无模型即不可用。
func TestChatCompletionRequiresModel(t *testing.T) {
	app := &config.Config{AI: config.AIConfig{
		Enabled:        true,
		ActiveProvider: "vscheduler",
		Providers: []config.AIProviderEntry{{
			ID:      "vscheduler",
			APIBase: "http://v-scheduler:8080/v1",
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
		ActiveProvider: "vscheduler",
		Providers: []config.AIProviderEntry{{
			ID:      "vscheduler",
			APIBase: srv.URL,
			Models:  []config.AIModelEntry{{Name: "test-model"}},
		}},
	}}
	svc := keyfreeTestService(app)

	result, err := svc.TestConnection("")
	if err != nil {
		t.Fatalf("vscheduler 无 key 测试连接应成功，实际报错: %v", err)
	}
	if result["success"] != true {
		t.Errorf("success 应为 true，实际 %v (error: %v)", result["success"], result["error"])
	}
	if gotAuth != "" {
		t.Errorf("无 key 时不应发送 Authorization 头，实际 %q", gotAuth)
	}
}

// TestKeyOptionalEverywhere 验证：key 全局可选——deepseek 等任意 provider 未配 key
// 时 IsEnabled() 为 true（只查 api_base），调用发出请求由服务端 401/连接错误兑底。
func TestKeyOptionalEverywhere(t *testing.T) {
	app := &config.Config{AI: config.AIConfig{
		Enabled:        true,
		ActiveProvider: "deepseek",
		Providers: []config.AIProviderEntry{{
			ID:      "deepseek",
			APIBase: "http://127.0.0.1:1/v1", // 必然连接失败
			APIKey:  "",                      // 未配 key
		}},
	}}
	p := NewAIConfigProvider(app)
	if !p.IsEnabled() {
		t.Fatal("deepseek 未配 key 时 IsEnabled() 应为 true（key 可选，只查 api_base）")
	}
	svc := keyfreeTestService(app)
	if _, err := svc.ChatCompletion("sys", "user", 0.1, 10); err == nil {
		t.Fatal("deepseek 未配 key 且服务端拒绝时调用应报错")
	}
}

// TestLocalProviderKeyFreeTestConnection 验证：本地推理 provider（如 llama.cpp，
// APIBase 为本地/私网地址）不配 key 时 TestConnection 不报"未配置"，能正常测试连接。
func TestLocalProviderKeyFreeTestConnection(t *testing.T) {
	var gotAuth string
	srv := keyfreeStubServer(t, &gotAuth) // httptest 监听 127.0.0.1，不需要鉴权

	app := &config.Config{AI: config.AIConfig{
		Enabled:        true,
		ActiveProvider: "custom_llama.cpp",
		Providers: []config.AIProviderEntry{{
			ID:      "custom_llama.cpp",
			Name:    "llama.cpp",
			APIBase: srv.URL,
			APIKey:  "", // 本地推理免 key
			Models:  []config.AIModelEntry{{Name: "test-model"}},
		}},
	}}
	svc := keyfreeTestService(app)

	result, err := svc.TestConnection("")
	if err != nil {
		t.Fatalf("本地推理 provider 无 key 测试连接应成功，实际报错: %v", err)
	}
	if result["success"] != true {
		t.Errorf("success 应为 true，实际 %v (error: %v)", result["success"], result["error"])
	}
	if gotAuth != "" {
		t.Errorf("无 key 时不应发送 Authorization 头，实际 %q", gotAuth)
	}
}

// TestFriendlyProviderError 验证错误解释按 provider 类别与 key 配置分流：
// gateway 报网关专属文案；custom 空 key 报"未配置"、有 key 报"鉴权失败"，均不含 V-Scheduler。
func TestFriendlyProviderError(t *testing.T) {
	// custom provider：401 分空 key 与无效 key 两种文案，均不含 V-Scheduler
	got := friendlyProviderError(false, false, http.StatusUnauthorized, `{"error":"invalid api key"}`)
	if got == "" || !strings.Contains(got, "未配置 API Key") || strings.Contains(got, "V-Scheduler") {
		t.Errorf("custom 空 key 401 应报「未配置 API Key」且不含 V-Scheduler，实际: %s", got)
	}
	got = friendlyProviderError(false, true, http.StatusUnauthorized, `{"error":"invalid api key"}`)
	if got == "" || !strings.Contains(got, "鉴权失败") || strings.Contains(got, "V-Scheduler") {
		t.Errorf("custom 有 key 401 应报「鉴权失败」且不含 V-Scheduler，实际: %s", got)
	}
	// 非网关的 400 "requires model"：不套 V-Scheduler 文案，沿用原始错误
	if got := friendlyProviderError(false, true, http.StatusBadRequest, `body requires model`); got != "" {
		t.Errorf("非网关 provider 400 不应套网关文案，实际: %s", got)
	}
	// gateway：id 或 APIBase 任一特征命中即报网关专属文案
	for _, tc := range [][2]string{
		{"vscheduler", ""},
		{"custom_v-scheduler", ""},
		{"任意命名", "http://v-scheduler:8080/v1"},
		{"任意命名", "http://172.17.0.1:22888/v1"},
	} {
		got := friendlyProviderError(true, false, http.StatusUnauthorized, "")
		if got == "" || !strings.Contains(got, "V-Scheduler") {
			t.Errorf("网关 %v 401 应报 V-Scheduler 文案，实际: %s", tc, got)
		}
	}
}

// TestBlockLocalAIExemptsVScheduler 验证：BlockLocalAI=true 时 vscheduler 不被"禁止本地 AI"拦截。
// V-Scheduler 是云模型网关，APIBase 为私网 IP（宿主机端口模式）也不代表本地推理。
func TestBlockLocalAIExemptsVScheduler(t *testing.T) {
	var gotAuth string
	srv := keyfreeStubServer(t, &gotAuth) // httptest 监听 127.0.0.1，必命中本地地址特征

	app := &config.Config{AI: config.AIConfig{
		Enabled:        true,
		BlockLocalAI:   true,
		ActiveProvider: "vscheduler",
		Providers: []config.AIProviderEntry{{
			ID:      "vscheduler",
			APIBase: srv.URL,
			Models:  []config.AIModelEntry{{Name: "test-model"}},
		}},
	}}
	svc := keyfreeTestService(app)
	if _, err := svc.ChatCompletion("sys", "user", 0.1, 10); err != nil {
		t.Fatalf("BlockLocalAI=true 时 vscheduler 不应被拦截，实际报错: %v", err)
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
		ActiveProvider: "vscheduler",
		Providers: []config.AIProviderEntry{{
			ID:      "vscheduler",
			APIBase: srv.URL,
			Models:  []config.AIModelEntry{{Name: "test-model"}},
		}},
	}}
	svc := keyfreeTestService(app)

	resp, err := svc.ChatCompletionJSONSchema("sys", "user", 0.3, 1000, `{"type":"object"}`, "none")
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

// TestChatCompletionReasoningEffortRejectedStripped 验证：后端 400 拒绝 reasoning_effort
//（错误体提及该字段）时剥离 reasoning_effort 重试，重试请求保留的其余字段不受影响

func TestChatCompletionReasoningEffortRejectedStripped(t *testing.T) {
	var sawReasoningEffort, retryClean bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if strings.Contains(string(body), `"reasoning_effort"`) {
			sawReasoningEffort = true
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"reasoning_effort not supported"}}`))
			return
		}
		retryClean = !strings.Contains(string(body), `"reasoning_effort"`)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"OK"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`))
	}))
	t.Cleanup(srv.Close)

	app := &config.Config{AI: config.AIConfig{
		Enabled:        true,
		ActiveProvider: "vscheduler",
		Providers: []config.AIProviderEntry{{
			ID:      "vscheduler",
			APIBase: srv.URL,
			Models:  []config.AIModelEntry{{Name: "test-model"}},
		}},
	}}
	svc := keyfreeTestService(app)

	if _, err := svc.ChatCompletionJSONSchema("sys", "user", 0.3, 1000, `{"type":"object"}`, "none"); err != nil {
		t.Fatalf("剥离 reasoning_effort 后应成功，实际报错: %v", err)
	}
	if !sawReasoningEffort {
		t.Error("禁思考时应发送 reasoning_effort 字段")
	}
	if !retryClean {
		t.Error("重试请求不应再携带 reasoning_effort")
	}
}
