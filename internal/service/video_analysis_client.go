package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync/atomic"
	"time"
)

const maxVideoAnalysisResponseBytes = 4 << 20

type SceneBoundary struct {
	SceneIndex int     `json:"scene_index"`
	StartFrame int64   `json:"start_frame"`
	EndFrame   int64   `json:"end_frame"`
	StartTime  float64 `json:"start_time"`
	EndTime    float64 `json:"end_time"`
}

type DetectJobRequest struct {
	VideoPath     string  `json:"video_path"`
	Threshold     float64 `json:"threshold,omitempty"`
	MaxScenes     int     `json:"max_scenes,omitempty"`
	ScaleWidth    int     `json:"scale_width,omitempty"`
	DecodeThreads int     `json:"decode_threads,omitempty"`
}

type StructureJobRequest struct {
	VideoPath   string          `json:"video_path"`
	DetectJobID string          `json:"detect_job_id,omitempty"`
	Scenes      []SceneBoundary `json:"scenes,omitempty"`
	FrameGrid   bool            `json:"frame_grid"`
	GridRows    int             `json:"grid_rows,omitempty"`
	GridCols    int             `json:"grid_cols,omitempty"`
}

// DescribeModelCfg 场景描述阶段调用的 LLM 配置
// 由 Nowen 的 AI 配置动态注入，不持久化到外部服务
type DescribeModelCfg struct {
	BaseURL        string `json:"base_url"`
	APIKey         string `json:"api_key"`
	ModelName      string `json:"model_name"`
	MaxConcurrency int    `json:"max_concurrency"`
}

type DescribeJobRequest struct {
	StructureJobID string            `json:"structure_job_id"`
	Force          bool              `json:"force"`
	ModelCfg       *DescribeModelCfg `json:"model_cfg,omitempty"`
}

type ExternalJobRef struct {
	JobID   string `json:"job_id"`
	Status  string `json:"status"`
	PollURL string `json:"poll_url"`
}

type ExternalJobError struct {
	Code    string          `json:"code"`
	Message string          `json:"message"`
	Detail  json.RawMessage `json:"detail"`
}

type ExternalJob struct {
	JobID      string            `json:"job_id"`
	Type       string            `json:"type"`
	Status     string            `json:"status"`
	CreatedAt  int64             `json:"created_at"`
	StartedAt  int64             `json:"started_at"`
	FinishedAt int64             `json:"finished_at"`
	Attempt    int               `json:"attempt"`
	Result     json.RawMessage   `json:"result"`
	Error      *ExternalJobError `json:"error"`
}

type VideoAnalysisHealth struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

type VideoAnalysisAPIError struct {
	HTTPStatus int
	Code       int
	Message    string
}

func (e *VideoAnalysisAPIError) Error() string {
	if e.HTTPStatus != 0 {
		return fmt.Sprintf("video analysis API error: http=%d code=%d message=%s", e.HTTPStatus, e.Code, e.Message)
	}
	return fmt.Sprintf("video analysis API error: code=%d message=%s", e.Code, e.Message)
}

type VideoAnalysisClient struct {
	sceneBase     atomic.Pointer[url.URL]
	structureBase atomic.Pointer[url.URL]
	httpClient    *http.Client
}

func NewVideoAnalysisClient(sceneBaseURL, structureBaseURL string, client *http.Client) (*VideoAnalysisClient, error) {
	sceneBase, err := normalizeAnalysisBaseURL(sceneBaseURL)
	if err != nil {
		return nil, fmt.Errorf("invalid scene base URL: %w", err)
	}
	structureBase, err := normalizeAnalysisBaseURL(structureBaseURL)
	if err != nil {
		return nil, fmt.Errorf("invalid structure base URL: %w", err)
	}
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	c := &VideoAnalysisClient{httpClient: client}
	c.sceneBase.Store(sceneBase)
	c.structureBase.Store(structureBase)
	return c, nil
}

// SetBaseURLs 热更新 Scene / Structure 服务地址，后续请求立即使用新地址。
func (c *VideoAnalysisClient) SetBaseURLs(sceneBaseURL, structureBaseURL string) error {
	sceneBase, err := normalizeAnalysisBaseURL(sceneBaseURL)
	if err != nil {
		return fmt.Errorf("invalid scene base URL: %w", err)
	}
	structureBase, err := normalizeAnalysisBaseURL(structureBaseURL)
	if err != nil {
		return fmt.Errorf("invalid structure base URL: %w", err)
	}
	c.sceneBase.Store(sceneBase)
	c.structureBase.Store(structureBase)
	return nil
}

