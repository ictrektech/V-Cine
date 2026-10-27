package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/repository"
	"github.com/nowen-video/nowen-video/internal/service"
	"go.uber.org/zap"
)

// AIHandler AI 功能处理器
type AIHandler struct {
	aiService   *service.AIService
	router      *service.AIRouter
	usageRepo   *repository.AIUsageRepo
	failoverLog *repository.AIFailoverLogRepo
	cfg         *config.Config
	logger      *zap.SugaredLogger
}

// SmartSearch AI 智能搜索（解析自然语言查询）
func (h *AIHandler) SmartSearch(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "搜索关键词不能为空"})
		return
	}

	intent, err := h.aiService.ParseSearchIntent(query)
	if err != nil {
		h.logger.Warnw("AI 智能搜索失败", "error", err)
		c.JSON(http.StatusOK, gin.H{
			"data": service.SearchIntent{
				Query:  query,
				Parsed: false,
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": intent})
}

// GetAIStatus 获取 AI 服务状态（管理员）
func (h *AIHandler) GetAIStatus(c *gin.Context) {
	status := h.aiService.GetStatus()
	c.JSON(http.StatusOK, gin.H{"data": status})
}

// UpdateAIConfig 更新 AI 配置（管理员）
func (h *AIHandler) UpdateAIConfig(c *gin.Context) {
	var updates map[string]interface{}
	if err := c.ShouldBindJSON(&updates); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
		return
	}

	if err := h.aiService.UpdateConfig(updates); err != nil {
		respondErr(c, http.StatusInternalServerError, "", err)
		return
	}

	status := h.aiService.GetStatus()
	c.JSON(http.StatusOK, gin.H{"message": "AI 配置已更新", "data": status})
}

// TestAIConnection 测试 AI API 连接（管理员）
func (h *AIHandler) TestAIConnection(c *gin.Context) {
	var req struct {
		ProviderID string `json:"provider_id"` // 为空时测试当前激活的
	}
	_ = c.ShouldBindJSON(&req)

	result, err := h.aiService.TestConnection(req.ProviderID)
	if err != nil && result == nil {
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"success": false, "error": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}

// TestDesensitizeConnection 测试脱敏服务健康（管理员）
func (h *AIHandler) TestDesensitizeConnection(c *gin.Context) {
	result := h.aiService.TestDesensitize()
	c.JSON(http.StatusOK, gin.H{"data": result})
}

// ClearAICache 清空 AI 缓存（管理员）
func (h *AIHandler) ClearAICache(c *gin.Context) {
	count := h.aiService.ClearCache()
	c.JSON(http.StatusOK, gin.H{
		"message": "AI 缓存已清空",
		"data":    gin.H{"cleared": count},
	})
}

// GetAICacheStats 获取 AI 缓存统计（管理员）
func (h *AIHandler) GetAICacheStats(c *gin.Context) {
	stats := h.aiService.GetCacheStats()
	c.JSON(http.StatusOK, gin.H{"data": stats})
}

// GetAIErrorLogs 获取 AI 错误日志（管理员）
func (h *AIHandler) GetAIErrorLogs(c *gin.Context) {
	logs := h.aiService.GetErrorLogs()
	c.JSON(http.StatusOK, gin.H{"data": logs})
}

// TestSmartSearch 测试智能搜索功能（管理员）
func (h *AIHandler) TestSmartSearch(c *gin.Context) {
	var req struct {
		Query string `json:"query" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 query 参数"})
		return
	}

	result, err := h.aiService.TestSmartSearch(req.Query)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"success": false, "error": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

// EnableAutoPilot 一键启用 AI 全自动托管模式（管理员）
//
// 接受可选的 provider 与 api_key，会在一次调用中：
//  1. 强制开启 ai.enabled / ai.auto_pilot
//  2. 强制启用三个子功能开关（智能搜索、推荐理由、元数据增强）
//  3. 仅切换 active_provider，不回填 api_base / model（未配置的由调用链可读错误兜底）
//
// 不再强制 block_local_ai：允许本地模型参与托管模式，由用户自行选择。
//
// 请求体示例：
//
//	{ "provider": "deepseek", "api_key": "sk-xxxxxx" }
func (h *AIHandler) EnableAutoPilot(c *gin.Context) {
	var req struct {
		Provider string `json:"provider"`
		APIKey   string `json:"api_key"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		// 允许空 body：表示在已有 provider/api_key 基础上仅打开 AutoPilot 开关
		req = struct {
			Provider string `json:"provider"`
			APIKey   string `json:"api_key"`
		}{}
	}

	updates := map[string]interface{}{
		"enabled":                 true,
		"auto_pilot":              true,
		"enable_smart_search":     true,
		"enable_recommend_reason": true,
		"enable_metadata_enhance": true,
	}

	// 仅切换 provider，不回填 api_base/model：预设回填会静默覆盖用户
	// 已自定义的地址（如独立部署 V-Scheduler 的网关 URL）。未配置的 provider
	// 由调用链「未配置 API Base」可读错误兜底。
	if req.Provider != "" {
		updates["active_provider"] = req.Provider
	}
	if req.APIKey != "" {
		updates["api_key"] = req.APIKey
	}

	if err := h.aiService.UpdateConfig(updates); err != nil {
		respondErr(c, http.StatusInternalServerError, "", err)
		return
	}

	status := h.aiService.GetStatus()
	c.JSON(http.StatusOK, gin.H{
		"message": "AI 全自动托管模式已开启",
		"data":    status,
	})
}

// TestRecommendReason 测试推荐理由生成（管理员）
func (h *AIHandler) TestRecommendReason(c *gin.Context) {
	var req struct {
		Title  string `json:"title" binding:"required"`
		Genres string `json:"genres"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 title 参数"})
		return
	}

	result, err := h.aiService.TestRecommendReason(req.Title, req.Genres)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"success": false, "error": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

// ==================== 智能调度器 / 用量监控 / 故障转移 ====================

// GetRouterSnapshot 获取 AIRouter 当前状态（管理员）
//
// 返回当前生效 provider、月度用量、切换链、消耗百分比等，用于前端 dashboard。
func (h *AIHandler) GetRouterSnapshot(c *gin.Context) {
	if h.router == nil {
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"failover_enabled":   false,
			"current_active":     "",
			"preferred_provider": "",
		}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": h.router.GetSnapshot()})
}

// ForceSwitchProvider 强制切换到指定 provider（管理员）
//
// 请求体：{ "provider": "deepseek" }
func (h *AIHandler) ForceSwitchProvider(c *gin.Context) {
	if h.router == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AIRouter 未启用"})
		return
	}
	var req struct {
		Provider string `json:"provider" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 provider 参数"})
		return
	}
	operator := getUsernameFromContext(c)
	if err := h.router.ForceSwitch(req.Provider, operator); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "已切换到 " + req.Provider,
		"data":    h.router.GetSnapshot(),
	})
}

// RestoreProvider 手动恢复主 provider（管理员）
func (h *AIHandler) RestoreProvider(c *gin.Context) {
	if h.router == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AIRouter 未启用"})
		return
	}
	operator := getUsernameFromContext(c)
	if err := h.router.Restore(operator); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "已恢复到主 provider",
		"data":    h.router.GetSnapshot(),
	})
}

