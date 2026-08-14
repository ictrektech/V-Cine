-- ============================================================
-- nowen-video 内置 PostgreSQL 初始化脚本（可选自包含部署用）
-- 挂载到 /docker-entrypoint-initdb.d/，仅在数据库卷首次初始化时执行一次。
--
-- 作用：
--   1. 为 nowen_video 库启用 pgvector 扩展。
--   2. 为 media.collection_id 安装兜底 trigger：把空字符串 '' 改写为 NULL。
--
-- 说明：
--   - pgvector：项目是 PostgreSQL-only，场景语义搜索的 scenes 表使用 vector(768) 列
--     （internal/model/video_analysis.go / internal/repository/scene_repo.go），
--     必须在建表迁移前让 vector 类型可用，否则启动时 AutoMigrate 会失败。
--   - trigger：Media.CollectionID 是 Go string，零值为 ''；而 PostgreSQL 外键
--     fk_movie_collections_media 会对 '' 做引用检查（NULL 才放行）。
--     该 trigger 兜底所有写入路径（含未来新增代码），把 '' 统一改写为 NULL。
--     代码层（model default:NULL / repo Update Omit / 显式写 nil）已修复已知路径，
--     此处作为最后一道防线。已有库需手动执行一次本 trigger 部分。
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- media.collection_id 空串 → NULL 兜底 trigger（外键 fk_movie_collections_media 要求 NULL 或存在的 id）
CREATE OR REPLACE FUNCTION media_collection_id_blank_to_null() RETURNS trigger AS $$
BEGIN
  IF NEW.collection_id = '' THEN
    NEW.collection_id := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_media_collection_id_blank_to_null ON media;
CREATE TRIGGER trg_media_collection_id_blank_to_null
  BEFORE INSERT OR UPDATE ON media
  FOR EACH ROW
  EXECUTE FUNCTION media_collection_id_blank_to_null();
