package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.uber.org/zap"
)

// newLoggingTestConfig 构建最小可用配置（App.Debug=false，级别默认 info）。
func newLoggingTestConfig(outputPath, errorOutputPath string) *Config {
	return &Config{
		App: AppConfig{Debug: false},
		Logging: LoggingConfig{
			Level:           "info",
			Format:          "json",
			OutputPath:      outputPath,
			ErrorOutputPath: errorOutputPath,
		},
	}
}

func TestBuildZap_FileOutput(t *testing.T) {
	dir := t.TempDir()
	logFile := filepath.Join(dir, "app.log")

	prev := zap.ReplaceGlobals(zap.NewNop())
	t.Cleanup(prev)

	logger := newLoggingTestConfig(logFile, "").BuildZap()
	logger.Info("hello file")
	logger.Warn("warn file")
	if err := logger.Sync(); err != nil {
		t.Fatalf("Sync 失败: %v", err)
	}

	data, err := os.ReadFile(logFile)
	if err != nil {
		t.Fatalf("读取日志文件失败: %v", err)
	}
	got := string(data)
	if !strings.Contains(got, "hello file") || !strings.Contains(got, "warn file") {
		t.Fatalf("日志文件缺少预期内容: %q", got)
	}
	if !strings.Contains(got, `"level":"info"`) {
		t.Fatalf("期望 JSON 编码（默认 format=json）: %q", got)
	}
}

func TestBuildZap_LevelFilter(t *testing.T) {
	dir := t.TempDir()
	logFile := filepath.Join(dir, "app.log")

	prev := zap.ReplaceGlobals(zap.NewNop())
	t.Cleanup(prev)

	cfg := newLoggingTestConfig(logFile, "")
	cfg.Logging.Level = "error"
	logger := cfg.BuildZap()
	logger.Info("should not appear")
	logger.Error("should appear")
	if err := logger.Sync(); err != nil {
		t.Fatalf("Sync 失败: %v", err)
	}

	data, err := os.ReadFile(logFile)
	if err != nil {
		t.Fatalf("读取日志文件失败: %v", err)
	}
	got := string(data)
	if strings.Contains(got, "should not appear") {
		t.Fatalf("info 日志不应写入 error 级别文件: %q", got)
	}
	if !strings.Contains(got, "should appear") {
		t.Fatalf("error 日志应写入文件: %q", got)
	}
}

func TestBuildZap_ErrorFileSplit(t *testing.T) {
	dir := t.TempDir()
	logFile := filepath.Join(dir, "app.log")
	errFile := filepath.Join(dir, "error.log")

	prev := zap.ReplaceGlobals(zap.NewNop())
	t.Cleanup(prev)

	logger := newLoggingTestConfig(logFile, errFile).BuildZap()
	logger.Info("info msg")
	logger.Error("error msg")
	if err := logger.Sync(); err != nil {
		t.Fatalf("Sync 失败: %v", err)
	}

	mainData, err := os.ReadFile(logFile)
	if err != nil {
		t.Fatalf("读取主日志文件失败: %v", err)
	}
	if !strings.Contains(string(mainData), "info msg") || !strings.Contains(string(mainData), "error msg") {
		t.Fatalf("主日志文件应包含全量日志: %q", string(mainData))
	}

	errData, err := os.ReadFile(errFile)
	if err != nil {
		t.Fatalf("读取错误日志文件失败: %v", err)
	}
	if !strings.Contains(string(errData), "error msg") {
		t.Fatalf("错误文件应包含 error 日志: %q", string(errData))
	}
	if strings.Contains(string(errData), "info msg") {
		t.Fatalf("错误文件不应包含 info 日志: %q", string(errData))
	}
}

func TestBuildZap_StderrDefault(t *testing.T) {
	prev := zap.ReplaceGlobals(zap.NewNop())
	t.Cleanup(prev)

	// OutputPath 为空：不落文件，仅 stderr，构建即用
	logger := newLoggingTestConfig("", "").BuildZap()
	logger.Info("stderr only")
	// stderr 为管道时 Sync 返回 EINVAL，属无害（写入本身无缓冲）
	_ = logger.Sync()
}

func TestBuildZap_RotationRetention(t *testing.T) {
	dir := t.TempDir()
	logFile := filepath.Join(dir, "app.log")

	prev := zap.ReplaceGlobals(zap.NewNop())
	t.Cleanup(prev)

	cfg := newLoggingTestConfig(logFile, "")
	cfg.Logging.EnableRotation = true
	cfg.Logging.MaxSizeMB = 1
	cfg.Logging.MaxBackups = 1
	logger := cfg.BuildZap()

	// 写入 >2MB 触发至少 2 次轮转
	line := strings.Repeat("x", 1024)
	for i := 0; i < 2200; i++ {
		logger.Info(line)
	}
	if err := logger.Sync(); err != nil {
		t.Fatalf("Sync 失败: %v", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("读取目录失败: %v", err)
	}
	// MaxBackups=1：最多保留当前文件 + 1 个备份
	if len(entries) > 2 {
		var names []string
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("MaxBackups=1 时应最多保留 2 个日志文件，实际 %d 个: %v", len(entries), names)
	}
}

func TestBuildZap_ErrorFileWithoutOutputPath(t *testing.T) {
	dir := t.TempDir()
	errFile := filepath.Join(dir, "error.log")

	prev := zap.ReplaceGlobals(zap.NewNop())
	t.Cleanup(prev)

	// OutputPath 留空（stderr 为主）时，仅配 error_output_path 也应生效
	logger := newLoggingTestConfig("", errFile).BuildZap()
	logger.Info("info msg")
	logger.Error("error msg")
	// stderr 为管道时 Sync 返回 EINVAL，属无害（文件写入本身同步无缓冲）
	_ = logger.Sync()

	errData, err := os.ReadFile(errFile)
	if err != nil {
		t.Fatalf("读取错误文件失败: %v", err)
	}
	if !strings.Contains(string(errData), "error msg") {
		t.Fatalf("错误文件应包含 error 日志: %q", string(errData))
	}
	if strings.Contains(string(errData), "info msg") {
		t.Fatalf("错误文件不应包含 info 日志: %q", string(errData))
	}
}

func TestBuildZap_ErrorFileCreatesParentDir(t *testing.T) {
	dir := t.TempDir()
	// sub 目录不存在，应自动创建
	errFile := filepath.Join(dir, "sub", "error.log")

	prev := zap.ReplaceGlobals(zap.NewNop())
	t.Cleanup(prev)

	logger := newLoggingTestConfig("", errFile).BuildZap()
	logger.Error("error msg")
	// stderr 为管道时 Sync 返回 EINVAL，属无害
	_ = logger.Sync()

	errData, err := os.ReadFile(errFile)
	if err != nil {
		t.Fatalf("error 文件未创建（父目录应自动创建）: %v", err)
	}
	if !strings.Contains(string(errData), "error msg") {
		t.Fatalf("错误文件应包含 error 日志: %q", string(errData))
	}
}
