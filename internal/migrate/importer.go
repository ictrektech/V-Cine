package migrate

import (
	"database/sql"
	"fmt"
	"log"
	"strings"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// ImportAll 将导出的数据批量导入 PostgreSQL
// 流程：禁用 FK → 按序导入 → 恢复 FK
func ImportAll(pgDSN string, results []ExportResult, dryRun bool) error {
	db, err := gorm.Open(postgres.Open(pgDSN), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("连接 PostgreSQL 失败: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("获取 PostgreSQL sql.DB 失败: %w", err)
	}
	defer sqlDB.Close()

	if dryRun {
		log.Println("🔍 Dry-run 模式：跳过实际导入")
		for _, r := range results {
			if r.Count > 0 {
				log.Printf("  [dry-run] 表 %s: 准备导入 %d 行", r.Table, r.Count)
			}
		}
		return nil
	}

	// 禁用外键约束
	log.Println("🔓 禁用外键约束...")
	if _, err := sqlDB.Exec("SET session_replication_role = 'replica'"); err != nil {
		return fmt.Errorf("禁用外键约束失败: %w", err)
	}

	defer func() {
		log.Println("🔒 恢复外键约束...")
		if _, err := sqlDB.Exec("SET session_replication_role = 'origin'"); err != nil {
			log.Printf("⚠️  恢复外键约束失败: %v", err)
		}
	}()

	totalRows := int64(0)
	for _, r := range results {
		if len(r.Rows) == 0 {
			continue
		}

		n, err := importTable(sqlDB, r)
		if err != nil {
			return fmt.Errorf("导入表 %s 失败: %w", r.Table, err)
		}
		totalRows += n
		log.Printf("✅  导入表 %s: %d 行", r.Table, n)
	}

	log.Printf("🎉 导入完成: 共 %d 张表, %d 行", len(results), totalRows)
	return nil
}

// importTable 批量导入单张表的数据（每事务 1000 行）
func importTable(db *sql.DB, result ExportResult) (int64, error) {
	if len(result.Rows) == 0 {
		return 0, nil
	}

	cols := make([]string, 0, len(result.Rows[0]))
	for k := range result.Rows[0] {
		cols = append(cols, k)
	}

	colList := joinCols(cols)
	placeholdersStr := "(" + strings.Join(placeholders(len(cols)), ", ") + ")"
	batchSize := 1000
	imported := int64(0)

	for i := 0; i < len(result.Rows); i += batchSize {
		end := i + batchSize
		if end > len(result.Rows) {
			end = len(result.Rows)
		}
		batch := result.Rows[i:end]

		tx, err := db.Begin()
		if err != nil {
			return imported, fmt.Errorf("开始事务失败: %w", err)
		}

		stmt := fmt.Sprintf("INSERT INTO %s %s VALUES %s",
			quoteIdent(result.Table), colList,
			strings.Repeat(", "+placeholdersStr, len(batch))[2:],
		)

		args := make([]interface{}, 0, len(batch)*len(cols))
		for _, row := range batch {
			for _, col := range cols {
				if v, ok := row[col]; ok && v != nil {
					args = append(args, v)
				} else {
					args = append(args, nil)
				}
			}
		}

		if _, err := tx.Exec(stmt, args...); err != nil {
			tx.Rollback()
			return imported, fmt.Errorf("批量插入失败 (rows %d-%d): %w", i, end, err)
		}

		if err := tx.Commit(); err != nil {
			return imported, fmt.Errorf("提交事务失败: %w", err)
		}

		imported += int64(len(batch))
	}

	return imported, nil
}

// ClearTable 清空目标表（用于重试）
func ClearTable(db *gorm.DB, tableName string) error {
	return db.Exec(fmt.Sprintf("DELETE FROM %s", quoteIdent(tableName))).Error
}
