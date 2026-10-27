package service

import (
	"bytes"
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
	Code    string `json:"code,omitempty"`
	Message string `json:"message"`
	// Detail 上游原始诊断（finish_reason/usage/响应体等），面向排查；Message 保持简短给用户看。
	Detail   DetailText `json:"detail,omitempty"`
	Scope    string     `json:"scope,omitempty"`
	TargetID string     `json:"target_id,omitempty"`
}

// DetailText 上游诊断文本：兼容上游把 detail 传成字符串或结构化对象。
// 对象/数组会被压成紧凑 JSON 文本，落库与下发保持字符串形态，前端 <pre> 直接可读。
type DetailText string

// UnmarshalJSON 接受 string / object / array / number / null，统一转成文本。
func (d *DetailText) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		*d = ""
		return nil
	}
	if trimmed[0] == '"' {
		var text string
		if err := json.Unmarshal(trimmed, &text); err != nil {
			return err
		}
		*d = DetailText(text)
		return nil
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, trimmed); err != nil {
		*d = DetailText(string(trimmed))
		return nil
	}
	*d = DetailText(compact.String())
	return nil
}

// MarshalJSON 始终输出字符串，与落库/前端契约保持一致。
func (d DetailText) MarshalJSON() ([]byte, error) {
	return json.Marshal(string(d))
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

// VideoAnalysisArtifactFile artifact 清单中的单文件信息（v2 Pull 交付）。
type VideoAnalysisArtifactFile struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

// VideoAnalysisArtifact structure job 可下载产物清单（v2 Pull 交付）。
// 由外部服务在 job 状态响应顶层返回，下载后按 files 校验产物完整性。
type VideoAnalysisArtifact struct {
	Files []VideoAnalysisArtifactFile `json:"files"`
}

type videoAnalysisStructureResult struct {
	VideoHash    string                 `json:"video_hash"`
	Metadata     videoAnalysisMetadata  `json:"metadata"`
	Artifact     *VideoAnalysisArtifact `json:"artifact,omitempty"`
	Scenes       []videoAnalysisScene   `json:"scenes"`
	Warnings     []VideoAnalysisWarning `json:"warnings"`
	StageTimings map[string]float64     `json:"stage_timings"`
	ElapsedSec   float64                `json:"elapsed_sec"`
}

type videoAnalysisDescribeResult struct {
	VideoHash string `json:"video_hash"`
	// Status describe 阶段整体结果："completed" 全部成功 / "partial" 存在失败场景。
	// 旧版服务不返回该字段（空值按 completed 处理）。
	Status       string                       `json:"status"`
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
	gridPath, err := resolveClaimedGridPath(s.assetDir, result.VideoHash, scene.GridImage)
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
	// 结果 JSON 里可能残留已恢复场景的告警：读取侧再清理一次，
	// 保证接口返回的告警与当前场景状态一致。
	warnings := pruneSceneWarnings(result.Warnings, result.Scenes)
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
		Warnings:            warnings,
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

// resolveClaimedGridPath 解析搬移后的九宫格图片绝对路径。
// 布局：<assetDir>/<videoHash>/grids/<gridImage>（staging 被 mv 到 asset_dir/<hash>/）。
func resolveClaimedGridPath(assetDir, videoHash, gridImage string) (string, error) {
	assetDir = filepath.Clean(strings.TrimSpace(assetDir))
	if assetDir == "." || assetDir == "" {
		return "", errors.New("video analysis asset dir is not configured")
	}
	videoHash = strings.TrimSpace(videoHash)
	if videoHash == "" || videoHash == "." || strings.ContainsAny(videoHash, "/\\") {
		return "", errors.New("video analysis asset hash is invalid")
	}
	gridImage = filepath.Clean(strings.TrimSpace(gridImage))
	if gridImage == "." || gridImage == "" {
		return "", errors.New("video analysis grid path is missing")
	}
	if filepath.IsAbs(gridImage) || strings.HasPrefix(gridImage, "..") {
		return "", errors.New("video analysis grid path must be relative")
	}
	candidate := filepath.Join(assetDir, videoHash, "grids", gridImage)
	rel, err := filepath.Rel(assetDir, candidate)
	if err != nil {
		return "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("video analysis grid path escapes asset dir")
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

// buildStructureResultJSON 组装持久化到任务的 structure 结果 JSON。
// 外部服务把 artifact 清单放在 job status 顶层（与 result 平级），
// 这里把它嵌入 result 一并持久化，claim 阶段只需读 task.ResultJSON。
func buildStructureResultJSON(job *ExternalJob) (string, error) {
	raw := job.Result
	if len(raw) == 0 {
		return "", nil
	}
	if job.Artifact == nil {
		return string(raw), nil
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return "", err
	}
	if data == nil {
		data = map[string]any{}
	}
	data["artifact"] = job.Artifact
	out, err := json.Marshal(data)
	if err != nil {
		return "", err
	}
	return string(out), nil
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
		scene := &structureResult.Scenes[i]
		item, ok := byIndex[scene.SceneIndex]
		if !ok {
			continue
		}
		if strings.TrimSpace(scene.GridImage) == "" {
			scene.GridImage = strings.TrimSpace(item.GridImage)
		}
		incoming := strings.TrimSpace(item.Description)
		if incoming == "" {
			// 本轮失败/跳过：本轮状态照记（含沿用了旧描述的场景），但不用空描述覆盖旧描述。
			scene.Status = strings.TrimSpace(item.Status)
			scene.Error = strings.TrimSpace(item.Error)
			continue
		}
		scene.Description = incoming
		scene.Status = strings.TrimSpace(item.Status)
		scene.Error = ""
	}
	if len(describeResult.Warnings) > 0 {
		structureResult.Warnings = append(structureResult.Warnings, describeResult.Warnings...)
	}
	// 本批告警已追加：清理已补齐场景的旧条目与重复条目，保证明细与 error_message 一致。
	structureResult.Warnings = pruneSceneWarnings(structureResult.Warnings, structureResult.Scenes)
	if structureResult.VideoHash == "" {
		structureResult.VideoHash = strings.TrimSpace(describeResult.VideoHash)
	}
	merged, err := json.Marshal(structureResult)
	if err != nil {
		return "", fmt.Errorf("encode merged describe result: %w", err)
	}
	return string(merged), nil
}

// allScenesDescribed 判断结果里是否每个场景都已有描述。
// 重试时本轮失败的场景可能仍带着上一轮成功的描述，此时任务应视为完成而不是 partial。
func allScenesDescribed(resultJSON string) bool {
	if strings.TrimSpace(resultJSON) == "" {
		return false
	}
	var result videoAnalysisStructureResult
	if err := json.Unmarshal([]byte(resultJSON), &result); err != nil {
		return false
	}
	if len(result.Scenes) == 0 {
		return false
	}
	for _, scene := range result.Scenes {
		if strings.TrimSpace(scene.Description) == "" {
			return false
		}
	}
	return true
}

// pruneSceneWarnings 清理跨多次 describe 累积的场景告警：
//   - 场景已补齐描述且本轮未失败 → 丢弃该场景的失败告警；
//   - 场景已有旧描述但本轮仍失败（重试沿用上次描述）→ 保留告警，否则看不出本轮失败；
//   - 同一场景保留最后一条（告警按批次追加，最后一条是本批结果）。
//
// 按场景号去重：同一场景在不同批次里可能换错误码（如取消 → 真实失败），
// 旧错误码的那条不能留着。
//
// 非场景级告警（structure/detect 等）原样保留。
func pruneSceneWarnings(warnings []VideoAnalysisWarning, scenes []videoAnalysisScene) []VideoAnalysisWarning {
	if len(warnings) == 0 {
		return warnings
	}
	described := make(map[string]bool, len(scenes))
	failed := make(map[string]bool, len(scenes))
	for _, scene := range scenes {
		key := fmt.Sprintf("%d", scene.SceneIndex)
		if strings.TrimSpace(scene.Description) != "" {
			described[key] = true
		}
		if strings.EqualFold(strings.TrimSpace(scene.Status), "failed") {
			failed[key] = true
		}
	}
	lastIndex := make(map[string]int, len(warnings))
	for i, warning := range warnings {
		if !isSceneWarning(warning) {
			continue
		}
		lastIndex[warning.TargetID] = i
	}
	pruned := make([]VideoAnalysisWarning, 0, len(warnings))
	for i, warning := range warnings {
		if isSceneWarning(warning) {
			if described[warning.TargetID] && !failed[warning.TargetID] {
				continue
			}
			if lastIndex[warning.TargetID] != i {
				continue
			}
		}
		pruned = append(pruned, warning)
	}
	return pruned
}

// isSceneWarning 场景级告警：本地 describe 扇出写入 Scope=scene，并带场景号 TargetID。
func isSceneWarning(warning VideoAnalysisWarning) bool {
	return warning.Scope == "scene" && strings.TrimSpace(warning.TargetID) != ""
}

func firstNonEmptyVideoAnalysis(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
