package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ModelHubClient 是 Model Hub 后端（model-hub-backend:5005）的只读/拉取客户端。
// 视频分析 describe 阶段可能因 V-Scheduler 缺少模型（unknown model: model-hub/xxx）
// 而失败；本客户端用于查询该模型在 Model Hub 的下载状态并触发拉取。
type ModelHubClient struct {
	baseURL string
	client  *http.Client
}

// NewModelHubClient 创建一个 Model Hub 客户端；baseURL 为空时返回 nil（功能未启用）。
func NewModelHubClient(baseURL string) *ModelHubClient {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil
	}
	return &ModelHubClient{
		baseURL: baseURL,
		client:  &http.Client{Timeout: 15 * time.Second},
	}
}

// modelHubRegistryEntry 对应 Model Hub GET /api/v1/models?status=all 的条目。
type modelHubRegistryEntry struct {
	ModelID string `json:"model_id"`
	Status  string `json:"status"` // pulling / ready / failed / deleting
	Error   string `json:"error,omitempty"`
}

// modelHubTask 对应 Model Hub GET /api/v1/tasks 的条目。
type modelHubTask struct {
	TaskID          string  `json:"task_id"`
	ModelID         string  `json:"model_id"`
	Phase           string  `json:"phase"` // PENDING / DOWNLOADING / VERIFYING / READY / FAILED
	Progress        float64 `json:"progress"`
	DownloadedBytes *int64  `json:"downloaded_bytes"`
	TotalBytes      *int64  `json:"total_bytes"`
	CurrentFile     string  `json:"current_file"`
	ErrorMsg        string  `json:"error_msg"`
}

// ModelHubModelStatus 描述一个 V-Scheduler 模型名在 Model Hub 侧的下载状态。
type ModelHubModelStatus struct {
	// Requested 前端传入的 V-Scheduler 模型名（如 model-hub/minicpm-v4.6:latest）。
	Requested string `json:"requested"`
	// ModelID 映射后的 Model Hub model_id（如 ollama://minicpm-v4.6:latest）。
	ModelID string `json:"model_id"`
	// Status: missing / pulling / ready / failed / unsupported
	Status string `json:"status"`
	// Progress 下载进度 0~1（仅 pulling 时有意义）。
	Progress    float64 `json:"progress,omitempty"`
	Downloaded  *int64  `json:"downloaded_bytes,omitempty"`
	Total       *int64  `json:"total_bytes,omitempty"`
	CurrentFile string  `json:"current_file,omitempty"`
	ErrorMsg    string  `json:"error_msg,omitempty"`
	TaskID      string  `json:"task_id,omitempty"`
}

// resolveModelHubModelID 把 V-Scheduler 的模型名（model-hub/xxx）映射为
// Model Hub 的拉取标识（ollama://xxx 或 hf://xxx / ms://xxx）。
// 仅支持 model-hub/ 前缀的模型；其他来源（image-studio/、registered/ 等）不支持下载。
func resolveModelHubModelID(requested string) (source, modelID string, ok bool) {
	requested = strings.TrimSpace(requested)
	if !strings.HasPrefix(requested, "model-hub/") {
		return "", "", false
	}
	rest := strings.TrimPrefix(requested, "model-hub/")
	rest = strings.Trim(rest, `"' `)
	if rest == "" || strings.ContainsAny(rest, " \t\n") {
		return "", "", false
	}
	return "ollama", "ollama://" + rest, true
}

const (
	modelHubStatusMissing     = "missing"
	modelHubStatusPulling     = "pulling"
	modelHubStatusReady       = "ready"
	modelHubStatusFailed      = "failed"
	modelHubStatusUnsupported = "unsupported"
)

// 拉取失败的业务分类，handler 据此映射 HTTP 状态码（400/409/502）。
var (
	// ErrModelHubModelUnsupported 模型不是 Model Hub 托管，无法自动下载。
	ErrModelHubModelUnsupported = errors.New("该模型不是 Model Hub 托管的模型，无法自动下载")
	// ErrModelHubPullConflict Model Hub 拒绝了拉取请求（下载中/已就绪/删除中等业务冲突）。
	ErrModelHubPullConflict = errors.New("Model Hub 拒绝拉取该模型")
)

