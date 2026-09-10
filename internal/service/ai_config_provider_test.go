package service

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/nowen-video/nowen-video/internal/config"
	"go.uber.org/zap"
)

// 并发读写：所有 app.AI 访问都经 c.mu 序列化（AISnapshot / UpdateAIConfig），
// go test -race 下不应有数据竞争。
func TestAIConfigProviderConcurrentAccess(t *testing.T) {
	t.Chdir(t.TempDir())

	app := &config.Config{AI: config.AIConfig{Enabled: false}}
	p := NewAIConfigProvider(app)

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				_ = p.Update(func(cfg *config.AIConfig) {
					cfg.Enabled = !cfg.Enabled
					cfg.ActiveProvider = "p"
				})
				_ = p.IsEnabled()
				_ = p.APIKey()
			}
		}(i)
	}
	wg.Wait()
}

// 回归测试：AIConfigProvider 不持有配置副本，读方法实时读取权威状态 app.AI。
// 运行期 UI 保存（AIHandler 直改 app.AI / AIService.UpdateConfig 写回）后，
// IsEnabled() 等判定立即生效，无需重启——VOS 上"AI 开启后仍提示 AI服务未启用"
// 的根因是旧实现的启动快照不同步。
func TestAIConfigProviderReadsLiveConfig(t *testing.T) {
	app := &config.Config{AI: config.AIConfig{Enabled: false}}
	p := NewAIConfigProvider(app)

	if p.IsEnabled() {
		t.Fatal("启动时 enabled=false，IsEnabled() 应为 false")
	}

	// 模拟运行期 UI 开启 AI：app.AI 被直接修改（未重启进程）
	app.AI.Enabled = true
	app.AI.ActiveProvider = "custom_ollama"
	app.AI.Providers = []config.AIProviderEntry{{
		ID:      "custom_ollama",
		APIBase: "http://172.17.0.1:48910",
		APIKey:  "test-key",
	}}

	// provider 直读权威状态，IsEnabled 应立即为 true
	if !p.IsEnabled() {
		t.Fatal("app.AI 修改后 IsEnabled() 应立即为 true（实时读取，无快照过期）")
	}
}

// provider.Update 在锁内更新 app.AI 并持久化，读方法随后立即可见。
func TestAIConfigProviderUpdateAppliesImmediately(t *testing.T) {
	t.Chdir(t.TempDir()) // 隔离 ai.yaml 落盘位置

	app := &config.Config{AI: config.AIConfig{Enabled: false}}
	p := NewAIConfigProvider(app)

	if err := p.Update(func(cfg *config.AIConfig) {
		cfg.Enabled = true
		cfg.ActiveProvider = "p1"
		cfg.Providers = []config.AIProviderEntry{{ID: "p1", APIBase: "http://x", APIKey: "k"}}
	}); err != nil {
		t.Fatalf("Update 失败: %v", err)
	}

	// 权威状态 app.AI 已被更新，读方法立即可见
	if !app.AI.Enabled {
		t.Fatal("Update 后 app.AI.Enabled 应为 true")
	}
	if !p.IsEnabled() {
		t.Fatal("Update 后 IsEnabled() 应为 true")
	}
}

// 回归测试：UpdateConfig（AI 开关保存路径）更新 timeout 后，权威状态 app.AI
// 与持久化文件均应包含新值——旧实现丢失了 timeout 字段，重启后用户改动被静默丢弃。
func TestUpdateConfigPersistsTimeout(t *testing.T) {
	t.Chdir(t.TempDir())

	app := &config.Config{AI: testAIConfig()}
	p := NewAIConfigProvider(app)
	svc := NewAIService(app.AI, app, nil, nil, zap.NewNop().Sugar(), p)

	if err := svc.UpdateConfig(map[string]interface{}{
		"timeout": float64(45),
		"enabled": true,
	}); err != nil {
		t.Fatalf("UpdateConfig 失败: %v", err)
	}

	if got := p.Snapshot().Timeout; got != 45 {
		t.Errorf("Timeout = %d, 期望 45", got)
	}

	// 持久化文件也应包含新超时（重启后生效）
	data, err := os.ReadFile(filepath.Join("config", "ai.yaml"))
	if err != nil {
		t.Fatalf("读取 ai.yaml 失败: %v", err)
	}
	if !strings.Contains(string(data), "timeout: 45") {
		t.Errorf("ai.yaml 应包含 timeout: 45")
	}
}

// NewAIConfigProvider 创建的 provider 与 AIService 共享同一份权威状态：
// AIService.UpdateConfig 写回 app.AI 后，provider 的读方法立即可见。
func TestAIConfigProviderSeesAIServiceUpdateConfig(t *testing.T) {
	t.Chdir(t.TempDir()) // 隔离 ai.yaml 落盘位置

	app := &config.Config{AI: config.AIConfig{Enabled: false}}
	p := NewAIConfigProvider(app)
	svc := NewAIService(app.AI, app, nil, nil, zap.NewNop().Sugar(), p)

	// 模拟 AI 开关保存路径：AIService.UpdateConfig 更新自己的副本并写回 app.AI
	svc.UpdateConfig(map[string]interface{}{"enabled": true, "active_provider": "p1"})
	app.AI.Providers = []config.AIProviderEntry{{ID: "p1", APIBase: "http://x", APIKey: "k"}}

	if !p.IsEnabled() {
		t.Fatal("AIService.UpdateConfig 后 IsEnabled() 应立即为 true")
	}
}
