package migrate

import (
	"database/sql"
	"fmt"
	"log"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// ExportResult 单张表的导出结果
type ExportResult struct {
	Table  string
	Rows   []RowData
	Count  int64
}

// ExportAll 从 SQLite 源库导出全部数据
// 按 tableOrder 顺序导出，返回每张表的行数据
func ExportAll(sqliteDSN string) ([]ExportResult, error) {
	db, err := gorm.Open(sqlite.Open(sqliteDSN), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("连接 SQLite 失败: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("获取 SQLite sql.DB 失败: %w", err)
	}
	defer sqlDB.Close()

	var results []ExportResult
	tables := knownTables()

	for _, table := range tables {
		result, err := exportTable(sqlDB, table)
		if err != nil {
			log.Printf("⚠️  导出表 %s 失败 (跳过): %v", table, err)
			continue
		}
		results = append(results, result)
		log.Printf("✅  导出表 %s: %d 行", table, result.Count)
	}

	return results, nil
}

// exportTable 导出单张表的全部数据
func exportTable(db *sql.DB, tableName string) (ExportResult, error) {
	cols, err := tableColumns(db, "sqlite", tableName)
	if err != nil {
		return ExportResult{}, fmt.Errorf("获取列信息失败: %w", err)
	}
	if len(cols) == 0 {
		return ExportResult{Table: tableName, Rows: nil, Count: 0}, nil
	}

	// 查询行数
	var count int64
	countRow := db.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM `%s`", tableName))
	if err := countRow.Scan(&count); err != nil {
		return ExportResult{}, fmt.Errorf("统计行数失败: %w", err)
	}
	if count == 0 {
		return ExportResult{Table: tableName, Rows: nil, Count: 0}, nil
	}

	// 分批读取
	batchSize := 1000
	colList := joinCols(cols)
	colPtrs := make([]interface{}, len(cols))
	colVals := make([]sql.NullString, len(cols))
	for i := range colPtrs {
		colPtrs[i] = &colVals[i]
	}

	var allRows []RowData

	for offset := 0; offset < int(count); offset += batchSize {
		query := fmt.Sprintf("SELECT %s FROM `%s` LIMIT %d OFFSET %d", colList, tableName, batchSize, offset)
		rows, err := db.Query(query)
		if err != nil {
			return ExportResult{}, fmt.Errorf("查询数据失败 (offset=%d): %w", offset, err)
		}

		for rows.Next() {
			if err := rows.Scan(colPtrs...); err != nil {
				rows.Close()
				return ExportResult{}, fmt.Errorf("扫描行数据失败: %w", err)
			}
			row := make(RowData)
			for i, col := range cols {
				if colVals[i].Valid {
					row[col] = colVals[i].String
				} else {
					row[col] = nil
				}
			}
			allRows = append(allRows, row)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return ExportResult{}, fmt.Errorf("读取行数据错误: %w", err)
		}
	}

	return ExportResult{Table: tableName, Rows: allRows, Count: int64(len(allRows))}, nil
}
