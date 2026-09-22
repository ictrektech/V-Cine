package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"
)

// BootstrapZap 创建 production 格式 zap logger 并设为全局 logger。
// config 加载期的警告通过 zap 全局 logger 输出，需在 config.Load 之前调用；
// config 加载后调用 BuildZap 按配置重建并覆盖。
func BootstrapZap() *zap.Logger {
	logger, _ := zap.NewProduction()
	zap.ReplaceGlobals(logger)
	return logger
}

// BuildZap 按 LoggingConfig 构建 zap logger 并设为全局 logger。
// 在 config.Load 之后调用，覆盖 BootstrapZap 建立的 bootstrap logger。
//
// 输去向：
//   - OutputPath 为空：全部输出到 stderr
//   - OutputPath 非空：写入文件，EnableRotation 时按 MaxSizeMB 轮转（lumberjack）
//   - ErrorOutputPath 非空：error 及以上同时写入独立错误文件（主输出仍保留全量）
func (c *Config) BuildZap() *zap.Logger {
	level := c.effectiveLevel()
	encoder := c.newEncoder()

	core := c.newFileCore(encoder, c.Logging.OutputPath, level)

	if c.Logging.ErrorOutputPath != "" {
		errorCore := c.newFileCore(encoder, c.Logging.ErrorOutputPath, zapcore.ErrorLevel)
		core = zapcore.NewTee(core, errorCore)
	}

	logger := zap.New(core)
	zap.ReplaceGlobals(logger)
	return logger
}

// newFileCore 构建写往日志文件的 zapcore：path 为空时输出到 stderr。
// EnableRotation 时按 MaxSizeMB 轮转（lumberjack），否则为纯追加文件；
// 打不开日志文件则回退 stderr，保证日志不丢。
func (c *Config) newFileCore(encoder zapcore.Encoder, path string, level zapcore.Level) zapcore.Core {
	if path == "" {
		return zapcore.NewCore(encoder, zapcore.Lock(os.Stderr), level)
	}
	if c.Logging.EnableRotation {
		return zapcore.NewCore(encoder, c.newFileSink(path), level)
	}
	// OpenFile 只建文件不建父目录，先确保目录存在
	mkdirErr := os.MkdirAll(filepath.Dir(path), 0o755)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err == nil {
		return zapcore.NewCore(encoder, zapcore.AddSync(f), level)
	}
	zap.S().Warnw("打开日志文件失败，回退到 stderr", "path", path, "error", errors.Join(err, mkdirErr))
	return zapcore.NewCore(encoder, zapcore.Lock(os.Stderr), level)
}

// effectiveLevel 解析日志级别：Debug 开关优先，其次配置项，默认 info。
func (c *Config) effectiveLevel() zapcore.Level {
	if c.App.Debug {
		return zapcore.DebugLevel
	}
	if c.Logging.Level != "" {
		if lv, err := zapcore.ParseLevel(c.Logging.Level); err == nil {
			return lv
		}
		zap.S().Warnw("日志级别无效，回退到 info", "level", c.Logging.Level)
	}
	return zapcore.InfoLevel
}

// newEncoder 构建编码器：Debug 用 development 配置，否则 production 配置；
// 编码格式按 Format（json / console，默认 json）。
func (c *Config) newEncoder() zapcore.Encoder {
	encoderCfg := zap.NewProductionEncoderConfig()
	if c.App.Debug {
		encoderCfg = zap.NewDevelopmentEncoderConfig()
	}
	if strings.EqualFold(c.Logging.Format, "console") {
		return zapcore.NewConsoleEncoder(encoderCfg)
	}
	return zapcore.NewJSONEncoder(encoderCfg)
}

// newFileSink 创建带轮转的日志文件写入器（lumberjack）。
// 0 值语义（lumberjack）：MaxSize=0 → 默认 100MB；MaxAge/MaxBackups=0 → 不限制。
func (c *Config) newFileSink(path string) zapcore.WriteSyncer {
	return zapcore.AddSync(&lumberjack.Logger{
		Filename:   path,
		MaxSize:    c.Logging.MaxSizeMB,
		MaxAge:     c.Logging.MaxAgeDays,
		MaxBackups: c.Logging.MaxBackups,
	})
}
