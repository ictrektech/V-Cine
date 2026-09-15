// Package testutil 提供测试基础设施工具函数。
// NewTestDB() 连接 PostgreSQL 测试数据库：每个测试包使用独立 schema（按测试二进制名派生），
// 包间互不干扰，`go test` 默认并行跑包也不会互相销毁 schema，无需 -p 1。
package testutil

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/nowen-video/nowen-video/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var mu sync.Mutex

// initializedSchemas 本进程内已初始化（重建 + AutoMigrate）的包级 schema
var initializedSchemas sync.Map

func getTestDSN() string {
	if dsn := os.Getenv("VCINE_TEST_DATABASE_DSN"); dsn != "" {
		return dsn
	}
	host := envOr("VCINE_TEST_DATABASE_HOST", "10.144.144.232")
	port := envOr("VCINE_TEST_DATABASE_PORT", "35432")
	user := envOr("VCINE_TEST_DATABASE_USER", "postgres")
	password := envOr("VCINE_TEST_DATABASE_PASSWORD", "postgres")
	dbname := envOr("VCINE_TEST_DATABASE_DBNAME", "vcine_test")
	sslmode := envOr("VCINE_TEST_DATABASE_SSLMODE", "disable")
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
	dbname := envOr("VCINE_TEST_DATABASE_DBNAME", "vcine_test")
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
	host = envOr("VCINE_TEST_DATABASE_HOST", "10.144.144.232")
	port = envOr("VCINE_TEST_DATABASE_PORT", "35432")
	user = envOr("VCINE_TEST_DATABASE_USER", "postgres")
	password = envOr("VCINE_TEST_DATABASE_PASSWORD", "postgres")
	dbname = envOr("VCINE_TEST_DATABASE_DBNAME", "vcine_test")
	sslmode = envOr("VCINE_TEST_DATABASE_SSLMODE", "disable")
	return
}

// NewTestDB 创建一个 PostgreSQL 测试数据库连接并执行 AutoMigrate。
// 每个测试二进制（包）使用独立的 schema（按测试二进制名派生），包间互不干扰，
// `go test` 默认并行跑包也不会互相销毁，无需 -p 1。
// 本进程内每个 schema 只重建 + AutoMigrate 一次，后续调用仅 TRUNCATE 清表（快）。
func NewTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	// 安全校验：数据库名必须包含 "test"，防止误删业务数据
	_, _, _, _, dbname, _ := dsnConfig()
	if !strings.Contains(strings.ToLower(dbname), "test") {
		t.Fatalf("❌ 安全拦截：测试数据库名 %q 不包含 \"test\"，拒绝 DROP SCHEMA 操作", dbname)
	}

	mu.Lock()
	err := ensureTestDB()
	mu.Unlock()
	if err != nil {
		t.Fatalf("无法初始化测试数据库: %v", err)
	}

	// 每个测试包独立 schema（按测试二进制名派生），包间互不干扰；
	// search_path 指向包 schema（连接池级参数，所有连接生效），表落在本包 schema
	schema := testSchemaName(t)
	dsn := getTestDSN() + fmt.Sprintf(" search_path=%s,public", schema)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("连接测试数据库失败: %v", err)
	}

	// pgvector 扩展整库安装一次（public schema，永不被包级 DROP 触及，避免孤儿状态）
	if err := db.Exec("CREATE EXTENSION IF NOT EXISTS vector SCHEMA public").Error; err != nil {
		t.Fatalf("安装 pgvector 扩展失败: %v", err)
	}
	// 验证 vector 类型真正可用
	var vecType string
	if err := db.Raw("SELECT to_regtype('vector')::text").Scan(&vecType).Error; err != nil || vecType == "" {
		t.Fatalf("pgvector 未就绪：vector 类型不可用（服务器可能未安装 pgvector 或扩展状态损坏）")
	}

	// 本进程内每个 schema 只重建 + AutoMigrate 一次；后续仅 TRUNCATE 清表（快）
	if _, loaded := initializedSchemas.LoadOrStore(schema, struct{}{}); !loaded {
		if err := db.Exec(fmt.Sprintf("DROP SCHEMA IF EXISTS %s CASCADE", schema)).Error; err != nil {
			t.Fatalf("重置 schema %s 失败: %v", schema, err)
		}
		if err := db.Exec(fmt.Sprintf("CREATE SCHEMA %s", schema)).Error; err != nil {
			t.Fatalf("创建 schema %s 失败: %v", schema, err)
		}
		if err := model.AutoMigrate(db); err != nil {
			t.Fatalf("测试数据库迁移失败: %v", err)
		}
	} else if err := truncateTables(db, schema); err != nil {
		t.Fatalf("清空表失败: %v", err)
	}

	// 关闭外键检查（session 级别，连接关闭后自动恢复）
	if err := db.Exec("SET session_replication_role = replica").Error; err != nil {
		t.Fatalf("关闭外键检查失败: %v", err)
	}
	return db
}

// truncateTables 清空 schema 下所有表（保留表结构，比 DROP/CREATE + AutoMigrate 快）
func truncateTables(db *gorm.DB, schema string) error {
	var tables []string
	if err := db.Raw(`SELECT tablename FROM pg_tables WHERE schemaname = ?`, schema).Scan(&tables).Error; err != nil {
		return err
	}
	if len(tables) == 0 {
		return nil
	}
	names := make([]string, len(tables))
	for i, tb := range tables {
		names[i] = fmt.Sprintf("%q.%q", schema, tb)
	}
	return db.Exec(fmt.Sprintf("TRUNCATE TABLE %s RESTART IDENTITY CASCADE", strings.Join(names, ", "))).Error
}

// testSchemaName 按测试二进制名生成包级 schema 名（每个测试包独立，包间可安全并行）
func testSchemaName(t *testing.T) string {
	base := filepath.Base(os.Args[0])
	name := strings.TrimSuffix(base, ".test")
	name = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			return r
		}
		return '_'
	}, name)
	if name == "" {
		return "test_default"
	}
	return "t_" + name
}
