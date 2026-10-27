package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenAIVisionClientSendsImageAndReturnsDescription(t *testing.T) {
	var gotAuth string
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"  夜晚雨中的街道  "}}]}`))
	}))
	defer server.Close()

	dir := t.TempDir()
	imagePath := filepath.Join(dir, "scene_000.jpg")
	if err := os.WriteFile(imagePath, []byte("jpeg-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}

	client := newOpenAIVisionClient(openAIVisionConfig{
		BaseURL: server.URL + "/v1",
		Model:   "model-hub/test-vlm",
		APIKey:  "test-key",
	})
	description, err := client.DescribeImage(context.Background(), imagePath)
	if err != nil {
		t.Fatal(err)
	}
	if description != "夜晚雨中的街道" {
		t.Fatalf("description = %q", description)
	}
	if gotAuth != "Bearer test-key" {
		t.Fatalf("authorization = %q", gotAuth)
	}
	if gotBody["model"] != "model-hub/test-vlm" {
		t.Fatalf("model = %v", gotBody["model"])
	}
	// 与 AIService.ChatCompletionNoReasoning 一致：描述任务统一关闭思考，
	// 否则推理模型会把 max_tokens 烧在思维链上导致 content 为空。
	if gotBody["reasoning_effort"] != "none" {
		t.Fatalf("reasoning_effort = %v, want none", gotBody["reasoning_effort"])
	}
	messages, _ := gotBody["messages"].([]any)
	if len(messages) != 2 {
		t.Fatalf("messages = %v", messages)
	}
	userContent, _ := messages[1].(map[string]any)["content"].([]any)
	if len(userContent) != 2 {
		t.Fatalf("user content parts = %v", userContent)
	}
	imagePart, _ := userContent[1].(map[string]any)
	if imagePart["type"] != "image_url" {
		t.Fatalf("image part = %v", imagePart)
	}
	imageURL, _ := imagePart["image_url"].(map[string]any)
	if !strings.HasPrefix(fmt.Sprint(imageURL["url"]), "data:image/jpeg;base64,") {
		t.Fatalf("image url = %v", imageURL["url"])
	}
}

func TestOpenAIVisionClientStripsReasoningEffortOn400(t *testing.T) {
	// 少数旧网关不识别 reasoning_effort 会返回 400：剥离该字段重试一次，其余参数保持不变。
	var attempts int
	var retriedBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if attempts == 1 {
			if body["reasoning_effort"] != "none" {
				t.Errorf("first request reasoning_effort = %v, want none", body["reasoning_effort"])
			}
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"Unrecognized request argument: reasoning_effort"}}`))
			return
		}
		retriedBody = body
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"雨夜的街道"}}]}`))
	}))
	defer server.Close()

	imagePath := filepath.Join(t.TempDir(), "scene_000.jpg")
	if err := os.WriteFile(imagePath, []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}
	client := newOpenAIVisionClient(openAIVisionConfig{BaseURL: server.URL, Model: "m"})
	description, err := client.DescribeImage(context.Background(), imagePath)
	if err != nil {
		t.Fatal(err)
	}
	if description != "雨夜的街道" {
		t.Fatalf("description = %q", description)
	}
	if attempts != 2 {
		t.Fatalf("attempts = %d, want 2", attempts)
	}
	if _, ok := retriedBody["reasoning_effort"]; ok {
		t.Fatalf("retried request must not carry reasoning_effort: %v", retriedBody)
	}
	if retriedBody["max_tokens"] == nil || retriedBody["messages"] == nil {
		t.Fatalf("retried request lost other fields: %v", retriedBody)
	}
}

func TestOpenAIVisionClientClassifiesStatusWhenStripHitsLastAttempt(t *testing.T) {
	// 第一次 503 用掉重试，第二次 400 触发剥离字段后，传输层直接返回上游状态错误：
	// 错误仍按状态码与响应体分类，上游原文保留、missing_model 可识别。
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if calls == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("busy"))
			return
		}
		if body["reasoning_effort"] != "none" {
			t.Errorf("second request reasoning_effort = %v, want none", body["reasoning_effort"])
		}
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"Unrecognized argument: reasoning_effort, unknown model: model-hub/minicpm-v4.6"}}`))
	}))
	defer server.Close()

	imagePath := filepath.Join(t.TempDir(), "scene_000.jpg")
	if err := os.WriteFile(imagePath, []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}
	client := newOpenAIVisionClient(openAIVisionConfig{BaseURL: server.URL, Model: "m"})
	_, err := client.DescribeImage(context.Background(), imagePath)
	if err == nil {
		t.Fatal("expected error")
	}
	var describeErr *sceneDescribeError
	if !errors.As(err, &describeErr) {
		t.Fatalf("err type = %T, want *sceneDescribeError", err)
	}
	if describeErr.Retryable {
		t.Fatalf("400 must be classified as non-retryable: %v", err)
	}
	if !strings.Contains(describeErr.Error(), "unknown model") {
		t.Fatalf("error %q must keep upstream body", err)
	}
	if got := extractMissingModel(err.Error()); got != "model-hub/minicpm-v4.6" {
		t.Fatalf("extractMissingModel = %q, want model-hub/minicpm-v4.6", got)
	}
}

