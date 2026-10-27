package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nowen-video/nowen-video/internal/model"
	"golang.org/x/sync/errgroup"
	"golang.org/x/sync/semaphore"
)

// 本地 describe 阶段的收敛状态（与远端 describe job 的 result.status 语义对齐）。
const (
	describeStatusCompleted = "completed"
	describeStatusPartial   = "partial"
)

// errSceneDescriptionUnretryable 标记确定性失败（配置/鉴权/输入问题）。
// 命中时扇出立即停止派发剩余场景。
var errSceneDescriptionUnretryable = errors.New("scene description failed with a non-retryable error")

// sceneDescriptionTarget 一个待描述场景的最小投影：只保留扇出所需字段。
type sceneDescriptionTarget struct {
	SceneIndex int
	GridImage  string
}

// localDescribeRequest 本地 describe 一次执行所需的不可变输入。
type localDescribeRequest struct {
	VideoHash string
	Targets   []sceneDescriptionTarget
}

// localDescribeOutcome 本地 describe 的产出：既供上层落库，也供日志与错误码使用。
type localDescribeOutcome struct {
	// Result 与远端 describe job 的 result 同构，可直接喂给 mergeDescribeResult。
	Result []byte
	// Failed 描述失败的场景索引（升序），失败时非空。
	Failed []int
	// Warnings 每个失败场景的原因（与 Failed 同序），供错误信息带上上游原文。
	// extractMissingModel 从该文本识别缺失模型名。
	Warnings []VideoAnalysisWarning
	// Total 本次派发的场景总数（= 此前缺口数），用于日志与进度展示。
	Total int
}

// describeLocalClient 返回本地 describe 使用的视觉客户端；nil 表示应回退远端 describe job。
//
// 判定条件：配置了自定义场景描述模型（ai.scene_describe_ai.model）。
// localDescribe 非空时直接返回它（测试注入的替身，不走配置推导）。
// 否则每次调用按当前配置重建客户端，不缓存。
func (s *VideoAnalysisService) describeLocalClient() SceneDescriptionClient {
	s.mu.RLock()
	injected := s.localDescribe
	desensitize := s.sceneImageDesensitize
	s.mu.RUnlock()
	if injected != nil {
		return injected
	}
	// 本地 describe 需要场景存储；缺失时回退远端 describe job。
	if s.sceneStore() == nil {
		return nil
	}
	if s.appCfg == nil {
		return nil
	}
	ai := s.appCfg.AISnapshot()
	modelName := strings.TrimSpace(ai.SceneDescribeAI.Model)
	if modelName == "" {
		return nil
	}
	apiBase, apiKey := resolveSceneDescribeProvider(ai)
	if apiBase == "" {
		return nil
	}
	providerID := strings.TrimSpace(ai.SceneDescribeAI.ProviderID)
	if providerID == "" {
		providerID = ai.ActiveProvider
	}
	return newOpenAIVisionClient(openAIVisionConfig{
		BaseURL:    apiBase,
		Model:      modelName,
		APIKey:     apiKey,
		ProviderID: providerID,
		Desensitize: func(dataURL string) string {
			if desensitize == nil {
				return dataURL
			}
			return desensitize(dataURL)
		},
		Logger: s.logger,
	})
}

// sceneDescriptionStore 本地 describe 所需的最小场景存储能力。
// *repository.SceneRepo 满足该接口；测试可注入内存替身。
type sceneDescriptionStore interface {
	// GetByTaskID 读取任务下全部场景（含已有描述，用于计算缺口）。
	GetByTaskID(taskID string) ([]model.Scene, error)
}

// sceneStore 返回本地 describe 使用的场景存储。
func (s *VideoAnalysisService) sceneStore() sceneDescriptionStore {
	if s.sceneDescriptionStore != nil {
		return s.sceneDescriptionStore
	}
	if s.sceneRepo == nil {
		return nil
	}
	return s.sceneRepo
}

// runDescribePhase describe 阶段的统一入口：按配置选择“本地扇出”或“远端 describe job”。
// 两条路径共用同一套产出、落库与 partial 收尾逻辑。
func (s *VideoAnalysisService) runDescribePhase(ctx context.Context, task *model.VideoAnalysisTask) error {
	if !task.IncludeDescriptions {
		task.SetStageStatus(model.VideoAnalysisStageDescribe, model.VideoAnalysisStageStatusSkipped)
		return nil
	}
	task.Stage = model.VideoAnalysisStageDescribe
	task.SetStageStatus(model.VideoAnalysisStageDescribe, model.VideoAnalysisStageStatusRunning)
	task.Progress = 90
	if err := s.persist(task); err != nil {
		return err
	}
	if client := s.describeLocalClient(); client != nil {
		return s.runLocalDescribeStage(ctx, task, client)
	}
	return s.runRemoteDescribeStage(ctx, task)
}

