package config

import "go.uber.org/zap"

// BootstrapZap 创建 production 格式 zap logger 并设为全局 logger。
// config 加载期的警告通过 zap 全局 logger 输出，需在 config.Load 之前调用；
// server 启动后按 Debug 再切换为 development 格式。
func BootstrapZap() *zap.Logger {
	logger, _ := zap.NewProduction()
	zap.ReplaceGlobals(logger)
	return logger
}
