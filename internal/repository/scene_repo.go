package repository

import (
	"fmt"
	"strings"

	"github.com/nowen-video/nowen-video/internal/model"
	pgvector "github.com/pgvector/pgvector-go"
	"gorm.io/gorm"
)

// SceneRepo 场景向量化存储与检索
type SceneRepo struct {
	db *gorm.DB
}

func NewSceneRepo(db *gorm.DB) *SceneRepo {
	return &SceneRepo{db: db}
}

// BatchCreate 批量写入场景（含 embedding）
func (r *SceneRepo) BatchCreate(taskID string, scenes []model.Scene) error {
	if len(scenes) == 0 {
		return nil
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		// 先删除旧场景（幂等）
		if err := tx.Where("video_analysis_task_id = ?", taskID).Delete(&model.Scene{}).Error; err != nil {
			return err
		}
		// 批量写入
		for i := range scenes {
			scenes[i].VideoAnalysisTaskID = taskID
			if err := tx.Create(&scenes[i]).Error; err != nil {
				return fmt.Errorf("create scene %d: %w", scenes[i].SceneIndex, err)
			}
		}
		return nil
	})
}

// UpdateDescriptions 更新场景描述和描述 embedding
func (r *SceneRepo) UpdateDescriptions(taskID string, descriptions []SceneDescriptionUpdate) error {
	if len(descriptions) == 0 {
		return nil
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, d := range descriptions {
			updates := map[string]interface{}{
				"description": d.Description,
			}
			if d.DescriptionEmbedding != nil {
				updates["description_embedding"] = *d.DescriptionEmbedding
			}
			if err := tx.Model(&model.Scene{}).
				Where("video_analysis_task_id = ? AND scene_index = ?", taskID, d.SceneIndex).
				Updates(updates).Error; err != nil {
				return fmt.Errorf("update scene %d description: %w", d.SceneIndex, err)
			}
		}
		return nil
	})
}

// GetByTaskID 获取某次视频分析的所有场景
func (r *SceneRepo) GetByTaskID(taskID string) ([]model.Scene, error) {
	var scenes []model.Scene
	err := r.db.Where("video_analysis_task_id = ?", taskID).
		Order("scene_index ASC").
		Find(&scenes).Error
	return scenes, err
}

// GetByTaskIDWithMedia 获取场景并关联 Media 信息
func (r *SceneRepo) GetByTaskIDWithMedia(taskID string) ([]model.Scene, error) {
	var scenes []model.Scene
	err := r.db.
		Preload("VideoAnalysisTask.Media").
		Where("video_analysis_task_id = ?", taskID).
		Order("scene_index ASC").
		Find(&scenes).Error
	return scenes, err
}

// DeleteByTaskID 删除某次分析的所有场景
func (r *SceneRepo) DeleteByTaskID(taskID string) error {
	return r.db.Where("video_analysis_task_id = ?", taskID).Delete(&model.Scene{}).Error
}

// SearchByText 通过文本 embedding 搜索场景（余弦距离）
func (r *SceneRepo) SearchByText(embedding []float32, limit int) ([]SceneSearchResult, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	vec := pgvector.NewVector(embedding)
	var results []SceneSearchResult
	err := r.db.Raw(`
		SELECT s.id, s.video_analysis_task_id, s.scene_index, s.start_time, s.end_time,
			s.image_path, s.description,
			s.description_embedding <=> ? AS distance,
			t.media_id, m.title AS media_title
		FROM scenes s
		JOIN video_analysis_tasks t ON t.id = s.video_analysis_task_id
		LEFT JOIN media m ON m.id = t.media_id
		WHERE s.description_embedding IS NOT NULL
		ORDER BY s.description_embedding <=> ?
		LIMIT ?
	`, vec, vec, limit).Scan(&results).Error
	return results, err
}