// ListFailoverLogs 列出最近的切换审计日志（管理员）
//
// Query: ?limit=100
func (h *AIHandler) ListFailoverLogs(c *gin.Context) {
	if h.failoverLog == nil {
		c.JSON(http.StatusOK, gin.H{"data": []interface{}{}})
		return
	}
	limit := 100
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	logs, err := h.failoverLog.List(limit)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": logs})
}

// GetUsageBuckets 用量曲线（管理员）
//
// Query:
//   - range: day | week | month  (默认 month)
//   - provider: 可选，按 provider 过滤
func (h *AIHandler) GetUsageBuckets(c *gin.Context) {
	if h.usageRepo == nil {
		c.JSON(http.StatusOK, gin.H{"data": []interface{}{}})
		return
	}
	rng := strings.ToLower(c.DefaultQuery("range", "month"))
	provider := c.Query("provider")
	now := time.Now()
	var from time.Time
	switch rng {
	case "day":
		from = now.AddDate(0, 0, -1)
	case "week":
		from = now.AddDate(0, 0, -7)
	case "month":
		from = now.AddDate(0, -1, 0)
	case "year":
		from = now.AddDate(-1, 0, 0)
	default:
		from = now.AddDate(0, -1, 0)
	}
	buckets, err := h.usageRepo.AggregateByDay(from, now.Add(time.Minute), provider)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "", err)
		return
	}
	totals, _ := h.usageRepo.SumByProvider(from, now.Add(time.Minute))
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"buckets":         buckets,
			"provider_totals": totals,
			"range":           rng,
			"from":            from,
			"to":              now,
		},
	})
}

