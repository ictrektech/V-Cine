package model

import (
	"time"

	"github.com/google/uuid"
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
