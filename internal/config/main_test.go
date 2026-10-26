package config

import (
	"encoding/base64"
	"os"
	"testing"
)

// TestMain 固定测试包的主密钥。VCINE_MASTER_KEY 是 internal/crypto 的最高优先级
// 来源，设置后不会再生成 .master.key 文件。
func TestMain(m *testing.M) {
	if os.Getenv("VCINE_MASTER_KEY") == "" {
		// 32 字节全零密钥：仅用于测试，生产必须用真随机值。
		_ = os.Setenv("VCINE_MASTER_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	}
	os.Exit(m.Run())
}
