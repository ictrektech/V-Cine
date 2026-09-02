package repository

import (
	"errors"
	"strings"

	"github.com/nowen-video/nowen-video/internal/model"
	"gorm.io/gorm"
)

var ErrVideoAnalysisTaskActive = errors.New("an active video analysis task already exists for this media")

type VideoAnalysisTaskRepo struct {
	db *gorm.DB
}

func NewVideoAnalysisTaskRepo(db *gorm.DB) *VideoAnalysisTaskRepo {
	return &VideoAnalysisTaskRepo{db: db}
}

// CreateIfNoActive serializes local task creation to guarantee that Nowen has
// at most one queued/running task per media, even under repeated UI submits.
func (r *VideoAnalysisTaskRepo) CreateIfNoActive(task *model.VideoAnalysisTask) error {
	task.SyncActiveKey()
	err := r.db.Create(task).Error
	if isUniqueConstraintError(err) {
		return ErrVideoAnalysisTaskActive
	}
	return err
}

func (r *VideoAnalysisTaskRepo) Update(task *model.VideoAnalysisTask) error {
	task.SyncActiveKey()
	return r.db.Save(task).Error
}

func (r *VideoAnalysisTaskRepo) ClaimQueued(id string) (bool, error) {
	var task model.VideoAnalysisTask
	if err := r.db.Select("media_id").First(&task, "id = ?", id).Error; err != nil {
		return false, err
	}
	result := r.db.Model(&model.VideoAnalysisTask{}).
		Where("id = ? AND status = ?", id, model.VideoAnalysisStatusQueued).
		Updates(map[string]any{
			"status":     model.VideoAnalysisStatusRunning,
			"active_key": task.MediaID,
			"attempt":    gorm.Expr("attempt + 1"),
		})
	return result.RowsAffected == 1, result.Error
}

func isUniqueConstraintError(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique constraint")
}

func (r *VideoAnalysisTaskRepo) FindByID(id string) (*model.VideoAnalysisTask, error) {
	var task model.VideoAnalysisTask
	err := r.db.First(&task, "id = ?", id).Error
	return &task, err
}

func (r *VideoAnalysisTaskRepo) FindActiveByMediaID(mediaID string) (*model.VideoAnalysisTask, error) {
	var task model.VideoAnalysisTask
	err := r.db.Where("media_id = ? AND status IN ?", mediaID, model.VideoAnalysisActiveStatuses).
		Order("created_at DESC").First(&task).Error
	return &task, err
}

func (r *VideoAnalysisTaskRepo) FindLatestByMediaID(mediaID string) (*model.VideoAnalysisTask, error) {
	var task model.VideoAnalysisTask
	err := r.db.Where("media_id = ?", mediaID).Order("created_at DESC").First(&task).Error
	return &task, err
}

func (r *VideoAnalysisTaskRepo) FindLatestResultByMediaID(mediaID string) (*model.VideoAnalysisTask, error) {
	var task model.VideoAnalysisTask
	err := r.db.Where("media_id = ? AND result_json <> ''", mediaID).
		Order("created_at DESC").First(&task).Error
	return &task, err
}

func (r *VideoAnalysisTaskRepo) ListPending(limit int) ([]model.VideoAnalysisTask, error) {
	var tasks []model.VideoAnalysisTask
	if limit <= 0 {
		return tasks, nil
	}
	err := r.db.Where("status = ?", model.VideoAnalysisStatusQueued).
		Order("created_at ASC").Limit(limit).Find(&tasks).Error
	return tasks, err
}

func (r *VideoAnalysisTaskRepo) ListRunning() ([]model.VideoAnalysisTask, error) {
	var tasks []model.VideoAnalysisTask
	err := r.db.Where("status = ?", model.VideoAnalysisStatusRunning).
		Order("created_at ASC").Find(&tasks).Error
	return tasks, err
}

func (r *VideoAnalysisTaskRepo) RequeueFailed(task *model.VideoAnalysisTask) error {
	task.SyncActiveKey()
	result := r.db.Model(&model.VideoAnalysisTask{}).
		Where("id = ? AND status IN ?", task.ID, []string{model.VideoAnalysisStatusFailed, model.VideoAnalysisStatusPartial}).
		Updates(map[string]any{
			"status": task.Status, "stage": task.Stage, "progress": task.Progress,
			"active_key": task.ActiveKey, "detect_job_id": task.DetectJobID,
			"structure_job_id": task.StructureJobID, "describe_job_id": task.DescribeJobID,
			"result_json": task.ResultJSON, "video_hash": task.VideoHash,
			"fallback_used": task.FallbackUsed, "error_code": "", "error_message": "",
			"started_at": nil, "finished_at": nil,
		})
	if isUniqueConstraintError(result.Error) {
		return ErrVideoAnalysisTaskActive
	}
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("video analysis task is not retryable")
	}
	return nil
}

