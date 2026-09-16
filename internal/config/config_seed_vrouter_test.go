package config

import "testing"

// TestEnsureDefaultProviderSeedsVRouter 验证：全新安装（Providers 空）时种子
// vrouter 免 key 条目并设为默认 provider。
// 依据：ActiveProfile() 从 Providers 列表解析，列表为空时返回 nil——
// 单纯改默认 provider id 不生效，必须配套种子条目。
func TestEnsureDefaultProviderSeedsVRouter(t *testing.T) {
	cfg := &Config{}
	cfg.ensureDefaultProvider()

	if cfg.AI.ActiveProvider != "vrouter" {
		t.Errorf("ActiveProvider = %q, 期望 vrouter", cfg.AI.ActiveProvider)
	}
	if len(cfg.AI.Providers) != 1 {
		t.Fatalf("Providers 应有 1 条种子条目，实际 %d 条", len(cfg.AI.Providers))
	}
	p := cfg.AI.Providers[0]
	if p.ID != "vrouter" {
		t.Errorf("种子条目 ID = %q, 期望 vrouter", p.ID)
	}
	if p.APIBase != "http://v-router:8080/v1" {
		t.Errorf("种子条目 APIBase = %q, 期望 http://v-router:8080/v1", p.APIBase)
	}
	if p.APIKey != "" {
		t.Errorf("种子条目应免 key（APIKey 空），实际 %q", p.APIKey)
	}
	if !p.Enabled {
		t.Error("种子条目应 Enabled=true")
	}
}

// TestEnsureDefaultProviderKeepsExistingUsers 验证：已有用户（Providers 非空）
// 的手动选择与已有条目不被改动，但内置 vrouter 条目会自动补齐（不可删除的一等 provider）。
func TestEnsureDefaultProviderKeepsExistingUsers(t *testing.T) {
	cfg := &Config{AI: AIConfig{
		ActiveProvider: "deepseek",
		Providers: []AIProviderEntry{{
			ID:      "deepseek",
			APIBase: "https://api.deepseek.com/v1",
			APIKey:  "sk-test",
			Enabled: true,
		}},
	}}
	cfg.ensureDefaultProvider()

	if cfg.AI.ActiveProvider != "deepseek" {
		t.Errorf("已有用户 ActiveProvider 不应被改，实际 %q", cfg.AI.ActiveProvider)
	}
	if len(cfg.AI.Providers) != 2 {
		t.Fatalf("应补齐内置 vrouter 后共 2 条，实际 %d 条", len(cfg.AI.Providers))
	}
	if cfg.AI.Providers[0].ID != "deepseek" {
		t.Errorf("已有用户条目不应被改，实际 %q", cfg.AI.Providers[0].ID)
	}
	if cfg.AI.Providers[1].ID != "vrouter" {
		t.Errorf("补齐的条目应为内置 vrouter，实际 %q", cfg.AI.Providers[1].ID)
	}
}

// TestEnsureDefaultProviderRespectsUserIntent 验证：ActiveProvider 指向
// 不存在的条目时（用户已写下的意图），不强制切换，尊重用户配置。
func TestEnsureDefaultProviderRespectsUserIntent(t *testing.T) {
	cfg := &Config{AI: AIConfig{
		ActiveProvider: "deepseek",
		Providers: []AIProviderEntry{{
			ID:      "vrouter",
			APIBase: "http://v-router:8080/v1",
			Enabled: true,
		}},
	}}
	cfg.ensureDefaultProvider()

	if cfg.AI.ActiveProvider != "deepseek" {
		t.Errorf("ActiveProvider 已有值时不应被覆盖，实际 %q", cfg.AI.ActiveProvider)
	}
	if len(cfg.AI.Providers) != 1 {
		t.Errorf("已有 vrouter 时不应追加，实际 %d 条", len(cfg.AI.Providers))
	}
}

// TestEnsureDefaultProviderIdempotent 验证：重复调用结果一致，不产生重复条目。
func TestEnsureDefaultProviderIdempotent(t *testing.T) {
	cfg := &Config{}
	cfg.ensureDefaultProvider()
	cfg.ensureDefaultProvider()

	if len(cfg.AI.Providers) != 1 {
		t.Errorf("重复调用不应产生重复条目，实际 %d 条", len(cfg.AI.Providers))
	}
	if cfg.AI.ActiveProvider != "vrouter" {
		t.Errorf("重复调用后 ActiveProvider = %q, 期望 vrouter", cfg.AI.ActiveProvider)
	}
}