func (c *VideoAnalysisClient) SubmitDetectJob(ctx context.Context, request DetectJobRequest) (*ExternalJobRef, error) {
	if strings.TrimSpace(request.VideoPath) == "" {
		return nil, errors.New("video_path is required")
	}
	var result ExternalJobRef
	if err := c.doJSON(ctx, http.MethodPost, c.sceneBase.Load(), "/api/v2/scenes/detect/jobs", request, &result); err != nil {
		return nil, err
	}
	if err := c.validateJobRef(c.sceneBase.Load(), &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *VideoAnalysisClient) GetDetectJob(ctx context.Context, jobID string) (*ExternalJob, error) {
	return c.getJob(ctx, c.sceneBase.Load(), "/api/v2/scenes/detect/jobs/", jobID)
}

func (c *VideoAnalysisClient) SubmitStructureJob(ctx context.Context, request StructureJobRequest) (*ExternalJobRef, error) {
	if strings.TrimSpace(request.VideoPath) == "" {
		return nil, errors.New("video_path is required")
	}
	if strings.TrimSpace(request.DetectJobID) == "" && len(request.Scenes) == 0 {
		return nil, errors.New("detect_job_id or scenes is required")
	}
	var result ExternalJobRef
	if err := c.doJSON(ctx, http.MethodPost, c.structureBase.Load(), "/api/v2/video/structure/jobs", request, &result); err != nil {
		return nil, err
	}
	if err := c.validateJobRef(c.structureBase.Load(), &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *VideoAnalysisClient) GetStructureJob(ctx context.Context, jobID string) (*ExternalJob, error) {
	return c.getJob(ctx, c.structureBase.Load(), "/api/v2/video/structure/jobs/", jobID)
}

func (c *VideoAnalysisClient) SubmitDescribeJob(ctx context.Context, request DescribeJobRequest) (*ExternalJobRef, error) {
	if strings.TrimSpace(request.StructureJobID) == "" {
		return nil, errors.New("structure_job_id is required")
	}
	var result ExternalJobRef
	if err := c.doJSON(ctx, http.MethodPost, c.structureBase.Load(), "/api/v2/video/describe/jobs", request, &result); err != nil {
		return nil, err
	}
	if err := c.validateJobRef(c.structureBase.Load(), &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *VideoAnalysisClient) GetDescribeJob(ctx context.Context, jobID string) (*ExternalJob, error) {
	return c.getJob(ctx, c.structureBase.Load(), "/api/v2/video/describe/jobs/", jobID)
}

func (c *VideoAnalysisClient) CheckSceneHealth(ctx context.Context) (*VideoAnalysisHealth, error) {
	var result VideoAnalysisHealth
	if err := c.doJSON(ctx, http.MethodGet, c.sceneBase.Load(), "/api/health", nil, &result); err != nil {
		return nil, err
	}
	if result.Status == "" || result.Service == "" {
		return nil, errors.New("scene health response is missing required fields")
	}
	return &result, nil
}

func (c *VideoAnalysisClient) CheckStructureHealth(ctx context.Context) (*VideoAnalysisHealth, error) {
	var result VideoAnalysisHealth
	if err := c.doJSON(ctx, http.MethodGet, c.structureBase.Load(), "/api/health", nil, &result); err != nil {
		return nil, err
	}
	if result.Status == "" || result.Service == "" {
		return nil, errors.New("structure health response is missing required fields")
	}
	return &result, nil
}

func (c *VideoAnalysisClient) getJob(ctx context.Context, base *url.URL, endpointPrefix, jobID string) (*ExternalJob, error) {
	if strings.TrimSpace(jobID) == "" {
		return nil, errors.New("job ID is required")
	}
	var result ExternalJob
	if err := c.doJSON(ctx, http.MethodGet, base, endpointPrefix+url.PathEscape(jobID), nil, &result); err != nil {
		return nil, err
	}
	if result.JobID == "" || !isExternalJobStatus(result.Status) {
		return nil, errors.New("video analysis API returned an invalid job")
	}
	return &result, nil
}

func (c *VideoAnalysisClient) doJSON(ctx context.Context, method string, base *url.URL, endpoint string, requestBody, result any) error {
	var body io.Reader
	if requestBody != nil {
		encoded, err := json.Marshal(requestBody)
		if err != nil {
			return fmt.Errorf("encode video analysis request: %w", err)
		}
		body = bytes.NewReader(encoded)
	}

	requestURL := *base
	requestURL.Path = path.Join(strings.TrimSuffix(base.Path, "/"), endpoint)
	req, err := http.NewRequestWithContext(ctx, method, requestURL.String(), body)
	if err != nil {
		return fmt.Errorf("create video analysis request: %w", err)
	}
	if requestBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("call video analysis API: %w", err)
	}
	defer resp.Body.Close()

	limited := io.LimitReader(resp.Body, maxVideoAnalysisResponseBytes+1)
	payload, err := io.ReadAll(limited)
	if err != nil {
		return fmt.Errorf("read video analysis response: %w", err)
	}
	if len(payload) > maxVideoAnalysisResponseBytes {
		return errors.New("video analysis response exceeds size limit")
	}

	var envelope struct {
		Code int             `json:"code"`
		Msg  string          `json:"msg"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return fmt.Errorf("decode video analysis response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || envelope.Code != 0 {
		return &VideoAnalysisAPIError{HTTPStatus: resp.StatusCode, Code: envelope.Code, Message: envelope.Msg}
	}
	if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return errors.New("video analysis API returned empty data")
	}
	if err := json.Unmarshal(envelope.Data, result); err != nil {
		return fmt.Errorf("decode video analysis data: %w", err)
	}
	return nil
}

func (c *VideoAnalysisClient) validateJobRef(base *url.URL, job *ExternalJobRef) error {
	if job.JobID == "" || (job.Status != "queued" && job.Status != "running") {
		return errors.New("video analysis API returned an invalid job reference")
	}
	if job.PollURL == "" {
		return errors.New("video analysis API returned an empty poll_url")
	}
	pollURL, err := url.Parse(job.PollURL)
	if err != nil {
		return errors.New("video analysis API returned an invalid poll_url")
	}
	if pollURL.Host != "" && !sameOrigin(base, pollURL) {
		return errors.New("video analysis API returned a cross-origin poll_url")
	}
	return nil
}

func normalizeAnalysisBaseURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, errors.New("absolute URL is required")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, errors.New("only http and https URLs are supported")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("credentials, query, and fragment are not allowed")
	}
	parsed.Path = strings.TrimSuffix(parsed.Path, "/")
	return parsed, nil
}

func sameOrigin(left, right *url.URL) bool {
	return strings.EqualFold(left.Scheme, right.Scheme) && strings.EqualFold(left.Host, right.Host)
}

func isExternalJobStatus(status string) bool {
	switch status {
	case "queued", "running", "succeeded", "failed":
		return true
	default:
		return false
	}
}
