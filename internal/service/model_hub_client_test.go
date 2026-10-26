package service

import (
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

	// 旧值残留：新错误不含模型名 → 推导清空，不残留误导
	stale := &model.VideoAnalysisTask{
		Status:       model.VideoAnalysisStatusPartial,
		ErrorMessage: `describe stage: external job failed: code=DESCRIBE_ERROR message=Connection error.`,
		MissingModel: "model-hub/minicpm-v4.6:latest",
	}
	ensureMissingModel(stale)
	if stale.MissingModel != "" {
		t.Fatalf("stale missing_model = %q, want empty", stale.MissingModel)
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
	cases := []struct {
		requested  string
		source, id string
		ok         bool
	}{
		{requested: "model-hub/minicpm-v4.6:latest", source: "ollama", id: "ollama://minicpm-v4.6:latest", ok: true},
		{requested: "model-hub/qwen3:0.6b", source: "ollama", id: "ollama://qwen3:0.6b", ok: true},
		{requested: "model-hub/org/repo:tag", source: "ollama", id: "ollama://org/repo:tag", ok: true},
		{requested: "model-hub/foo", source: "ollama", id: "ollama://foo", ok: true},
		{requested: "image-studio/sdxl", source: "", id: "", ok: false},
		{requested: "registered/xxx", source: "", id: "", ok: false},
		{requested: "model-hub/", source: "", id: "", ok: false},
		{requested: "", source: "", id: "", ok: false},
		{requested: "model-hub/a b", source: "", id: "", ok: false},
	}
	for _, tc := range cases {
		t.Run(tc.requested, func(t *testing.T) {
			source, id, ok := resolveModelHubModelID(tc.requested)
			if ok != tc.ok || source != tc.source || id != tc.id {
				t.Fatalf("resolveModelHubModelID(%q) = (%q, %q, %v), want (%q, %q, %v)", tc.requested, source, id, ok, tc.source, tc.id, tc.ok)
			}
		})
	}
}