func (r *VideoAnalysisTaskRepo) List(page, pageSize int, status, libraryID, keyword string) ([]model.VideoAnalysisTask, int64, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	query := r.db.Model(&model.VideoAnalysisTask{})
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if libraryID != "" {
		query = query.Where("library_id = ?", libraryID)
	}
	if keyword != "" {
		query = query.Where("LOWER(media_title) LIKE ?", "%"+strings.ToLower(keyword)+"%")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var tasks []model.VideoAnalysisTask
	err := query.Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&tasks).Error
	return tasks, total, err
}

func (r *VideoAnalysisTaskRepo) CountByStatus() (map[string]int64, error) {
	var rows []struct {
		Status string
		Count  int64
	}
	if err := r.db.Model(&model.VideoAnalysisTask{}).
		Select("status, COUNT(*) AS count").Group("status").Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := make(map[string]int64, len(rows))
	for _, row := range rows {
		counts[row.Status] = row.Count
	}
	return counts, nil
}

// ListVideoHashes 返回所有任务中已使用过的 video_hash（用于识别 structure 孤儿目录）。
func (r *VideoAnalysisTaskRepo) ListVideoHashes() ([]string, error) {
	var hashes []string
	err := r.db.Model(&model.VideoAnalysisTask{}).
		Where("video_hash <> ''").
		Distinct().
		Pluck("video_hash", &hashes).Error
	return hashes, err
}

// DeleteByID 删除指定任务。运行中的任务不可删除，避免与 worker 抢状态。
func (r *VideoAnalysisTaskRepo) DeleteByID(id string) error {
	if id == "" {
		return gorm.ErrRecordNotFound
	}
	result := r.db.Where("id = ? AND status <> ?", id, model.VideoAnalysisStatusRunning).Delete(&model.VideoAnalysisTask{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	// RowsAffected=0: either missing, or still running (lost the race with ClaimQueued).
	var task model.VideoAnalysisTask
	if err := r.db.Select("status").First(&task, "id = ?", id).Error; err != nil {
		return err
	}
	if task.Status == model.VideoAnalysisStatusRunning {
		return ErrVideoAnalysisTaskActive
	}
	return gorm.ErrRecordNotFound
}

// DeleteByMediaID 删除指定媒体的所有视频分析任务（用于媒体删除时清理）
func (r *VideoAnalysisTaskRepo) DeleteByMediaID(mediaID string) (int64, error) {
	if mediaID == "" {
		return 0, nil
	}
	result := r.db.Where("media_id = ?", mediaID).Delete(&model.VideoAnalysisTask{})
	return result.RowsAffected, result.Error
}

// AvgElapsedByStatus 计算指定状态的任务平均耗时（秒）
func (r *VideoAnalysisTaskRepo) AvgElapsedByStatus(status string) (float64, error) {
	var avg float64
	if err := r.db.Model(&model.VideoAnalysisTask{}).
		Where("status = ? AND started_at IS NOT NULL AND finished_at IS NOT NULL", status).
		Select("COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at - started_at))), 0)").
		Scan(&avg).Error; err != nil {
		return 0, err
	}
	return avg, nil
}

// CleanupOldTasks 清理旧的终态任务，按每个 media 分别保留最近 N 条记录。
func (r *VideoAnalysisTaskRepo) CleanupOldTasks(keepRecent int) (int64, error) {
	terminalStatuses := []string{
		model.VideoAnalysisStatusSucceeded,
		model.VideoAnalysisStatusPartial,
		model.VideoAnalysisStatusFailed,
		model.VideoAnalysisStatusSkipped,
	}

	// 用 ROW_NUMBER 在 DB 侧按 media 分组保留最近 keepRecent 条，
	// 避免把全部终态任务 id 载入 Go 内存。
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(terminalStatuses)), ",")
	args := make([]interface{}, 0, len(terminalStatuses)*2+1)
	for _, s := range terminalStatuses {
		args = append(args, s)
	}
	for _, s := range terminalStatuses {
		args = append(args, s)
	}
	args = append(args, keepRecent)

	sql := "DELETE FROM video_analysis_tasks WHERE status IN (" + placeholders + ")" +
		" AND id NOT IN (" +
		" SELECT id FROM (" +
		"  SELECT id, ROW_NUMBER() OVER (PARTITION BY media_id ORDER BY created_at DESC, id DESC) AS rn" +
		"  FROM video_analysis_tasks WHERE status IN (" + placeholders + ")" +
		" ) ranked WHERE rn <= ?" +
		" )"
	result := r.db.Exec(sql, args...)
	return result.RowsAffected, result.Error
}

// CleanupOrphanedByMediaID 清理媒体不存在的孤儿任务
func (r *VideoAnalysisTaskRepo) CleanupOrphanedByMediaID(existingMediaIDs []string) (int64, error) {
	if len(existingMediaIDs) == 0 {
		return 0, nil
	}
	result := r.db.Where("media_id NOT IN ?", existingMediaIDs).Delete(&model.VideoAnalysisTask{})
	return result.RowsAffected, result.Error
}
