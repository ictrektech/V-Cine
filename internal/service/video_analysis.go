package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	pgvector "github.com/pgvector/pgvector-go"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

const videoAnalysisTaskUpdateEvent = "video_analysis_task_update"

// ErrVideoAnalysisTaskActive 表示媒体已有进行中的分析任务。
var ErrVideoAnalysisTaskActive = repository.ErrVideoAnalysisTaskActive

// errClaimStagingFailed 标记 staging 搬移失败（产物未落地），由编排层转为
// CLAIM_STAGING_FAILED 错误码。
var errClaimStagingFailed = errors.New("claim staging dir failed")

type videoAnalysisExternalClient interface {
	SubmitDetectJob(context.Context, DetectJobRequest) (*ExternalJobRef, error)
	GetDetectJob(context.Context, string) (*ExternalJob, error)
	SubmitStructureJob(context.Context, StructureJobRequest) (*ExternalJobRef, error)
	GetStructureJob(context.Context, string) (*ExternalJob, error)
	SubmitDescribeJob(context.Context, DescribeJobRequest) (*ExternalJobRef, error)
	GetDescribeJob(context.Context, string) (*ExternalJob, error)
	DownloadStructureArtifact(context.Context, string, string, *VideoAnalysisArtifact) error
	ReleaseStructureJob(context.Context, string) error
}

type VideoAnalysisSubmitOptions struct {
	Trigger             string
	Force               bool
	IncludeDescriptions bool
}

// VideoAnalysisDetailedStats 详细的视频分析统计指标
type VideoAnalysisDetailedStats struct {
	StatusCounts      map[string]int64 `json:"status_counts"`
	TotalTasks        int64            `json:"total_tasks"`
	QueuedCount       int64            `json:"queued_count"`
	RunningCount      int64            `json:"running_count"`
	SuccessRate       float64          `json:"success_rate"`
	ErrorRate         float64          `json:"error_rate"`
	PartialRate       float64          `json:"partial_rate"`
	AvgElapsedSeconds float64          `json:"avg_elapsed_seconds"`
}

type VideoAnalysisSubmitOutcome struct {
	Task    *model.VideoAnalysisTask
	Result  string
	Message string
}

type VideoAnalysisBatchError struct {
	MediaID string `json:"media_id"`
	Kind    string `json:"kind,omitempty"`
	Message string `json:"message"`
}

type VideoAnalysisBatchResult struct {
	Created       int                        `json:"created"`
	Reused        int                        `json:"reused"`
	Skipped       int                        `json:"skipped"`
	SkippedErrors []VideoAnalysisBatchError  `json:"skipped_errors,omitempty"`
	Errors        []VideoAnalysisBatchError  `json:"errors"`
	TaskIDs       []string                   `json:"task_ids"`
	Tasks         []*model.VideoAnalysisTask `json:"tasks"`
}

type VideoAnalysisService struct {
	tasks            *repository.VideoAnalysisTaskRepo
	media            *repository.MediaRepo
	client           videoAnalysisExternalClient
	vfsMgr           *VFSManager
	sceneRepo        *repository.SceneRepo
	embeddingClient  *EmbeddingClient
	assetDir         string
	describeEnabled  bool
	enabled          bool
	sceneBaseURL     string
	structureBaseURL string

	mu sync.RWMutex
	// cleanupMu 串行化 structure 目录清理与 claim 搬移，避免清理误删新 claim 的目录。
	cleanupMu sync.Mutex

	wsHub        *WSHub
	logger       *zap.SugaredLogger
	pollInterval time.Duration
	jobTimeout   time.Duration

	// appCfg 全局配置引用（用于读取 LLM 配置，动态注入 describe 阶段）
	appCfg *config.Config
}

func NewVideoAnalysisService(
	tasks *repository.VideoAnalysisTaskRepo,
	media *repository.MediaRepo,
	client videoAnalysisExternalClient,
	sceneRepo *repository.SceneRepo,
	embeddingClient *EmbeddingClient,
	assetDir string,
	describeEnabled bool,
	wsHub *WSHub,
	logger *zap.SugaredLogger,
	pollInterval, jobTimeout time.Duration,
	appCfg *config.Config,
) *VideoAnalysisService {
	if pollInterval <= 0 {
		pollInterval = 2 * time.Second
	}
	if jobTimeout <= 0 {
		jobTimeout = 2 * time.Hour
	}
	s := &VideoAnalysisService{
		tasks: tasks, media: media, client: client, sceneRepo: sceneRepo, embeddingClient: embeddingClient,
		assetDir:        strings.TrimSpace(assetDir),
		describeEnabled: describeEnabled, wsHub: wsHub, logger: logger, pollInterval: pollInterval, jobTimeout: jobTimeout,
		appCfg: appCfg,
	}
	if appCfg != nil {
		// 记录服务启动时实际使用的配置；运行期修改配置不影响已启动的服务。
		s.enabled = appCfg.VideoAnalysis.Enabled
		s.sceneBaseURL = appCfg.VideoAnalysis.SceneBaseURL
		s.structureBaseURL = appCfg.VideoAnalysis.StructureBaseURL
	}
	return s
}

func (s *VideoAnalysisService) SetDescribeEnabled(enabled bool) {
	s.mu.Lock()
	s.describeEnabled = enabled
	s.mu.Unlock()
}

// SetEnabled 热更新视频分析总开关，保存后立即生效（健康检查实时反映，无需重启）。
func (s *VideoAnalysisService) SetEnabled(enabled bool) {
	s.mu.Lock()
	s.enabled = enabled
	s.mu.Unlock()
}

// SetVFSManager 注入远程文件系统管理器（webdav/alist/s3），用于远程媒体提交分析。
func (s *VideoAnalysisService) SetVFSManager(vfsMgr *VFSManager) {
	s.vfsMgr = vfsMgr
}

// SetBaseURLs 热更新运行中的 Scene / Structure 服务地址，保存后立即生效。
func (s *VideoAnalysisService) SetBaseURLs(sceneBaseURL, structureBaseURL string) error {
	sceneBase, err := normalizeAnalysisBaseURL(sceneBaseURL)
	if err != nil {
		return fmt.Errorf("invalid scene base URL: %w", err)
	}
	structureBase, err := normalizeAnalysisBaseURL(structureBaseURL)
	if err != nil {
		return fmt.Errorf("invalid structure base URL: %w", err)
	}
	if updater, ok := s.client.(interface{ SetBaseURLs(string, string) error }); ok {
		if err := updater.SetBaseURLs(sceneBase.String(), structureBase.String()); err != nil {
			return err
		}
	}
	s.mu.Lock()
	s.sceneBaseURL = sceneBase.String()
	s.structureBaseURL = structureBase.String()
	s.mu.Unlock()
	return nil
}

// 默认媒体源地址：同一 compose 网络内的服务名（DNS 别名），
// 容器 IP 变化不影响解析；异网/远程拓扑用环境变量 VCINE_VIDEO_ANALYSIS_MEDIA_BASE_URL 覆盖。
const defaultAnalysisMediaBaseURL = "http://nowen-video:8080"

// buildAnalysisSourceURL 生成 detect/structure 可访问的内部媒体源 URL（按 mediaId 寻址）。
func (s *VideoAnalysisService) buildAnalysisSourceURL(mediaID string) string {
	if s.appCfg == nil {
		return ""
	}
	base := defaultAnalysisMediaBaseURL
	if b := strings.TrimRight(strings.TrimSpace(s.appCfg.VideoAnalysis.MediaBaseURL), "/"); b != "" {
		base = b
	}
	u := base + "/internal/video-analysis/source/" + url.PathEscape(mediaID)
	if token := strings.TrimSpace(s.appCfg.VideoAnalysis.SourceToken); token != "" {
		u += "?token=" + url.QueryEscape(token)
	}
	return u
}

func (s *VideoAnalysisService) IsAvailable() bool {
	return s != nil && s.client != nil && s.tasks != nil && s.media != nil
}

// VideoAnalysisConfig 视频分析服务配置（供前端读取）
type VideoAnalysisConfig struct {
	DescribeEnabled    bool `json:"describe_enabled"`
	RemoteVideoEnabled bool `json:"remote_video_enabled"`
}

// GetConfig 返回视频分析服务配置
func (s *VideoAnalysisService) GetConfig() VideoAnalysisConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	remoteEnabled := false
	if s.appCfg != nil {
		remoteEnabled = s.appCfg.VideoAnalysis.RemoteVideoEnabled
	}
	return VideoAnalysisConfig{
		DescribeEnabled:    s.describeEnabled,
		RemoteVideoEnabled: remoteEnabled,
	}
}

// VideoAnalysisHealthInfo 视频分析服务诊断信息（供系统设置只读展示）
type VideoAnalysisHealthInfo struct {
	Enabled          bool                 `json:"enabled"`
	Available        bool                 `json:"available"`
	DescribeEnabled  bool                 `json:"describe_enabled"`
	SceneBaseURL     string               `json:"scene_base_url"`
	StructureBaseURL string               `json:"structure_base_url"`
	AssetDir         string               `json:"asset_dir"`
	Scene            *VideoAnalysisHealth `json:"scene,omitempty"`
	Structure        *VideoAnalysisHealth `json:"structure,omitempty"`
	SceneError       string               `json:"scene_error,omitempty"`
	StructureError   string               `json:"structure_error,omitempty"`
}

