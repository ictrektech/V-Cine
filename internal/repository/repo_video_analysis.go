package repository

import (
	"encoding/json"
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

// UpdateProgress 只更新进度列。轮询期间高频更新，避免整行 Save 反复写大 ResultJSON。
func (r *VideoAnalysisTaskRepo) UpdateProgress(id string, progress float64) error {
	return r.db.Model(&model.VideoAnalysisTask{}).Where("id = ?", id).Update("progress", progress).Error
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

// AssignMediaSeq 为任务批量填充媒体级执行序号（按媒体内创建时间升序，最新一次序号最大）。
// 序号在查询侧计算、不落库；查询失败时尽力而为（seq 保持 0）。
func (r *VideoAnalysisTaskRepo) AssignMediaSeq(tasks []model.VideoAnalysisTask) {
	if len(tasks) == 0 {
		return
	}
	mediaIDs := make([]string, 0, len(tasks))
	seen := make(map[string]struct{}, len(tasks))
	for _, task := range tasks {
		if task.MediaID == "" {
			continue
		}
		if _, ok := seen[task.MediaID]; ok {
			continue
		}
		seen[task.MediaID] = struct{}{}
		mediaIDs = append(mediaIDs, task.MediaID)
	}
	if len(mediaIDs) == 0 {
		return
	}
	var rows []struct {
		ID  string
		Seq int
	}
	err := r.db.Table("video_analysis_tasks").
		Select("id, ROW_NUMBER() OVER (PARTITION BY media_id ORDER BY created_at ASC, id ASC) AS seq").
		Where("media_id IN ?", mediaIDs).
		Scan(&rows).Error
	if err != nil {
		return
	}
	seqByID := make(map[string]int, len(rows))
	for _, row := range rows {
		seqByID[row.ID] = row.Seq
	}
	for i := range tasks {
		if seq, ok := seqByID[tasks[i].ID]; ok {
			tasks[i].Seq = seq
		}
	}
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

// List 查询任务列表。
// mediaID 非空时仅返回该媒体的任务历史；groupByMedia=true 时按媒体去重，
// 仅返回每个媒体最新一条（组头），total 为过滤后的媒体组数。
func (r *VideoAnalysisTaskRepo) List(page, pageSize int, status, libraryID, keyword, mediaID string, groupByMedia bool) ([]model.VideoAnalysisTask, int64, error) {
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
	if groupByMedia {
		// 每个媒体仅保留最新一条：JOIN 子查询取各媒体 created_at 最新的任务。
		latest := r.db.Model(&model.VideoAnalysisTask{}).
			Select("media_id, MAX(created_at) AS max_created").
			Group("media_id")
		query = query.Joins("JOIN (?) v ON video_analysis_tasks.media_id = v.media_id AND video_analysis_tasks.created_at = v.max_created", latest)
	}
	if mediaID != "" {
		query = query.Where("video_analysis_tasks.media_id = ?", mediaID)
	}
	if status != "" {
		query = query.Where("video_analysis_tasks.status = ?", status)
	}
	if libraryID != "" {
		query = query.Where("video_analysis_tasks.library_id = ?", libraryID)
	}
	if keyword != "" {
		query = query.Where("LOWER(video_analysis_tasks.media_title) LIKE ?", "%"+strings.ToLower(keyword)+"%")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if groupByMedia {
		// Count 之后限定列（避免 GORM 把 "video_analysis_tasks.*" 引号化为单个列名）
		query = query.Select("video_analysis_tasks.*")
	}
	var tasks []model.VideoAnalysisTask
	err := query.Order("video_analysis_tasks.created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&tasks).Error
	if err != nil {
		return nil, 0, err
	}
	r.AssignMediaSeq(tasks)
	return tasks, total, nil
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
// 与展示路径同源：独立列 + result_json 内嵌的 video_hash（列可能漏写，
// 展示找文件用的是 JSON 里的值，清理必须同样可见，否则目录会被误删）。
func (r *VideoAnalysisTaskRepo) ListVideoHashes() ([]string, error) {
	var hashes []string
	err := r.db.Model(&model.VideoAnalysisTask{}).
		Where("video_hash <> ''").
		Distinct().
		Pluck("video_hash", &hashes).Error
	if err != nil {
		return nil, err
	}

	// 补充列漏写、但 result_json 内嵌 video_hash 的行（量小），解析失败/无值忽略。
	var blobs []string
	err = r.db.Model(&model.VideoAnalysisTask{}).
		Where("video_hash = '' AND result_json LIKE ?", `%"video_hash"%`).
		Pluck("result_json", &blobs).Error
	if err != nil {
		// 补充查询失败必须中止清理：残缺名单会漏掉 JSON 引用的目录，
		// 继续删除可能误删仍被展示引用的产物。宁可不删，不可误删。
		return nil, err
	}
	for _, raw := range blobs {
		var header struct {
			VideoHash string `json:"video_hash"`
		}
		if err := json.Unmarshal([]byte(raw), &header); err != nil {
			continue
		}
		if h := strings.TrimSpace(header.VideoHash); h != "" {
			hashes = append(hashes, h)
		}
	}
	return hashes, nil
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

// DeleteByMediaID 删除指定媒体的所有视频分析任务（用于媒体删除时清理）。
// running 任务不删除，避免与 worker 抢状态（与 DeleteByID 的保护一致）。
func (r *VideoAnalysisTaskRepo) DeleteByMediaID(mediaID string) (int64, error) {
	if mediaID == "" {
		return 0, nil
	}
	result := r.db.Where("media_id = ? AND status <> ?", mediaID, model.VideoAnalysisStatusRunning).Delete(&model.VideoAnalysisTask{})
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
