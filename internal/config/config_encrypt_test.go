package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mitchellh/mapstructure"
	"gopkg.in/yaml.v3"
)

// newTestConfig 构造各 section 带敏感字段的测试配置。
func newTestConfig() *Config {
	c := &Config{}
	c.AI.Providers = []AIProviderEntry{
		{ID: "deepseek", Name: "DeepSeek", APIBase: "https://api.deepseek.com", APIKey: "sk-test123"},
	}
	c.AI.ActiveProvider = "deepseek"
	c.AI.WhisperAPIKey = "wh-test123"

	c.Storage.WebDAV.ServerURL = "https://dav.example.com"
	c.Storage.WebDAV.Password = "davpass"
	c.Storage.Alist.ServerURL = "https://alist.example.com"
	c.Storage.Alist.Token = "alisttoken"
	c.Storage.Alist.Password = "alistpass2"
	c.Storage.S3.SecretKey = "s3secret"

	c.Secrets.TMDbAPIKey = "tmdbkey"
	c.Secrets.TMDbAPIProxy = "https://proxy.example.com"
	c.Secrets.BangumiAccessToken = "bgmtoken"
	c.Secrets.DoubanCookie = "dbcl2=abc"

	c.VideoAnalysis.SourceToken = "vtoken"
	c.VideoAnalysis.SceneBaseURL = "https://scene.example.com"

	c.AdultScraper.JavBusURL = "https://www.javbus.com"
	c.AdultScraper.CookieJavBus = "cookie-javbus-val"
	c.AdultScraper.CookieJavDB = "cookie-javdb-val"

	return c
}

// saveSectionToTempDir 在临时目录中保存 section 并返回文件内容。
func saveSectionToTempDir(t *testing.T, c *Config, fileName string, save func() error) string {
	t.Helper()
	tmp := t.TempDir()
	t.Chdir(tmp)
	if err := save(); err != nil {
		t.Fatalf("保存 %s 失败: %v", fileName, err)
	}
	data, err := os.ReadFile(filepath.Join(tmp, "config", fileName))
	if err != nil {
		t.Fatalf("读取 %s 失败: %v", fileName, err)
	}
	return string(data)
}

// assertEncrypted 断言 yaml 中指定 key 的值为 ENC: 密文，其余 key 为明文。
func assertEncrypted(t *testing.T, yamlContent string, encryptedKeys, plainKeys []string) {
	t.Helper()
	var m map[string]interface{}
	if err := yaml.Unmarshal([]byte(yamlContent), &m); err != nil {
		t.Fatalf("解析 yaml 失败: %v", err)
	}
	for _, key := range encryptedKeys {
		v, ok := m[key]
		if !ok {
			t.Errorf("key %q 不存在于 yaml 中", key)
			continue
		}
		s, _ := v.(string)
		if !strings.HasPrefix(s, "ENC:") {
			t.Errorf("key %q 应为 ENC: 密文，实际非密文", key)
		}
	}
	for _, key := range plainKeys {
		v, ok := m[key]
		if !ok {
			t.Errorf("key %q 不存在于 yaml 中", key)
			continue
		}
		if s, _ := v.(string); strings.HasPrefix(s, "ENC:") {
			t.Errorf("key %q 应为明文，实际是 ENC: 密文", key)
		}
	}
}

// decryptBack 从 yaml 内容还原 section 并解密（模拟 Load 流程：map → struct → 解密）。
func decryptBack[T any](t *testing.T, yamlContent string, out *T) {
	t.Helper()
	var m map[string]interface{}
	if err := yaml.Unmarshal([]byte(yamlContent), &m); err != nil {
		t.Fatalf("解析 yaml 失败: %v", err)
	}
	if err := mapstructure.Decode(m, out); err != nil {
		t.Fatalf("还原 struct 失败: %v", err)
	}
	decryptEncValues(out)
}

