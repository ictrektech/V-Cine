// Package migrate 提供 SQLite → PostgreSQL 数据迁移功能。
//
// 迁移流程：
//  1. 连接 SQLite 源库，按外键依赖顺序导出全部表数据
//  2. 在 PostgreSQL 目标库上运行 AutoMigrate 创建表结构
//  3. 禁用 PG 外键约束，批量导入数据，恢复约束
//  4. 执行行数校验、外键完整性校验和内容抽样校验
package migrate

import (
	"database/sql"
	"fmt"
	"strings"
)

// TableInfo 描述一张表的元数据
type TableInfo struct {
	Name    string   // 表名
	Columns []string // 列名
}

// RowData 单行数据（列名 → 值）
type RowData map[string]interface{}

// MigrationConfig 迁移配置
type MigrationConfig struct {
	FromDSN string // SQLite DSN
	ToDSN   string // PostgreSQL DSN
	DryRun  bool   // 仅校验不写入
}

// ErrStopExport 导出完成信号
var ErrStopExport = fmt.Errorf("export complete")

// tableOrder 按外键依赖排序的表列表（依赖少的在前）
// 保证导入时不会因 FK 顺序错误而失败
var tableOrder = []string{
	// Level 0: 无外键依赖
	"users",
	"libraries",
	"people",
	"movie_collections",
	"system_settings",
	"ai_cache_entries",
	"genre_mappings",
	"system_logs",
	"cover_candidates",
	"ingest_jobs",
	"ai_usage_records",
	"ai_failover_logs",
	// Level 1: 依赖 Level 0
	"series",            // library_id → libraries
	"invite_codes",      // creator_id → users
	"playlists",         // user_id → users
	"scrape_tasks",      // media_id → media（media 还未创建，但无直接 FK）
	"recommend_cache",   // user_id → users
	"rename_plans",      // user_id → users
	// Level 2: 依赖 Level 0-1
	"media",                    // library_id, series_id, collection_id
	"user_permissions",         // user_id → users
	"login_logs",               // user_id → users
	"audit_logs",               // operator_id → users
	"file_operation_logs",      // user_id, media_id...
	// Level 3: 依赖 media + users
	"watch_histories",
	"favorites",
	"bookmarks",
	"comments",
	"danmaku_comments",
	"content_ratings",
	"transcode_tasks",
	"preprocess_tasks",
	"subtitle_preprocess_tasks",
	"playback_stats",
	"scrape_history",
	"video_chapters",
	"video_highlights",
	"ai_analysis_tasks",
	"video_analysis_tasks",
	"media_classifications",
	"rename_journals",
	"rename_plan_items",
	// Level 4: 依赖 playlists + media
	"playlist_items",
	// Level 3: 依赖 media + people
	"media_people",
}

// knownTables 返回所有已知表名
func knownTables() []string {
	return tableOrder
}

// tableColumns 通过 PRAGMA table_info / information_schema 查询表的列名
func tableColumns(db *sql.DB, driver string, tableName string) ([]string, error) {
	var rows *sql.Rows
	var err error

	switch driver {
	case "sqlite":
		rows, err = db.Query(fmt.Sprintf("PRAGMA table_info(`%s`)", tableName))
		if err != nil {
			return nil, fmt.Errorf("查询表 %s 结构失败: %w", tableName, err)
		}
		defer rows.Close()

		var cols []string
		for rows.Next() {
			var cid int
			var name, ctype string
			var notnull int
			var dflt sql.NullString
			var pk int
			if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
				return nil, fmt.Errorf("扫描列信息失败: %w", err)
			}
			cols = append(cols, name)
		}
		return cols, rows.Err()

	case "postgresql":
		rows, err = db.Query(`
			SELECT column_name FROM information_schema.columns
			WHERE table_name = $1 AND table_schema = 'public'
			ORDER BY ordinal_position`, tableName)
		if err != nil {
			return nil, fmt.Errorf("查询表 %s 结构失败: %w", tableName, err)
		}
		defer rows.Close()

		var cols []string
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				return nil, fmt.Errorf("扫描列信息失败: %w", err)
			}
			cols = append(cols, name)
		}
		return cols, rows.Err()

	default:
		return nil, fmt.Errorf("不支持的数据库驱动: %s", driver)
	}
}

// quoteIdent 安全地引用标识符
func quoteIdent(name string) string {
	return `"` + name + `"`
}

// joinCols 将列名列表拼成逗号分隔的引用标识符
func joinCols(cols []string) string {
	quoted := make([]string, len(cols))
	for i, c := range cols {
		quoted[i] = quoteIdent(c)
	}
	return strings.Join(quoted, ", ")
}

// placeholders 生成参数占位符列表
func placeholders(n int) []string {
	ps := make([]string, n)
	for i := range ps {
		ps[i] = fmt.Sprintf("$%d", i+1)
	}
	return ps
}