// runRemoteDescribeStage 远端 describe job：扇出与重试粒度由 structure 服务端控制。
func (s *VideoAnalysisService) runRemoteDescribeStage(ctx context.Context, task *model.VideoAnalysisTask) error {
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

	// Phase 3: 更新 Scene 描述
	if err := s.updateSceneDescriptionsFromDescribe(task, describeResult.Result); err != nil && s.logger != nil {
		s.logger.Warnw("Video analysis update scene descriptions failed (non-fatal)",
			"task_id", task.ID,
			"media_id", task.MediaID,
			"error", err,
		)
	}

	// Phase 3b: 计算描述文本的 CLIP embedding（经 V-Scheduler 调用 ML Server）
	if err := s.computeDescriptionEmbeddings(task); err != nil && s.logger != nil {
		s.logger.Warnw("Video analysis compute description embeddings failed (non-fatal)",
			"task_id", task.ID,
			"media_id", task.MediaID,
			"error", err,
		)
	}

	// describe 部分失败（result.status = "partial"）：成功场景的描述已保留，
	// 标记任务 partial，可重新提交 describe job 增量补齐失败场景。
	if describeResultStatus(describeResult.Result) == describeStatusPartial {
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
	return nil
}

// runLocalDescribeStage 本地 describe：按 DB 缺口扇出到视觉模型，只补缺失场景。
// 产出构造为 describe result JSON，与远端路径同构。
func (s *VideoAnalysisService) runLocalDescribeStage(ctx context.Context, task *model.VideoAnalysisTask, client SceneDescriptionClient) error {
	if s.sceneStore() == nil {
		return errors.New("scene repo is not available for local describe")
	}
	if task.ResultJSON == "" {
		return errors.New("structure result is required before describe")
	}
	// 本地扇出读取 asset_dir 下的九宫格，先把产物 claim 到本地（幂等）。
	// release=false 保留服务端 staging。
	if err := s.claimArtifactsForTask(task, false); err != nil {
		return s.completeDescribePartial(task, err, analysisErrorCode(err))
	}

	request, err := s.buildLocalDescribeRequest(task)
	if err != nil {
		return s.completeDescribePartial(task, err, "")
	}
	outcome, describeErr := s.describeLocally(ctx, client, request)

	mergedResult, mergeErr := mergeDescribeResult(task.ResultJSON, outcome.Result)
	if mergeErr != nil {
		return s.completeDescribePartial(task, mergeErr, "DESCRIBE_MERGE_ERROR")
	}
	task.ResultJSON = mergedResult

	if err := s.updateSceneDescriptionsFromDescribe(task, outcome.Result); err != nil && s.logger != nil {
		s.logger.Warnw("Video analysis update scene descriptions failed (non-fatal)",
			"task_id", task.ID, "media_id", task.MediaID, "error", err)
	}
	// 只算描述向量；图片向量由 completeDescribePartial 计算。
	if err := s.computeDescriptionEmbeddings(task); err != nil && s.logger != nil {
		s.logger.Warnw("Video analysis compute description embeddings failed (non-fatal)",
			"task_id", task.ID, "media_id", task.MediaID, "error", err)
	}

	if len(outcome.Failed) > 0 {
		// 逐场景记录上游原始报错：任务级 error_message 只有聚合文案，排查时需要每条原因。
		if s.logger != nil {
			for _, warning := range outcome.Warnings {
				s.logger.Warnw("Video analysis scene description failed",
					"task_id", task.ID,
					"media_id", task.MediaID,
					"scene_index", warning.TargetID,
					"code", warning.Code,
					"error", warning.Message,
					"detail", warning.Detail,
				)
			}
		}
		details := make([]string, 0, len(outcome.Warnings))
		for _, warning := range outcome.Warnings {
			if warning.Detail != "" {
				details = append(details, warning.Detail)
			}
		}
		// Detail 一并参与缺失模型识别：上游把 unknown model 放在响应体里时也能提示下载。
		return s.completeDescribePartial(task, localDescribeError(outcome), "DESCRIBE_PARTIAL", details...)
	}
	if describeErr != nil {
		// 无失败场景但存在确定性错误（例如全部场景被取消）：按 partial 收尾保留已有结果。
		return s.completeDescribePartial(task, describeErr, "")
	}
	task.SetStageStatus(model.VideoAnalysisStageDescribe, model.VideoAnalysisStageStatusSucceeded)
	return nil
}

// buildLocalDescribeRequest 计算本次需要描述的场景集合：DB 中尚无描述的场景。
func (s *VideoAnalysisService) buildLocalDescribeRequest(task *model.VideoAnalysisTask) (localDescribeRequest, error) {
	scenes, err := s.sceneStore().GetByTaskID(task.ID)
	if err != nil {
		return localDescribeRequest{}, fmt.Errorf("list scenes for local describe: %w", err)
	}
	if len(scenes) == 0 {
		return localDescribeRequest{}, errors.New("no scenes available for local describe")
	}

	targets := make([]sceneDescriptionTarget, 0, len(scenes))
	for _, scene := range scenes {
		if strings.TrimSpace(scene.Description) != "" {
			continue // 已有描述
		}
		if strings.TrimSpace(scene.ImagePath) == "" {
			continue
		}
		targets = append(targets, sceneDescriptionTarget{SceneIndex: scene.SceneIndex, GridImage: scene.ImagePath})
	}
	return localDescribeRequest{VideoHash: task.VideoHash, Targets: targets}, nil
}

// describeLocally 并发扇出到视觉模型，返回与远端 describe result 同构的 JSON。
// 单个场景失败不打断整体（收敛为 partial）；确定性失败取消剩余派发。
func (s *VideoAnalysisService) describeLocally(ctx context.Context, client SceneDescriptionClient, request localDescribeRequest) (localDescribeOutcome, error) {
	outcome := localDescribeOutcome{Total: len(request.Targets)}
	if len(request.Targets) == 0 {
		// 无缺口：返回 completed + 空描述列表。
		outcome.Result = mustEncodeDescribeResult(request.VideoHash, describeStatusCompleted, nil, nil)
		return outcome, nil
	}

	concurrency, perSceneTimeout := s.describeLimits()

	var mu sync.Mutex
	items := make([]videoAnalysisSceneDescribe, 0, len(request.Targets))
	warnings := make([]VideoAnalysisWarning, 0)
	failed := make([]int, 0)

	g, gctx := errgroup.WithContext(ctx)
	sem := semaphore.NewWeighted(concurrency)
	for _, target := range request.Targets {
		target := target
		g.Go(func() error {
			if err := sem.Acquire(gctx, 1); err != nil {
				// 上下文已取消（超时或不可重试错误）：本场景未执行，计入失败。
				mu.Lock()
				failed = append(failed, target.SceneIndex)
				warnings = append(warnings, VideoAnalysisWarning{
					Code:     "DESCRIBE_SCENE_CANCELED",
					Message:  fmt.Sprintf("场景 %d：未执行（任务已取消或超时）", target.SceneIndex),
					Scope:    "scene",
					TargetID: fmt.Sprintf("%d", target.SceneIndex),
				})
				mu.Unlock()
				return nil
			}
			defer sem.Release(1)

			description, err := s.describeSingleScene(gctx, client, request.VideoHash, target, perSceneTimeout)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failed = append(failed, target.SceneIndex)
				warning := VideoAnalysisWarning{
					Code:     "DESCRIBE_SCENE_FAILED",
					Message:  fmt.Sprintf("场景 %d：%s", target.SceneIndex, err.Error()),
					Scope:    "scene",
					TargetID: fmt.Sprintf("%d", target.SceneIndex),
				}
				var describeErr *sceneDescribeError
				if errors.As(err, &describeErr) {
					// 上游原始诊断（finish_reason/usage/响应体）随结果落库，供前端明细与日志排查。
					warning.Detail = describeErr.Detail
				}
				warnings = append(warnings, warning)
				if describeErr != nil && !describeErr.Retryable {
					// 确定性失败：返回错误以取消组内上下文，剩余场景不再派发。
					return errors.Join(errSceneDescriptionUnretryable, err)
				}
				return nil
			}
			items = append(items, videoAnalysisSceneDescribe{
				SceneIndex:  target.SceneIndex,
				GridImage:   target.GridImage,
				Description: description,
				Status:      "ok",
			})
			return nil
		})
	}
	waitErr := g.Wait()

	sort.Ints(failed)
	// warnings 并发写入顺序不定：按场景号排序，便于日志与前端逐条对照排查。
	sort.SliceStable(warnings, func(i, j int) bool {
		left, leftErr := strconv.Atoi(warnings[i].TargetID)
		right, rightErr := strconv.Atoi(warnings[j].TargetID)
		if leftErr != nil || rightErr != nil {
			return false
		}
		return left < right
	})
	sort.Slice(items, func(i, j int) bool { return items[i].SceneIndex < items[j].SceneIndex })
	outcome.Failed = failed
	outcome.Warnings = warnings
	status := describeStatusCompleted
	if len(failed) > 0 {
		status = describeStatusPartial
	}
	outcome.Result = mustEncodeDescribeResult(request.VideoHash, status, items, warnings)
	if errors.Is(waitErr, errSceneDescriptionUnretryable) {
		return outcome, waitErr
	}
	return outcome, nil
}

