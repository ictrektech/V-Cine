-- ============================================================
-- nowen-video 迁移: media 从属表外键改为 ON DELETE CASCADE
--
-- 背景：
--   media 表被 13 张从属表通过 media_id 外键引用（AutoMigrate 默认建 NO ACTION）：
--   watch_histories / favorites / transcode_tasks / playlist_items /
--   bookmarks / comments / danmaku_comments / video_chapters /
--   video_highlights / cover_candidates / preprocess_tasks /
--   subtitle_preprocess_tasks / video_analysis_tasks
--
--   删除 media 记录时（单条删除 / 删除媒体库 / 清理孤立数据 / 扫描清理失效记录），
--   若这些表存在引用行且外键无级联动作，PostgreSQL 会拒绝删除：
--     SQLSTATE 23503: update or delete on table "media" violates foreign key
--     constraint "fk_xxx_media" on table "xxx"
--
-- 修复：给这 13 个外键加 ON DELETE CASCADE（媒体删除时从属数据自动级联删除）。
-- 代码层已同步在模型关联标签加 constraint:OnDelete:CASCADE（新库 AutoMigrate 自动生效），
-- 本脚本用于已有库迁移，需执行一次。
--
-- 注意：fk_movie_collections_media 是 media.collection_id 引用 movie_collections，
-- 属"media 引用他人"方向，不在此迁移范围。
-- ============================================================

-- watch_histories
ALTER TABLE watch_histories DROP CONSTRAINT IF EXISTS fk_watch_histories_media;
ALTER TABLE watch_histories ADD CONSTRAINT fk_watch_histories_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE;

-- favorites
ALTER TABLE favorites DROP CONSTRAINT IF EXISTS fk_favorites_media;
ALTER TABLE favorites ADD CONSTRAINT fk_favorites_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE;

-- transcode_tasks
ALTER TABLE transcode_tasks DROP CONSTRAINT IF EXISTS fk_transcode_tasks_media;
ALTER TABLE transcode_tasks ADD CONSTRAINT fk_transcode_tasks_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE;

-- playlist_items
ALTER TABLE playlist_items DROP CONSTRAINT IF EXISTS fk_playlist_items_media;
ALTER TABLE playlist_items ADD CONSTRAINT fk_playlist_items_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE;

-- bookmarks
ALTER TABLE bookmarks DROP CONSTRAINT IF EXISTS fk_bookmarks_media;
ALTER TABLE bookmarks ADD CONSTRAINT fk_bookmarks_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE;

-- comments
ALTER TABLE comments DROP CONSTRAINT IF EXISTS fk_comments_media;
ALTER TABLE comments ADD CONSTRAINT fk_comments_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE;

-- danmaku_comments
ALTER TABLE danmaku_comments DROP CONSTRAINT IF EXISTS fk_danmaku_comments_media;
ALTER TABLE danmaku_comments ADD CONSTRAINT fk_danmaku_comments_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE;

-- video_chapters
ALTER TABLE video_chapters DROP CONSTRAINT IF EXISTS fk_video_chapters_media;
ALTER TABLE video_chapters ADD CONSTRAINT fk_video_chapters_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE;

-- video_highlights
ALTER TABLE video_highlights DROP CONSTRAINT IF EXISTS fk_video_highlights_media;
ALTER TABLE video_highlights ADD CONSTRAINT fk_video_highlights_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE;

-- cover_candidates
ALTER TABLE cover_candidates DROP CONSTRAINT IF EXISTS fk_cover_candidates_media;
ALTER TABLE cover_candidates ADD CONSTRAINT fk_cover_candidates_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE;

-- preprocess_tasks
ALTER TABLE preprocess_tasks DROP CONSTRAINT IF EXISTS fk_preprocess_tasks_media;
ALTER TABLE preprocess_tasks ADD CONSTRAINT fk_preprocess_tasks_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE;

-- subtitle_preprocess_tasks
ALTER TABLE subtitle_preprocess_tasks DROP CONSTRAINT IF EXISTS fk_subtitle_preprocess_tasks_media;
ALTER TABLE subtitle_preprocess_tasks ADD CONSTRAINT fk_subtitle_preprocess_tasks_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE;

-- video_analysis_tasks
ALTER TABLE video_analysis_tasks DROP CONSTRAINT IF EXISTS fk_video_analysis_tasks_media;
ALTER TABLE video_analysis_tasks ADD CONSTRAINT fk_video_analysis_tasks_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE;

-- ============================================================
-- 链式依赖: scenes.video_analysis_task_id → video_analysis_tasks.id
-- （video_analysis_tasks 被级联删除时，scenes 也随之级联删除）
-- ============================================================
ALTER TABLE scenes DROP CONSTRAINT IF EXISTS fk_scenes_video_analysis_task;
ALTER TABLE scenes ADD CONSTRAINT fk_scenes_video_analysis_task FOREIGN KEY (video_analysis_task_id) REFERENCES video_analysis_tasks(id) ON DELETE CASCADE;