// Status 查询模型在 Model Hub 的下载状态。模型不在注册表且无活跃/失败任务时返回 missing。
func (m *ModelHubClient) Status(ctx context.Context, requested string) (*ModelHubModelStatus, error) {
	_, modelID, ok := resolveModelHubModelID(requested)
	if !ok {
		return &ModelHubModelStatus{Requested: requested, Status: modelHubStatusUnsupported}, nil
	}
	out := &ModelHubModelStatus{Requested: requested, ModelID: modelID, Status: modelHubStatusMissing}

	// 1) 注册表状态（ready/pulling/failed 都以模型在注册表为准）
	registry := []modelHubRegistryEntry{}
	if err := m.getJSON(ctx, "/api/v1/models", url.Values{"status": {"all"}}, &registry); err != nil {
		return nil, err
	}
	for _, entry := range registry {
		if entry.ModelID != modelID {
			continue
		}
		switch entry.Status {
		case "ready", "READY":
			out.Status = modelHubStatusReady
			return out, nil
		case "pulling", "PULLING":
			out.Status = modelHubStatusPulling
		case "failed", "FAILED":
			out.Status = modelHubStatusFailed
			if entry.Error != "" {
				out.ErrorMsg = entry.Error
			}
		}
		break
	}

	// 2) 拉取任务（进度/失败原因；ready 回归由注册表优先，不覆盖）
	tasks := []modelHubTask{}
	if err := m.getJSON(ctx, "/api/v1/tasks", nil, &tasks); err != nil {
		return nil, err
	}
	for _, task := range tasks {
		if task.ModelID != modelID {
			continue
		}
		out.TaskID = task.TaskID
		switch task.Phase {
		case "DOWNLOADING", "VERIFYING", "PENDING":
			out.Status = modelHubStatusPulling
			out.Progress = task.Progress
			out.Downloaded = task.DownloadedBytes
			out.Total = task.TotalBytes
			out.CurrentFile = task.CurrentFile
			return out, nil
		case "FAILED":
			if out.Status != modelHubStatusPulling {
				out.Status = modelHubStatusFailed
			}
			if task.ErrorMsg != "" {
				out.ErrorMsg = task.ErrorMsg
			}
		}
	}
	return out, nil
}

// Pull 触发 Model Hub 拉取模型。模型已在下载/已就绪时返回业务错误文本（非网络错误）。
func (m *ModelHubClient) Pull(ctx context.Context, requested string) (string, error) {
	source, modelID, ok := resolveModelHubModelID(requested)
	if !ok {
		return "", ErrModelHubModelUnsupported
	}
	payload := map[string]any{
		"source":   source,
		"model_id": modelID,
		"name":     strings.TrimPrefix(modelID, source+"://"),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.baseURL+"/api/v1/models/pull", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := m.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("连接 Model Hub 失败: %w", err)
	}
	defer resp.Body.Close()

	var envelope struct {
		TaskID  string `json:"task_id"`
		ModelID string `json:"model_id"`
		Detail  string `json:"detail"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return "", fmt.Errorf("Model Hub 响应解析失败（HTTP %d）", resp.StatusCode)
	}
	switch resp.StatusCode {
	case http.StatusOK, http.StatusAccepted:
		return envelope.TaskID, nil
	case http.StatusConflict:
		if envelope.Detail == "" {
			return "", ErrModelHubPullConflict
		}
		return "", fmt.Errorf("%w: %s", ErrModelHubPullConflict, envelope.Detail)
	default:
		return "", fmt.Errorf("Model Hub 拉取失败（HTTP %d）: %s", resp.StatusCode, envelope.Detail)
	}
}

func (m *ModelHubClient) getJSON(ctx context.Context, path string, query url.Values, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.baseURL+path, nil)
	if err != nil {
		return err
	}
	if len(query) > 0 {
		req.URL.RawQuery = query.Encode()
	}
	resp, err := m.client.Do(req)
	if err != nil {
		return fmt.Errorf("连接 Model Hub 失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Model Hub %s 查询失败（HTTP %d）", path, resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("Model Hub 响应解析失败: %w", err)
	}
	return nil
}