// GetHealth 返回 Scene / Structure 服务健康状态与关键配置（只读诊断）。
// 即使服务未启用也返回 200，便于前端展示“未启用/不可用”状态。
func (s *VideoAnalysisService) GetHealth(ctx context.Context) VideoAnalysisHealthInfo {
	if s == nil {
		return VideoAnalysisHealthInfo{}
	}

	info := VideoAnalysisHealthInfo{Available: s.IsAvailable()}
	s.mu.RLock()
	info.DescribeEnabled = s.describeEnabled
	info.Enabled = s.enabled
	info.SceneBaseURL = s.sceneBaseURL
	info.StructureBaseURL = s.structureBaseURL
	info.AssetDir = s.assetDir
	s.mu.RUnlock()
	if !info.Available {
		return info
	}

	if hc, ok := s.client.(interface {
		CheckSceneHealth(context.Context) (*VideoAnalysisHealth, error)
		CheckStructureHealth(context.Context) (*VideoAnalysisHealth, error)
	}); ok {
		if scene, err := hc.CheckSceneHealth(ctx); err != nil {
			info.SceneError = err.Error()
		} else {
			info.Scene = scene
		}
		if structure, err := hc.CheckStructureHealth(ctx); err != nil {
			info.StructureError = err.Error()
		} else {
			info.Structure = structure
		}
	}
	return info
}

// SearchScenesByText 通过文本 embedding 搜索场景
func (s *VideoAnalysisService) SearchScenesByText(embedding []float32, limit int) ([]repository.SceneSearchResult, error) {
	if s.sceneRepo == nil {
		return nil, errors.New("scene repo is not available")
	}
	return s.sceneRepo.SearchByText(embedding, limit)
}

// SearchScenesByTextQuery 通过文本查询搜索场景：文本 → CLIP 文本向量 → 检索描述 embedding 列
// 文搜文：查询文本向量 vs description_embedding（场景描述文本向量）
func (s *VideoAnalysisService) SearchScenesByTextQuery(q string, limit int) ([]repository.SceneSearchResult, error) {
	if s.sceneRepo == nil {
		return nil, errors.New("scene repo is not available")
	}
	vec, err := s.textToEmbeddingVector(q)
	if err != nil {
		return nil, err
	}
	return s.sceneRepo.SearchByText(vec, limit)
}

// SearchScenesByTextToImage 文搜图：文本查询 → CLIP 文本向量 → 检索场景视觉 embedding 列
// 文本与图片向量同属 SigLIP2 模型的同一 CLIP 空间，可跨模态直接做余弦检索
func (s *VideoAnalysisService) SearchScenesByTextToImage(q string, limit int) ([]repository.SceneSearchResult, error) {
	if s.sceneRepo == nil {
		return nil, errors.New("scene repo is not available")
	}
	vec, err := s.textToEmbeddingVector(q)
	if err != nil {
		return nil, err
	}
	return s.sceneRepo.SearchByImage(vec, limit)
}

// textToEmbeddingVector 文本 → CLIP 文本向量（float32），文搜文/文搜图共用
func (s *VideoAnalysisService) textToEmbeddingVector(q string) ([]float32, error) {
	if s.embeddingClient == nil || !s.embeddingClient.IsAvailable() {
		return nil, errors.New("embedding service is not available")
	}
	emb, err := s.embeddingClient.ComputeTextEmbedding(context.Background(), q)
	if err != nil {
		return nil, err
	}
	vec := make([]float32, len(emb))
	for i, v := range emb {
		vec[i] = float32(v)
	}
	return vec, nil
}

// SearchScenesByImage 通过图片 embedding 搜索场景
func (s *VideoAnalysisService) SearchScenesByImage(embedding []float32, limit int) ([]repository.SceneSearchResult, error) {
	if s.sceneRepo == nil {
		return nil, errors.New("scene repo is not available")
	}
	return s.sceneRepo.SearchByImage(embedding, limit)
}

// GetScenesByTaskID 获取某次分析的所有场景
func (s *VideoAnalysisService) GetScenesByTaskID(taskID string) ([]model.Scene, error) {
	if s.sceneRepo == nil {
		return nil, errors.New("scene repo is not available")
	}
	return s.sceneRepo.GetByTaskID(taskID)
}

func (s *VideoAnalysisService) SubmitMedia(mediaID string, options VideoAnalysisSubmitOptions) (*model.VideoAnalysisTask, bool, error) {
	outcome, err := s.SubmitMediaWithOutcome(mediaID, options)
	if err != nil {
		return nil, false, err
	}
	return outcome.Task, outcome.Result == "reused", nil
}

func (s *VideoAnalysisService) SubmitMediaWithOutcome(mediaID string, options VideoAnalysisSubmitOptions) (*VideoAnalysisSubmitOutcome, error) {
	if !s.IsAvailable() {
		return nil, errors.New("video analysis service is not configured")
	}
	if options.IncludeDescriptions && !s.describeEnabled {
		return nil, errors.New("场景描述功能未启用，请联系管理员在配置文件中开启 describe_enabled 选项")
	}
	if active, err := s.tasks.FindActiveByMediaID(mediaID); err == nil {
		return &VideoAnalysisSubmitOutcome{Task: active, Result: "reused"}, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	media, err := s.media.FindByID(mediaID)
	if err != nil {
		return nil, err
	}
	if media.StreamURL != "" {
		return nil, errors.New("remote STRM media is not supported by video analysis")
	}
	// URL 媒体源寻址：detect/structure 通过内部 HTTP 接口按 mediaId 拉流，
	// 不依赖宿主文件路径，也不依赖两侧共享文件系统。
	mappedPath := s.buildAnalysisSourceURL(mediaID)
	// 远程视频结构化默认关闭：避免无感知消耗带宽/网络。
	if IsRemotePath(media.FilePath) && (s.appCfg == nil || !s.appCfg.VideoAnalysis.RemoteVideoEnabled) {
		return nil, errors.New("远程视频结构化未开启，已跳过；本地/内网视频可正常解析")
	}
	// 本地文件用 os.Stat；webdav/alist/s3 远程文件用 VFS.Stat（URL 模式已能统一拉流）。
	fileInfo, err := s.statVideoPath(media.FilePath)
	if err != nil {
		return nil, fmt.Errorf("stat video file: %w", err)
	}
	if !fileInfo.Mode().IsRegular() {
		return nil, errors.New("video path is not a regular file")
	}
	trigger := options.Trigger
	if trigger == "" {
		trigger = model.VideoAnalysisTriggerManual
	}
	if trigger != model.VideoAnalysisTriggerManual && trigger != model.VideoAnalysisTriggerAuto {
		return nil, errors.New("invalid video analysis trigger")
	}
	if !options.Force {
		if latest, latestErr := s.tasks.FindLatestByMediaID(mediaID); latestErr == nil &&
			latest.Status == model.VideoAnalysisStatusSucceeded &&
			latest.FileSize == fileInfo.Size() && latest.FileMTime == fileInfo.ModTime().Unix() {
			return &VideoAnalysisSubmitOutcome{
				Task: latest, Result: "skipped", Message: "video already has a current successful analysis",
			}, nil
		} else if latestErr != nil && !errors.Is(latestErr, gorm.ErrRecordNotFound) {
			return nil, latestErr
		}
	}

	task := &model.VideoAnalysisTask{
		MediaID: media.ID, LibraryID: media.LibraryID, MediaTitle: media.Title,
		VideoPath: media.FilePath, MappedVideoPath: mappedPath,
		FileSize: fileInfo.Size(), FileMTime: fileInfo.ModTime().Unix(),
		Trigger: trigger, Status: model.VideoAnalysisStatusQueued, Stage: model.VideoAnalysisStageDetect,
		Force: options.Force, IncludeDescriptions: options.IncludeDescriptions,
	}
	if err := s.tasks.CreateIfNoActive(task); err != nil {
		if errors.Is(err, repository.ErrVideoAnalysisTaskActive) {
			active, findErr := s.tasks.FindActiveByMediaID(mediaID)
			if findErr != nil {
				return nil, findErr
			}
			return &VideoAnalysisSubmitOutcome{Task: active, Result: "reused"}, nil
		}
		return nil, err
	}

	if s.logger != nil {
		s.logger.Infow("Video analysis task created",
			"task_id", task.ID,
			"media_id", task.MediaID,
			"media_title", task.MediaTitle,
			"trigger", task.Trigger,
			"force", task.Force,
			"include_descriptions", task.IncludeDescriptions,
			"video_path", task.VideoPath,
			"mapped_video_path", task.MappedVideoPath,
		)
	}

	s.broadcast(task)
	return &VideoAnalysisSubmitOutcome{Task: task, Result: "created"}, nil
}

func (s *VideoAnalysisService) BatchSubmit(mediaIDs []string, options VideoAnalysisSubmitOptions) VideoAnalysisBatchResult {
	result := VideoAnalysisBatchResult{Errors: []VideoAnalysisBatchError{}, SkippedErrors: []VideoAnalysisBatchError{}, TaskIDs: []string{}, Tasks: []*model.VideoAnalysisTask{}}
	seen := make(map[string]struct{}, len(mediaIDs))
	for _, mediaID := range mediaIDs {
		mediaID = strings.TrimSpace(mediaID)
		if mediaID == "" {
			result.Errors = append(result.Errors, VideoAnalysisBatchError{Kind: "invalid_input", Message: "media_id is required"})
			continue
		}
		if _, exists := seen[mediaID]; exists {
			result.Reused++
			continue
		}
		seen[mediaID] = struct{}{}
		outcome, err := s.SubmitMediaWithOutcome(mediaID, options)
		if err != nil {
			if skipKind, skipReason, ok := classifyVideoAnalysisSkip(err); ok {
				result.Skipped++
				result.SkippedErrors = append(result.SkippedErrors, VideoAnalysisBatchError{MediaID: mediaID, Kind: skipKind, Message: skipReason})
				continue
			}
			result.Errors = append(result.Errors, VideoAnalysisBatchError{MediaID: mediaID, Kind: "submit_failed", Message: err.Error()})
			continue
		}
		switch outcome.Result {
		case "created":
			result.Created++
		case "reused":
			result.Reused++
		case "skipped":
			result.Skipped++
		}
		if outcome.Task != nil {
			result.TaskIDs = append(result.TaskIDs, outcome.Task.ID)
			result.Tasks = append(result.Tasks, outcome.Task)
		}
	}
	return result
}

func classifyVideoAnalysisSkip(err error) (kind, message string, ok bool) {
	if err == nil {
		return "", "", false
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "remote STRM media is not supported"):
		return "unsupported_strm", "STRM/远程流媒体暂不支持视频分析", true
	case strings.Contains(msg, "远程视频结构化未开启"):
		return "remote_video_disabled", "远程目录未开启结构化解析，已跳过；本地/内网视频可正常解析", true
	case strings.Contains(msg, "remote media is not supported"):
		return "unsupported_remote", "远程视频暂不支持视频分析", true
	case strings.Contains(msg, "stat video file"):
		return "unreadable_file", "视频文件不存在或不可读取", true
	case strings.Contains(msg, "video path is not a regular file"):
		return "unreadable_file", "视频路径不是普通文件", true
	case strings.Contains(msg, "no video path mapping") || strings.Contains(msg, "path escapes mapping target") || strings.Contains(msg, "source path must be absolute") || strings.Contains(msg, "target path must be absolute"):
		return "path_mapping_failed", "视频路径映射失败，无法提交到视频分析服务", true
	default:
		return "", "", false
	}
}

