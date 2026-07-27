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

	IncludeDescriptions bool `json:"include_descriptions" gorm:"default:false"`
	Force               bool `json:"force" gorm:"default:false"`
	FallbackUsed        bool `json:"fallback_used" gorm:"default:false"`

	StartedAt  *time.Time `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
	CreatedAt  time.Time  `json:"created_at" gorm:"index"`
	UpdatedAt  time.Time  `json:"updated_at"`

	Media Media `json:"-" gorm:"foreignKey:MediaID"`
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

// Scene 视频场景结构化分析结果，包含图片 embedding 和描述 embedding
// 用于后续的向量检索（以图搜图 / 自然语言搜索）
type Scene struct {
	ID                  string           `json:"id" gorm:"primaryKey;type:text"`
	VideoAnalysisTaskID string           `json:"video_analysis_task_id" gorm:"index;type:text;not null"`
	SceneIndex          int              `json:"scene_index" gorm:"not null"`
	StartTime           float64          `json:"start_time"`
	EndTime             float64          `json:"end_time"`
	ImagePath           string           `json:"image_path" gorm:"type:text"`
	// Embedding 场景图片的 CLIP 视觉 embedding（ViT-B-16-SigLIP2, 768 维）
	Embedding pgvector.Vector `json:"embedding" gorm:"type:vector(768)"`
	// Description 场景描述文本（由 VL 模型生成）
	Description string `json:"description" gorm:"type:text"`
	// DescriptionEmbedding 场景描述的 CLIP 文本 embedding（ViT-B-16-SigLIP2, 768 维）
	DescriptionEmbedding pgvector.Vector `json:"description_embedding" gorm:"type:vector(768)"`
	// Status 场景状态：ok / error
	Status string `json:"status" gorm:"type:text;default:ok"`
	// Error 错误信息
	Error string `json:"error" gorm:"type:text"`

	CreatedAt time.Time `json:"created_at"`

	VideoAnalysisTask VideoAnalysisTask `json:"-" gorm:"foreignKey:VideoAnalysisTaskID"`
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