func TestOpenAIVisionClientEscalatesMaxTokensWhenTruncated(t *testing.T) {
	// 模型忽略 reasoning_effort 时，512 预算会被思维链烧穿（finish_reason=length、content 为空）：
	// 客户端应提高预算重试一次，而不是直接判失败。
	var budgets []int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if value, ok := body["max_tokens"].(float64); ok {
			budgets = append(budgets, int(value))
		}
		w.Header().Set("Content-Type", "application/json")
		if len(budgets) == 1 {
			_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"length","message":{"content":"","reasoning":"先分析画面..."}}],"usage":{"completion_tokens":512}}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"stop","message":{"content":"雨夜的街道"}}]}`))
	}))
	defer server.Close()

	imagePath := filepath.Join(t.TempDir(), "scene_000.jpg")
	if err := os.WriteFile(imagePath, []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}
	client := newOpenAIVisionClient(openAIVisionConfig{BaseURL: server.URL, Model: "m"})
	description, err := client.DescribeImage(context.Background(), imagePath)
	if err != nil {
		t.Fatal(err)
	}
	if description != "雨夜的街道" {
		t.Fatalf("description = %q", description)
	}
	if len(budgets) != 2 || budgets[0] != sceneDescribeMaxTokens || budgets[1] != sceneDescribeEscalatedMaxTokens {
		t.Fatalf("max_tokens sequence = %v, want [%d %d]", budgets, sceneDescribeMaxTokens, sceneDescribeEscalatedMaxTokens)
	}
}

func TestOpenAIVisionClientDoesNotResendRejectedReasoningEffort(t *testing.T) {
	// 网关 400 拒绝 reasoning_effort 后，预算升级不能再次发送该字段（否则每轮多一次 400）。
	var reasoningSent int
	var budgets []int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if _, ok := body["reasoning_effort"]; ok {
			reasoningSent++
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"reasoning_effort not supported"}}`))
			return
		}
		maxTokens, _ := body["max_tokens"].(float64)
		budgets = append(budgets, int(maxTokens))
		w.Header().Set("Content-Type", "application/json")
		if int(maxTokens) == sceneDescribeMaxTokens {
			_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"length","message":{"content":"","reasoning":"思考..."}}],"usage":{"completion_tokens":512}}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"stop","message":{"content":"雨夜的街道"}}]}`))
	}))
	defer server.Close()

	imagePath := filepath.Join(t.TempDir(), "scene_000.jpg")
	if err := os.WriteFile(imagePath, []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}
	client := newOpenAIVisionClient(openAIVisionConfig{BaseURL: server.URL, Model: "m"})
	description, err := client.DescribeImage(context.Background(), imagePath)
	if err != nil {
		t.Fatal(err)
	}
	if description != "雨夜的街道" {
		t.Fatalf("description = %q", description)
	}
	if reasoningSent != 1 {
		t.Fatalf("reasoning_effort sent %d times, want 1 (must not resend after 400)", reasoningSent)
	}
	if len(budgets) != 2 || budgets[1] != sceneDescribeEscalatedMaxTokens {
		t.Fatalf("budgets = %v, want [%d %d]", budgets, sceneDescribeMaxTokens, sceneDescribeEscalatedMaxTokens)
	}
}

func TestOpenAIVisionClientDoesNotEscalateNonTruncatedEmpty(t *testing.T) {
	// 非 length 的空返回（如内容过滤）不重试，避免无意义地多花钱。
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"content_filter","message":{"content":""}}]}`))
	}))
	defer server.Close()

	imagePath := filepath.Join(t.TempDir(), "scene_000.jpg")
	if err := os.WriteFile(imagePath, []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}
	client := newOpenAIVisionClient(openAIVisionConfig{BaseURL: server.URL, Model: "m"})
	if _, err := client.DescribeImage(context.Background(), imagePath); err == nil {
		t.Fatal("expected error")
	}
	if calls != 1 {
		t.Fatalf("calls = %d, want 1 (non-length empty must not retry)", calls)
	}
}

func TestOpenAIVisionClientClassifiesRetryableStatus(t *testing.T) {
	cases := []struct {
		name      string
		status    int
		body      string
		retryable bool
	}{
		{name: "rate limited", status: http.StatusTooManyRequests, body: "slow down", retryable: true},
		{name: "server error", status: http.StatusInternalServerError, body: "boom", retryable: true},
		{name: "unknown model", status: http.StatusBadRequest, body: "unknown model: model-hub/minicpm-v4.6", retryable: false},
		{name: "unauthorized", status: http.StatusUnauthorized, body: "invalid key", retryable: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()

			dir := t.TempDir()
			imagePath := filepath.Join(dir, "scene_000.jpg")
			if err := os.WriteFile(imagePath, []byte("jpeg-bytes"), 0o600); err != nil {
				t.Fatal(err)
			}
			client := newOpenAIVisionClient(openAIVisionConfig{BaseURL: server.URL, Model: "m"})
			_, err := client.DescribeImage(context.Background(), imagePath)
			if err == nil {
				t.Fatal("expected error")
			}
			var describeErr *sceneDescribeError
			if !errors.As(err, &describeErr) {
				t.Fatalf("err type = %T, want *sceneDescribeError", err)
			}
			if describeErr.Retryable != tc.retryable {
				t.Fatalf("retryable = %v, want %v (err: %v)", describeErr.Retryable, tc.retryable, err)
			}
			// 上游原文必须保留：extractMissingModel 依赖它识别缺失模型。
			if !strings.Contains(describeErr.Error(), tc.body) {
				t.Fatalf("error %q must contain upstream body %q", describeErr.Error(), tc.body)
			}
		})
	}
}