func (s *VideoAnalysisService) GetTask(taskID string) (*model.VideoAnalysisTask, error) {
	if !s.IsAvailable() {
		return nil, errors.New("video analysis service is not configured")
	}
	task, err := s.tasks.FindByID(taskID)
	if err != nil {
		return nil, err
	}
	batch := []model.VideoAnalysisTask{*task}
	s.tasks.AssignMediaSeq(batch)
	*task = batch[0]
	return task, nil
}

func (s *VideoAnalysisService) GetLatestTaskByMediaID(mediaID string) (*model.VideoAnalysisTask, error) {
	if !s.IsAvailable() {
		return nil, errors.New("video analysis service is not configured")
	}
	return s.tasks.FindLatestByMediaID(mediaID)
}

// ListTasks 查询任务列表。groupByMedia=true 时按媒体去重仅返回每个媒体最新一条，
// mediaID 非空时返回该媒体的任务历史（用于前端展开）。
func (s *VideoAnalysisService) ListTasks(page, pageSize int, status, libraryID, keyword, mediaID string, groupByMedia bool) ([]model.VideoAnalysisTask, int64, error) {
	if !s.IsAvailable() {
		return nil, 0, errors.New("video analysis service is not configured")
	}
	return s.tasks.List(page, pageSize, status, libraryID, strings.TrimSpace(keyword), mediaID, groupByMedia)
}

func (s *VideoAnalysisService) RetryTask(taskID string) (*model.VideoAnalysisTask, error) {
	if !s.IsAvailable() {
		return nil, errors.New("video analysis service is not configured")
	}
	task, err := s.tasks.FindByID(taskID)
	if err != nil {
		return nil, err
	}
	if task.Status != model.VideoAnalysisStatusFailed && task.Status != model.VideoAnalysisStatusPartial {
		return nil, errors.New("only failed or partial video analysis tasks can be retried")
	}
	if active, activeErr := s.tasks.FindActiveByMediaID(task.MediaID); activeErr == nil {
		return active, repository.ErrVideoAnalysisTaskActive
	} else if !errors.Is(activeErr, gorm.ErrRecordNotFound) {
		return nil, activeErr
	}
	if err := s.verifyFileSnapshot(task); err != nil {
		return nil, err
	}

	// Keep completed upstream work and clear only the failed stage and below.
	// 注意:VideoHash 必须保留。已 claim 的 structure 目录由 video_hash 列保护,
	// 若在此处清空,重试期间任意一次 CleanOrphanStructure 会把目录当孤儿删除,
	// 导致重试再次失败后 DB 中的 scenes/结果引用到已丢失的图片。
	// 新 claim 成功后会用新 hash 覆盖(同一视频 hash 不变,目录幂等复用)。
	switch task.Stage {
	case model.VideoAnalysisStageStructure:
		task.StructureJobID = ""
		task.DescribeJobID = ""
		task.ResultJSON = ""
		task.Progress = 50
	case model.VideoAnalysisStageDescribe:
		task.DescribeJobID = ""
		task.Progress = 90
	default:
		task.Stage = model.VideoAnalysisStageDetect
		task.DetectJobID = ""
		task.StructureJobID = ""
		task.DescribeJobID = ""
		task.ResultJSON = ""
		task.FallbackUsed = false
		task.Progress = 0
	}
	task.Status = model.VideoAnalysisStatusQueued
	task.ErrorCode = ""
	task.ErrorMessage = ""
	task.StartedAt = nil
	task.FinishedAt = nil
	if err := s.tasks.RequeueFailed(task); err != nil {
		return nil, err
	}
	s.broadcast(task)
	return task, nil
}

func (s *VideoAnalysisService) Statistics() (map[string]int64, error) {
	if !s.IsAvailable() {
		return nil, errors.New("video analysis service is not configured")
	}
	return s.tasks.CountByStatus()
}

// DetailedStatistics 返回详细的视频分析统计指标
func (s *VideoAnalysisService) DetailedStatistics() (*VideoAnalysisDetailedStats, error) {
	if !s.IsAvailable() {
		return nil, errors.New("video analysis service is not configured")
	}

	statusCounts, err := s.tasks.CountByStatus()
	if err != nil {
		return nil, err
	}

	stats := &VideoAnalysisDetailedStats{
		StatusCounts: statusCounts,
		QueuedCount:  statusCounts[model.VideoAnalysisStatusQueued],
		RunningCount: statusCounts[model.VideoAnalysisStatusRunning],
	}

	// 计算成功率和错误率
	total := int64(0)
	for _, count := range statusCounts {
		total += count
	}
	stats.TotalTasks = total

	succeeded := statusCounts[model.VideoAnalysisStatusSucceeded]
	partial := statusCounts[model.VideoAnalysisStatusPartial]
	failed := statusCounts[model.VideoAnalysisStatusFailed]

	completedTasks := succeeded + partial + failed
	if completedTasks > 0 {
		stats.SuccessRate = float64(succeeded) / float64(completedTasks) * 100
		stats.ErrorRate = float64(failed) / float64(completedTasks) * 100
		stats.PartialRate = float64(partial) / float64(completedTasks) * 100
	}

	// 计算平均耗时（最近完成的任务）
	avgElapsed, err := s.tasks.AvgElapsedByStatus(model.VideoAnalysisStatusSucceeded)
	if err == nil {
		stats.AvgElapsedSeconds = avgElapsed
	}

	return stats, nil
}

// CleanupOldTasks 清理旧的终态任务并回收 structure 孤儿目录（best-effort）
func (s *VideoAnalysisService) CleanupOldTasks(keepRecent int) (int64, error) {
	if !s.IsAvailable() {
		return 0, errors.New("video analysis service is not configured")
	}
	deleted, err := s.tasks.CleanupOldTasks(keepRecent)
	if err != nil {
		return 0, err
	}
	// 显式清理被删任务的孤儿 scenes（不依赖 DB 的 FK 级联）。
	if s.sceneRepo != nil {
		if _, sceneErr := s.sceneRepo.DeleteOrphaned(); sceneErr != nil && s.logger != nil {
			s.logger.Warnw("清理孤儿 scenes 失败", "error", sceneErr)
		}
	}
	if err := s.CleanOrphanStructure(); err != nil && s.logger != nil {
		s.logger.Warnw("清理任务后回收 structure 孤儿失败", "error", err)
	}
	return deleted, nil
}

// DeleteTask 删除任务记录。运行中的任务不可删除。
// 删除本地 Scene 记录与任务，并回收不再被引用的 structure 目录。
func (s *VideoAnalysisService) DeleteTask(taskID string) error {
	if !s.IsAvailable() {
		return errors.New("video analysis service is not configured")
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return errors.New("task id is required")
	}
	task, err := s.tasks.FindByID(taskID)
	if err != nil {
		return err
	}
	// running 拒绝逻辑在 repo.DeleteByID，这里先删场景再删任务
	if s.sceneRepo != nil {
		if delErr := s.sceneRepo.DeleteByTaskID(taskID); delErr != nil && s.logger != nil {
			s.logger.Warnw("删除场景记录失败", "task_id", taskID, "error", delErr)
		}
	}
	if err := s.tasks.DeleteByID(taskID); err != nil {
		return err
	}
	// 删除任务后回收 structure 孤儿目录（best-effort，复用全局清理逻辑）
	if err := s.CleanOrphanStructure(); err != nil && s.logger != nil {
		s.logger.Warnw("删除任务后清理 structure 孤儿失败", "task_id", taskID, "error", err)
	}
	if s.wsHub != nil {
		s.wsHub.BroadcastEvent(videoAnalysisTaskUpdateEvent, map[string]any{
			"id": taskID, "media_id": task.MediaID, "deleted": true,
		})
	}
	return nil
}

// ProcessTask executes one queued task. Only the first caller can atomically
// claim it, so repeated queue scans do not duplicate external submissions.
func (s *VideoAnalysisService) ProcessTask(parent context.Context, taskID string) error {
	claimed, err := s.tasks.ClaimQueued(taskID)
	if err != nil || !claimed {
		return err
	}
	return s.processClaimedTask(parent, taskID)
}

