package config

import (
	"encoding/base64"
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
