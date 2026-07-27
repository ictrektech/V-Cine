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

	// 获取 SQLite 列名（从导出数据中）
	sqliteCols := make([]string, 0, len(result.Rows[0]))
	for k := range result.Rows[0] {
		sqliteCols = append(sqliteCols, k)
	}

	// 查询 PostgreSQL 表的列信息（列名和类型）
	pgCols, boolCols, err := getPGColumnInfo(db, result.Table)
	if err != nil {
		log.Printf("⚠️  获取表 %s 列信息失败: %v", result.Table, err)
		return 0, err
	}

	// 建立 SQLite 列名到 PostgreSQL 列名的映射
	// 处理 GORM 命名差异（如 imdb_id → im_db_id）
	colMap := buildColumnMapping(sqliteCols, pgCols)

	// 使用 PostgreSQL 列名构建 INSERT 语句
	pgColNames := make([]string, 0, len(colMap))
	for _, pgCol := range colMap {
		if pgCol != "" {
			pgColNames = append(pgColNames, pgCol)
		}
	}
	colList := joinCols(pgColNames)

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

		// 生成多行 INSERT 语句，每行使用不同的参数占位符
		var valueParts []string
		args := make([]interface{}, 0, len(batch)*len(pgColNames))
		argIndex := 1
		for _, row := range batch {
			var rowPlaceholders []string
			for j, sqliteCol := range sqliteCols {
				pgCol := colMap[j]
				if pgCol == "" {
					continue // 跳过 PostgreSQL 中不存在的列
				}
				rowPlaceholders = append(rowPlaceholders, fmt.Sprintf("$%d", argIndex))
				argIndex++
				if v, ok := row[sqliteCol]; ok && v != nil {
					// 类型转换：SQLite boolean 字符串 → PostgreSQL boolean
					if boolCols[pgCol] {
						args = append(args, convertToBool(v))
					} else {
						args = append(args, v)
					}
				} else {
					args = append(args, nil)
				}
			}
			valueParts = append(valueParts, "("+strings.Join(rowPlaceholders, ", ")+")")
		}

		stmt := fmt.Sprintf("INSERT INTO %s %s VALUES %s",
			quoteIdent(result.Table), "("+colList+")",
			strings.Join(valueParts, ", "),
		)

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

// getPGColumnInfo 查询 PostgreSQL 表的列信息（列名和类型）
func getPGColumnInfo(db *sql.DB, tableName string) ([]string, map[string]bool, error) {
	rows, err := db.Query(`
		SELECT column_name, data_type
		FROM information_schema.columns
		WHERE table_name = $1 AND table_schema = 'public'
		ORDER BY ordinal_position
	`, tableName)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	var pgCols []string
	boolCols := make(map[string]bool)
	for rows.Next() {
		var colName, dataType string
		if err := rows.Scan(&colName, &dataType); err != nil {
			return nil, nil, err
		}
		pgCols = append(pgCols, colName)
		if dataType == "boolean" {
			boolCols[colName] = true
		}
	}
	return pgCols, boolCols, rows.Err()
}

// buildColumnMapping 建立 SQLite 列名到 PostgreSQL 列名的映射
// 处理 GORM 命名差异（如 imdb_id → im_db_id）
// 仅做精确匹配 + 已知别名映射，避免子串匹配造成的误映射
func buildColumnMapping(sqliteCols []string, pgCols []string) []string {
	pgColSet := make(map[string]bool)
	for _, col := range pgCols {
		pgColSet[col] = true
	}
	usedPGCols := make(map[string]bool)

	mapping := make([]string, len(sqliteCols))
	for i, sqliteCol := range sqliteCols {
		// 1. 精确匹配
		if pgColSet[sqliteCol] && !usedPGCols[sqliteCol] {
			mapping[i] = sqliteCol
			usedPGCols[sqliteCol] = true
			continue
		}

		// 2. 已知别名映射（GORM 命名差异）
		normalized := normalizeColumnName(sqliteCol)
		if pgColSet[normalized] && !usedPGCols[normalized] {
			mapping[i] = normalized
			usedPGCols[normalized] = true
			continue
		}

		// 3. 找不到映射，跳过
		log.Printf("⚠️  列 %s 在 PostgreSQL 中未找到对应列，跳过", sqliteCol)
	}

	return mapping
}

// normalizeColumnName 标准化列名（处理 GORM 命名差异）
func normalizeColumnName(name string) string {
	// 处理常见的 GORM 命名差异
	// 例如: imdb_id → im_db_id, tmdb_id → tm_db_id
	replacements := map[string]string{
		"imdb_id":  "im_db_id",
		"tmdb_id":  "tm_db_id",
		"thetvdb":  "the_tvdb",
		"fanart":   "fan_art",
		"javbus":   "jav_bus",
		"javdb":    "jav_db",
		"jav321":   "jav_321",
		"freejavbt": "free_javbt",
		"mgstage":  "mg_stage",
		"fc2hub":   "fc_2_hub",
	}

	if normalized, ok := replacements[name]; ok {
		return normalized
	}

	return name
}

// convertToBool 将 SQLite 的 "0"/"1" 字符串转换为布尔值
func convertToBool(v interface{}) interface{} {
	if s, ok := v.(string); ok {
		return s == "1" || s == "true" || s == "TRUE" || s == "t"
	}
	if b, ok := v.(bool); ok {
		return b
	}
	if i, ok := v.(int64); ok {
		return i != 0
	}
	if f, ok := v.(float64); ok {
		return f != 0
	}
	return v
}

// ClearTable 清空目标表（用于重试）
func ClearTable(db *gorm.DB, tableName string) error {
	return db.Exec(fmt.Sprintf("DELETE FROM %s", quoteIdent(tableName))).Error
}