// ResumeRunningTask is only for startup recovery, before regular workers start.
func (s *VideoAnalysisService) ResumeRunningTask(parent context.Context, taskID string) error {
	task, err := s.tasks.FindByID(taskID)
	if err != nil {
		return err
	}
	if task.Status != model.VideoAnalysisStatusRunning {
		return nil
	}
	return s.processClaimedTask(parent, taskID)
}

func (s *VideoAnalysisService) processClaimedTask(parent context.Context, taskID string) error {
	task, err := s.tasks.FindByID(taskID)
	if err != nil {
		return err
	}
	now := time.Now()
	if task.StartedAt == nil {
		task.StartedAt = &now
	}
	// 标记当前待执行阶段为 running：工作流 UI 展示与阶段耗时计时使用。
	if task.Stage != model.VideoAnalysisStageDone && !task.IsStageDone(task.Stage) {
		task.SetStageStatus(task.Stage, model.VideoAnalysisStageStatusRunning)
	}
	if err := s.persist(task); err != nil {
		return err
	}

	if s.logger != nil {
		s.logger.Infow("Video analysis task started",
			"task_id", task.ID,
			"media_id", task.MediaID,
			"trigger", task.Trigger,
			"attempt", task.Attempt,
		)
	}

	ctx, cancel := context.WithTimeout(parent, s.jobTimeout)
	defer cancel()
	if err := s.run(ctx, task); err != nil {
		s.failTask(task, err)
		return err
	}
	return nil
}

func (s *VideoAnalysisService) run(ctx context.Context, task *model.VideoAnalysisTask) error {
	if err := s.verifyFileSnapshot(task); err != nil {
		return err
	}

	detectJob, err := s.ensureDetectJob(ctx, task)
	if err != nil {
		return err
	}
	detectResult, err := s.waitForJob(ctx, detectJob, s.client.GetDetectJob)
	if err != nil {
		if s.logger != nil {
			s.logger.Warnw("Video analysis detect stage failed",
				"task_id", task.ID,
				"media_id", task.MediaID,
				"detect_job_id", detectJob,
				"error", err,
			)
		}
		return fmt.Errorf("detect stage: %w", err)
	}

	if s.logger != nil {
		s.logger.Infow("Video analysis detect stage completed",
			"task_id", task.ID,
			"media_id", task.MediaID,
			"detect_job_id", detectJob,
		)
	}

	task.SetStageStatus(model.VideoAnalysisStageDetect, model.VideoAnalysisStageStatusSucceeded)

	task.Stage = model.VideoAnalysisStageStructure
	task.SetStageStatus(model.VideoAnalysisStageStructure, model.VideoAnalysisStageStatusRunning)
	task.Progress = 50
	if err := s.persist(task); err != nil {
		return err
	}
	structureJob, err := s.ensureStructureJob(ctx, task, detectResult)
	if err != nil {
		return err
	}
	structureProgress := s.jobProgressUpdater(task, 50, 90)
	structureResult, err := s.waitForJobWithProgress(ctx, structureJob, s.client.GetStructureJob, structureProgress)
	if err != nil && !task.FallbackUsed && shouldFallbackToScenes(err) {
		if s.logger != nil {
			s.logger.Infow("Video analysis structure stage using scenes fallback",
				"task_id", task.ID,
				"media_id", task.MediaID,
				"structure_job_id", structureJob,
				"error", err,
			)
		}
		task.FallbackUsed = true
		task.StructureJobID = ""
		if persistErr := s.persist(task); persistErr != nil {
			return persistErr
		}
		structureJob, err = s.submitStructureWithScenes(ctx, task, detectResult)
		if err == nil {
			structureResult, err = s.waitForJobWithProgress(ctx, structureJob, s.client.GetStructureJob, structureProgress)
		}
	}
	if err != nil {
		if s.logger != nil {
			s.logger.Warnw("Video analysis structure stage failed",
				"task_id", task.ID,
				"media_id", task.MediaID,
				"structure_job_id", structureJob,
				"fallback_used", task.FallbackUsed,
				"error", err,
			)
		}
		return fmt.Errorf("structure stage: %w", err)
	}

	if s.logger != nil {
		s.logger.Infow("Video analysis structure stage completed",
			"task_id", task.ID,
			"media_id", task.MediaID,
			"structure_job_id", structureJob,
			"fallback_used", task.FallbackUsed,
		)
	}

	task.SetStageStatus(model.VideoAnalysisStageStructure, model.VideoAnalysisStageStatusSucceeded)
	task.ResultJSON, err = buildStructureResultJSON(structureResult)
	if err != nil {
		return fmt.Errorf("encode structure result: %w", err)
	}
	var resultHeader struct {
		VideoHash string `json:"video_hash"`
	}
	if err := json.Unmarshal(structureResult.Result, &resultHeader); err != nil || resultHeader.VideoHash == "" {
		return errors.New("structure result is missing video_hash")
	}
	task.VideoHash = resultHeader.VideoHash

	// Phase 2: 将 Structure 结果中的场景写入 Scene 表（含图片 embedding）
	if err := s.saveScenesFromStructure(task, structureResult); err != nil {
		if s.logger != nil {
			s.logger.Warnw("Video analysis save scenes failed (non-fatal)",
				"task_id", task.ID,
				"media_id", task.MediaID,
				"error", err,
			)
		}
	}

	if task.IncludeDescriptions {
		task.Stage = model.VideoAnalysisStageDescribe
		task.SetStageStatus(model.VideoAnalysisStageDescribe, model.VideoAnalysisStageStatusRunning)
		task.Progress = 90
		if err := s.persist(task); err != nil {
			return err
		}
		describeJob, err := s.ensureDescribeJob(ctx, task)
		if err != nil {
			return s.completeDescribePartial(task, fmt.Errorf("describe stage: %w", err), "")
		}
		describeResult, err := s.waitForJobWithProgress(ctx, describeJob, s.client.GetDescribeJob, s.jobProgressUpdater(task, 90, 100))
		if err != nil {
			if s.logger != nil {
				s.logger.Warnw("Video analysis describe stage failed",
					"task_id", task.ID,
					"media_id", task.MediaID,
					"describe_job_id", describeJob,
					"error", err,
				)
			}
			return s.completeDescribePartial(task, fmt.Errorf("describe stage: %w", err), "")
		}
		mergedResult, err := mergeDescribeResult(task.ResultJSON, describeResult.Result)
		if err != nil {
			return s.completeDescribePartial(task, err, "DESCRIBE_MERGE_ERROR")
		}
		task.ResultJSON = mergedResult

		// Phase 3: 更新 Scene 描述和描述 embedding
		if err := s.updateSceneDescriptionsFromDescribe(task, describeResult); err != nil {
			if s.logger != nil {
				s.logger.Warnw("Video analysis update scene descriptions failed (non-fatal)",
					"task_id", task.ID,
					"media_id", task.MediaID,
					"error", err,
				)
			}
		}

		// Phase 3b: 计算描述文本的 CLIP embedding（本地调用 emb_server）
		if err := s.computeDescriptionEmbeddings(task); err != nil {
			if s.logger != nil {
				s.logger.Warnw("Video analysis compute description embeddings failed (non-fatal)",
					"task_id", task.ID,
					"media_id", task.MediaID,
					"error", err,
				)
			}
		}

		// describe 部分失败（result.status = "partial"）：成功场景的描述已保留，
		// 标记任务 partial，可重新提交 describe job 增量补齐失败场景。
		if describeResultStatus(describeResult.Result) == "partial" {
			return s.completeDescribePartial(task, describePartialError(describeResult.Result), "DESCRIBE_PARTIAL")
		}

		if s.logger != nil {
			s.logger.Infow("Video analysis describe stage completed",
				"task_id", task.ID,
				"media_id", task.MediaID,
				"describe_job_id", describeJob,
			)
		}
		task.SetStageStatus(model.VideoAnalysisStageDescribe, model.VideoAnalysisStageStatusSucceeded)
	} else {
		task.SetStageStatus(model.VideoAnalysisStageDescribe, model.VideoAnalysisStageStatusSkipped)
	}

	// Phase 4: 搬移 staging 产物到 asset_dir（describe 之后 claim；describe 全部成功时
	// 产物才含 descriptions.json）。失败 = 产物未落地 = 任务实际未完成，标 failed，RetryTask 从 structure 阶段重跑。
	if err := s.claimArtifactsForTask(task, true); err != nil {
		task.Stage = model.VideoAnalysisStageStructure
		s.failTask(task, err)
		return err
	}

	// Phase 5: 搬移后计算图片 CLIP embedding（读取 asset_dir/<hash>/grids/，non-fatal）。
	if err := s.computeSceneEmbeddings(task); err != nil && s.logger != nil {
		s.logger.Warnw("Video analysis compute scene embeddings failed (non-fatal)",
			"task_id", task.ID,
			"media_id", task.MediaID,
			"error", err,
		)
	}

	task.Status = model.VideoAnalysisStatusSucceeded
	task.Stage = model.VideoAnalysisStageDone
	task.Progress = 100
	finished := time.Now()
	task.FinishedAt = &finished
	task.ErrorCode = ""
	task.ErrorMessage = ""

	if s.logger != nil {
		s.logger.Infow("Video analysis task completed successfully",
			"task_id", task.ID,
			"media_id", task.MediaID,
			"trigger", task.Trigger,
			"attempt", task.Attempt,
			"fallback_used", task.FallbackUsed,
			"include_descriptions", task.IncludeDescriptions,
			"elapsed", finished.Sub(*task.StartedAt).String(),
		)
	}

	return s.persist(task)
}

