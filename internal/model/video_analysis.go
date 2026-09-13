package model

import (
	"time"

	"github.com/google/uuid"
	pgvector "github.com/pgvector/pgvector-go"
	"gorm.io/gorm"
)

const (
	VideoAnalysisStatusQueued    = "queued"
	VideoAnalysisStatusRunning   = "running"
	VideoAnalysisStatusSucceeded = "succeeded"
	VideoAnalysisStatusPartial   = "partial"
	VideoAnalysisStatusFailed    = "failed"
	VideoAnalysisStatusSkipped   = "skipped"

	VideoAnalysisStageDetect    = "detect"
	VideoAnalysisStageStructure = "structure"
	VideoAnalysisStageDescribe  = "describe"
	VideoAnalysisStageDone      = "done"

	VideoAnalysisTriggerAuto   = "auto"
	VideoAnalysisTriggerManual = "manual"

	// 各阶段独立状态值
	VideoAnalysisStageStatusEmpty     = ""
	VideoAnalysisStageStatusRunning   = "running"
	VideoAnalysisStageStatusSucceeded = "succeeded"
	VideoAnalysisStageStatusFailed    = "failed"
	VideoAnalysisStageStatusSkipped   = "skipped"
)

var VideoAnalysisActiveStatuses = []string{
	VideoAnalysisStatusQueued,
	VideoAnalysisStatusRunning,
}

