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
	"strings"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
)

// ModelHubClient 是 V-Scheduler 模型仓库（v-scheduler:6005）的只读/拉取客户端。
// 视频分析 describe 阶段可能因网关找不到模型（404 unknown model or upstream）而失败；
// 本客户端用于查询该模型在模型仓库的下载状态并触发拉取。
type ModelHubClient struct {
	baseURL string
	client  *http.Client
}

// NewModelHubClient 创建一个 V-Scheduler 模型仓库客户端；baseURL 为空时返回 nil（功能未启用）。
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

// modelHubRegistryEntry 对应 V-Scheduler 模型仓库 GET /api/v1/models?status=all 的条目。
type modelHubRegistryEntry struct {
	ModelID string `json:"model_id"`
	Status  string `json:"status"` // pulling / ready / failed / deleting
	Error   string `json:"error,omitempty"`
}

// modelHubTask 对应 V-Scheduler 模型仓库 GET /api/v1/tasks 的条目。
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

// ModelHubModelStatus 描述一个网关模型名在 V-Scheduler 模型仓库侧的下载状态。
type ModelHubModelStatus struct {
	// Requested 前端传入的 V-Scheduler 模型名（如 model-hub/minicpm-v4.6:latest）。
	Requested string `json:"requested"`
	// ModelID 映射后的模型仓库 model_id（如 ollama://minicpm-v4.6:latest）。
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

// splitModelSource 把 source://name 拆成 source 与 name；无 source 前缀时 source 为空。
func splitModelSource(id string) (source, name string) {
	if i := strings.Index(id, "://"); i > 0 {
		return id[:i], id[i+3:]
	}
	return "", id
}

// resolveModelHubModelID 把网关模型名映射为模型仓库的拉取标识（source + model_id）。
// 网关有三种写法，按顺序处理：
//  1. 已带 source://（ollama:// / hf:// / ms://）→ 原样使用；
//  2. 旧版 model-hub/<name> → ollama://<name>；
//  3. <namespace>/<upstream>/<native>（如 v-scheduler/ollama-qa/minicpm-v4.6:latest）
//     或裸名 → 取最后一段原生模型名在注册表里唯一匹配，
//     同名多个时放弃匹配，交给人工确认，避免拉错模型；
//  4. 注册表里没有该模型（从未拉取过）→ 按网关名的源标记段推导仓库 id。
//
// registry 为 nil 时只处理前两种和推导（无需网络）。
func resolveModelHubModelID(requested string, registry []modelHubRegistryEntry) (source, modelID string, ok bool) {
	requested = strings.TrimSpace(requested)
	if requested == "" {
		return "", "", false
	}
	if source, _ := splitModelSource(requested); source != "" {
		return source, requested, true
	}
	if rest, found := strings.CutPrefix(requested, "model-hub/"); found {
		rest = strings.Trim(rest, `"' `)
		if rest == "" || strings.ContainsAny(rest, " \t\n") {
			return "", "", false
		}
		return "ollama", "ollama://" + rest, true
	}

	// 网关名可能带它自己的上游命名空间与组织路径，
	// 因此按最后一段原生模型名匹配；多个候选一律放弃，避免拉错模型。
	matched := ""
	for _, entry := range registry {
		_, name := splitModelSource(entry.ModelID)
		if !modelNameMatches(requested, name) {
			continue
		}
		if matched != "" && matched != entry.ModelID {
			return "", "", false
		}
		matched = entry.ModelID
	}
	if matched == "" {
		if id, src, derivable := deriveModelIDFromGatewayName(requested); derivable {
			return src, id, true
		}
		return "", "", false
	}
	source, _ = splitModelSource(matched)
	return source, matched, true
}

// deriveModelIDFromGatewayName 从网关名的源标记段推导仓库 id，用于注册表里还没有的模型。
// 网关名形如 <upstream>/<源标记>/<模型路径>：
//   - v-scheduler/ollama-qa/minicpm-v4.6:latest → ollama://minicpm-v4.6:latest
//   - v-scheduler/hf-prod/Qwen/Qwen3-0.6B       → hf://Qwen/Qwen3-0.6B
//
// ollama 源是单段原生名；hf 源是 <org>/<repo> 两段路径。
// 其他源（如 ms://）的 id 约定无法从网关名可靠推导，只能靠注册表匹配。
func deriveModelIDFromGatewayName(requested string) (modelID, source string, ok bool) {
	parts := strings.Split(requested, "/")
	if len(parts) < 3 {
		return "", "", false
	}
	for i := 1; i < len(parts)-1; i++ {
		seg := strings.ToLower(parts[i])
		path := parts[i+1:]
		switch {
		case strings.HasPrefix(seg, "ollama"):
			name := strings.Join(path, "/")
			if name == "" || strings.Contains(name, "/") || strings.ContainsAny(name, " \t\n") {
				return "", "", false
			}
			return "ollama://" + name, "ollama", true
		case strings.HasPrefix(seg, "hf"):
			repo := strings.Join(path, "/")
			if strings.Count(repo, "/") != 1 || strings.ContainsAny(repo, " \t\n") {
				return "", "", false
			}
			return "hf://" + repo, "hf", true
		}
	}
	return "", "", false
}

// modelTail 取模型名的最后一段：去掉 source:// 与上游/组织路径。
// 例：v-scheduler/ollama-qa/minicpm-v4.6:latest → minicpm-v4.6:latest。
func modelTail(id string) string {
	_, name := splitModelSource(id)
	if i := strings.LastIndex(name, "/"); i >= 0 {
		return name[i+1:]
	}
	return name
}

// modelNameMatches 判断网关模型名与仓库 model_id 是否指同一个模型。
// 网关名形如 v-scheduler/ollama-qa/minicpm-v4.6:latest，仓库 id 形如 ollama://minicpm-v4.6:latest，
// 只有最后一段（原生模型名，含量化/tag 后缀）是一致的；中间是网关侧的上游与组织路径，仓库里没有。
func modelNameMatches(requested, name string) bool {
	if requested == "" || name == "" {
		return false
	}
	if requested == name {
		return true
	}
	return modelTail(requested) == modelTail(name)
}

// listModels 读取模型仓库注册表（含下载中/失败的条目）。
func (m *ModelHubClient) listModels(ctx context.Context) ([]modelHubRegistryEntry, error) {
	registry := []modelHubRegistryEntry{}
	if err := m.getJSON(ctx, "/api/v1/models", url.Values{"status": {"all"}}, &registry); err != nil {
		return nil, err
	}
	return registry, nil
}

const (
	modelHubStatusMissing     = "missing"
	modelHubStatusPulling     = "pulling"
	modelHubStatusReady       = "ready"
	modelHubStatusFailed      = "failed"
	modelHubStatusUnsupported = "unsupported"
	// ModelHubStatusNotRegistered 仓库里有模型文件，但网关注册表里没有这个模型名
	// （典型：仍用旧命名 model-hub/…，此时重试必然 404）。
	ModelHubStatusNotRegistered = "not_registered"
)

// 网关模型列表探测：状态查询不能因为网关慢而卡住。
const gatewayProbeTimeout = 3 * time.Second

var gatewayProbeClient = &http.Client{Timeout: gatewayProbeTimeout}

// VerifyGatewayModel 用 V-Scheduler 网关的 /v1/models 校正仓库状态：
// 仓库 ready 只说明模型文件在，网关不认识这个名称时重试仍会 404，改判 not_registered 提示改名。
// missing（仓库里还没有）不参与改判：网关本来就不会列出未下载的模型，此时应保持 missing 供用户下载。
// 非网关供应商或网关不可达时保持原状态，不误报。
func VerifyGatewayModel(ctx context.Context, status *ModelHubModelStatus, providerID, apiBase, apiKey string) {
	if status == nil || status.Status != modelHubStatusReady {
		return
	}
	// 只对 V-Scheduler 网关做这项校验：普通 OpenAI 兼容服务也有 /models，
	// 但对不上号不代表"命名格式不对"，别给出错误建议。
	if !config.IsVSchedulerGateway(providerID, apiBase) {
		return
	}
	registered, err := gatewayHasModel(ctx, apiBase, apiKey, status.Requested)
	if err != nil || registered {
		return
	}
	status.Status = ModelHubStatusNotRegistered
}

// gatewayHasModel 查询网关 /v1/models 判断模型 id 是否已注册。
func gatewayHasModel(ctx context.Context, apiBase, apiKey, modelID string) (bool, error) {
	base := strings.TrimRight(strings.TrimSpace(apiBase), "/")
	modelID = strings.TrimSpace(modelID)
	if base == "" || modelID == "" {
		return false, errors.New("网关地址或模型名为空")
	}
	ctx, cancel := context.WithTimeout(ctx, gatewayProbeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/models", nil)
	if err != nil {
		return false, err
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := gatewayProbeClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("连接网关失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false, fmt.Errorf("网关模型列表查询失败（HTTP %d）", resp.StatusCode)
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&payload); err != nil {
		return false, fmt.Errorf("网关模型列表解析失败: %w", err)
	}
	for _, item := range payload.Data {
		if item.ID == modelID {
			return true, nil
		}
	}
	return false, nil
}

// 拉取失败的业务分类，handler 据此映射 HTTP 状态码（400/409/502）。
var (
	// ErrModelHubModelUnsupported 模型不在 V-Scheduler 模型仓库中，无法自动下载。
	ErrModelHubModelUnsupported = errors.New("该模型不在 V-Scheduler 模型仓库中，无法自动下载")
	// ErrModelHubPullConflict V-Scheduler 模型仓库拒绝了拉取请求（下载中/已就绪/删除中等业务冲突）。
	ErrModelHubPullConflict = errors.New("V-Scheduler 模型仓库拒绝拉取该模型")
)

// Status 查询模型在 V-Scheduler 模型仓库的下载状态。模型不在注册表且无活跃/失败任务时返回 missing。
func (m *ModelHubClient) Status(ctx context.Context, requested string) (*ModelHubModelStatus, error) {
	registry, err := m.listModels(ctx)
	if err != nil {
		return nil, err
	}
	_, modelID, ok := resolveModelHubModelID(requested, registry)
	if !ok {
		return &ModelHubModelStatus{Requested: requested, Status: modelHubStatusUnsupported}, nil
	}
	out := &ModelHubModelStatus{Requested: requested, ModelID: modelID, Status: modelHubStatusMissing}

	// 1) 注册表状态（ready/pulling/failed 都以模型在注册表为准）
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

// Pull 触发 V-Scheduler 模型仓库拉取模型。模型已在下载/已就绪时返回业务错误文本（非网络错误）。
func (m *ModelHubClient) Pull(ctx context.Context, requested string) (string, error) {
	source, modelID, ok := resolveModelHubModelID(requested, nil)
	if !ok {
		// 网关用 <upstream>/<native> 命名时需要注册表才能对上仓库 id。
		registry, err := m.listModels(ctx)
		if err != nil {
			return "", err
		}
		source, modelID, ok = resolveModelHubModelID(requested, registry)
		if !ok {
			return "", ErrModelHubModelUnsupported
		}
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
		return "", fmt.Errorf("连接 V-Scheduler 模型仓库失败: %w", err)
	}
	defer resp.Body.Close()

	var envelope struct {
		TaskID  string `json:"task_id"`
		ModelID string `json:"model_id"`
		Detail  string `json:"detail"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return "", fmt.Errorf("V-Scheduler 模型仓库响应解析失败（HTTP %d）", resp.StatusCode)
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
		return "", fmt.Errorf("V-Scheduler 模型仓库拉取失败（HTTP %d）: %s", resp.StatusCode, envelope.Detail)
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
		return fmt.Errorf("连接 V-Scheduler 模型仓库失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("V-Scheduler 模型仓库 %s 查询失败（HTTP %d）", path, resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("V-Scheduler 模型仓库响应解析失败: %w", err)
	}
	return nil
}
