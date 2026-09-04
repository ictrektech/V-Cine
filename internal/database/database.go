// Package database 负责 PostgreSQL 连接的建立与连接池配置。
// 从 internal/config 拆出：config 包只负责解析配置，
// gorm/pgx 等基础设施依赖收敛到这里，避免配置层反向耦合实现细节。
package database

import (
	"fmt"
	"log"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"

	"go.uber.org/zap"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// Open 打开 PostgreSQL 数据库连接（带启动重试），并配置连接池。
// 应用依赖 PostgreSQL：启动时多次重试连接，重试耗尽后返回错误，由调用方终止启动。
func Open(cfg *config.DatabaseConfig, logger *zap.Logger) (*gorm.DB, error) {
	sugar := logger.Sugar()

	gormLog := gormlogger.New(
		log.Default(),
		gormlogger.Config{
			SlowThreshold:             200 * time.Millisecond,
			LogLevel:                  gormlogger.Warn,
			IgnoreRecordNotFoundError: true,
			Colorful:                  false,
		},
	)

	dialector := postgres.Open(fmt.Sprintf(
		"host=%s user=%s password=%s dbname=%s port=%d sslmode=%s TimeZone=%s",
		cfg.Host, cfg.User, cfg.Password, cfg.DBName,
		cfg.Port, cfg.SSLMode, cfg.TimeZone,
	))

	// 启动重试参数来自配置；0/负数按默认值处理（防止零次尝试导致返回 nil db）
	maxRetries := cfg.ConnectRetries
	if maxRetries <= 0 {
		maxRetries = 5
	}
	retryInterval := cfg.ConnectRetryInterval
	if retryInterval <= 0 {
		retryInterval = 3
	}

	var db *gorm.DB
	var err error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		db, err = gorm.Open(dialector, &gorm.Config{Logger: gormLog})
		if err == nil {
			break
		}
		if attempt < maxRetries {
			sugar.Warnf("连接 PostgreSQL 失败（第 %d/%d 次）: %v，%ds 后重试...", attempt, maxRetries, err, retryInterval)
			time.Sleep(time.Duration(retryInterval) * time.Second)
		}
	}
	if err != nil {
		return nil, fmt.Errorf("连接 PostgreSQL 失败（已重试 %d 次，应用依赖数据库，启动中止）: %w", maxRetries, err)
	}

	// 配置 PostgreSQL 连接池
	sqlDB, dbErr := db.DB()
	if dbErr != nil {
		return nil, fmt.Errorf("获取底层 sql.DB 失败: %w", dbErr)
	}
	maxOpen := cfg.MaxOpenConns
	if maxOpen <= 0 {
		maxOpen = 25
	}
	maxIdle := cfg.MaxIdleConns
	if maxIdle <= 0 {
		maxIdle = 10
	}
	lifetime := cfg.ConnMaxLifetime
	if lifetime <= 0 {
		lifetime = 1800
	}
	sqlDB.SetMaxOpenConns(maxOpen)
	sqlDB.SetMaxIdleConns(maxIdle)
	sqlDB.SetConnMaxLifetime(time.Duration(lifetime) * time.Second)
	sugar.Infof("PostgreSQL 连接池: max_open=%d, max_idle=%d, lifetime=%ds", maxOpen, maxIdle, lifetime)

	return db, nil
}
