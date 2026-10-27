package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nowen-video/nowen-video/internal/model"
)

func TestExtractMissingModel(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "openai sdk error body with chinese colon",
			input: `describe stage: external job failed: code=DESCRIBE_ERROR message=全部 6 个场景描述失败: Error code：404 - {'error': {'message': 'unknown model：model-hub/minicpm-v4.6:latest'}}`,
			want:  "model-hub/minicpm-v4.6:latest",
		},
		{
			name:  "plain unknown model",
			input: `unknown model: model-hub/qwen3:0.6b`,
			want:  "model-hub/qwen3:0.6b",
		},
		{
			name:  "double quoted model",
			input: `Error code: 404 - {"error": {"message": "unknown model: model-hub/foo/bar:q4"}}`,
			want:  "model-hub/foo/bar:q4",
		},
		{
			name:  "ollama gateway name without prefix gets model-hub prefix",
			input: `describe stage: external job failed: code=DESCRIBE_ERROR message=大模型调用失败: 全部 6 个场景描述失败: 大模型调用失败: Error code: 404 - {'error': "model 'minicpm-v4.6:latest' not found"}`,
			want:  "model-hub/minicpm-v4.6:latest",
		},
		{
			name:  "ollama gateway namespaced name ignored",
			input: `Error code: 404 - {"error": {"message": "model 'foo/bar:latest' not found"}}`,
			want:  "",
		},
		{
			name:  "unknown model without prefix ignored",
			input: `unknown model: qwen3:0.6b`,
			want:  "",
		},
		{
			name:  "undefined model without prefix ignored",
			input: `Error: model 'deepseek-r1:8b' undefined`,
			want:  "",
		},
		{
			name:  "hf repo style without tag ignored",
			input: `unknown model: org/repo`,
			want:  "",
		},
		{
			name:  "short connection error ignored",
			input: `Connection error: timeout`,
			want:  "",
		},
		{
			name:  "non model-hub prefix ignored",
			input: `unknown model: image-studio/sdxl:latest`,
			want:  "",
		},
		{
			name:  "no unknown model",
			input: `Connection error: timeout`,
			want:  "",
		},
		{
			name:  "empty input",
			input: ``,
			want:  "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := extractMissingModel(tc.input); got != tc.want {
				t.Fatalf("extractMissingModel(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestEnsureMissingModel(t *testing.T) {
	const errMsg = `describe stage: external job failed: code=DESCRIBE_ERROR message=全部 6 个场景描述失败: Error code：404 - {'error': {'message': 'unknown model：model-hub/minicpm-v4.6:latest'}}`

	// 历史任务：missing_model 落库前失败，列为空 → 读取时从 error_message 推导
	historical := &model.VideoAnalysisTask{
		Status:       model.VideoAnalysisStatusPartial,
		ErrorMessage: errMsg,
	}
	ensureMissingModel(historical)
	if historical.MissingModel != "model-hub/minicpm-v4.6:latest" {
		t.Fatalf("historical missing_model = %q, want model-hub/minicpm-v4.6:latest", historical.MissingModel)
	}

	// 已落库值优先：模型名可能只出现在逐场景 warnings.detail 里，
	// error_message 只保留首个失败原因。
	persisted := &model.VideoAnalysisTask{
		Status:       model.VideoAnalysisStatusPartial,
		ErrorMessage: `describe stage: external job failed: code=DESCRIBE_PARTIAL message=2/5 个场景描述失败（scene_index: 1,3）: 场景 1：场景描述模型不可达`,
		MissingModel: "model-hub/minicpm-v4.6:latest",
	}
	ensureMissingModel(persisted)
	if persisted.MissingModel != "model-hub/minicpm-v4.6:latest" {
		t.Fatalf("persisted missing_model = %q, want kept", persisted.MissingModel)
	}

	// 重试成功：即使 error_message 残留也不再提示下载
	succeeded := &model.VideoAnalysisTask{
		Status:       model.VideoAnalysisStatusSucceeded,
		ErrorMessage: errMsg,
		MissingModel: "model-hub/minicpm-v4.6:latest",
	}
	ensureMissingModel(succeeded)
	if succeeded.MissingModel != "" {
		t.Fatalf("succeeded missing_model = %q, want empty", succeeded.MissingModel)
	}
}

func TestResolveModelHubModelID(t *testing.T) {
	// 网关模型名有三种形态：带 source、旧版 model-hub/、<upstream>/<native>。
	registry := []modelHubRegistryEntry{
		{ModelID: "ollama://minicpm-v4.6:latest"},
		{ModelID: "hf://Qwen/Qwen3-0.6B"},
		{ModelID: "ms://org/repo"},
		{ModelID: "ollama://dup-model"},
		{ModelID: "hf://dup-model"},
	}
	cases := []struct {
		name       string
		requested  string
		withReg    bool
		source, id string
		ok         bool
	}{
		{name: "legacy prefix", requested: "model-hub/minicpm-v4.6:latest", source: "ollama", id: "ollama://minicpm-v4.6:latest", ok: true},
		{name: "legacy nested", requested: "model-hub/org/repo:tag", source: "ollama", id: "ollama://org/repo:tag", ok: true},
		{name: "legacy empty", requested: "model-hub/", ok: false},
		{name: "legacy space", requested: "model-hub/a b", ok: false},
		{name: "explicit source", requested: "hf://Qwen/Qwen3-0.6B", source: "hf", id: "hf://Qwen/Qwen3-0.6B", ok: true},
		{name: "upstream native", requested: "v-scheduler/ollama-qa/minicpm-v4.6:latest", withReg: true, source: "ollama", id: "ollama://minicpm-v4.6:latest", ok: true},
		{name: "upstream hf with org path", requested: "v-scheduler/hf-prod/Qwen/Qwen3-0.6B", withReg: true, source: "hf", id: "hf://Qwen/Qwen3-0.6B", ok: true},
		{name: "bare name", requested: "Qwen3-0.6B", withReg: true, source: "hf", id: "hf://Qwen/Qwen3-0.6B", ok: true},
		{name: "unregistered ollama derives", requested: "v-scheduler/ollama-qa/nope", withReg: true, source: "ollama", id: "ollama://nope", ok: true},
		{name: "unregistered hf derives", requested: "v-scheduler/hf-prod/org/repo", ok: true, source: "hf", id: "hf://org/repo"},
		{name: "unregistered ms not derivable", requested: "v-scheduler/ms-prod/org/repo", ok: false},
		{name: "ollama name with slash not derivable", requested: "v-scheduler/ollama-qa/a/b", ok: false},
		{name: "ambiguous native", requested: "v-scheduler/ollama-qa/dup-model", withReg: true, ok: false},
		{name: "unmatched without registry derives", requested: "v-scheduler/ollama-qa/minicpm-v4.6:latest", source: "ollama", id: "ollama://minicpm-v4.6:latest", ok: true},
		{name: "empty", requested: "", ok: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var entries []modelHubRegistryEntry
			if tc.withReg {
				entries = registry
			}
			source, id, ok := resolveModelHubModelID(tc.requested, entries)
			if ok != tc.ok || source != tc.source || id != tc.id {
				t.Fatalf("resolveModelHubModelID(%q) = (%q, %q, %v), want (%q, %q, %v)", tc.requested, source, id, ok, tc.source, tc.id, tc.ok)
			}
		})
	}
}