// describeSingleScene 描述单个场景：解析本地九宫格路径 + 单场景超时保护。
func (s *VideoAnalysisService) describeSingleScene(
	ctx context.Context,
	client SceneDescriptionClient,
	videoHash string,
	target sceneDescriptionTarget,
	timeout time.Duration,
) (string, error) {
	gridPath, err := resolveClaimedGridPath(s.assetDir, videoHash, target.GridImage)
	if err != nil {
		return "", &sceneDescribeError{Message: err.Error(), Err: err}
	}
	sceneCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	description, err := client.DescribeImage(sceneCtx, gridPath)
	if err != nil {
		return "", err
	}
	description = strings.TrimSpace(description)
	if description == "" {
		return "", &sceneDescribeError{Retryable: true, Message: "场景描述模型返回空内容"}
	}
	return description, nil
}

// describeLimits 一次快照取出本地扇出的并发上限与单场景超时，配置缺省时用默认值。
func (s *VideoAnalysisService) describeLimits() (concurrency int64, timeout time.Duration) {
	concurrency, timeout = defaultDescribeConcurrency, defaultDescribeSceneTimeout
	if s.appCfg == nil {
		return concurrency, timeout
	}
	cfg := s.appCfg.VideoAnalysisSnapshot()
	if cfg.DescribeConcurrency > 0 {
		concurrency = int64(cfg.DescribeConcurrency)
	}
	if cfg.DescribeSceneTimeoutSeconds > 0 {
		timeout = time.Duration(cfg.DescribeSceneTimeoutSeconds) * time.Second
	}
	return concurrency, timeout
}

