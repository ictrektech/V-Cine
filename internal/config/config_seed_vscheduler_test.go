package config

import "testing"

// TestEnsureDefaultProviderSeedsGateway 验证：全新安装（Providers 空）时种子
// 内置网关条目并设为默认 provider。
// 依据：ActiveProfile() 从 Providers 列表解析，列表为空时返回 nil——
// 单纯改默认 provider id 不生效，必须配套种子条目。
func TestEnsureDefaultProviderSeedsGateway(t *testing.T) {
	cfg := &Config{}
	cfg.ensureDefaultProvider()

	if cfg.AI.ActiveProvider != GatewayProviderID {
		t.Errorf("ActiveProvider = %q, 期望 %q", cfg.AI.ActiveProvider, GatewayProviderID)
	}
	if len(cfg.AI.Providers) != 1 {
		t.Fatalf("Providers 应有 1 条种子条目，实际 %d 条", len(cfg.AI.Providers))
	}
	p := cfg.AI.Providers[0]
	if p.ID != GatewayProviderID {
		t.Errorf("种子条目 ID = %q, 期望 %q", p.ID, GatewayProviderID)
	}
	if p.APIBase != GatewayAPIBase {
		t.Errorf("种子条目 APIBase = %q, 期望 %q", p.APIBase, GatewayAPIBase)
	}
	if p.APIKey != "" {
		t.Errorf("种子条目应免 key（APIKey 空），实际 %q", p.APIKey)
	}
	if !p.Enabled {
		t.Error("种子条目应 Enabled=true")
	}
}

// TestEnsureDefaultProviderKeepsExistingUsers 验证：已有用户（Providers 非空）
// 的手动选择与已有条目不被改动，但内置网关条目会自动补齐（不可删除的一等 provider）。
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
		t.Fatalf("应补齐内置网关后共 2 条，实际 %d 条", len(cfg.AI.Providers))
	}
	if cfg.AI.Providers[0].ID != "deepseek" {
		t.Errorf("已有用户条目不应被改，实际 %q", cfg.AI.Providers[0].ID)
	}
	if cfg.AI.Providers[1].ID != GatewayProviderID {
		t.Errorf("补齐的条目应为内置网关，实际 %q", cfg.AI.Providers[1].ID)
	}
}

// TestEnsureDefaultProviderRespectsUserIntent 验证：ActiveProvider 指向
// 不存在的条目时（用户已写下的意图），不强制切换，尊重用户配置。
func TestEnsureDefaultProviderRespectsUserIntent(t *testing.T) {
	cfg := &Config{AI: AIConfig{
		ActiveProvider: "deepseek",
		Providers: []AIProviderEntry{{
			ID:      GatewayProviderID,
			APIBase: GatewayAPIBase,
			Enabled: true,
		}},
	}}
	cfg.ensureDefaultProvider()

	if cfg.AI.ActiveProvider != "deepseek" {
		t.Errorf("ActiveProvider 已有值时不应被覆盖，实际 %q", cfg.AI.ActiveProvider)
	}
	if len(cfg.AI.Providers) != 1 {
		t.Errorf("已有内置条目时不应追加，实际 %d 条", len(cfg.AI.Providers))
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
	if cfg.AI.ActiveProvider != GatewayProviderID {
		t.Errorf("重复调用后 ActiveProvider = %q, 期望 %q", cfg.AI.ActiveProvider, GatewayProviderID)
	}
}

// TestEnsureDefaultProviderMigratesLegacyGatewayEntry 验证：旧版 V-Router 内置条目
// 在加载时就地迁移为 V-Scheduler，不新增重复条目，激活选择一并跟随。
func TestEnsureDefaultProviderMigratesLegacyGatewayEntry(t *testing.T) {
	cfg := &Config{AI: AIConfig{
		ActiveProvider: legacyGatewayProviderID,
		Providers: []AIProviderEntry{{
			ID:      legacyGatewayProviderID,
			Name:    "V-Router · VOS 账户模型",
			APIBase: legacyGatewayAPIBase,
			Enabled: true,
		}},
	}}
	cfg.ensureDefaultProvider()

	if len(cfg.AI.Providers) != 1 {
		t.Fatalf("迁移后不应新增条目，实际 %d 条", len(cfg.AI.Providers))
	}
	p := cfg.AI.Providers[0]
	if p.ID != GatewayProviderID || p.APIBase != GatewayAPIBase || p.Name != GatewayProviderName {
		t.Errorf("旧内置条目未迁移: %+v", p)
	}
	if cfg.AI.ActiveProvider != GatewayProviderID {
		t.Errorf("ActiveProvider = %q, 期望跟随迁移到 %q", cfg.AI.ActiveProvider, GatewayProviderID)
	}
}

// TestEnsureDefaultProviderKeepsCustomLegacyProvider 验证：用户自建的同名条目
// （带 key 或地址不同）不被迁移，只按缺失补齐内置条目。
func TestEnsureDefaultProviderKeepsCustomLegacyProvider(t *testing.T) {
	const customBase = "https://my-own-gateway.example.com/v1"
	cfg := &Config{AI: AIConfig{
		ActiveProvider: legacyGatewayProviderID,
		Providers: []AIProviderEntry{{
			ID:      legacyGatewayProviderID,
			APIBase: customBase,
			APIKey:  "sk-x",
			Enabled: true,
		}},
	}}
	cfg.ensureDefaultProvider()

	if len(cfg.AI.Providers) != 2 {
		t.Fatalf("应补齐内置条目后共 2 条，实际 %d 条", len(cfg.AI.Providers))
	}
	if p := cfg.AI.Providers[0]; p.ID != legacyGatewayProviderID || p.APIBase != customBase || p.APIKey != "sk-x" {
		t.Errorf("自建条目被改动: %+v", p)
	}
	if cfg.AI.ActiveProvider != legacyGatewayProviderID {
		t.Errorf("ActiveProvider 不应被改，实际 %q", cfg.AI.ActiveProvider)
	}
}
