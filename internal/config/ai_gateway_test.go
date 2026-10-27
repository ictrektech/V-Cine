package config

import "testing"

// TestIsVSchedulerGateway 验证网关判定：providerID 含 vscheduler/v-scheduler 或 APIBase
// 指向网关特征即为 gateway；其余（含云端厂商、本地推理）均为 custom，无需单独判定。
func TestIsVSchedulerGateway(t *testing.T) {
	cases := []struct {
		providerID string
		apiBase    string
		want       bool
	}{
		{"vscheduler", "", true},
		{"VScheduler", "", true},   // 大小写不敏感
		{" vscheduler ", "", true}, // 去空白
		// 手动添加的 V-Scheduler 条目（custom_ 前缀 id）
		{"custom_vscheduler", "", true},
		{"custom_v-scheduler", "", true},
		// 旧版 V-Router 命名：安装包保留兼容别名，既有部署继续按网关处理
		{"vrouter", "", true},
		{"custom_v-router", "", true},
		{"my_gateway", "http://v-router:8080/v1", true},
		// 任意命名的条目但 APIBase 指向 V-Scheduler 网关（docker 服务名 / 宿主机端口）
		{"my_gateway", "http://v-scheduler:8080/v1", true},
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
		if got := IsVSchedulerGateway(c.providerID, c.apiBase); got != c.want {
			t.Errorf("IsVSchedulerGateway(%q, %q) = %v, 期望 %v", c.providerID, c.apiBase, got, c.want)
		}
	}
}

// TestIsBuiltInProviderID 验证内置条目的保护范围：只认当前 ID，
// 旧 id 在加载迁移后属于用户自建条目，不能一并锁死。
func TestIsBuiltInProviderID(t *testing.T) {
	if !IsBuiltInProviderID(GatewayProviderID) {
		t.Errorf("IsBuiltInProviderID(%q) = false, 期望 true", GatewayProviderID)
	}
	if IsBuiltInProviderID(legacyGatewayProviderID) {
		t.Errorf("IsBuiltInProviderID(%q) = true, 期望 false", legacyGatewayProviderID)
	}
	if IsBuiltInProviderID("deepseek") {
		t.Error(`IsBuiltInProviderID("deepseek") = true, 期望 false`)
	}
}
