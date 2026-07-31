// Package testutil 提供测试基础设施工具函数。
// NewTestDB() 连接 PostgreSQL 测试数据库，通过 DROP/CREATE 重建 schema 确保隔离性。
// 使用说明：多包测试时需用 `go test -p 1` 避免并发冲突。
package testutil

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/nowen-video/nowen-video/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var mu sync.Mutex

func getTestDSN() string {
	if dsn := os.Getenv("NOWEN_TEST_DATABASE_DSN"); dsn != "" {
		return dsn
	}
	host := envOr("NOWEN_TEST_DATABASE_HOST", "10.144.144.232")
	port := envOr("NOWEN_TEST_DATABASE_PORT", "35432")
	user := envOr("NOWEN_TEST_DATABASE_USER", "postgres")
	password := envOr("NOWEN_TEST_DATABASE_PASSWORD", "postgres")
	dbname := envOr("NOWEN_TEST_DATABASE_DBNAME", "nowen_test")
	sslmode := envOr("NOWEN_TEST_DATABASE_SSLMODE", "disable")
	return fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=%s TimeZone=Asia/Shanghai",
		host, user, password, dbname, port, sslmode)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ensureTestDB 确保测试数据库存在，不存在则创建。
// 同时检测 pgvector 扩展的"孤儿"损坏状态（扩展目录存在但所在 schema 已被 DROP，
// 导致 vector 类型悬空不可用），此时 CREATE EXTENSION IF NOT EXISTS 会静默跳过，
// 需重建整个测试数据库才能恢复。
func ensureTestDB() error {
	dsn := getTestDSN()
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err == nil {
		defer func() {
			if sqlDB, e := db.DB(); e == nil {
				sqlDB.Close()
			}
		}()
		if vectorOrphaned(db) {
			return repairOrphanedVector()
		}
		return nil
	}

	host, port, user, password, _, sslmode := dsnConfig()
	dbname := envOr("NOWEN_TEST_DATABASE_DBNAME", "nowen_test")
	adminConn := fmt.Sprintf("host=%s user=%s password=%s dbname=postgres port=%s sslmode=%s",
		host, user, password, port, sslmode)
	adminDB, adminErr := gorm.Open(postgres.Open(adminConn), &gorm.Config{})
	if adminErr != nil {
		return fmt.Errorf("连接 PostgreSQL 管理数据库失败: %w", adminErr)
	}
	var count int64
	adminDB.Raw("SELECT COUNT(*) FROM pg_database WHERE datname = ?", dbname).Scan(&count)
	if count == 0 {
		if err := adminDB.Exec(fmt.Sprintf("CREATE DATABASE %s", dbname)).Error; err != nil {
			return fmt.Errorf("创建测试数据库 %s 失败: %w", dbname, err)
		}
		fmt.Printf("已创建测试数据库: %s\n", dbname)
	}
	if sqlDB, err := adminDB.DB(); err == nil {
		sqlDB.Close()
	}
	return nil
}

// vectorOrphaned 判断 pgvector 扩展是否处于孤儿损坏状态：
// 扩展已注册（pg_extension 中存在 vector），但其命名空间悬空（schema 已被 DROP），
// 或 vector 类型已不存在。此时 CREATE EXTENSION IF NOT EXISTS 会静默跳过。
func vectorOrphaned(db *gorm.DB) bool {
	var orphaned bool
	if err := db.Raw(`
		SELECT EXISTS (
			SELECT 1 FROM pg_extension e
			WHERE e.extname = 'vector'
			  AND (NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.oid = e.extnamespace)
			       OR NOT EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'vector'))
		)
	`).Scan(&orphaned).Error; err != nil {
		return false
	}
	return orphaned
}

