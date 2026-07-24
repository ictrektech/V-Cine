package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

const videoAnalysisTaskUpdateEvent = "video_analysis_task_update"

var ErrVideoAnalysisTaskActive = repository.ErrVideoAnalysisTaskActive

type videoAnalysisExternalClient interface {
	SubmitDetectJob(context.Context, DetectJobRequest) (*ExternalJobRef, error)
	GetDetectJob(context.Context, string) (*ExternalJob, error)
	SubmitStructureJob(context.Context, StructureJobRequest) (*ExternalJobRef, error)
	GetStructureJob(context.Context, string) (*ExternalJob, error)
}

type VideoAnalysisSubmitOptions struct {
	Trigger             string
	Force               bool
	IncludeDescriptions bool
}

type VideoAnalysisSubmitOutcome struct {
	Task    *model.VideoAnalysisTask
	Result  string
	Message string
}

type VideoAnalysisBatchError struct {
	MediaID string `json:"media_id"`
	Message string `json:"message"`
}

type VideoAnalysisBatchResult struct {
	Created int                        `json:"created"`
	Reused  int                        `json:"reused"`
	Skipped int                        `json:"skipped"`
	Errors  []VideoAnalysisBatchError  `json:"errors"`
	TaskIDs []string                   `json:"task_ids"`
	Tasks   []*model.VideoAnalysisTask `json:"tasks"`
}

type VideoAnalysisService struct {
	tasks        *repository.VideoAnalysisTaskRepo
	media        *repository.MediaRepo
	client       videoAnalysisExternalClient
	pathMapper   *VideoPathMapper
	wsHub        *WSHub
	logger       *zap.SugaredLogger
	pollInterval time.Duration
	jobTimeout   time.Duration
}

func NewVideoAnalysisService(
	tasks *repository.VideoAnalysisTaskRepo,
	media *repository.MediaRepo,
	client videoAnalysisExternalClient,
	pathMapper *VideoPathMapper,
	wsHub *WSHub,
	logger *zap.SugaredLogger,
	pollInterval, jobTimeout time.Duration,
) *VideoAnalysisService {
	if pollInterval <= 0 {
		pollInterval = 2 * time.Second
	}
	if jobTimeout <= 0 {
		jobTimeout = 2 * time.Hour
	}
	return &VideoAnalysisService{
		tasks: tasks, media: media, client: client, pathMapper: pathMapper,
		wsHub: wsHub, logger: logger, pollInterval: pollInterval, jobTimeout: jobTimeout,
	}
}

