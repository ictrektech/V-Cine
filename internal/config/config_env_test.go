package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/spf13/viper"
)

// TestEnvOverridesShardConfig 验证：设置非空环境变量时，config/ 分片文件不应覆盖 env。
// 这是配置优先级"env 最高"承诺的回归测试——分片文件用 viper.Set 写入会吞掉 env。

// clearDatabaseEnv 清空 VCINE_DATABASE_* 环境变量（env 优先级高于分片文件）。
// t.Setenv 会在测试结束后还原原值。
func clearDatabaseEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"VCINE_DATABASE_HOST", "VCINE_DATABASE_PORT", "VCINE_DATABASE_USER",
		"VCINE_DATABASE_PASSWORD", "VCINE_DATABASE_DBNAME", "VCINE_DATABASE_SSLMODE",
		"VCINE_DATABASE_TIMEZONE",
	} {
		t.Setenv(key, "")
	}
}

func TestEnvOverridesShardConfig(t *testing.T) {
	viper.Reset()
	t.Cleanup(viper.Reset)
	clearDatabaseEnv(t)

	tempDir := t.TempDir()
	mainBody := `
app:
  data_dir: ./data
cache:
  cache_dir: ./cache
`
	if err := os.WriteFile(filepath.Join(tempDir, "config.yaml"), []byte(mainBody), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(tempDir, "config"), 0755); err != nil {
		t.Fatal(err)
	}
	shardBody := `
host: 10.0.0.1
port: 5432
user: postgres
password: shard-password
dbname: nowen_video
sslmode: disable
timezone: Asia/Shanghai
`
	if err := os.WriteFile(filepath.Join(tempDir, "config", "database.yaml"), []byte(shardBody), 0600); err != nil {
		t.Fatal(err)
	}

	oldWorkingDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(oldWorkingDir) })

	// 设置非空环境变量：password/host 用 env，其余走分片文件
	t.Setenv("VCINE_DATABASE_PASSWORD", "env-password")
	t.Setenv("VCINE_DATABASE_HOST", "192.168.1.100")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}

	if cfg.Database.Password != "env-password" {
		t.Fatalf("env 未覆盖分片 password: got %q, want %q", cfg.Database.Password, "env-password")
	}
	if cfg.Database.Host != "192.168.1.100" {
		t.Fatalf("env 未覆盖分片 host: got %q, want %q", cfg.Database.Host, "192.168.1.100")
	}
	if cfg.Database.Port != 5432 {
		t.Fatalf("分片 port 被误改: got %d, want %d", cfg.Database.Port, 5432)
	}
	if cfg.Database.DBName != "nowen_video" {
		t.Fatalf("分片 dbname 被误改: got %q, want %q", cfg.Database.DBName, "nowen_video")
	}
}

// TestEmptyEnvDoesNotOverrideShardConfig 验证：空字符串 env（如 compose ${VAR:-} 注入）
// 不应被视为"已设置"，分片文件值需保留，否则 DB 密码会被清空导致连不上库。
func TestEmptyEnvDoesNotOverrideShardConfig(t *testing.T) {
	viper.Reset()
	t.Cleanup(viper.Reset)

	tempDir := t.TempDir()
	mainBody := `
app:
  data_dir: ./data
cache:
  cache_dir: ./cache
`
	if err := os.WriteFile(filepath.Join(tempDir, "config.yaml"), []byte(mainBody), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(tempDir, "config"), 0755); err != nil {
		t.Fatal(err)
	}
	shardBody := `
host: 10.0.0.1
port: 5432
user: postgres
password: shard-password
dbname: nowen_video
sslmode: disable
timezone: Asia/Shanghai
`
	if err := os.WriteFile(filepath.Join(tempDir, "config", "database.yaml"), []byte(shardBody), 0600); err != nil {
		t.Fatal(err)
	}

	oldWorkingDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(oldWorkingDir) })

	// 空字符串 env：模拟 compose 的 ${VCINE_DATABASE_PASSWORD:-} 空占位
	t.Setenv("VCINE_DATABASE_PASSWORD", "")
	t.Setenv("VCINE_DATABASE_HOST", "")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}

	if cfg.Database.Password != "shard-password" {
		t.Fatalf("空 env 误覆盖分片 password: got %q, want %q", cfg.Database.Password, "shard-password")
	}
	if cfg.Database.Host != "10.0.0.1" {
		t.Fatalf("空 env 误覆盖分片 host: got %q, want %q", cfg.Database.Host, "10.0.0.1")
	}
}

// TestShardConfigUsedWithoutEnv 验证：未设环境变量时，分片文件照常生效（无回归）。
func TestShardConfigUsedWithoutEnv(t *testing.T) {
	viper.Reset()
	t.Cleanup(viper.Reset)
	clearDatabaseEnv(t)

	tempDir := t.TempDir()
	mainBody := `
app:
  data_dir: ./data
cache:
  cache_dir: ./cache
`
	if err := os.WriteFile(filepath.Join(tempDir, "config.yaml"), []byte(mainBody), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(tempDir, "config"), 0755); err != nil {
		t.Fatal(err)
	}
	shardBody := `
host: 10.0.0.1
port: 5433
user: postgres
password: shard-password
dbname: nowen_video
sslmode: disable
timezone: Asia/Shanghai
`
	if err := os.WriteFile(filepath.Join(tempDir, "config", "database.yaml"), []byte(shardBody), 0600); err != nil {
		t.Fatal(err)
	}

	oldWorkingDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(oldWorkingDir) })

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}

	if cfg.Database.Host != "10.0.0.1" || cfg.Database.Port != 5433 || cfg.Database.Password != "shard-password" {
		t.Fatalf("无 env 时分片未生效: %+v", cfg.Database)
	}
}
