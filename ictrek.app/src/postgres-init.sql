-- ============================================================
-- nowen-video 内置 PostgreSQL 初始化脚本（可选自包含部署用）
-- 挂载到 /docker-entrypoint-initdb.d/，仅在数据库卷首次初始化时执行一次。
--
-- 作用：为 nowen_video 库启用 pgvector 扩展。
-- 项目是 PostgreSQL-only，场景语义搜索的 scenes 表使用 vector(768) 列
-- （internal/model/video_analysis.go / internal/repository/scene_repo.go），
-- 必须在建表迁移前让 vector 类型可用，否则启动时 AutoMigrate 会失败。
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;