// VideoAnalysisTask persists the local orchestration state for one external
// scene-detection and video-structure workflow.
type VideoAnalysisTask struct {
	ID      string `json:"id" gorm:"primaryKey;type:text"`
	MediaID string `json:"media_id" gorm:"index;type:text;not null"`
	// ActiveKey is media_id for queued/running tasks and NULL for terminal tasks.
	// The unique index closes the race between concurrent submissions.
	ActiveKey       *string `json:"-" gorm:"uniqueIndex;type:text"`
	LibraryID       string  `json:"library_id" gorm:"index;type:text;not null"`
	MediaTitle      string  `json:"media_title" gorm:"type:text"`
	VideoPath       string  `json:"video_path" gorm:"type:text;not null"`
	MappedVideoPath string  `json:"mapped_video_path" gorm:"type:text;not null"`
	FileSize        int64   `json:"file_size"`
	FileMTime       int64   `json:"file_mtime"`
	Trigger         string  `json:"trigger" gorm:"type:text;not null"`
	Status          string  `json:"status" gorm:"index;type:text;not null;default:queued"`
	Stage           string  `json:"stage" gorm:"type:text;not null;default:detect"`
	Progress        float64 `json:"progress"`

	DetectJobID    string `json:"detect_job_id" gorm:"type:text"`
	StructureJobID string `json:"structure_job_id" gorm:"type:text"`
	DescribeJobID  string `json:"describe_job_id" gorm:"type:text"`
	VideoHash      string `json:"video_hash" gorm:"index;type:text"`
	ResultJSON     string `json:"-" gorm:"type:text"`
	ErrorCode      string `json:"error_code" gorm:"type:text"`
	ErrorMessage   string `json:"error_message" gorm:"type:text"`
	Attempt        int    `json:"attempt" gorm:"default:0"`

	// StageTimings 各阶段实际耗时（秒），由编排层在阶段状态流转时记录，JSON 序列化存储。
	StageTimings map[string]float64 `json:"stage_timings,omitempty" gorm:"serializer:json;type:text"`

	IncludeDescriptions bool `json:"include_descriptions" gorm:"default:false"`
	Force               bool `json:"force" gorm:"default:false"`
	FallbackUsed        bool `json:"fallback_used" gorm:"default:false"`

	// 各阶段独立状态（用于分阶段 workflow 控制）
	// 取值: ""(未开始) / "running" / "succeeded" / "failed" / "skipped"
	DetectStatus    string `json:"detect_status" gorm:"type:text;default:''"`
	StructureStatus string `json:"structure_status" gorm:"type:text;default:''"`
	DescribeStatus  string `json:"describe_status" gorm:"type:text;default:''"`

	// stageStartedAt/stageStartedStage 当前计时阶段的起点（非持久化，进程重启后丢失，
	// 阶段耗时按尽力而为记录）。
	stageStartedAt    time.Time
	stageStartedStage string

	StartedAt  *time.Time `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
	CreatedAt  time.Time  `json:"created_at" gorm:"index"`
	UpdatedAt  time.Time  `json:"updated_at"`

	Media Media `json:"-" gorm:"foreignKey:MediaID;constraint:OnDelete:CASCADE"`
}

func (t *VideoAnalysisTask) BeforeCreate(tx *gorm.DB) error {
	if t.ID == "" {
		t.ID = uuid.New().String()
	}
	if t.Status == "" {
		t.Status = VideoAnalysisStatusQueued
	}
	if t.Stage == "" {
		t.Stage = VideoAnalysisStageDetect
	}
	t.SyncActiveKey()
	return nil
}

func (t *VideoAnalysisTask) SyncActiveKey() {
	if t.Status == VideoAnalysisStatusQueued || t.Status == VideoAnalysisStatusRunning {
		mediaID := t.MediaID
		t.ActiveKey = &mediaID
		return
	}
	t.ActiveKey = nil
}

func IsVideoAnalysisTerminalStatus(status string) bool {
	switch status {
	case VideoAnalysisStatusSucceeded, VideoAnalysisStatusPartial, VideoAnalysisStatusFailed, VideoAnalysisStatusSkipped:
		return true
	default:
		return false
	}
}

// StageStatus 返回指定阶段的独立状态
func (t *VideoAnalysisTask) StageStatus(stage string) string {
	switch stage {
	case VideoAnalysisStageDetect:
		return t.DetectStatus
	case VideoAnalysisStageStructure:
		return t.StructureStatus
	case VideoAnalysisStageDescribe:
		return t.DescribeStatus
	}
	return ""
}

// SetStageStatus 设置指定阶段的独立状态，并在状态流转时记录阶段耗时。
func (t *VideoAnalysisTask) SetStageStatus(stage, status string) {
	prev := t.StageStatus(stage)
	switch stage {
	case VideoAnalysisStageDetect:
		t.DetectStatus = status
	case VideoAnalysisStageStructure:
		t.StructureStatus = status
	case VideoAnalysisStageDescribe:
		t.DescribeStatus = status
	}
	t.recordStageTiming(stage, prev, status)
}

// recordStageTiming 阶段耗时记录（尽力而为）：
//   - 阶段进入 running 且尚未完成过：记录计时起点（重跑已完成阶段不重新计时）；
//   - 该阶段流转到 succeeded/failed：按起点记录耗时（秒）；
//   - skipped 等其他流转不计时；起点不持久化，进程重启后丢失时自动跳过。
func (t *VideoAnalysisTask) recordStageTiming(stage, prev, status string) {
	if status == VideoAnalysisStageStatusRunning {
		if prev != VideoAnalysisStageStatusSucceeded {
			t.stageStartedAt = time.Now()
			t.stageStartedStage = stage
		}
		return
	}
	if stage == t.stageStartedStage && !t.stageStartedAt.IsZero() &&
		(status == VideoAnalysisStageStatusSucceeded || status == VideoAnalysisStageStatusFailed) {
		if t.StageTimings == nil {
			t.StageTimings = make(map[string]float64)
		}
		t.StageTimings[stage] = time.Since(t.stageStartedAt).Seconds()
	}
	if stage == t.stageStartedStage {
		t.stageStartedAt = time.Time{}
		t.stageStartedStage = ""
	}
}

// IsStageSucceeded 判断阶段是否已完成
func (t *VideoAnalysisTask) IsStageSucceeded(stage string) bool {
	return t.StageStatus(stage) == VideoAnalysisStageStatusSucceeded
}

// IsStageFailed 判断阶段是否已失败
func (t *VideoAnalysisTask) IsStageFailed(stage string) bool {
	return t.StageStatus(stage) == VideoAnalysisStageStatusFailed
}

// IsStageDone 判断阶段是否已结束（成功/失败/跳过）
func (t *VideoAnalysisTask) IsStageDone(stage string) bool {
	s := t.StageStatus(stage)
	return s == VideoAnalysisStageStatusSucceeded ||
		s == VideoAnalysisStageStatusFailed ||
		s == VideoAnalysisStageStatusSkipped
}

// IsStagePending 判断阶段是否尚未开始
func (t *VideoAnalysisTask) IsStagePending(stage string) bool {
	return t.StageStatus(stage) == VideoAnalysisStageStatusEmpty
}

// NextPendingStage 返回第一个未完成的阶段
func (t *VideoAnalysisTask) NextPendingStage() string {
	if !t.IsStageDone(VideoAnalysisStageDetect) {
		return VideoAnalysisStageDetect
	}
	if !t.IsStageDone(VideoAnalysisStageStructure) {
		return VideoAnalysisStageStructure
	}
	if t.IncludeDescriptions && !t.IsStageDone(VideoAnalysisStageDescribe) {
		return VideoAnalysisStageDescribe
	}
	return VideoAnalysisStageDone
}

// CanRunStage 检查指定阶段的前置依赖是否满足
func (t *VideoAnalysisTask) CanRunStage(stage string) (bool, string) {
	switch stage {
	case VideoAnalysisStageDetect:
		return true, ""
	case VideoAnalysisStageStructure:
		if !t.IsStageSucceeded(VideoAnalysisStageDetect) {
			return false, "前置阶段 Detect 未完成，请先运行 Detect"
		}
		return true, ""
	case VideoAnalysisStageDescribe:
		if !t.IsStageSucceeded(VideoAnalysisStageDetect) {
			return false, "前置阶段 Detect 未完成"
		}
		if !t.IsStageSucceeded(VideoAnalysisStageStructure) {
			return false, "前置阶段 Structure 未完成，请先运行 Structure"
		}
		return true, ""
	}
	return false, "未知阶段: " + stage
}

// Scene 视频场景结构化分析结果，包含图片 embedding 和描述 embedding
// 用于后续的向量检索（以图搜图 / 自然语言搜索）
type Scene struct {
	ID                  string  `json:"id" gorm:"primaryKey;type:text"`
	VideoAnalysisTaskID string  `json:"video_analysis_task_id" gorm:"index;type:text;not null"`
	SceneIndex          int     `json:"scene_index" gorm:"not null"`
	StartTime           float64 `json:"start_time"`
	EndTime             float64 `json:"end_time"`
	ImagePath           string  `json:"image_path" gorm:"type:text"`
	// Embedding 场景图片的 CLIP 视觉 embedding（ViT-B-16-SigLIP2, 768 维）
	Embedding *pgvector.Vector `json:"embedding" gorm:"type:vector(768)"`
	// Description 场景描述文本（由 VL 模型生成）
	Description string `json:"description" gorm:"type:text"`
	// DescriptionEmbedding 场景描述的 CLIP 文本 embedding（ViT-B-16-SigLIP2, 768 维）
	DescriptionEmbedding *pgvector.Vector `json:"description_embedding" gorm:"type:vector(768)"`
	// Status 场景状态：ok / error
	Status string `json:"status" gorm:"type:text;default:ok"`
	// Error 错误信息
	Error string `json:"error" gorm:"type:text"`

	CreatedAt time.Time `json:"created_at"`

	VideoAnalysisTask VideoAnalysisTask `json:"-" gorm:"foreignKey:VideoAnalysisTaskID;constraint:OnDelete:CASCADE"`
}

func (s *Scene) BeforeCreate(tx *gorm.DB) error {
	if s.ID == "" {
		s.ID = uuid.New().String()
	}
	return nil
}

// TableName 指定 Scene 的表名
func (Scene) TableName() string {
	return "scenes"
}