func (s *VideoAnalysisService) ensureDetectJob(ctx context.Context, task *model.VideoAnalysisTask) (string, error) {
	if task.DetectJobID != "" {
		if s.logger != nil {
			s.logger.Debugw("Video analysis detect job already submitted",
				"task_id", task.ID,
				"detect_job_id", task.DetectJobID,
			)
		}
		return task.DetectJobID, nil
	}
	job, err := s.client.SubmitDetectJob(ctx, DetectJobRequest{VideoPath: task.MappedVideoPath})
	if err != nil {
		if s.logger != nil {
			s.logger.Warnw("Video analysis detect job submission failed",
				"task_id", task.ID,
				"video_path", task.MappedVideoPath,
				"error", err,
			)
		}
		return "", fmt.Errorf("submit detect job: %w", err)
	}
	task.DetectJobID = job.JobID
	task.Progress = 5
	if err := s.persist(task); err != nil {
		return "", err
	}
	if s.logger != nil {
		s.logger.Infow("Video analysis detect job submitted",
			"task_id", task.ID,
			"detect_job_id", job.JobID,
			"video_path", task.MappedVideoPath,
		)
	}
	return job.JobID, nil
}

func (s *VideoAnalysisService) ensureStructureJob(ctx context.Context, task *model.VideoAnalysisTask, detectResult *ExternalJob) (string, error) {
	if task.StructureJobID != "" {
		if s.logger != nil {
			s.logger.Debugw("Video analysis structure job already submitted",
				"task_id", task.ID,
				"structure_job_id", task.StructureJobID,
			)
		}
		return task.StructureJobID, nil
	}
	job, err := s.client.SubmitStructureJob(ctx, StructureJobRequest{
		VideoPath: task.MappedVideoPath, DetectJobID: task.DetectJobID,
		FrameGrid: true, GridRows: 3, GridCols: 3,
	})
	if err != nil && !task.FallbackUsed && shouldFallbackToScenes(err) {
		if s.logger != nil {
			s.logger.Infow("Video analysis structure job falling back to scenes",
				"task_id", task.ID,
				"detect_job_id", task.DetectJobID,
				"error", err,
			)
		}
		task.FallbackUsed = true
		if persistErr := s.persist(task); persistErr != nil {
			return "", persistErr
		}
		return s.submitStructureWithScenes(ctx, task, detectResult)
	}
	if err != nil {
		if s.logger != nil {
			s.logger.Warnw("Video analysis structure job submission failed",
				"task_id", task.ID,
				"detect_job_id", task.DetectJobID,
				"error", err,
			)
		}
		return "", fmt.Errorf("submit structure job: %w", err)
	}
	task.StructureJobID = job.JobID
	if err := s.persist(task); err != nil {
		return "", err
	}
	if s.logger != nil {
		s.logger.Infow("Video analysis structure job submitted",
			"task_id", task.ID,
			"structure_job_id", job.JobID,
			"detect_job_id", task.DetectJobID,
		)
	}
	return job.JobID, nil
}

func (s *VideoAnalysisService) submitStructureWithScenes(ctx context.Context, task *model.VideoAnalysisTask, detectResult *ExternalJob) (string, error) {
	var result struct {
		Scenes []SceneBoundary `json:"scenes"`
	}
	if err := json.Unmarshal(detectResult.Result, &result); err != nil || len(result.Scenes) == 0 {
		return "", errors.New("detect result contains no scenes for structure fallback")
	}
	job, err := s.client.SubmitStructureJob(ctx, StructureJobRequest{
		VideoPath: task.MappedVideoPath, Scenes: result.Scenes,
		FrameGrid: true, GridRows: 3, GridCols: 3,
	})
	if err != nil {
		return "", fmt.Errorf("submit structure fallback job: %w", err)
	}
	task.StructureJobID = job.JobID
	if err := s.persist(task); err != nil {
		return "", err
	}
	return job.JobID, nil
}

// resolveSceneDescribeProvider 解析场景描述视觉模型的连接信息。
// 优先从 scene_describe_ai 指定的 provider 获取，回退到当前激活的 provider。
func resolveSceneDescribeProvider(cfg *config.Config) (apiBase, apiKey string) {
	if p := cfg.AI.FindProvider(cfg.AI.SceneDescribeAI.ProviderID); p != nil && p.APIBase != "" {
		return p.APIBase, p.APIKey
	}
	if ap := cfg.AI.ActiveProfile(); ap != nil && ap.APIBase != "" {
		return ap.APIBase, ap.APIKey
	}
	return "", ""
}

func (s *VideoAnalysisService) ensureDescribeJob(ctx context.Context, task *model.VideoAnalysisTask) (string, error) {
	if task.DescribeJobID != "" {
		if s.logger != nil {
			s.logger.Debugw("Video analysis describe job already submitted",
				"task_id", task.ID,
				"describe_job_id", task.DescribeJobID,
			)
		}
		return task.DescribeJobID, nil
	}
	if strings.TrimSpace(task.StructureJobID) == "" {
		return "", errors.New("structure_job_id is required before describe")
	}
	req := DescribeJobRequest{
		StructureJobID: task.StructureJobID,
		Force:          task.Force,
	}
	// 注入视觉 LLM 配置（场景描述需要视觉模型，从指定供应商获取连接信息）
	if s.appCfg != nil && s.appCfg.AI.SceneDescribeAI.Model != "" {
		apiBase, apiKey := resolveSceneDescribeProvider(s.appCfg)
		if apiBase != "" {
			req.ModelCfg = &DescribeModelCfg{
				BaseURL:        apiBase,
				APIKey:         apiKey,
				ModelName:      s.appCfg.AI.SceneDescribeAI.Model,
				MaxConcurrency: 3,
			}
		}
	}
	job, err := s.client.SubmitDescribeJob(ctx, req)
	if err != nil {
		if s.logger != nil {
			s.logger.Warnw("Video analysis describe job submission failed",
				"task_id", task.ID,
				"structure_job_id", task.StructureJobID,
				"error", err,
			)
		}
		return "", fmt.Errorf("submit describe job: %w", err)
	}
	task.DescribeJobID = job.JobID
	if err := s.persist(task); err != nil {
		return "", err
	}
	if s.logger != nil {
		s.logger.Infow("Video analysis describe job submitted",
			"task_id", task.ID,
			"describe_job_id", job.JobID,
			"structure_job_id", task.StructureJobID,
		)
	}
	return job.JobID, nil
}

// completeDescribePartial describe 阶段未全部成功时的收尾：
// 先尽力 claim 九宫格产物（staging 有 TTL，避免重试前丢失；幂等，失败不致命），
// 再把任务标记为 partial（结构已成功，仅描述未全部完成）。
// 同时清空 describe_job_id，重试时重新提交 describe job（服务端按 staging 增量/全量生成）。
func (s *VideoAnalysisService) completeDescribePartial(task *model.VideoAnalysisTask, err error, errorCode string) error {
	if claimErr := s.claimArtifactsForTask(task, false); claimErr != nil && s.logger != nil {
		s.logger.Warnw("Video analysis claim artifacts after describe failure failed (non-fatal)",
			"task_id", task.ID,
			"media_id", task.MediaID,
			"error", claimErr,
		)
	}
	task.DescribeJobID = ""
	task.SetStageStatus(model.VideoAnalysisStageDescribe, model.VideoAnalysisStageStatusFailed)
	task.Status = model.VideoAnalysisStatusPartial
	task.Progress = 90
	finished := time.Now()
	task.FinishedAt = &finished
	if errorCode != "" {
		task.ErrorCode = errorCode
	} else {
		task.ErrorCode = analysisErrorCode(err)
	}
	task.ErrorMessage = err.Error()
	if persistErr := s.persist(task); persistErr != nil {
		return persistErr
	}
	// 图片 embedding（non-fatal）：九宫格已 claim，尽力计算，避免图片检索缺口。
	if embErr := s.computeSceneEmbeddings(task); embErr != nil && s.logger != nil {
		s.logger.Warnw("Video analysis compute scene embeddings failed (non-fatal)",
			"task_id", task.ID,
			"media_id", task.MediaID,
			"error", embErr,
		)
	}
	return nil
}

// describePartialError 从 describe 结果 warnings 构造部分失败错误信息（取首个详情）。
func describePartialError(describeJSON []byte) error {
	var parsed videoAnalysisDescribeResult
	if err := json.Unmarshal(describeJSON, &parsed); err != nil || len(parsed.Warnings) == 0 {
		return errors.New("部分场景描述失败")
	}
	return fmt.Errorf("%d 个场景描述失败: %s", len(parsed.Warnings), parsed.Warnings[0].Message)
}

// describeResultStatus 解析 describe result 的整体状态（"completed"/"partial"）。
// 旧版服务不返回该字段，空值按 completed 处理。
func describeResultStatus(describeJSON []byte) string {
	var parsed videoAnalysisDescribeResult
	if err := json.Unmarshal(describeJSON, &parsed); err != nil {
		return ""
	}
	return parsed.Status
}

func (s *VideoAnalysisService) waitForJob(ctx context.Context, jobID string, get func(context.Context, string) (*ExternalJob, error)) (*ExternalJob, error) {
	return s.waitForJobWithProgress(ctx, jobID, get, nil)
}