func TestOpenAIVisionClientMissingModelIsExtractable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"unknown model: model-hub/minicpm-v4.6:latest"}}`))
	}))
	defer server.Close()

	dir := t.TempDir()
	imagePath := filepath.Join(dir, "scene_000.jpg")
	if err := os.WriteFile(imagePath, []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}
	client := newOpenAIVisionClient(openAIVisionConfig{BaseURL: server.URL, Model: "m"})
	_, err := client.DescribeImage(context.Background(), imagePath)
	if err == nil {
		t.Fatal("expected error")
	}
	if got := extractMissingModel(err.Error()); got != "model-hub/minicpm-v4.6:latest" {
		t.Fatalf("extractMissingModel = %q, want model-hub/minicpm-v4.6:latest", got)
	}
}

func TestOpenAIVisionClientEmptyContentKeepsUpstreamDetail(t *testing.T) {
	// 空描述必须保留上游响应细节（finish_reason/usage/推理内容），否则只能看到
	// “返回空内容”这种无信息量文案，无法定位是截断、内容过滤还是思考占满 token。
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl-test","model":"minicpm-v4.6","choices":[{"finish_reason":"length","message":{"content":"","reasoning_content":"先观察画面..."}}],"usage":{"prompt_tokens":1200,"completion_tokens":512,"total_tokens":1712}}`))
	}))
	defer server.Close()

	imagePath := filepath.Join(t.TempDir(), "scene_000.jpg")
	if err := os.WriteFile(imagePath, []byte("jpeg-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	client := newOpenAIVisionClient(openAIVisionConfig{BaseURL: server.URL, Model: "m"})
	_, err := client.DescribeImage(context.Background(), imagePath)
	if err == nil {
		t.Fatal("expected error")
	}
	var describeErr *sceneDescribeError
	if !errors.As(err, &describeErr) {
		t.Fatalf("err type = %T, want *sceneDescribeError", err)
	}
	if !describeErr.Retryable {
		t.Fatal("empty content must stay retryable")
	}
	// 用户可见的摘要保持简短，上游细节放在 Detail 里。
	if got := describeErr.Error(); got != "场景描述模型返回空内容" {
		t.Fatalf("error message = %q, want short reason", got)
	}
	for _, want := range []string{
		"model=minicpm-v4.6",
		"response_id=chatcmpl-test",
		"finish_reason=length",
		"usage=prompt:1200,completion:512,total:1712",
		"reasoning=先观察画面",
		"raw=",
		"requested_max_tokens=",
	} {
		if !strings.Contains(describeErr.Detail, want) {
			t.Fatalf("detail %q must contain %q", describeErr.Detail, want)
		}
	}
}

func TestOpenAIVisionClientEmptyContentKeepsUpstreamErrorBody(t *testing.T) {
	// 部分网关 200 也返回 error 对象：必须把 error.message 带出来。
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"error":{"message":"upstream overloaded","type":"server_error"}}`))
	}))
	defer server.Close()

	imagePath := filepath.Join(t.TempDir(), "scene_000.jpg")
	if err := os.WriteFile(imagePath, []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}
	client := newOpenAIVisionClient(openAIVisionConfig{BaseURL: server.URL, Model: "m"})
	_, err := client.DescribeImage(context.Background(), imagePath)
	if err == nil {
		t.Fatal("expected error")
	}
	var describeErr *sceneDescribeError
	if !errors.As(err, &describeErr) {
		t.Fatalf("err type = %T, want *sceneDescribeError", err)
	}
	if !strings.Contains(describeErr.Detail, "上游错误：upstream overloaded") {
		t.Fatalf("detail %q must contain upstream error message", describeErr.Detail)
	}
}

func TestOpenAIVisionClientRequiresImagePath(t *testing.T) {
	client := newOpenAIVisionClient(openAIVisionConfig{BaseURL: "http://example.invalid", Model: "m"})
	if _, err := client.DescribeImage(context.Background(), ""); err == nil {
		t.Fatal("expected error for empty image path")
	}
	if _, err := client.DescribeImage(context.Background(), filepath.Join(t.TempDir(), "missing.jpg")); err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestNewOpenAIVisionClientRequiresBaseURLAndModel(t *testing.T) {
	if c := newOpenAIVisionClient(openAIVisionConfig{Model: "m"}); c != nil {
		t.Fatal("client without base url must be nil")
	}
	if c := newOpenAIVisionClient(openAIVisionConfig{BaseURL: "http://x"}); c != nil {
		t.Fatal("client without model must be nil")
	}
}