// TestExternalJobFailedErrorMissingModel 验证从上游结构化 error.detail 取模型名：
// 只有"模型缺失"类失败才算 missing_model（上游对所有 LLM 异常都带 model）。
func TestExternalJobFailedErrorMissingModel(t *testing.T) {
	detail := func(model, upstreamCode string) json.RawMessage {
		raw, _ := json.Marshal(map[string]any{"model": model, "upstream_code": upstreamCode})
		return raw
	}
	cases := []struct {
		name string
		err  *externalJobFailedError
		want string
	}{
		{
			name: "model not found",
			err:  &externalJobFailedError{Code: errorCodeDescribeModelNotFound, Detail: detail("v-scheduler/ollama-qa/minicpm-v4.6:latest", "NOT_FOUND")},
			want: "v-scheduler/ollama-qa/minicpm-v4.6:latest",
		},
		{
			name: "upstream not found without code",
			err:  &externalJobFailedError{Code: "DESCRIBE_ERROR", Detail: detail("v-scheduler/ollama-qa/x", "NOT_FOUND")},
			want: "v-scheduler/ollama-qa/x",
		},
		{
			name: "plain llm error carries model but is not missing",
			err:  &externalJobFailedError{Code: "DESCRIBE_ERROR", Detail: detail("v-scheduler/ollama-qa/x", "")},
			want: "",
		},
		{
			name: "no detail",
			err:  &externalJobFailedError{Code: errorCodeDescribeModelNotFound},
			want: "",
		},
		{
			name: "detail stored as json string",
			err: &externalJobFailedError{
				Code:   errorCodeDescribeModelNotFound,
				Detail: json.RawMessage(`"{\"model\":\"v-scheduler/ollama-qa/str\",\"upstream_code\":\"NOT_FOUND\"}"`),
			},
			want: "v-scheduler/ollama-qa/str",
		},
		{
			name: "garbage detail",
			err:  &externalJobFailedError{Code: errorCodeDescribeModelNotFound, Detail: json.RawMessage("not json")},
			want: "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.err.MissingModel(); got != tc.want {
				t.Fatalf("MissingModel() = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestVerifyGatewayModel 验证状态查询会用网关注册表校正仓库状态：
// 仓库 ready 但网关没有该名称（典型：旧命名 model-hub/…）时改判 not_registered；
// 网关不可达或状态非 ready/missing 时不改判。
func TestVerifyGatewayModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"v-scheduler/ollama-qa/minicpm-v4.6:latest"}]}`))
	}))
	defer server.Close()
	apiBase := server.URL + "/v1"

	cases := []struct {
		name     string
		status   ModelHubModelStatus
		provider string
		apiBase  string
		want     string
	}{
		{"registered", ModelHubModelStatus{Requested: "v-scheduler/ollama-qa/minicpm-v4.6:latest", Status: modelHubStatusReady}, "vscheduler", apiBase, modelHubStatusReady},
		{"legacy name", ModelHubModelStatus{Requested: "model-hub/minicpm-v4.6:latest", Status: modelHubStatusReady}, "vscheduler", apiBase, ModelHubStatusNotRegistered},
		{"missing keeps download entry", ModelHubModelStatus{Requested: "v-scheduler/ollama-qa/minicpm-v4.6:latest", Status: modelHubStatusMissing}, "vscheduler", apiBase, modelHubStatusMissing},
		{"gateway down", ModelHubModelStatus{Requested: "model-hub/minicpm-v4.6:latest", Status: modelHubStatusReady}, "vscheduler", "http://127.0.0.1:1/v1", modelHubStatusReady},
		{"pulling untouched", ModelHubModelStatus{Requested: "model-hub/x", Status: modelHubStatusPulling}, "vscheduler", apiBase, modelHubStatusPulling},
		{"empty base", ModelHubModelStatus{Requested: "model-hub/x", Status: modelHubStatusReady}, "vscheduler", "", modelHubStatusReady},
		{"non gateway provider", ModelHubModelStatus{Requested: "model-hub/x", Status: modelHubStatusReady}, "openai", apiBase, modelHubStatusReady},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status := tc.status
			VerifyGatewayModel(context.Background(), &status, tc.provider, tc.apiBase, "")
			if status.Status != tc.want {
				t.Fatalf("status = %q, want %q", status.Status, tc.want)
			}
		})
	}
}

// TestClassifySceneDescribeStatusMissingModel 验证本地扇出路径：网关 404 不回显 model id，
// 由调用方把本次请求的模型名补进错误，供 missing_model 使用。
func TestClassifySceneDescribeStatusMissingModel(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{
			name:   "v-scheduler 404",
			status: http.StatusNotFound,
			body:   `{"category":"v-scheduler","code":"NOT_FOUND","msg":"unknown model or upstream"}`,
			want:   "v-scheduler/ollama-qa/minicpm-v4.6:latest",
		},
		{
			name:   "legacy 404",
			status: http.StatusNotFound,
			body:   `{"error":{"message":"unknown model: model-hub/xxx"}}`,
			want:   "v-scheduler/ollama-qa/minicpm-v4.6:latest",
		},
		{
			name:   "404 without model hint",
			status: http.StatusNotFound,
			body:   `{"error":"not found"}`,
			want:   "",
		},
		{
			name:   "500 is not model missing",
			status: http.StatusInternalServerError,
			body:   `{"code":"NOT_FOUND"}`,
			want:   "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := classifySceneDescribeStatus(true, false, tc.status, []byte(tc.body), "v-scheduler/ollama-qa/minicpm-v4.6:latest")
			var describeErr *sceneDescribeError
			if !errors.As(err, &describeErr) {
				t.Fatalf("err type = %T, want *sceneDescribeError", err)
			}
			if describeErr.MissingModel != tc.want {
				t.Fatalf("MissingModel = %q, want %q", describeErr.MissingModel, tc.want)
			}
			if tc.want != "" && describeErr.Retryable {
				t.Fatal("404 不应可重试")
			}
		})
	}
}