// waitForJobWithProgress 轮询外部 job；onPoll 在每次未结束时调用，
// 用于把外部 progress 字段（"12/73"）映射到任务进度（尽力而为）。
func (s *VideoAnalysisService) waitForJobWithProgress(ctx context.Context, jobID string, get func(context.Context, string) (*ExternalJob, error), onPoll func(*ExternalJob)) (*ExternalJob, error) {
	ticker := time.NewTicker(s.pollInterval)
	defer ticker.Stop()
	for {
		job, err := get(ctx, jobID)
		if err != nil {
			return nil, err
		}
		switch job.Status {
		case "succeeded":
			if len(job.Result) == 0 || string(job.Result) == "null" {
				return nil, errors.New("external job succeeded without a result")
			}
			return job, nil
		case "failed":
			if job.Error == nil {
				return nil, errors.New("external job failed without error details")
			}
			return nil, &externalJobFailedError{Code: job.Error.Code, Message: job.Error.Message}
		}
		if onPoll != nil {
			onPoll(job)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
}

// jobProgressUpdater 把外部 job 的 progress（"12/73"）映射到任务进度区间 [from, to)，
// 仅在数值前进时落库（尽力而为，失败不影响任务本身）。
func (s *VideoAnalysisService) jobProgressUpdater(task *model.VideoAnalysisTask, from, to float64) func(*ExternalJob) {
	return func(job *ExternalJob) {
		frac, ok := parseJobProgressFraction(job.Progress)
		if !ok {
			return
		}
		p := from + frac*(to-from)
		if p > to-1 {
			p = to - 1
		}
		if p <= task.Progress {
			return
		}
		task.Progress = p
		if err := s.tasks.UpdateProgress(task.ID, p); err != nil {
			if s.logger != nil {
				s.logger.Warnw("Video analysis progress update failed (non-fatal)",
					"task_id", task.ID, "error", err)
			}
			return
		}
		s.broadcast(task)
	}
}

// parseJobProgressFraction 解析 "12/73" 格式为 12/73。
func parseJobProgressFraction(raw string) (float64, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, false
	}
	parts := strings.SplitN(raw, "/", 2)
	if len(parts) != 2 {
		return 0, false
	}
	done, err := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	if err != nil || done < 0 {
		return 0, false
	}
	total, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if err != nil || total <= 0 {
		return 0, false
	}
	if done > total {
		done = total
	}
	return done / total, true
}

func (s *VideoAnalysisService) verifyFileSnapshot(task *model.VideoAnalysisTask) error {
	info, err := s.statVideoPath(task.VideoPath)
	if err != nil {
		return fmt.Errorf("stat video file: %w", err)
	}
	if info.Size() != task.FileSize || info.ModTime().Unix() != task.FileMTime {
		return errors.New("video file changed after the analysis task was created")
	}
	return nil
}

// statVideoPath 本地文件用 os.Stat；webdav/alist/s3 远程文件用 VFS.Stat。
func (s *VideoAnalysisService) statVideoPath(path string) (os.FileInfo, error) {
	if !IsRemotePath(path) {
		return os.Stat(path)
	}
	if s.vfsMgr == nil {
		return nil, errors.New("remote media is not supported: VFS manager is not configured")
	}
	return s.vfsMgr.Stat(path)
}

func (s *VideoAnalysisService) persist(task *model.VideoAnalysisTask) error {
	if err := s.tasks.Update(task); err != nil {
		return err
	}
	s.broadcast(task)
	return nil
}

func (s *VideoAnalysisService) failTask(task *model.VideoAnalysisTask, err error) {
	if task.Status != model.VideoAnalysisStatusPartial {
		task.Status = model.VideoAnalysisStatusFailed
	}
	// Mark the current stage as failed so the workflow UI reflects it
	task.SetStageStatus(task.Stage, model.VideoAnalysisStageStatusFailed)
	task.ErrorCode = analysisErrorCode(err)
	task.ErrorMessage = err.Error()
	finished := time.Now()
	task.FinishedAt = &finished

	if s.logger != nil {
		s.logger.Warnw("Video analysis task failed",
			"task_id", task.ID,
			"media_id", task.MediaID,
			"trigger", task.Trigger,
			"attempt", task.Attempt,
			"stage", task.Stage,
			"error_code", task.ErrorCode,
			"error", err,
			"elapsed", finished.Sub(*task.StartedAt).String(),
		)
	}

	if persistErr := s.persist(task); persistErr != nil && s.logger != nil {
		s.logger.Errorf("persist failed video analysis task %s: %v", task.ID, persistErr)
	}
}

// claimArtifactsForTask 下载 structure job 的 artifact 产物到 asset_dir/<hash>。
// release 表示是否释放服务端 staging：describe 成功后为 true；describe 失败时为
// false，staging 保留给服务端增量重试。
// 必须在 describe 完成后调用。
func (s *VideoAnalysisService) claimArtifactsForTask(task *model.VideoAnalysisTask, release bool) error {
	if strings.TrimSpace(task.ResultJSON) == "" {
		return nil
	}
	var result struct {
		VideoHash string                 `json:"video_hash"`
		Artifact  *VideoAnalysisArtifact `json:"artifact"`
	}
	if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil {
		return fmt.Errorf("decode structure result for claim: %w", err)
	}
	if strings.TrimSpace(result.VideoHash) == "" {
		return nil
	}
	// 无可下载产物时也要落库 video_hash：结果 JSON 引用的九宫格目录可能由
	// 其他任务 claim，不落库则该目录在本任务存活期间不受孤儿清理保护。
	if result.Artifact == nil || len(result.Artifact.Files) == 0 {
		if err := s.persistVideoHash(task, result.VideoHash); err != nil {
			return fmt.Errorf("persist video_hash for artifact-less result: %w", err)
		}
		return nil
	}
	return s.claimArtifactForTask(task, result.VideoHash, result.Artifact, release)
}

// CleanOrphanStructure 清理 asset_dir 下未被任何视频分析任务引用的孤儿目录。
func (s *VideoAnalysisService) CleanOrphanStructure() error {
	s.cleanupMu.Lock()
	defer s.cleanupMu.Unlock()

	assetDir := filepath.Clean(strings.TrimSpace(s.assetDir))
	if assetDir == "." || assetDir == ".." || assetDir == "/" {
		return fmt.Errorf("invalid asset dir for orphan cleanup: %q", s.assetDir)
	}
	hashes, err := s.tasks.ListVideoHashes()
	if err != nil {
		return err
	}
	valid := make(map[string]struct{}, len(hashes))
	for _, h := range hashes {
		h = strings.TrimSpace(h)
		if h != "" {
			valid[h] = struct{}{}
		}
	}

	entries, err := os.ReadDir(assetDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			// 跳过文件及隐藏目录（如 .tmp 下载临时区）。
			continue
		}
		hash := entry.Name()
		if _, ok := valid[hash]; ok {
			continue
		}
		if err := os.RemoveAll(filepath.Join(assetDir, hash)); err != nil {
			if s.logger != nil {
				s.logger.Warnw("Video analysis orphan structure remove failed",
					"hash", hash, "error", err)
			}
			continue
		}
		if s.logger != nil {
			s.logger.Infow("Video analysis orphan structure removed",
				"hash", hash)
		}
	}
	return nil
}

func (s *VideoAnalysisService) broadcast(task *model.VideoAnalysisTask) {
	if s.wsHub != nil {
		s.wsHub.BroadcastEvent(videoAnalysisTaskUpdateEvent, task)
	}
}

type externalJobFailedError struct {
	Code    string
	Message string
}

func (e *externalJobFailedError) Error() string {
	return fmt.Sprintf("external job failed: code=%s message=%s", e.Code, e.Message)
}

func shouldFallbackToScenes(err error) bool {
	var apiErr *VideoAnalysisAPIError
	if errors.As(err, &apiErr) {
		return apiErr.Code == 70201
	}
	var jobErr *externalJobFailedError
	return errors.As(err, &jobErr) && (jobErr.Code == "70201" || strings.Contains(strings.ToLower(jobErr.Message), "detect"))
}

func analysisErrorCode(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "JOB_TIMEOUT"
	}
	if errors.Is(err, errClaimStagingFailed) {
		return "CLAIM_STAGING_FAILED"
	}
	var apiErr *VideoAnalysisAPIError
	if errors.As(err, &apiErr) {
		return fmt.Sprintf("EXTERNAL_%d", apiErr.Code)
	}
	var jobErr *externalJobFailedError
	if errors.As(err, &jobErr) && jobErr.Code != "" {
		return jobErr.Code
	}
	return "VIDEO_ANALYSIS_ERROR"
}

// saveScenesFromStructure 将 Structure 结果写入 Scene 表（Phase 2）
func (s *VideoAnalysisService) saveScenesFromStructure(task *model.VideoAnalysisTask, structureResult *ExternalJob) error {
	if s.sceneRepo == nil {
		return nil
	}
	var result videoAnalysisStructureResult
	if err := json.Unmarshal(structureResult.Result, &result); err != nil {
		return fmt.Errorf("decode structure result for scene save: %w", err)
	}
	if len(result.Scenes) == 0 {
		return nil
	}

	scenes := make([]model.Scene, 0, len(result.Scenes))
	for _, scene := range result.Scenes {
		if scene.Status == "error" {
			continue
		}
		s := model.Scene{
			SceneIndex: scene.SceneIndex,
			StartTime:  scene.StartTime,
			EndTime:    scene.EndTime,
			ImagePath:  scene.GridImage,
			Status:     "ok",
		}
		if len(scene.Embedding) > 0 {
			s.Embedding = float64sToVector(scene.Embedding)
		}
		scenes = append(scenes, s)
	}

	if len(scenes) == 0 {
		return nil
	}

	if err := s.sceneRepo.BatchCreate(task.ID, scenes); err != nil {
		return fmt.Errorf("batch create scenes: %w", err)
	}
	if s.logger != nil {
		s.logger.Infow("Saved scenes from structure result",
			"task_id", task.ID,
			"media_id", task.MediaID,
			"count", len(scenes),
		)
	}
	return nil
}

