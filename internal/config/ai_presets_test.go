package config

import "testing"

// TestVRouterPresetExists 验证 vrouter 预设已注册且字段符合接入设计：
// APIBase 指向 VOS docker 网关服务名，DefaultModel 留空（模型从 V-Router 动态拉取）。
func TestVRouterPresetExists(t *testing.T) {
	p, ok := FindAIProviderPreset("vrouter")
	if !ok {
		t.Fatal("vrouter 预设未注册")
	}
	if p.APIBase != "http://v-router:8080/v1" {
		t.Errorf("vrouter APIBase = %q, 期望 http://v-router:8080/v1", p.APIBase)
	}
	if p.DefaultModel != "" {
		t.Errorf("vrouter DefaultModel = %q, 期望为空（动态从 V-Router 拉取）", p.DefaultModel)
	}
	if len(p.AvailableModels) != 0 {
		t.Errorf("vrouter AvailableModels 应为空（动态目录），实际 %v", p.AvailableModels)
	}
	if p.Label == "" {
		t.Error("vrouter Label 不应为空")
	}
}

// TestIsVRouterGateway 验证网关判定：providerID 含 vrouter/v-router 或 APIBase
// 指向网关特征即为 gateway；其余（含云端厂商、本地推理）均为 custom，无需单独判定。
func TestIsVRouterGateway(t *testing.T) {
	cases := []struct {
		providerID string
		apiBase    string
		want       bool
	}{
		{"vrouter", "", true},
		{"VRouter", "", true},   // 大小写不敏感
		{" vrouter ", "", true}, // 去空白
		// 手动添加的 V-Router 条目（custom_ 前缀 id）
		{"custom_vrouter", "", true},
		{"custom_v-router", "", true},
		// 任意命名的条目但 APIBase 指向 V-Router 网关（docker 服务名 / 宿主机端口）
		{"my_gateway", "http://v-router:8080/v1", true},
		{"我的网关", "http://172.17.0.1:22888/v1", true},
		// 非网关：云端厂商、本地推理、自定义命名均归 custom
		{"deepseek", "", false},
		{"openai", "", false},
		{"qwen", "", false},
		{"zhipu", "", false},
		{"anthropic", "", false},
		{"", "", false},
		{"llama.cpp", "http://127.0.0.1:2333/v1", false},
		// 恰好含数字串但非网关地址：不应误判
		{"deepseek", "https://api.deepseek.com/v1", false},
	}
	for _, c := range cases {
		if got := IsVRouterGateway(c.providerID, c.apiBase); got != c.want {
			t.Errorf("IsVRouterGateway(%q, %q) = %v, 期望 %v", c.providerID, c.apiBase, got, c.want)
		}
	}
}
