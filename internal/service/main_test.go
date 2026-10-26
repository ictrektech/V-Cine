package service

import (
	"encoding/base64"
	"os"
	"testing"
)

// TestMain 给整个测试包固定一把主密钥。VCINE_MASTER_KEY 是 internal/crypto
// 的最高优先级来源，设置后不会再生成 .master.key 文件。
func TestMain(m *testing.M) {
	// 32 字节全零密钥：仅用于测试，生产必须用真随机值。
	if os.Getenv("VCINE_MASTER_KEY") == "" {
		_ = os.Setenv("VCINE_MASTER_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	}
	os.Exit(m.Run())
}