// computeSceneEmbeddings 遍历场景九宫格图片，调用 emb_server 计算 CLIP embedding 并回写。
// 图片路径按搬移后的 <asset_dir>/<hash>/grids/ 解析，须在 claim 之后调用。
func (s *VideoAnalysisService) computeSceneEmbeddings(task *model.VideoAnalysisTask) error {
	if s.embeddingClient == nil || s.sceneRepo == nil {
		return nil
	}
	result, err := decodeVideoAnalysisStructureResult(task)
	if err != nil {
		return err
	}
	log := s.logger

	updates := make([]repository.SceneEmbeddingUpdate, 0, len(result.Scenes))
	for _, scene := range result.Scenes {
		if scene.Status == "error" || strings.TrimSpace(scene.GridImage) == "" {
			continue
		}

		gridPath, err := resolveClaimedGridPath(s.assetDir, result.VideoHash, scene.GridImage)
		if err != nil {
			if log != nil {
				log.Debugw("Skip embedding for scene: resolve path failed",
					"task_id", task.ID,
					"scene_index", scene.SceneIndex,
					"error", err,
				)
			}
			continue
		}

		emb, err := s.embeddingClient.ComputeImageEmbedding(context.Background(), gridPath)
		if err != nil {
			if log != nil {
				log.Warnw("Compute scene embedding failed",
					"task_id", task.ID,
					"scene_index", scene.SceneIndex,
					"error", err,
				)
			}
			continue
		}

		if len(emb) > 0 {
			v := float64sToVector(emb)
			updates = append(updates, repository.SceneEmbeddingUpdate{
				SceneIndex: scene.SceneIndex,
				Embedding:  v,
			})
		}
	}

	if len(updates) == 0 {
		if log != nil {
			log.Warnw("computeSceneEmbeddings: no valid scenes for embedding",
				"task_id", task.ID,
				"total_scenes", len(result.Scenes),
			)
		}
		return nil
	}

	if err := s.sceneRepo.UpdateEmbeddings(task.ID, updates); err != nil {
		return fmt.Errorf("update scene embeddings: %w", err)
	}

	if log != nil {
		log.Infow("Computed and saved scene embeddings",
			"task_id", task.ID,
			"media_id", task.MediaID,
			"count", len(updates),
		)
	}
	return nil
}

// computeDescriptionEmbeddings 计算场景描述的文本 CLIP embedding 并回写
// 在描述写入 DB 后调用，读取描述文本并调用 emb_server 计算文本 embedding
func (s *VideoAnalysisService) computeDescriptionEmbeddings(task *model.VideoAnalysisTask) error {
	if s.embeddingClient == nil || !s.embeddingClient.IsAvailable() || s.sceneRepo == nil {
		return nil
	}

	scenes, err := s.sceneRepo.GetByTaskID(task.ID)
	if err != nil {
		return fmt.Errorf("get scenes for description embedding: %w", err)
	}

	updates := make([]repository.SceneDescriptionUpdate, 0, len(scenes))
	for _, scene := range scenes {
		if strings.TrimSpace(scene.Description) == "" {
			continue
		}
		// 跳过已有 embedding 的场景
		if scene.DescriptionEmbedding != nil {
			continue
		}

		emb, err := s.embeddingClient.ComputeTextEmbedding(context.Background(), scene.Description)
		if err != nil {
			if s.logger != nil {
				s.logger.Warnw("Compute description embedding failed",
					"task_id", task.ID,
					"scene_index", scene.SceneIndex,
					"error", err,
				)
			}
			continue
		}

		if len(emb) > 0 {
			descriptionUpdate := repository.SceneDescriptionUpdate{
				SceneIndex:           scene.SceneIndex,
				Description:          scene.Description,
				DescriptionEmbedding: float64sToVector(emb),
			}
			updates = append(updates, descriptionUpdate)
		}
	}

	if len(updates) == 0 {
		if s.logger != nil {
			s.logger.Infow("computeDescriptionEmbeddings: no scenes need description embedding",
				"task_id", task.ID,
			)
		}
		return nil
	}

	if err := s.sceneRepo.UpdateDescriptions(task.ID, updates); err != nil {
		return fmt.Errorf("update description embeddings: %w", err)
	}

	if s.logger != nil {
		s.logger.Infow("Computed and saved description embeddings",
			"task_id", task.ID,
			"count", len(updates),
		)
	}
	return nil
}

// float64sToVector 将 []float64 转为 *pgvector.Vector（nil 时返回 nil）
func float64sToVector(emb []float64) *pgvector.Vector {
	if len(emb) == 0 {
		return nil
	}
	vec := make([]float32, len(emb))
	for i, v := range emb {
		vec[i] = float32(v)
	}
	v := pgvector.NewVector(vec)
	return &v
}
func (s *VideoAnalysisService) updateSceneDescriptionsFromDescribe(task *model.VideoAnalysisTask, describeJob *ExternalJob) error {
	if s.sceneRepo == nil {
		return nil
	}
	var result videoAnalysisDescribeResult
	if err := json.Unmarshal(describeJob.Result, &result); err != nil {
		return fmt.Errorf("decode describe result for scene update: %w", err)
	}
	if len(result.Descriptions) == 0 {
		return nil
	}

	updates := make([]repository.SceneDescriptionUpdate, 0, len(result.Descriptions))
	for _, d := range result.Descriptions {
		if d.Status != "ok" || d.Description == "" {
			continue
		}
		update := repository.SceneDescriptionUpdate{
			SceneIndex:  d.SceneIndex,
			Description: d.Description,
		}
		// 转换 []float64 → []float32 → pgvector.Vector
		if len(d.DescriptionEmbedding) > 0 {
			vec := make([]float32, len(d.DescriptionEmbedding))
			for i, v := range d.DescriptionEmbedding {
				vec[i] = float32(v)
			}
			v := pgvector.NewVector(vec)
			update.DescriptionEmbedding = &v
		}
		updates = append(updates, update)
	}

	if len(updates) == 0 {
		if s.logger != nil {
			s.logger.Warnw("updateSceneDescriptionsFromDescribe: no descriptions",
				"task_id", task.ID,
				"total_descriptions", len(result.Descriptions),
			)
		}
		return nil
	}

	if err := s.sceneRepo.UpdateDescriptions(task.ID, updates); err != nil {
		return fmt.Errorf("update scene descriptions: %w", err)
	}
	if s.logger != nil {
		s.logger.Infow("Updated scene descriptions from describe result",
			"task_id", task.ID,
			"media_id", task.MediaID,
			"count", len(updates),
		)
	}
	return nil
}

// GetWorkflow 返回任务的工作流状态详情
func (s *VideoAnalysisService) GetWorkflow(taskID string) (*WorkflowStatus, error) {
	if !s.IsAvailable() {
		return nil, errors.New("video analysis service is not configured")
	}
	task, err := s.tasks.FindByID(taskID)
	if err != nil {
		return nil, err
	}
	return &WorkflowStatus{
		TaskID:          task.ID,
		MediaID:         task.MediaID,
		MediaTitle:      task.MediaTitle,
		Status:          task.Status,
		Stage:           task.Stage,
		Progress:        task.Progress,
		DetectStatus:    task.DetectStatus,
		StructureStatus: task.StructureStatus,
		DescribeStatus:  task.DescribeStatus,
		StageTimings:    task.StageTimings,
		ErrorCode:       task.ErrorCode,
		ErrorMessage:    task.ErrorMessage,
		StartedAt:       task.StartedAt,
		FinishedAt:      task.FinishedAt,
		CreatedAt:       task.CreatedAt,
	}, nil
}

// RunStage 执行单个阶段（自动检查前置依赖）
func (s *VideoAnalysisService) RunStage(ctx context.Context, taskID, stage string) error {
	if !s.IsAvailable() {
		return errors.New("video analysis service is not configured")
	}
	task, err := s.tasks.FindByID(taskID)
	if err != nil {
		return err
	}
	if ok, reason := task.CanRunStage(stage); !ok {
		return errors.New(reason)
	}

	ctx, cancel := context.WithTimeout(ctx, s.jobTimeout)
	defer cancel()

	task.SetStageStatus(stage, model.VideoAnalysisStageStatusRunning)
	task.Status = model.VideoAnalysisStatusRunning
	task.Stage = stage
	if task.StartedAt == nil {
		now := time.Now()
		task.StartedAt = &now
	}
	if err := s.persist(task); err != nil {
		return err
	}

	var stageErr error
	switch stage {
	case model.VideoAnalysisStageDetect:
		stageErr = s.runDetectStage(ctx, task)
	case model.VideoAnalysisStageStructure:
		stageErr = s.runStructureStage(ctx, task)
	case model.VideoAnalysisStageDescribe:
		stageErr = s.runDescribeStage(ctx, task)
	}

	if stageErr != nil {
		if stage == model.VideoAnalysisStageDescribe && task.Status == model.VideoAnalysisStatusPartial {
			// describe 未全部成功已在 runDescribeStage 内按 partial 收尾（含 claim），保留状态
			return nil
		}
		task.SetStageStatus(stage, model.VideoAnalysisStageStatusFailed)
		task.Status = model.VideoAnalysisStatusFailed
		task.ErrorCode = analysisErrorCode(stageErr)
		task.ErrorMessage = stageErr.Error()
		finished := time.Now()
		task.FinishedAt = &finished
		s.persist(task)
		return stageErr
	}

	task.SetStageStatus(stage, model.VideoAnalysisStageStatusSucceeded)
	if stage == model.VideoAnalysisStageDescribe || (!task.IncludeDescriptions && stage == model.VideoAnalysisStageStructure) {
		// 到达 done：搬移 staging 产物（describe 全部成功时产物才含 descriptions.json，并释放服务端 staging）。
		// 失败 = 产物未落地 = 标 failed，RetryTask 从 structure 阶段重跑。
		if err := s.claimArtifactsForTask(task, true); err != nil {
			task.SetStageStatus(model.VideoAnalysisStageStructure, model.VideoAnalysisStageStatusFailed)
			task.Status = model.VideoAnalysisStatusFailed
			task.ErrorCode = analysisErrorCode(err)
			task.ErrorMessage = err.Error()
			finished := time.Now()
			task.FinishedAt = &finished
			s.persist(task)
			return err
		}
		if err := s.computeSceneEmbeddings(task); err != nil && s.logger != nil {
			s.logger.Warnw("Video analysis compute scene embeddings failed (non-fatal)",
				"task_id", task.ID,
				"media_id", task.MediaID,
				"error", err,
			)
		}
		task.Status = model.VideoAnalysisStatusSucceeded
		task.Stage = model.VideoAnalysisStageDone
		task.Progress = 100
		finished := time.Now()
		task.FinishedAt = &finished
	}
	s.persist(task)
	return nil
}

