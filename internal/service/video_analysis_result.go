package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/nowen-video/nowen-video/internal/model"
	"gorm.io/gorm"
)

type VideoAnalysisWarning struct {
	Code     string `json:"code,omitempty"`
	Message  string `json:"message"`
	Scope    string `json:"scope,omitempty"`
	TargetID string `json:"target_id,omitempty"`
}

type SceneResult struct {
	SceneID       string  `json:"scene_id,omitempty"`
	SceneIndex    int     `json:"scene_index"`
	StartTime     float64 `json:"start_time"`
	EndTime       float64 `json:"end_time"`
	StartFrame    int64   `json:"start_frame"`
	EndFrame      int64   `json:"end_frame"`
	GridAvailable bool    `json:"grid_available"`
	GridURL       string  `json:"grid_url,omitempty"`
	Description   string  `json:"description,omitempty"`
	Status        string  `json:"status,omitempty"`
	Error         string  `json:"error,omitempty"`
}

type VideoAnalysisResult struct {
	TaskID              string                 `json:"task_id"`
	MediaID             string                 `json:"media_id"`
	LibraryID           string                 `json:"library_id"`
	MediaTitle          string                 `json:"media_title"`
	Status              string                 `json:"status"`
	Stage               string                 `json:"stage"`
	Trigger             string                 `json:"trigger"`
	Progress            float64                `json:"progress"`
	VideoHash           string                 `json:"video_hash"`
	VideoPath           string                 `json:"video_path"`
	MappedVideoPath     string                 `json:"mapped_video_path"`
	Duration            float64                `json:"duration,omitempty"`
	FPS                 float64                `json:"fps,omitempty"`
	Width               int                    `json:"width,omitempty"`
	Height              int                    `json:"height,omitempty"`
	Codec               string                 `json:"codec,omitempty"`
	Bitrate             int64                  `json:"bitrate,omitempty"`
	HasAudio            bool                   `json:"has_audio"`
	TotalFrames         int64                  `json:"total_frames,omitempty"`
	SceneCount          int                    `json:"scene_count"`
	Warnings            []VideoAnalysisWarning `json:"warnings,omitempty"`
	StageTimings        map[string]float64     `json:"stage_timings,omitempty"`
	ElapsedSec          float64                `json:"elapsed_sec,omitempty"`
	FallbackUsed        bool                   `json:"fallback_used"`
	IncludeDescriptions bool                   `json:"include_descriptions"`
	Force               bool                   `json:"force"`
	Attempt             int                    `json:"attempt"`
	ErrorCode           string                 `json:"error_code,omitempty"`
	ErrorMessage        string                 `json:"error_message,omitempty"`
	CreatedAt           time.Time              `json:"created_at"`
	StartedAt           *time.Time             `json:"started_at,omitempty"`
	FinishedAt          *time.Time             `json:"finished_at,omitempty"`
	Scenes              []SceneResult          `json:"scenes"`
}

type videoAnalysisStructureResult struct {
	VideoHash    string                 `json:"video_hash"`
	Metadata     videoAnalysisMetadata  `json:"metadata"`
	GridBasePath string                 `json:"grid_base_path"`
	Scenes       []videoAnalysisScene   `json:"scenes"`
	Warnings     []VideoAnalysisWarning `json:"warnings"`
	StageTimings map[string]float64     `json:"stage_timings"`
	ElapsedSec   float64                `json:"elapsed_sec"`
}

type videoAnalysisDescribeResult struct {
	VideoHash    string                       `json:"video_hash"`
	Descriptions []videoAnalysisSceneDescribe `json:"descriptions"`
	Warnings     []VideoAnalysisWarning       `json:"warnings"`
}

type videoAnalysisMetadata struct {
	VideoPath   string  `json:"video_path"`
	FPS         float64 `json:"fps"`
	Duration    float64 `json:"duration"`
	Width       int     `json:"width"`
	Height      int     `json:"height"`
	Codec       string  `json:"codec"`
	Bitrate     int64   `json:"bitrate"`
	HasAudio    bool    `json:"has_audio"`
	TotalFrames int64   `json:"total_frames"`
}

type videoAnalysisScene struct {
	SceneID     string  `json:"scene_id"`
	SceneIndex  int     `json:"scene_index"`
	StartTime   float64 `json:"start_time"`
	EndTime     float64 `json:"end_time"`
	StartFrame  int64   `json:"start_frame"`
	EndFrame    int64   `json:"end_frame"`
	GridImage   string  `json:"grid_image"`
	Description string  `json:"description"`
	Status      string  `json:"status"`
	Error       string  `json:"error"`
	// Embedding 场景图片的 CLIP 视觉 embedding（由外部 ML 服务返回）
	Embedding []float64 `json:"embedding,omitempty"`
}

