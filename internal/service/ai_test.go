package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nowen-video/nowen-video/internal/config"
)

// ==================== AI 搜索意图解析测试 ====================

func TestCleanJSONResponse(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "纯 JSON",
			input:    `{"query": "三体", "media_type": "movie"}`,
			expected: `{"query": "三体", "media_type": "movie"}`,
		},
		{
			name:     "Markdown 代码块包裹",
			input:    "```json\n{\"query\": \"三体\"}\n```",
			expected: `{"query": "三体"}`,
		},
		{
			name:     "前后有多余文字",
			input:    "这是搜索结果：{\"query\": \"三体\"} 以上是结果",
			expected: `{"query": "三体"}`,
		},
		{
			name:     "多余空白",
			input:    "  \n  {\"query\": \"test\"}  \n  ",
			expected: `{"query": "test"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := cleanJSONResponse(tt.input)
			if result != tt.expected {
				t.Errorf("cleanJSONResponse() = %q, 期望 %q", result, tt.expected)
			}
		})
	}
}

func TestSearchIntentFormatDebug(t *testing.T) {
	intent := &SearchIntent{
		Query:     "三体",
		MediaType: "movie",
		Genre:     "科幻",
		YearMin:   2020,
		YearMax:   2025,
		MinRating: 8.0,
		SortBy:    "rating_desc",
	}

	debug := intent.FormatSearchIntentDebug()

	// 验证包含所有关键信息
	checks := []string{"三体", "movie", "科幻", "2020", "2025", "8.0", "rating_desc"}
	for _, check := range checks {
		found := false
		for i := 0; i < len(debug)-len(check)+1; i++ {
			if debug[i:i+len(check)] == check {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("FormatSearchIntentDebug() 缺少 %q, 输出: %s", check, debug)
		}
	}
}

func TestSearchIntentFormatDebug_Minimal(t *testing.T) {
	intent := &SearchIntent{
		Query: "test",
	}

	debug := intent.FormatSearchIntentDebug()
	if debug == "" {
		t.Error("FormatSearchIntentDebug() 不应返回空字符串")
	}
}

// ==================== AI 缓存测试 ====================

func TestAICache_MemoryLayer(t *testing.T) {
	app := &config.Config{AI: testAIConfig()}
	svc := testAIService(app)

	// 写入缓存
	svc.SetCache("test_key", "test_value")
	val, ok := svc.GetCache("test_key")
	if !ok {
		t.Error("缓存应命中")
	}
	if val != "test_value" {
		t.Errorf("缓存值 = %q, 期望 %q", val, "test_value")
	}

	// 读取不存在的键
	_, ok = svc.GetCache("nonexistent")
	if ok {
		t.Error("不存在的键不应命中缓存")
	}
}

// ==================== 脱敏服务健康测试 ====================

func TestDesensitize_Healthy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/desensitize/text" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"text":"请联系****","replaced":[{"rule":"phone"}]}`))
	}))
	defer srv.Close()

	cfg := testAIConfig()
	cfg.Desensitize.Enabled = true
	cfg.Desensitize.BaseURL = srv.URL
	cfg.Desensitize.Timeout = 2
	svc := testAIService(&config.Config{AI: cfg})

	res := svc.TestDesensitize()
	if res["success"] != true {
		t.Fatalf("期望 success=true, 得到 %v (error=%v)", res["success"], res["error"])
	}
	if res["rules"] != 1 {
		t.Errorf("期望命中 1 条规则, 得到 %v", res["rules"])
	}
}

func TestDesensitize_Unreachable(t *testing.T) {
	cfg := testAIConfig()
	cfg.Desensitize.Enabled = true
	cfg.Desensitize.BaseURL = "http://127.0.0.1:1" // 不可达端口
	cfg.Desensitize.Timeout = 1
	svc := testAIService(&config.Config{AI: cfg})

	res := svc.TestDesensitize()
	if res["success"] != false {
		t.Fatalf("期望 success=false, 得到 %v", res["success"])
	}
	if res["error"] == nil {
		t.Error("不可达时应返回 error")
	}
}

func TestDesensitize_NotConfigured(t *testing.T) {
	svc := testAIService(&config.Config{AI: testAIConfig()})
	res := svc.TestDesensitize()
	if res["success"] != false {
		t.Fatalf("期望 success=false, 得到 %v", res["success"])
	}
}

func TestAICache_ClearCache(t *testing.T) {
	app := &config.Config{AI: testAIConfig()}
	svc := testAIService(app)

	// 写入多条缓存
	svc.SetCache("key1", "value1")
	svc.SetCache("key2", "value2")
	svc.SetCache("key3", "value3")

	// 清空缓存
	count := svc.ClearCache()
	if count != 3 {
		t.Errorf("清空缓存返回 %d, 期望 3", count)
	}

	// 验证缓存已清空
	_, ok := svc.GetCache("key1")
	if ok {
		t.Error("清空后缓存不应命中")
	}
}

func TestAICache_Stats(t *testing.T) {
	app := &config.Config{AI: testAIConfig()}
	svc := testAIService(app)

	svc.SetCache("key1", "value1")
	svc.SetCache("key2", "value2")

	stats := svc.GetCacheStats()
	memTotal, ok := stats["memory_total"].(int)
	if !ok || memTotal != 2 {
		t.Errorf("缓存统计 memory_total = %v, 期望 2", stats["memory_total"])
	}
}

// ==================== 辅助函数 ====================

func testAIConfig() config.AIConfig {
	return config.AIConfig{
		Enabled:       false,
		CacheTTLHours: 24,
	}
}

// testAIService 构造一个用于单测的 AIService（provider 实时读取权威状态 app.AI）。
func testAIService(app *config.Config) *AIService {
	return &AIService{
		appCfg:   app,
		provider: NewAIConfigProvider(app),
		cache:    make(map[string]*aiCacheEntry),
		logger:   testLogger(),
	}
}