func TestSaveSectionEncryptsTaggedFields(t *testing.T) {
	c := newTestConfig()

	t.Run("ai", func(t *testing.T) {
		content := saveSectionToTempDir(t, c, "ai.yaml", func() error {
			return SaveSection(c, "ai", "ai.yaml", func() AIConfig { return c.AI })
		})
		assertEncrypted(t, content,
			[]string{"whisper_api_key"},
			[]string{"active_provider"})
		var m map[string]interface{}
		yaml.Unmarshal([]byte(content), &m)
		providers, _ := m["providers"].([]interface{})
		if len(providers) != 1 {
			t.Fatalf("providers 应有 1 条，实际 %d", len(providers))
		}
		p := providers[0].(map[string]interface{})
		if s, _ := p["api_key"].(string); !strings.HasPrefix(s, "ENC:") {
			t.Errorf("providers[0].api_key 应为 ENC: 密文")
		}
		if s, _ := p["api_base"].(string); s != "https://api.deepseek.com" {
			t.Errorf("providers[0].api_base 应为明文，实际: %v", p["api_base"])
		}

		var back AIConfig
		decryptBack(t, content, &back)
		if back.Providers[0].APIKey != "sk-test123" {
			t.Errorf("解密后 api_key 应为明文 sk-test123，实际: %q", back.Providers[0].APIKey)
		}
		if back.WhisperAPIKey != "wh-test123" {
			t.Errorf("解密后 whisper_api_key 应为明文 wh-test123，实际: %q", back.WhisperAPIKey)
		}
	})

	t.Run("storage", func(t *testing.T) {
		content := saveSectionToTempDir(t, c, "storage.yaml", func() error {
			return SaveSection(c, "storage", "storage.yaml", func() StorageConfig { return c.Storage })
		})
		// webdav / alist / s3 均为嵌套块，逐块断言
		var m map[string]interface{}
		yaml.Unmarshal([]byte(content), &m)

		webdav, _ := m["webdav"].(map[string]interface{})
		if webdav == nil {
			t.Fatalf("webdav 块不存在")
		}
		if s, _ := webdav["password"].(string); !strings.HasPrefix(s, "ENC:") {
			t.Errorf("webdav.password 应为 ENC: 密文")
		}
		if s, _ := webdav["server_url"].(string); s != "https://dav.example.com" {
			t.Errorf("webdav.server_url 应为明文，实际: %v", webdav["server_url"])
		}

		alist, _ := m["alist"].(map[string]interface{})
		if alist == nil {
			t.Fatalf("alist 块不存在")
		}
		for _, key := range []string{"token", "password"} {
			s, _ := alist[key].(string)
			if !strings.HasPrefix(s, "ENC:") {
				t.Errorf("alist.%s 应为 ENC: 密文", key)
			}
		}

		s3, _ := m["s3"].(map[string]interface{})
		if s3 == nil {
			t.Fatalf("s3 块不存在")
		}
		if s, _ := s3["secret_key"].(string); !strings.HasPrefix(s, "ENC:") {
			t.Errorf("s3.secret_key 应为 ENC: 密文")
		}

		var back StorageConfig
		decryptBack(t, content, &back)
		if back.WebDAV.Password != "davpass" {
			t.Errorf("解密后 webdav.password 应为明文 davpass，实际: %q", back.WebDAV.Password)
		}
		if back.Alist.Token != "alisttoken" {
			t.Errorf("解密后 alist.token 应为明文 alisttoken，实际: %q", back.Alist.Token)
		}
		if back.Alist.Password != "alistpass2" {
			t.Errorf("解密后 alist.password 应为明文 alistpass2，实际: %q", back.Alist.Password)
		}
		if back.S3.SecretKey != "s3secret" {
			t.Errorf("解密后 s3.secret_key 应为明文 s3secret，实际: %q", back.S3.SecretKey)
		}
	})

	t.Run("secrets", func(t *testing.T) {
		content := saveSectionToTempDir(t, c, "secrets.yaml", func() error {
			return saveSecretsShard(c)
		})
		assertEncrypted(t, content,
			[]string{"tmdb_api_key", "bangumi_access_token", "douban_cookie"},
			[]string{"tmdb_api_proxy"})
		if strings.Contains(content, "jwt_secret") {
			t.Errorf("secrets.yaml 不应包含 jwt_secret（由 data/.jwt_secret 单独管理）")
		}

		var back SecretsConfig
		decryptBack(t, content, &back)
		if back.TMDbAPIKey != "tmdbkey" {
			t.Errorf("解密后 tmdb_api_key 应为明文 tmdbkey，实际: %q", back.TMDbAPIKey)
		}
		if back.BangumiAccessToken != "bgmtoken" {
			t.Errorf("解密后 bangumi_access_token 应为明文 bgmtoken，实际: %q", back.BangumiAccessToken)
		}
	})

	t.Run("video_analysis", func(t *testing.T) {
		content := saveSectionToTempDir(t, c, "video_analysis.yaml", func() error {
			return SaveSection(c, "video_analysis", "video_analysis.yaml", func() VideoAnalysisConfig { return c.VideoAnalysis })
		})
		assertEncrypted(t, content,
			[]string{"source_token"},
			[]string{"scene_base_url"})

		var back VideoAnalysisConfig
		decryptBack(t, content, &back)
		if back.SourceToken != "vtoken" {
			t.Errorf("解密后 source_token 应为明文 vtoken，实际: %q", back.SourceToken)
		}
	})

	t.Run("adult_scraper", func(t *testing.T) {
		content := saveSectionToTempDir(t, c, "adult_scraper.yaml", func() error {
			return SaveSection(c, "adult_scraper", "adult_scraper.yaml", func() AdultScraperConfig { return c.AdultScraper })
		})
		assertEncrypted(t, content,
			[]string{"cookie_javbus", "cookie_javdb"},
			[]string{"javbus_url"})

		var back AdultScraperConfig
		decryptBack(t, content, &back)
		if back.CookieJavBus != "cookie-javbus-val" {
			t.Errorf("解密后 cookie_javbus 应为明文，实际: %q", back.CookieJavBus)
		}
		if back.CookieJavDB != "cookie-javdb-val" {
			t.Errorf("解密后 cookie_javdb 应为明文，实际: %q", back.CookieJavDB)
		}
	})
}

