// Package testutil 提供测试基础设施工具函数。
// NewTestDB() 创建内存 SQLite 数据库并自动迁移所有模型，供单元测试统一调用。
// 未来如需切换到 PostgreSQL 测试容器，只需修改此文件，调用方无需感知。
package testutil

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/nowen-video/nowen-video/internal/model"
	"gorm.io/gorm"
)

// NewTestDB 创建一个内存 SQLite 数据库并执行 AutoMigrate，适合单元测试使用。
// 测试结束后数据库自动销毁（进程退出即释放）。
func NewTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("创建测试数据库失败: %v", err)
	}
	if err := model.AutoMigrate(db); err != nil {
		t.Fatalf("测试数据库迁移失败: %v", err)
	}
	return db
}