// RunAll 从第一个未完成的阶段开始，一路跑到尾
func (s *VideoAnalysisService) RunAll(ctx context.Context, taskID string) error {
	if !s.IsAvailable() {
		return errors.New("video analysis service is not configured")
	}
	task, err := s.tasks.FindByID(taskID)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, s.jobTimeout)
	defer cancel()
	return s.run(ctx, task)
}

// RunMissing 自动检测缺失阶段，按顺序补齐
func (s *VideoAnalysisService) RunMissing(ctx context.Context, taskID string) error {
	if !s.IsAvailable() {
		return errors.New("video analysis service is not configured")
	}
	task, err := s.tasks.FindByID(taskID)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, s.jobTimeout)
	defer cancel()
	for {
		stage := task.NextPendingStage()
		if stage == model.VideoAnalysisStageDone {
			return nil
		}
		if err := s.runStageByTask(ctx, task, stage); err != nil {
			return err
		}
	}
}

// runStageByTask 内部执行单个阶段（直接操作 task 对象）
func (s *VideoAnalysisService) runStageByTask(ctx context.Context, task *model.VideoAnalysisTask, stage string) error {
	task.SetStageStatus(stage, model.VideoAnalysisStageStatusRunning)
	task.Status = model.VideoAnalysisStatusRunning
	task.Stage = stage
	if task.StartedAt == nil {
		now := time.Now()
		task.StartedAt = &now
	}
	if err := s.persist(task); err != nil {
		return err
	}
	var stageErr error
	switch stage {
	case model.VideoAnalysisStageDetect:
		stageErr = s.runDetectStage(ctx, task)
	case model.VideoAnalysisStageStructure:
		stageErr = s.runStructureStage(ctx, task)
	case model.VideoAnalysisStageDescribe:
		stageErr = s.runDescribeStage(ctx, task)
	}
	if stageErr != nil {
		if stage == model.VideoAnalysisStageDescribe && task.Status == model.VideoAnalysisStatusPartial {
			// describe 未全部成功已在 runDescribeStage 内按 partial 收尾（含 claim），保留状态
			return nil
		}
		task.SetStageStatus(stage, model.VideoAnalysisStageStatusFailed)
		task.ErrorCode = analysisErrorCode(stageErr)
		task.ErrorMessage = stageErr.Error()
		s.persist(task)
		return stageErr
	}
	task.SetStageStatus(stage, model.VideoAnalysisStageStatusSucceeded)
	// 最后一个阶段完成（下一阶段为 done）：搬移 staging 产物并计算图片 embedding。
	// RunMissing 循环在下一次迭代发现 done 时退出，这里在退出前完成 claim。
	if task.NextPendingStage() == model.VideoAnalysisStageDone {
		if err := s.claimArtifactsForTask(task, true); err != nil {
			task.SetStageStatus(model.VideoAnalysisStageStructure, model.VideoAnalysisStageStatusFailed)
			task.ErrorCode = analysisErrorCode(err)
			task.ErrorMessage = err.Error()
			s.persist(task)
			return err
		}
		if err := s.computeSceneEmbeddings(task); err != nil && s.logger != nil {
			s.logger.Warnw("Video analysis compute scene embeddings failed (non-fatal)",
				"task_id", task.ID,
				"media_id", task.MediaID,
				"error", err,
			)
		}
	}
	return s.persist(task)
}

// runDetectStage 执行 Detect 阶段
func (s *VideoAnalysisService) runDetectStage(ctx context.Context, task *model.VideoAnalysisTask) error {
	detectJob, err := s.ensureDetectJob(ctx, task)
	if err != nil {
		return err
	}
	_, err = s.waitForJob(ctx, detectJob, s.client.GetDetectJob)
	if err != nil {
		return fmt.Errorf("detect stage: %w", err)
	}
	task.Progress = 50
	return nil
}

// runStructureStage 执行 Structure 阶段
func (s *VideoAnalysisService) runStructureStage(ctx context.Context, task *model.VideoAnalysisTask) error {
	detectJob, err := s.ensureDetectJob(ctx, task)
	if err != nil {
		return err
	}
	detectResult, err := s.waitForJob(ctx, detectJob, s.client.GetDetectJob)
	if err != nil {
		return fmt.Errorf("get detect result for structure: %w", err)
	}
	structureJob, err := s.ensureStructureJob(ctx, task, detectResult)
	if err != nil {
		return err
	}
	structureProgress := s.jobProgressUpdater(task, 50, 90)
	structureResult, err := s.waitForJobWithProgress(ctx, structureJob, s.client.GetStructureJob, structureProgress)
	if err != nil && !task.FallbackUsed && shouldFallbackToScenes(err) {
		task.FallbackUsed = true
		task.StructureJobID = ""
		if persistErr := s.persist(task); persistErr != nil {
			return persistErr
		}
		structureJob, err = s.submitStructureWithScenes(ctx, task, detectResult)
		if err == nil {
			structureResult, err = s.waitForJobWithProgress(ctx, structureJob, s.client.GetStructureJob, structureProgress)
		}
	}
	if err != nil {
		return fmt.Errorf("structure stage: %w", err)
	}
	task.ResultJSON, err = buildStructureResultJSON(structureResult)
	if err != nil {
		return fmt.Errorf("encode structure result: %w", err)
	}
	var resultHeader struct {
		VideoHash string `json:"video_hash"`
	}
	if err := json.Unmarshal(structureResult.Result, &resultHeader); err != nil || resultHeader.VideoHash == "" {
		return errors.New("structure result is missing video_hash")
	}
	task.VideoHash = resultHeader.VideoHash
	if err := s.saveScenesFromStructure(task, structureResult); err != nil && s.logger != nil {
		s.logger.Warnw("Video analysis save scenes failed (non-fatal)",
			"task_id", task.ID, "media_id", task.MediaID, "error", err)
	}
	return nil
}

// runDescribeStage 执行 Describe 阶段
// describe 未全部成功时任务已按 partial 收尾（含 claim），返回非 nil 错误让调用方
// 保留 partial 状态，不覆盖为 succeeded/failed。
func (s *VideoAnalysisService) runDescribeStage(ctx context.Context, task *model.VideoAnalysisTask) error {
	if !task.IncludeDescriptions {
		task.SetStageStatus(model.VideoAnalysisStageDescribe, model.VideoAnalysisStageStatusSkipped)
		return nil
	}
	if task.ResultJSON == "" {
		return errors.New("structure result is required before describe")
	}
	describeJob, err := s.ensureDescribeJob(ctx, task)
	if err != nil {
		if perr := s.completeDescribePartial(task, err, ""); perr != nil {
			return perr
		}
		return err
	}
	describeResult, err := s.waitForJobWithProgress(ctx, describeJob, s.client.GetDescribeJob, s.jobProgressUpdater(task, 90, 100))
	if err != nil {
		if perr := s.completeDescribePartial(task, err, ""); perr != nil {
			return perr
		}
		return err
	}
	mergedResult, err := mergeDescribeResult(task.ResultJSON, describeResult.Result)
	if err != nil {
		if perr := s.completeDescribePartial(task, err, "DESCRIBE_MERGE_ERROR"); perr != nil {
			return perr
		}
		return err
	}
	task.ResultJSON = mergedResult
	if err := s.updateSceneDescriptionsFromDescribe(task, describeResult); err != nil && s.logger != nil {
		s.logger.Warnw("Video analysis update scene descriptions failed (non-fatal)",
			"task_id", task.ID, "media_id", task.MediaID, "error", err)
	}
	// describe 部分失败（result.status = "partial"）：成功描述已保留，标记任务 partial
	if describeResultStatus(describeResult.Result) == "partial" {
		partialErr := describePartialError(describeResult.Result)
		if perr := s.completeDescribePartial(task, partialErr, "DESCRIBE_PARTIAL"); perr != nil {
			return perr
		}
		return partialErr
	}
	return nil
}

// WorkflowStatus 工作流状态详情
type WorkflowStatus struct {
	TaskID          string             `json:"task_id"`
	MediaID         string             `json:"media_id"`
	MediaTitle      string             `json:"media_title"`
	Status          string             `json:"status"`
	Stage           string             `json:"stage"`
	Progress        float64            `json:"progress"`
	DetectStatus    string             `json:"detect_status"`
	StructureStatus string             `json:"structure_status"`
	DescribeStatus  string             `json:"describe_status"`
	StageTimings    map[string]float64 `json:"stage_timings,omitempty"`
	ErrorCode       string             `json:"error_code,omitempty"`
	ErrorMessage    string             `json:"error_message,omitempty"`
	StartedAt       *time.Time         `json:"started_at,omitempty"`
	FinishedAt      *time.Time         `json:"finished_at,omitempty"`
	CreatedAt       time.Time          `json:"created_at"`
}
