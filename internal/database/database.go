// Package database 负责 PostgreSQL 连接的建立与连接池配置。
// 从 internal/config 拆出：config 包只负责解析配置，
// gorm/pgx 等基础设施依赖收敛到这里，避免配置层反向耦合实现细节。
package database

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"

	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/jackc/pgx/v5/stdlib"
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
	autoCreateDone := false
	for attempt := 1; attempt <= maxRetries; attempt++ {
		db, err = gorm.Open(postgres.Open(dsnOf(cfg)), &gorm.Config{Logger: gormLog})
		if err == nil {
			break
		}
		// 库不存在（SQLSTATE 3D000）且允许自动创建时：连 postgres 系统库建库（含 pgvector
		// 扩展）后回到重试流程；角色由基础设施层预置，这里不创建。
		if cfg.AutoCreate && !autoCreateDone && isMissingDatabase(err) {
			autoCreateDone = true
			if crtErr := createDatabase(cfg, sugar); crtErr != nil {
				sugar.Warnw("自动创建数据库失败", "cfg_DBName", cfg.DBName, "error", crtErr)
			}
		}
		if attempt < maxRetries {
			sugar.Warnw("连接 PostgreSQL 失败，稍后重试", "attempt", attempt, "maxRetries", maxRetries, "error", err, "retryInterval", retryInterval)
			time.Sleep(time.Duration(retryInterval) * time.Second)
		}
	}
	if err != nil {
		if isMissingDatabase(err) && cfg.AutoCreate {
			return nil, fmt.Errorf("连接 PostgreSQL 失败：数据库 %s 不存在且自动创建失败（连接用户需 CREATEDB 权限），请手动创建: %w", cfg.DBName, err)
		}
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

// dsnOf 拼接 PostgreSQL 连接 DSN。
func dsnOf(cfg *config.DatabaseConfig) string {
	return fmt.Sprintf(
		"host=%s user=%s password=%s dbname=%s port=%d sslmode=%s TimeZone=%s",
		cfg.Host, cfg.User, cfg.Password, cfg.DBName,
		cfg.Port, cfg.SSLMode, cfg.TimeZone,
	)
}

// isMissingDatabase 判断错误是否为目标数据库不存在（SQLSTATE 3D000）。
func isMissingDatabase(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "3D000"
}

// createDatabase 连接 postgres 系统库创建目标数据库，并在新库中启用 pgvector 扩展。
// 需要连接用户具有 CREATEDB 权限且服务器已安装 pgvector；失败时返回错误，
// 由调用方降级为告警并继续重试（或给出人工处理指引）。
func createDatabase(cfg *config.DatabaseConfig, sugar *zap.SugaredLogger) error {
	sugar.Infof("数据库 %s 不存在，尝试自动创建（连接用户需 CREATEDB 权限）...", cfg.DBName)

	admin := *cfg
	admin.DBName = "postgres"
	adminDB, err := sql.Open("pgx", dsnOf(&admin))
	if err != nil {
		return err
	}
	defer adminDB.Close()
	// CREATE DATABASE 不支持参数化，库名经 %q 标识符引用防注入
	if _, err := adminDB.Exec(fmt.Sprintf(`CREATE DATABASE %q`, cfg.DBName)); err != nil {
		return err
	}

	// pgvector：场景搜索的 scenes 表使用 vector 类型，AutoMigrate 前必须可用；
	// 服务器未安装 pgvector 时仅告警，AutoMigrate 会给出明确错误。
	extDB, err := sql.Open("pgx", dsnOf(cfg))
	if err != nil {
		return err
	}
	defer extDB.Close()
	if _, err := extDB.Exec(`CREATE EXTENSION IF NOT EXISTS vector`); err != nil {
		return err
	}
	return nil
}
