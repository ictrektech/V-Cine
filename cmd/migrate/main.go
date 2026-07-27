// nowen-video-tool migrate — SQLite → PostgreSQL 数据迁移工具
//
// 用法:
//
//	nowen-video-tool migrate --from "sqlite_dsn" --to "pg_dsn"
//	nowen-video-tool migrate --from "sqlite_dsn" --to "pg_dsn" --dry-run
//	nowen-video-tool migrate --from "sqlite_dsn" --to "pg_dsn" --validate-only
//
// 选项:
//
//	--from           SQLite 数据库 DSN（默认: ./data/nowen.db）
//	--to             PostgreSQL DSN（默认: host=127.0.0.1 user=postgres password=postgres dbname=nowen_video）
//	--dry-run        仅校验不写入
//	--validate-only  仅执行数据校验，跳过导入
//	--help           显示帮助信息
//
// 示例:
//
//	nowen-video-tool migrate --from ./data/nowen.db \
//	  --to "host=localhost user=postgres password=secret dbname=nowen_video sslmode=disable"
package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/nowen-video/nowen-video/internal/migrate"
)

func main() {
	var (
		fromDSN      string
		toDSN        string
		dryRun       bool
		validateOnly bool
		showHelp     bool
	)

	flag.StringVar(&fromDSN, "from", "./data/nowen.db", "SQLite 数据库 DSN")
	flag.StringVar(&toDSN, "to", "host=127.0.0.1 user=postgres password=postgres dbname=nowen_video sslmode=disable", "PostgreSQL DSN")
	flag.BoolVar(&dryRun, "dry-run", false, "仅校验不写入")
	flag.BoolVar(&validateOnly, "validate-only", false, "仅执行数据校验，跳过导入")
	flag.BoolVar(&showHelp, "help", false, "显示帮助信息")
	flag.Parse()

	if showHelp {
		printUsage()
		os.Exit(0)
	}

	log.SetFlags(0)
	log.Println("🚀 nowen-video 数据迁移工具")
	log.Printf("📂 源库: %s", maskDSN(fromDSN))
	log.Printf("🎯 目标: %s", maskDSN(toDSN))

	if dryRun {
		log.Println("🔍 Dry-run 模式：仅校验不写入")
	}

	// 仅执行校验
	if validateOnly {
		log.Println("🔍 仅执行数据校验...")
		report, err := migrate.Validate(fromDSN, toDSN)
		if err != nil {
			log.Fatalf("❌ 校验失败: %v", err)
		}
		if report.Passed {
			log.Println("✅ 校验通过")
			os.Exit(0)
		} else {
			log.Println("❌ 校验未通过")
			os.Exit(1)
		}
	}

	// 第一步：导出
	log.Println("📤 开始导出数据...")
	results, err := migrate.ExportAll(fromDSN)
	if err != nil {
		log.Fatalf("❌ 导出失败: %v", err)
	}

	var totalRows int64
	for _, r := range results {
		totalRows += r.Count
	}
	log.Printf("📊 共导出 %d 张表, %d 行数据", len(results), totalRows)

	// 第二步：导入
	log.Println("📥 开始导入数据...")
	if err := migrate.ImportAll(toDSN, results, dryRun); err != nil {
		log.Fatalf("❌ 导入失败: %v", err)
	}

	if dryRun {
		log.Println("✅ Dry-run 完成 (无实际写入)")
		return
	}

	// 第三步：校验
	log.Println("🔍 执行数据校验...")
	report, err := migrate.Validate(fromDSN, toDSN)
	if err != nil {
		log.Printf("⚠️  校验过程异常: %v", err)
	}
	if report != nil && report.Passed {
		log.Println("🎉 迁移完成且校验通过!")
	} else {
		log.Println("⚠️  迁移完成但校验有警告，请检查日志")
	}

	// 打印总结
	fmt.Println()
	fmt.Println("========== 迁移总结 ==========")
	fmt.Printf("源库: %s\n", maskDSN(fromDSN))
	fmt.Printf("目标: %s\n", maskDSN(toDSN))
	fmt.Printf("表数: %d\n", len(results))
	fmt.Printf("总行数: %d\n", totalRows)
	if report != nil {
		passed := len(report.TableChecks)
		for _, c := range report.TableChecks {
			if !c.Match {
				passed--
			}
		}
		fmt.Printf("行数一致: %d/%d\n", passed, len(report.TableChecks))
	}
	fmt.Println("==============================")
}

func printUsage() {
	fmt.Println(`nowen-video-tool migrate — SQLite → PostgreSQL 数据迁移工具

用法:
  nowen-video-tool migrate --from <sqlite_dsn> --to <pg_dsn> [选项]

选项:
  --from string     SQLite 数据库 DSN (默认: "./data/nowen.db")
  --to string       PostgreSQL 数据库 DSN (默认: "host=127.0.0.1 user=postgres password=postgres dbname=nowen_video sslmode=disable")
  --dry-run         仅校验不写入
  --validate-only   仅执行数据校验，跳过导入
  --help            显示帮助信息

示例:
  # 默认配置迁移
  nowen-video-tool migrate

  # 指定 DSN
  nowen-video-tool migrate --from /data/nowen.db \
    --to "host=pg.example.com port=5432 user=admin password=secret dbname=nowen_video"

  # 先 dry-run 确认
  nowen-video-tool migrate --dry-run

  # 迁移后单独校验
  nowen-video-tool migrate --validate-only`)
}

func maskDSN(dsn string) string {
	result := []byte(dsn)
	replaced := false
	for i := 0; i < len(result); i++ {
		if i+9 <= len(result) && string(result[i:i+9]) == "password=" {
			end := i + 9
			for end < len(result) && result[end] != ' ' && result[end] != '\t' {
				end++
			}
			for j := i + 9; j < end; j++ {
				result[j] = '*'
			}
			replaced = true
		}
	}
	if !replaced {
		return dsn
	}
	return string(result)
}