type videoAnalysisSceneDescribe struct {
	SceneIndex  int    `json:"scene_index"`
	GridImage   string `json:"grid_image"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Error       string `json:"error"`
	// DescriptionEmbedding 场景描述的 CLIP 文本 embedding（由外部 ML 服务返回）
	DescriptionEmbedding []float64 `json:"description_embedding,omitempty"`
}

func (s *VideoAnalysisService) GetResultByMedia(mediaID, taskID string) (*VideoAnalysisResult, error) {
	if !s.IsAvailable() {
		return nil, errors.New("video analysis service is not configured")
	}
	task, err := s.resolveResultTask(mediaID, taskID)
	if err != nil {
		return nil, err
	}
	return buildVideoAnalysisResult(task)
}

func (s *VideoAnalysisService) OpenSceneGridByMedia(mediaID, taskID string, sceneIndex int) (*os.File, string, time.Time, error) {
	if !s.IsAvailable() {
		return nil, "", time.Time{}, errors.New("video analysis service is not configured")
	}
	if sceneIndex < 0 {
		return nil, "", time.Time{}, errors.New("scene index must be >= 0")
	}
	task, err := s.resolveResultTask(mediaID, taskID)
	if err != nil {
		return nil, "", time.Time{}, err
	}
	result, err := decodeVideoAnalysisStructureResult(task)
	if err != nil {
		return nil, "", time.Time{}, err
	}
	scene, ok := findVideoAnalysisSceneByIndex(result.Scenes, sceneIndex)
	if !ok {
		return nil, "", time.Time{}, gorm.ErrRecordNotFound
	}
	if strings.TrimSpace(scene.GridImage) == "" {
		return nil, "", time.Time{}, gorm.ErrRecordNotFound
	}
	gridPath, err := resolveVideoAnalysisGridPath(s.cacheRoot, result.GridBasePath, scene.GridImage)
	if err != nil {
		return nil, "", time.Time{}, err
	}
	file, err := os.Open(gridPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, "", time.Time{}, gorm.ErrRecordNotFound
		}
		return nil, "", time.Time{}, err
	}
	stat, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, "", time.Time{}, err
	}
	return file, detectVideoAnalysisImageContentType(gridPath), stat.ModTime(), nil
}

func (s *VideoAnalysisService) resolveResultTask(mediaID, taskID string) (*model.VideoAnalysisTask, error) {
	if strings.TrimSpace(mediaID) == "" {
		return nil, errors.New("media_id is required")
	}
	if taskID = strings.TrimSpace(taskID); taskID != "" {
		task, err := s.tasks.FindByID(taskID)
		if err != nil {
			return nil, err
		}
		if task.MediaID != mediaID {
			return nil, gorm.ErrRecordNotFound
		}
		if strings.TrimSpace(task.ResultJSON) == "" {
			return nil, gorm.ErrRecordNotFound
		}
		return task, nil
	}
	return s.tasks.FindLatestResultByMediaID(mediaID)
}

func buildVideoAnalysisResult(task *model.VideoAnalysisTask) (*VideoAnalysisResult, error) {
	result, err := decodeVideoAnalysisStructureResult(task)
	if err != nil {
		return nil, err
	}
	scenes := make([]SceneResult, 0, len(result.Scenes))
	for _, scene := range result.Scenes {
		sceneResult := SceneResult{
			SceneID:       scene.SceneID,
			SceneIndex:    scene.SceneIndex,
			StartTime:     scene.StartTime,
			EndTime:       scene.EndTime,
			StartFrame:    scene.StartFrame,
			EndFrame:      scene.EndFrame,
			GridAvailable: strings.TrimSpace(scene.GridImage) != "",
			Description:   strings.TrimSpace(scene.Description),
			Status:        strings.TrimSpace(scene.Status),
			Error:         strings.TrimSpace(scene.Error),
		}
		if sceneResult.GridAvailable {
			sceneResult.GridURL = fmt.Sprintf("/api/media/%s/video-analysis/scenes/%d/grid?task_id=%s", task.MediaID, scene.SceneIndex, task.ID)
		}
		scenes = append(scenes, sceneResult)
	}
	sort.Slice(scenes, func(i, j int) bool {
		return scenes[i].SceneIndex < scenes[j].SceneIndex
	})
	return &VideoAnalysisResult{
		TaskID:              task.ID,
		MediaID:             task.MediaID,
		LibraryID:           task.LibraryID,
		MediaTitle:          task.MediaTitle,
		Status:              task.Status,
		Stage:               task.Stage,
		Trigger:             task.Trigger,
		Progress:            task.Progress,
		VideoHash:           firstNonEmptyVideoAnalysis(result.VideoHash, task.VideoHash),
		VideoPath:           firstNonEmptyVideoAnalysis(result.Metadata.VideoPath, task.VideoPath),
		MappedVideoPath:     task.MappedVideoPath,
		Duration:            result.Metadata.Duration,
		FPS:                 result.Metadata.FPS,
		Width:               result.Metadata.Width,
		Height:              result.Metadata.Height,
		Codec:               result.Metadata.Codec,
		Bitrate:             result.Metadata.Bitrate,
		HasAudio:            result.Metadata.HasAudio,
		TotalFrames:         result.Metadata.TotalFrames,
		SceneCount:          len(scenes),
		Warnings:            result.Warnings,
		StageTimings:        result.StageTimings,
		ElapsedSec:          result.ElapsedSec,
		FallbackUsed:        task.FallbackUsed,
		IncludeDescriptions: task.IncludeDescriptions,
		Force:               task.Force,
		Attempt:             task.Attempt,
		ErrorCode:           task.ErrorCode,
		ErrorMessage:        task.ErrorMessage,
		CreatedAt:           task.CreatedAt,
		StartedAt:           task.StartedAt,
		FinishedAt:          task.FinishedAt,
		Scenes:              scenes,
	}, nil
}

func decodeVideoAnalysisStructureResult(task *model.VideoAnalysisTask) (*videoAnalysisStructureResult, error) {
	if task == nil || strings.TrimSpace(task.ResultJSON) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var result videoAnalysisStructureResult
	if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil {
		return nil, fmt.Errorf("decode video analysis result: %w", err)
	}
	return &result, nil
}

func resolveVideoAnalysisGridPath(cacheRoot, gridBasePath, gridImage string) (string, error) {
	cacheRoot = filepath.Clean(strings.TrimSpace(cacheRoot))
	if cacheRoot == "." || cacheRoot == "" {
		return "", errors.New("video analysis cache root is not configured")
	}
	gridBasePath = filepath.Clean(strings.TrimSpace(gridBasePath))
	gridImage = filepath.Clean(strings.TrimSpace(gridImage))
	if gridBasePath == "." || gridBasePath == "" || gridImage == "." || gridImage == "" {
		return "", errors.New("video analysis grid path is missing")
	}
	if filepath.IsAbs(gridBasePath) || filepath.IsAbs(gridImage) {
		return "", errors.New("video analysis grid path must be relative")
	}
	candidate := filepath.Join(cacheRoot, gridBasePath, gridImage)
	rel, err := filepath.Rel(cacheRoot, candidate)
	if err != nil {
		return "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("video analysis grid path escapes cache root")
	}
	return candidate, nil
}

func findVideoAnalysisSceneByIndex(scenes []videoAnalysisScene, sceneIndex int) (videoAnalysisScene, bool) {
	for i := range scenes {
		if scenes[i].SceneIndex == sceneIndex {
			return scenes[i], true
		}
	}
	return videoAnalysisScene{}, false
}

func detectVideoAnalysisImageContentType(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	if typ := mime.TypeByExtension(ext); typ != "" {
		return typ
	}
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}

func mergeDescribeResult(structureJSON string, describeJSON []byte) (string, error) {
	var structureResult videoAnalysisStructureResult
	if err := json.Unmarshal([]byte(structureJSON), &structureResult); err != nil {
		return "", fmt.Errorf("decode structure result: %w", err)
	}
	var describeResult videoAnalysisDescribeResult
	if err := json.Unmarshal(describeJSON, &describeResult); err != nil {
		return "", fmt.Errorf("decode describe result: %w", err)
	}
	byIndex := make(map[int]videoAnalysisSceneDescribe, len(describeResult.Descriptions))
	for _, item := range describeResult.Descriptions {
		byIndex[item.SceneIndex] = item
	}
	for i := range structureResult.Scenes {
		if item, ok := byIndex[structureResult.Scenes[i].SceneIndex]; ok {
			structureResult.Scenes[i].Description = strings.TrimSpace(item.Description)
			structureResult.Scenes[i].Status = strings.TrimSpace(item.Status)
			structureResult.Scenes[i].Error = strings.TrimSpace(item.Error)
			if strings.TrimSpace(structureResult.Scenes[i].GridImage) == "" {
				structureResult.Scenes[i].GridImage = strings.TrimSpace(item.GridImage)
			}
		}
	}
	if len(describeResult.Warnings) > 0 {
		structureResult.Warnings = append(structureResult.Warnings, describeResult.Warnings...)
	}
	if structureResult.VideoHash == "" {
		structureResult.VideoHash = strings.TrimSpace(describeResult.VideoHash)
	}
	merged, err := json.Marshal(structureResult)
	if err != nil {
		return "", fmt.Errorf("encode merged describe result: %w", err)
	}
	return string(merged), nil
}

func firstNonEmptyVideoAnalysis(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