func TestDecryptEncValuesSkipsPlain(t *testing.T) {
	type inner struct {
		Token string `mapstructure:"token"`
		Note  string `mapstructure:"note"`
	}
	type outer struct {
		Key    string  `mapstructure:"key"`
		Plain  string  `mapstructure:"plain"`
		Inner  inner   `mapstructure:"inner"`
		Items  []inner `mapstructure:"items"`
		Number int     `mapstructure:"number"`
	}
	o := outer{
		Key:    "ENC:AAAA",
		Plain:  "normal-value",
		Inner:  inner{Token: "ENC:BBBB", Note: "note"},
		Items:  []inner{{Token: "ENC:CCCC"}},
		Number: 42,
	}
	decryptEncValues(&o)

	// 密文格式不合法时 decryptSecretValue 会透传原值（见下方断言）；
	if o.Plain != "normal-value" {
		t.Errorf("明文字段不应被改动，实际: %q", o.Plain)
	}
	if o.Number != 42 {
		t.Errorf("非 string 字段不应被改动")
	}
	// ENC: 前缀但解不开的值应透传
	if o.Key != "ENC:AAAA" {
		t.Errorf("解不开的密文应透传原值，实际: %q", o.Key)
	}
	if o.Inner.Token != "ENC:BBBB" {
		t.Errorf("嵌套 struct 中解不开的密文应透传，实际: %q", o.Inner.Token)
	}
	if o.Items[0].Token != "ENC:CCCC" {
		t.Errorf("切片元素中解不开的密文应透传，实际: %q", o.Items[0].Token)
	}
	if o.Inner.Note != "note" {
		t.Errorf("未加密的嵌套字段不应被改动，实际: %q", o.Inner.Note)
	}
}