// SearchByImage 通过图片 embedding 搜索场景（余弦距离）
func (r *SceneRepo) SearchByImage(embedding []float32, limit int) ([]SceneSearchResult, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	vec := pgvector.NewVector(embedding)
	var results []SceneSearchResult
	err := r.db.Raw(`
		SELECT s.id, s.video_analysis_task_id, s.scene_index, s.start_time, s.end_time,
			s.image_path, s.description,
			s.embedding <=> ? AS distance,
			t.media_id, m.title AS media_title
		FROM scenes s
		JOIN video_analysis_tasks t ON t.id = s.video_analysis_task_id
		LEFT JOIN media m ON m.id = t.media_id
		WHERE s.embedding IS NOT NULL
		ORDER BY s.embedding <=> ?
		LIMIT ?
	`, vec, vec, limit).Scan(&results).Error
	return results, err
}

// CountByTaskID 统计某次分析的场景数
func (r *SceneRepo) CountByTaskID(taskID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.Scene{}).
		Where("video_analysis_task_id = ?", taskID).
		Count(&count).Error
	return count, err
}

// SceneDescriptionUpdate 描述更新参数
type SceneDescriptionUpdate struct {
	SceneIndex          int
	Description         string
	DescriptionEmbedding *pgvector.Vector
}

// SceneSearchResult 场景搜索结果
type SceneSearchResult struct {
	ID                  string  `json:"id"`
	VideoAnalysisTaskID string  `json:"video_analysis_task_id"`
	SceneIndex          int     `json:"scene_index"`
	StartTime           float64 `json:"start_time"`
	EndTime             float64 `json:"end_time"`
	ImagePath           string  `json:"image_path"`
	Description         string  `json:"description"`
	Distance            float64 `json:"distance"`
	MediaID             string  `json:"media_id"`
	MediaTitle          string  `json:"media_title"`
}

// EnsureVectorExtension 确保 pgvector 扩展已安装
func (r *SceneRepo) EnsureVectorExtension() error {
	return r.db.Exec("CREATE EXTENSION IF NOT EXISTS vector").Error
}

// EnsureHNSWIndexes 确保 HNSW 索引存在
func (r *SceneRepo) EnsureHNSWIndexes() error {
	// 检查 embedding 索引
	var idxCount int64
	r.db.Raw(`
		SELECT COUNT(*) FROM pg_indexes
		WHERE tablename = 'scenes' AND indexname = 'idx_scenes_embedding'
	`).Scan(&idxCount)
	if idxCount == 0 {
		if err := r.db.Exec(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scenes_embedding
			ON scenes USING hnsw (embedding vector_cosine_ops)
			WITH (m = 16, ef_construction = 300)`).Error; err != nil {
			// CONCURRENTLY 在事务内或某些环境中不可用，降级为普通创建
			if strings.Contains(err.Error(), "CONCURRENTLY") {
				return r.db.Exec(`CREATE INDEX IF NOT EXISTS idx_scenes_embedding
					ON scenes USING hnsw (embedding vector_cosine_ops)
					WITH (m = 16, ef_construction = 300)`).Error
			}
			return err
		}
	}

	// 检查 description_embedding 索引
	r.db.Raw(`
		SELECT COUNT(*) FROM pg_indexes
		WHERE tablename = 'scenes' AND indexname = 'idx_scenes_desc_embedding'
	`).Scan(&idxCount)
	if idxCount == 0 {
		if err := r.db.Exec(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scenes_desc_embedding
			ON scenes USING hnsw (description_embedding vector_cosine_ops)
			WITH (m = 16, ef_construction = 300)`).Error; err != nil {
			if strings.Contains(err.Error(), "CONCURRENTLY") {
				return r.db.Exec(`CREATE INDEX IF NOT EXISTS idx_scenes_desc_embedding
					ON scenes USING hnsw (description_embedding vector_cosine_ops)
					WITH (m = 16, ef_construction = 300)`).Error
			}
			return err
		}
	}
	return nil
}
