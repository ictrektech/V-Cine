package config

import (
	"encoding/base64"
	"strings"
	"testing"

	secretcrypto "github.com/nowen-video/nowen-video/internal/crypto"
)

func TestDecryptSecretValue(t *testing.T) {
	key := make([]byte, 32)
	t.Setenv("VCINE_MASTER_KEY", base64.StdEncoding.EncodeToString(key))

	plain := "sk-test-secret"
	enc, err := secretcrypto.Encrypt(plain)
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	if got := decryptSecretValue(enc); got != plain {
		t.Fatalf("decryptSecretValue(%q) = %q, want %q", enc, got, plain)
	}
	if got := decryptSecretValue("ENC:" + enc); got != plain {
		t.Fatalf("decryptSecretValue(double ENC) = %q, want %q", got, plain)
	}
	if got := decryptSecretValue(plain); got != plain {
		t.Fatalf("decryptSecretValue(plain) = %q, want %q", got, plain)
	}
	if got := decryptSecretValue(""); got != "" {
		t.Fatalf("decryptSecretValue(empty) = %q, want empty", got)
	}
}

// TestSaveAIConfigKeepsMemoryKeyPlain 回归测试：SaveSection 的 encryptStruct
// 通过反射原地改写 enc 字段——若 snapshot 返回浅拷贝，Providers 切片与
// c.AI.Providers 共享底层数组，落盘时会把内存中的明文 key 原地加密成
// "ENC:xxx"，之后所有调用发送 Bearer ENC:xxx 必然 401。
// 修复：saveAIConfig 的 snapshot 闭包必须返回深拷贝。
func TestSaveAIConfigKeepsMemoryKeyPlain(t *testing.T) {
	key := make([]byte, 32)
	t.Setenv("VCINE_MASTER_KEY", base64.StdEncoding.EncodeToString(key))

	c := &Config{AI: AIConfig{
		Enabled:        true,
		ActiveProvider: "custom_ictrek",
		Providers: []AIProviderEntry{{
			ID:      "custom_ictrek",
			Name:    "custom",
			APIBase: "http://127.0.0.1:49944/v1",
			APIKey:  "sk-plain-in-memory",
			Models:  []AIModelEntry{{Name: "test-model"}},
		}},
	}}

	content := saveSectionToTempDir(t, c, "ai.yaml", func() error {
		return c.saveAIConfig()
	})

	// 落盘后内存中的 key 必须仍是明文（浅拷贝共享数组会把它原地加密成 ENC:）
	got := c.AI.Providers[0].APIKey
	if got != "sk-plain-in-memory" {
		t.Fatalf("落盘后内存中的 key 被污染: %q，期望明文 %q", got, "sk-plain-in-memory")
	}
	// 落盘的分片文件里必须是 ENC: 密文
	if !strings.Contains(content, "ENC:") {
		t.Fatalf("分片文件应含 ENC: 密文，实际: %s", content)
	}
}