// ==================== 供应商管理（V11：列表模式） ====================

// ListProviders 获取所有供应商列表
func (h *AIHandler) ListProviders(c *gin.Context) {
	snapshot := h.cfg.AISnapshot()
	providers := make([]gin.H, 0, len(snapshot.Providers))
	for _, p := range snapshot.Providers {
		providers = append(providers, p.ViewMap(snapshot.ActiveProvider))
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"providers": providers}})
}

// AddProvider 添加供应商
func (h *AIHandler) AddProvider(c *gin.Context) {
	var req struct {
		ID      string                `json:"id"`
		Name    string                `json:"name" binding:"required"`
		APIBase string                `json:"api_base"`
		APIKey  string                `json:"api_key"`
		Models  []config.AIModelEntry `json:"models"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name 不能为空"})
		return
	}

	// 生成 ID（如果未提供）
	id := strings.TrimSpace(req.ID)
	if id == "" {
		id = "custom_" + strings.ReplaceAll(strings.ToLower(req.Name), " ", "_")
	}

	// 检查 ID 是否已存在
	for _, p := range h.cfg.AISnapshot().Providers {
		if p.ID == id {
			c.JSON(http.StatusConflict, gin.H{"error": "同名供应商已存在"})
			return
		}
	}

	if err := h.cfg.UpdateAIConfig(func(cfg *config.AIConfig) {
		cfg.Providers = append(cfg.Providers, config.AIProviderEntry{
			ID:      id,
			Name:    req.Name,
			APIBase: req.APIBase,
			APIKey:  req.APIKey,
			Models:  req.Models,
			Enabled: true,
		})
	}); err != nil {
		h.logger.Errorw("保存供应商配置失败", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "供应商已添加", "data": gin.H{
		"id": id, "name": req.Name, "api_base": req.APIBase,
	}})
}

// UpdateProvider 更新供应商配置（点击"设置"按钮后调用）
func (h *AIHandler) UpdateProvider(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少供应商 ID"})
		return
	}

	var req struct {
		Name    string                `json:"name"`
		APIBase string                `json:"api_base"`
		APIKey  string                `json:"api_key"`
		Models  []config.AIModelEntry `json:"models"`
		Enabled *bool                 `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
		return
	}

	updated := false
	if err := h.cfg.UpdateAIConfig(func(cfg *config.AIConfig) {
		for i, pr := range cfg.Providers {
			if pr.ID != id {
				continue
			}
			// 内置网关条目的连接信息由系统内置（免 key、默认网关地址），
			// APIBase/APIKey 不接受修改；名称、模型、启停仍可更新。
			isBuiltIn := config.IsBuiltInProviderID(pr.ID)
			if req.Name != "" {
				cfg.Providers[i].Name = req.Name
			}
			if req.APIBase != "" && !isBuiltIn {
				cfg.Providers[i].APIBase = req.APIBase
			}
			// api_key 留空时保留原值
			if req.APIKey != "" && !isBuiltIn {
				cfg.Providers[i].APIKey = req.APIKey
			}
			if req.Models != nil {
				cfg.Providers[i].Models = req.Models
			}
			if req.Enabled != nil {
				cfg.Providers[i].Enabled = *req.Enabled
			}
			updated = true
			break
		}
	}); err != nil {
		h.logger.Errorw("保存供应商配置失败", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
		return
	}
	if !updated {
		c.JSON(http.StatusNotFound, gin.H{"error": "供应商不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "供应商已更新"})
}

// DeleteProvider 删除供应商
func (h *AIHandler) DeleteProvider(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少供应商 ID"})
		return
	}

	// 内置网关条目不可删除：它是新装默认 provider（启动种子），删除会失去零配置能力。
	// 手动添加的 V-Scheduler 条目（custom_ 前缀等）不受限。
	if config.IsBuiltInProviderID(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "内置 V-Scheduler 供应商不可删除"})
		return
	}

	found := false
	if err := h.cfg.UpdateAIConfig(func(cfg *config.AIConfig) {
		newProviders := make([]config.AIProviderEntry, 0, len(cfg.Providers))
		for _, p := range cfg.Providers {
			if p.ID == id {
				found = true
				continue
			}
			newProviders = append(newProviders, p)
		}
		if !found {
			return
		}
		cfg.Providers = newProviders

		// 如果删除的是当前激活的供应商，激活字段回退到内置网关（默认选中）
		if cfg.ActiveProvider == id {
			cfg.ActiveProvider = config.GatewayProviderID
			cfg.ActiveModel = ""
		}
	}); err != nil {
		h.logger.Errorw("保存供应商配置失败", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
		return
	}
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "供应商不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "供应商已删除"})
}

// SetActive 切换激活的供应商（从列表中复制配置到顶层扁平字段）
func (h *AIHandler) SetActive(c *gin.Context) {
	var req struct {
		Provider string `json:"provider" binding:"required"`
		Model    string `json:"model"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider 不能为空"})
		return
	}

	var activeProvider, activeModel string
	if err := h.cfg.UpdateAIConfig(func(cfg *config.AIConfig) {
		// 只设顶层激活 ID，实际配置在 Providers 列表中
		cfg.ActiveProvider = req.Provider
		if req.Model != "" {
			cfg.ActiveModel = req.Model
		} else if found := cfg.FindProvider(req.Provider); found != nil {
			cfg.ActiveModel = found.DefaultModel()
		}
		activeProvider = cfg.ActiveProvider
		activeModel = cfg.ActiveModel
	}); err != nil {
		h.logger.Errorw("保存 AI 配置失败", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "AI 配置已更新", "data": gin.H{
		"active_provider": activeProvider,
		"active_model":    activeModel,
	}})
}

// FetchModels 从 OpenAI 兼容 API 获取模型列表
// 支持可选 provider_id：编辑已有供应商且 base_url 未变时，api_key 留空自动回退到已存储的密钥（内存中已解密）。
func (h *AIHandler) FetchModels(c *gin.Context) {
	var req struct {
		BaseURL    string `json:"base_url"`
		APIKey     string `json:"api_key"`
		ProviderID string `json:"provider_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求体"})
		return
	}

	base := strings.TrimRight(req.BaseURL, "/")
	if base == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 base_url"})
		return
	}

	// 回退到已存储的密钥（provider_id 匹配且 base_url 与已存地址一致时才回退，避免把存储密钥发往其他地址）
	apiKey := req.APIKey
	if req.ProviderID != "" && apiKey == "" {
		for _, p := range h.cfg.AISnapshot().Providers {
			if p.ID == req.ProviderID {
				if base == strings.TrimRight(p.APIBase, "/") {
					apiKey = p.APIKey
				}
				break
			}
		}
	}

	// 构建请求 URL（如果 base 已包含 /v1 则不再追加）
	var url string
	if strings.HasSuffix(base, "/v1") {
		url = base + "/models"
	} else {
		url = base + "/v1/models"
	}

	// 创建 HTTP 请求
	httpReq, err := http.NewRequest("GET", url, nil)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 URL"})
		return
	}
	if apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	// 发送请求
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无法连接到 API: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":       "API 返回错误状态码: " + strconv.Itoa(resp.StatusCode),
			"url":         url,
			"status_code": resp.StatusCode,
			"response":    string(respBody),
		})
		return
	}

	// 解析响应（兼容两种格式）
	// 格式1 OpenAI: {"data":[{"id":"gpt-4o"},...]}
	// 格式2 Ollama/llama.cpp: {"models":[{"model":"llama3"},...]}
	var openaiResult struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	var ollamaResult struct {
		Models []struct {
			Model string `json:"model"`
		} `json:"models"`
	}

	models := make([]string, 0)

	if err := json.Unmarshal(respBody, &openaiResult); err == nil && len(openaiResult.Data) > 0 {
		for _, m := range openaiResult.Data {
			if m.ID != "" {
				models = append(models, m.ID)
			}
		}
	} else if err := json.Unmarshal(respBody, &ollamaResult); err == nil && len(ollamaResult.Models) > 0 {
		for _, m := range ollamaResult.Models {
			if m.Model != "" {
				models = append(models, m.Model)
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": models})
}

// getUsernameFromContext 尝试从 gin context 中读取登录用户名，否则返回 "system"
func getUsernameFromContext(c *gin.Context) string {
	if v, ok := c.Get("username"); ok {
		if s, ok2 := v.(string); ok2 && s != "" {
			return s
		}
	}
	if v, ok := c.Get("user_id"); ok {
		if s, ok2 := v.(string); ok2 && s != "" {
			return s
		}
	}
	return "system"
}