// repairOrphanedVector 修复 pgvector 孤儿状态：重建整个测试数据库。
// 不直接 DROP EXTENSION，因为损坏状态下删除 pgvector 扩展可能令 PostgreSQL 崩溃
// （recovery 模式），而 DROP/CREATE DATABASE 已验证安全可靠。
func repairOrphanedVector() error {
	host, port, user, password, dbname, sslmode := dsnConfig()
	adminConn := fmt.Sprintf("host=%s user=%s password=%s dbname=postgres port=%s sslmode=%s",
		host, user, password, port, sslmode)
	adminDB, adminErr := gorm.Open(postgres.Open(adminConn), &gorm.Config{})
	if adminErr != nil {
		return fmt.Errorf("连接 PostgreSQL 管理数据库失败: %w", adminErr)
	}
	defer func() {
		if sqlDB, e := adminDB.DB(); e == nil {
			sqlDB.Close()
		}
	}()

	// 终止所有指向测试库的连接（含自身），否则无法 DROP DATABASE
	if err := adminDB.Exec(fmt.Sprintf(
		"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid()",
		dbname)).Error; err != nil {
		return fmt.Errorf("终止测试库连接失败: %w", err)
	}
	if err := adminDB.Exec(fmt.Sprintf("DROP DATABASE IF EXISTS %s", dbname)).Error; err != nil {
		return fmt.Errorf("重建测试库失败（DROP DATABASE %s）: %w", dbname, err)
	}
	if err := adminDB.Exec(fmt.Sprintf("CREATE DATABASE %s", dbname)).Error; err != nil {
		return fmt.Errorf("重建测试库失败（CREATE DATABASE %s）: %w", dbname, err)
	}
	fmt.Printf("检测到 pgvector 孤儿状态，已重建测试数据库: %s\n", dbname)
	return nil
}

func dsnConfig() (host, port, user, password, dbname, sslmode string) {
	host = envOr("NOWEN_TEST_DATABASE_HOST", "10.144.144.232")
	port = envOr("NOWEN_TEST_DATABASE_PORT", "35432")
	user = envOr("NOWEN_TEST_DATABASE_USER", "postgres")
	password = envOr("NOWEN_TEST_DATABASE_PASSWORD", "postgres")
	dbname = envOr("NOWEN_TEST_DATABASE_DBNAME", "nowen_test")
	sslmode = envOr("NOWEN_TEST_DATABASE_SSLMODE", "disable")
	return
}

// NewTestDB 创建一个 PostgreSQL 测试数据库连接并执行 AutoMigrate。
// 每次调用重建 public schema（DROP + CREATE），确保测试隔离性。
// 注意：多包测试时请用 `go test -p 1` 避免并发 schema 冲突。
func NewTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	// 安全校验：数据库名必须包含 "test"，防止误删业务数据
	_, _, _, _, dbname, _ := dsnConfig()
	if !strings.Contains(strings.ToLower(dbname), "test") {
		t.Fatalf("❌ 安全拦截：测试数据库名 %q 不包含 \"test\"，拒绝 DROP SCHEMA 操作", dbname)
	}

	if err := ensureTestDB(); err != nil {
		t.Fatalf("无法初始化测试数据库: %v", err)
	}

	mu.Lock()
	t.Cleanup(func() { mu.Unlock() })

	db, err := gorm.Open(postgres.Open(getTestDSN()), &gorm.Config{})
	if err != nil {
		t.Fatalf("连接测试数据库失败: %v", err)
	}

	// 重建 schema 确保隔离性。
	// 必须先显式删除 pgvector 扩展（此时其所在 schema 仍存在，可干净删除），
	// 再删 schema；若直接 DROP SCHEMA 连带删除扩展，可能留下悬空目录项（孤儿状态），
	// 使后续 CREATE EXTENSION IF NOT EXISTS 静默跳过、vector 类型不可用。
	if err := db.Exec("DROP EXTENSION IF EXISTS vector CASCADE").Error; err != nil {
		t.Fatalf("删除 pgvector 扩展失败: %v", err)
	}
	if err := db.Exec("DROP SCHEMA IF EXISTS public CASCADE").Error; err != nil {
		t.Fatalf("删除 public schema 失败: %v", err)
	}
	if err := db.Exec("CREATE SCHEMA public").Error; err != nil {
		t.Fatalf("创建 public schema 失败: %v", err)
	}
	if err := db.Exec("CREATE EXTENSION IF NOT EXISTS vector").Error; err != nil {
		t.Fatalf("安装 pgvector 扩展失败: %v", err)
	}
	// 验证 vector 类型真正可用（防止 IF NOT EXISTS 静默跳过 / 孤儿状态残留）
	var vecType string
	if err := db.Raw("SELECT to_regtype('vector')::text").Scan(&vecType).Error; err != nil || vecType == "" {
		t.Fatalf("pgvector 未就绪：vector 类型不可用（服务器可能未安装 pgvector 或扩展状态损坏）")
	}

	if err := model.AutoMigrate(db); err != nil {
		t.Fatalf("测试数据库迁移失败: %v", err)
	}

	// 关闭外键检查（session 级别，连接关闭后自动恢复）
	if err := db.Exec("SET session_replication_role = replica").Error; err != nil {
		t.Fatalf("关闭外键检查失败: %v", err)
	}
	return db
}