const (
	defaultDescribeConcurrency  int64 = 3
	defaultDescribeSceneTimeout       = 90 * time.Second
)

// localDescribeError 把失败场景集合收敛为可读错误（错误码由调用方指定为 DESCRIBE_PARTIAL）。
// 错误文本带上首条失败原因，供 completeDescribePartial 推导 missing_model。
func localDescribeError(outcome localDescribeOutcome) error {
	if len(outcome.Failed) == 0 {
		return errors.New("部分场景描述失败")
	}
	preview := outcome.Failed
	const maxPreview = 20
	suffix := ""
	if len(preview) > maxPreview {
		preview = preview[:maxPreview]
		suffix = " …"
	}
	indexes := make([]string, 0, len(preview))
	for _, idx := range preview {
		indexes = append(indexes, fmt.Sprintf("%d", idx))
	}
	message := fmt.Sprintf("%d/%d 个场景描述失败（scene_index: %s%s）",
		len(outcome.Failed), outcome.Total, strings.Join(indexes, ","), suffix)
	// 按 TargetID 匹配最小失败索引对应的原因（warnings 并发写入顺序不定）。
	if reason := firstFailureReason(outcome); reason != "" {
		message = message + ": " + reason
	}
	return errors.New(message)
}

// firstFailureReason 返回最小失败场景索引对应的失败原因（无则空串）。
func firstFailureReason(outcome localDescribeOutcome) string {
	if len(outcome.Failed) == 0 || len(outcome.Warnings) == 0 {
		return ""
	}
	want := fmt.Sprintf("%d", outcome.Failed[0])
	for _, w := range outcome.Warnings {
		if w.TargetID == want {
			return strings.TrimSpace(w.Message)
		}
	}
	return strings.TrimSpace(outcome.Warnings[0].Message)
}

// mustEncodeDescribeResult 构造 describe result JSON；序列化失败时返回空对象。
func mustEncodeDescribeResult(videoHash, status string, descriptions []videoAnalysisSceneDescribe, warnings []VideoAnalysisWarning) []byte {
	payload := videoAnalysisDescribeResult{
		VideoHash:    videoHash,
		Status:       status,
		Descriptions: descriptions,
		Warnings:     warnings,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		// 结构体仅含基础类型，正常不会失败。
		return []byte(`{}`)
	}
	return encoded
}