func (s *VideoAnalysisService) IsAvailable() bool {
	return s != nil && s.client != nil && s.tasks != nil && s.media != nil && s.pathMapper != nil
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
	if options.IncludeDescriptions {
		return nil, errors.New("scene descriptions are not enabled in the current video analysis worker")
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
	mappedPath, err := s.pathMapper.Map(media.FilePath)
	if err != nil {
		return nil, err
	}
	fileInfo, err := os.Stat(media.FilePath)
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
	s.broadcast(task)
	return &VideoAnalysisSubmitOutcome{Task: task, Result: "created"}, nil
}

func (s *VideoAnalysisService) BatchSubmit(mediaIDs []string, options VideoAnalysisSubmitOptions) VideoAnalysisBatchResult {
	result := VideoAnalysisBatchResult{Errors: []VideoAnalysisBatchError{}, TaskIDs: []string{}, Tasks: []*model.VideoAnalysisTask{}}
	seen := make(map[string]struct{}, len(mediaIDs))
	for _, mediaID := range mediaIDs {
		mediaID = strings.TrimSpace(mediaID)
		if mediaID == "" {
			result.Errors = append(result.Errors, VideoAnalysisBatchError{Message: "media_id is required"})
			continue
		}
		if _, exists := seen[mediaID]; exists {
			result.Reused++
			continue
		}
		seen[mediaID] = struct{}{}
		outcome, err := s.SubmitMediaWithOutcome(mediaID, options)
		if err != nil {
			result.Errors = append(result.Errors, VideoAnalysisBatchError{MediaID: mediaID, Message: err.Error()})
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

func (s *VideoAnalysisService) GetTask(taskID string) (*model.VideoAnalysisTask, error) {
	if !s.IsAvailable() {
		return nil, errors.New("video analysis service is not configured")
	}
	return s.tasks.FindByID(taskID)
}

func (s *VideoAnalysisService) GetLatestTaskByMediaID(mediaID string) (*model.VideoAnalysisTask, error) {
	if !s.IsAvailable() {
		return nil, errors.New("video analysis service is not configured")
	}
	return s.tasks.FindLatestByMediaID(mediaID)
}

func (s *VideoAnalysisService) ListTasks(page, pageSize int, status, libraryID, keyword string) ([]model.VideoAnalysisTask, int64, error) {
	if !s.IsAvailable() {
		return nil, 0, errors.New("video analysis service is not configured")
	}
	return s.tasks.List(page, pageSize, status, libraryID, strings.TrimSpace(keyword))
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
	switch task.Stage {
	case model.VideoAnalysisStageStructure:
		task.StructureJobID = ""
		task.DescribeJobID = ""
		task.ResultJSON = ""
		task.VideoHash = ""
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
		task.VideoHash = ""
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
	if err := s.persist(task); err != nil {
		return err
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
		return fmt.Errorf("detect stage: %w", err)
	}

	task.Stage = model.VideoAnalysisStageStructure
	task.Progress = 50
	if err := s.persist(task); err != nil {
		return err
	}
	structureJob, err := s.ensureStructureJob(ctx, task, detectResult)
	if err != nil {
		return err
	}
	structureResult, err := s.waitForJob(ctx, structureJob, s.client.GetStructureJob)
	if err != nil && !task.FallbackUsed && shouldFallbackToScenes(err) {
		task.FallbackUsed = true
		task.StructureJobID = ""
		if persistErr := s.persist(task); persistErr != nil {
			return persistErr
		}
		structureJob, err = s.submitStructureWithScenes(ctx, task, detectResult)
		if err == nil {
			structureResult, err = s.waitForJob(ctx, structureJob, s.client.GetStructureJob)
		}
	}
	if err != nil {
		return fmt.Errorf("structure stage: %w", err)
	}

	task.ResultJSON = string(structureResult.Result)
	var resultHeader struct {
		VideoHash string `json:"video_hash"`
	}
	if err := json.Unmarshal(structureResult.Result, &resultHeader); err != nil || resultHeader.VideoHash == "" {
		return errors.New("structure result is missing video_hash")
	}
	task.VideoHash = resultHeader.VideoHash
	// Describe is deliberately disabled in the MVP worker until its server-side
	// model credentials and partial-success policy are wired.
	task.Status = model.VideoAnalysisStatusSucceeded
	task.Stage = model.VideoAnalysisStageDone
	task.Progress = 100
	finished := time.Now()
	task.FinishedAt = &finished
	task.ErrorCode = ""
	task.ErrorMessage = ""
	return s.persist(task)
}

func (s *VideoAnalysisService) ensureDetectJob(ctx context.Context, task *model.VideoAnalysisTask) (string, error) {
	if task.DetectJobID != "" {
		return task.DetectJobID, nil
	}
	job, err := s.client.SubmitDetectJob(ctx, DetectJobRequest{VideoPath: task.MappedVideoPath})
	if err != nil {
		return "", fmt.Errorf("submit detect job: %w", err)
	}
	task.DetectJobID = job.JobID
	task.Progress = 5
	if err := s.persist(task); err != nil {
		return "", err
	}
	return job.JobID, nil
}

func (s *VideoAnalysisService) ensureStructureJob(ctx context.Context, task *model.VideoAnalysisTask, detectResult *ExternalJob) (string, error) {
	if task.StructureJobID != "" {
		return task.StructureJobID, nil
	}
	job, err := s.client.SubmitStructureJob(ctx, StructureJobRequest{
		VideoPath: task.MappedVideoPath, DetectJobID: task.DetectJobID,
		FrameGrid: true, Force: task.Force, GridRows: 3, GridCols: 3,
	})
	if err != nil && !task.FallbackUsed && shouldFallbackToScenes(err) {
		task.FallbackUsed = true
		if persistErr := s.persist(task); persistErr != nil {
			return "", persistErr
		}
		return s.submitStructureWithScenes(ctx, task, detectResult)
	}
	if err != nil {
		return "", fmt.Errorf("submit structure job: %w", err)
	}
	task.StructureJobID = job.JobID
	if err := s.persist(task); err != nil {
		return "", err
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
		FrameGrid: true, Force: task.Force, GridRows: 3, GridCols: 3,
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

func (s *VideoAnalysisService) waitForJob(ctx context.Context, jobID string, get func(context.Context, string) (*ExternalJob, error)) (*ExternalJob, error) {
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
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (s *VideoAnalysisService) verifyFileSnapshot(task *model.VideoAnalysisTask) error {
	info, err := os.Stat(task.VideoPath)
	if err != nil {
		return fmt.Errorf("stat video file: %w", err)
	}
	if info.Size() != task.FileSize || info.ModTime().Unix() != task.FileMTime {
		return errors.New("video file changed after the analysis task was created")
	}
	return nil
}

func (s *VideoAnalysisService) persist(task *model.VideoAnalysisTask) error {
	if err := s.tasks.Update(task); err != nil {
		return err
	}
	s.broadcast(task)
	return nil
}

func (s *VideoAnalysisService) failTask(task *model.VideoAnalysisTask, err error) {
	task.Status = model.VideoAnalysisStatusFailed
	task.ErrorCode = analysisErrorCode(err)
	task.ErrorMessage = err.Error()
	finished := time.Now()
	task.FinishedAt = &finished
	if persistErr := s.persist(task); persistErr != nil && s.logger != nil {
		s.logger.Errorf("persist failed video analysis task %s: %v", task.ID, persistErr)
	}
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
