// Package service 之 ai_router.go 实现 AI 智能路由 / 故障转移 / 用量监控。
//
// 它在 AIService 之上提供一层"前置守门员"：
//
//	业务调用 → AIRouter.Call → AIService.ChatCompletion → LLM
//	                  │                  ↑
//	                  ├─ 配额耗尽 / 持续 429 / 连续 5xx
//	                  ↓
//	                切换到下一个 provider → 重试一次（最多遍历整条链）
//
// 与 AIService 的分工：
//   - AIService 只关心"当前激活 provider 怎么调"；
//   - AIRouter 关心"调失败了换谁、怎么记账、什么时候恢复"。
//
// 接入方式：
//  1. ChatCompletion / TestConnection 等热路径继续保留，
//     在 AIService 内部接入 AIRouter 的 hook（成功/失败回调）；
//  2. 新增的强制切换 / 恢复 / 查询切换日志 API 走 AIRouter。
package service

import (
	"errors"
	"sync"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"go.uber.org/zap"
)

// FailoverReason 切换原因常量
const (
	FailoverReasonQuotaExhausted      = "quota_exhausted"
	FailoverReasonModelQuotaExhausted = "model_quota_exhausted" // V8：单模型免费额度用尽（同 provider 内换 model）
	FailoverReasonHTTP429             = "http_429_persistent"
	FailoverReasonHTTP5xx             = "http_5xx_consecutive"
	FailoverReasonNetwork             = "network_error"
	FailoverReasonManualSwitch        = "manual_switch"
	FailoverReasonManualRestore       = "manual_restore"
	FailoverReasonAutoRecover         = "auto_recover"
	FailoverReasonBudgetReached       = "monthly_token_budget_reached"
)

// AIRouter AI 智能路由器
//
// 维护"当前实际生效 provider"的状态机：
//   - PreferredProvider：用户偏好的主 provider（来自 cfg.AI.Provider）
//   - currentActive：此刻在用的 provider（可能因 failover 切换）
//   - consecutiveErrors：当前 provider 的连续错误次数
type AIRouter struct {
	ai          *AIService
	cost        *AICostService
	usageRepo   *repository.AIUsageRepo
	failoverLog *repository.AIFailoverLogRepo
	cfg         *config.Config
	logger      *zap.SugaredLogger

	mu                sync.RWMutex
	currentActive     string    // 此刻生效的 provider
	consecutiveErrors int       // 当前 provider 连续错误数
	lastSwitchedAt    time.Time // 最近一次切换时间（用于自动恢复）

	// 月度 token 累计（懒加载，每次 Call 后基于当月 from~now 累加；周期变化时清零）
	monthCountTokens int64
	monthCountAt     int // year*100+month

	// 预警通知去抖（避免每次 call 都打一行警告）
	lastWarningAt   time.Time
	lastBudgetWarn  bool
	lastBudgetReach bool
}

// NewAIRouter 构造
func NewAIRouter(
	ai *AIService,
	cost *AICostService,
	usageRepo *repository.AIUsageRepo,
	failoverLog *repository.AIFailoverLogRepo,
	cfg *config.Config,
	logger *zap.SugaredLogger,
) *AIRouter {
	r := &AIRouter{
		ai:          ai,
		cost:        cost,
		usageRepo:   usageRepo,
		failoverLog: failoverLog,
		cfg:         cfg,
		logger:      logger,
	}
	// 启动时初始化 currentActive
	if cfg != nil {
		r.currentActive = cfg.AI.Provider
	}
	// 注入到 AIService（让 ChatCompletion 在每次调用前后回调 router）
	if ai != nil {
		ai.SetRouter(r)
	}
	return r
}

// CurrentActive 返回此刻生效的 provider id
func (r *AIRouter) CurrentActive() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.currentActive == "" && r.cfg != nil {
		return r.cfg.AI.Provider
	}
	return r.currentActive
}

// PreferredProvider 用户偏好的主 provider（不受 failover 影响）
func (r *AIRouter) PreferredProvider() string {
	if r.cfg == nil {
		return ""
	}
	return r.cfg.AI.Provider
}

// FailoverChain 返回当前生效的切换链。
// V10 重构：failover 功能已删除，只返回主 provider。
func (r *AIRouter) FailoverChain() []string {
	if r.cfg == nil {
		return nil
	}
	pref := r.PreferredProvider()
	if pref == "" {
		return nil
	}
	return []string{pref}
}

// profileExplicitlyDisabled 判断某 profile 是否被用户显式禁用。
// V10 重构：failover 功能已删除，始终返回 false。
func (r *AIRouter) profileExplicitlyDisabled(p string) bool {
	return false
	return false
}

// MarkSuccess 在每次 AI 调用成功后由 AIService 回调
//
// 参数：
//   - provider/model：本次实际使用的 provider 与 model
//   - prompt/completion：本次消耗的 token 数
//   - latencyMs：耗时
//   - scene：场景标签（如 smart_search / metadata / autopilot）
func (r *AIRouter) MarkSuccess(provider, modelID string, prompt, completion int, latencyMs int64, scene string) {
	r.mu.Lock()
	r.consecutiveErrors = 0
	r.mu.Unlock()

	// 1. 写用量记录（异步，不阻塞调用方）
	go r.recordUsage(provider, modelID, prompt, completion, latencyMs, scene, true)

	// 2. 累计月度 token 并按需告警 / 切换
	go r.checkBudgetAfterUse(prompt + completion)
}

// MarkFailure 在每次 AI 调用失败后由 AIService 回调
//
// 参数：
//   - provider：失败时使用的 provider
//   - statusCode：HTTP 状态码（0 表示网络错误）
//   - body：响应体片段（用于检测 quota_exhausted 关键词）
//
// 返回：是否应该切换到下一个 provider（true 时调用方应重试）
func (r *AIRouter) MarkFailure(provider string, statusCode int, body string) (shouldSwitch bool, nextProvider string, reason string) {
	r.mu.Lock()
	r.consecutiveErrors++
	r.mu.Unlock()

	// 1. 异步写失败的用量记录（PromptTokens=0）
	go r.recordUsage(provider, "", 0, 0, 0, "error", false)

	// 2. V10 重构：failover 功能已删除，不切换
	return false, "", ""
}

// isModelQuotaExhausted V10 重构：failover 功能已删除，始终返回 false。
func isModelQuotaExhausted(statusCode int, body string) bool {
	return false
}

// tryAdvanceModel V10 重构：failover 功能已删除，始终返回 false。
func (r *AIRouter) tryAdvanceModel(provider string) bool {
	return false
}

// pickNextModelInChain V10 重构：failover 功能已删除，始终返回空。
func pickNextModelInChain(chain []string, cur string) string {
	return ""
}

// switchModel V10 重构：failover 功能已删除，始终返回错误。
func (r *AIRouter) switchModel(provider, fromModel, toModel, reason, detail, operator string) error {
	return errors.New("failover 已禁用")
}

// pickNextProvider V10 重构：failover 功能已删除，始终返回空。
func (r *AIRouter) pickNextProvider(currentFrom string) (string, bool) {
	chain := r.FailoverChain()
	curIdx := -1
	for i, p := range chain {
		if p == currentFrom {
			curIdx = i
			break
		}
	}
	for i := curIdx + 1; i < len(chain); i++ {
		return chain[i], true
	}
	return "", false
}

// ForceSwitch 手动强制切换到指定 provider（管理员触发）
func (r *AIRouter) ForceSwitch(toProvider, operator string) error {
	return errors.New("failover 已禁用")
}

// Restore V10 重构：failover 功能已删除，始终返回 nil。
func (r *AIRouter) Restore(operator string) error {
	return nil
}

// MaybeAutoRecover V10 重构：failover 功能已删除，直接返回。
func (r *AIRouter) MaybeAutoRecover() {
	return
}

// switchTo V10 重构：failover 功能已删除，始终返回错误。
func (r *AIRouter) switchTo(from, to, reason, detail, operator string) error {
	return errors.New("failover 已禁用")
}

// recordUsage 写入一条用量记录（异步入口）
func (r *AIRouter) recordUsage(provider, modelID string, prompt, completion int, latencyMs int64, scene string, success bool) {
	if r.usageRepo == nil {
		return
	}
	rec := &model.AIUsageRecord{
		Provider:         provider,
		Model:            modelID,
		PromptTokens:     prompt,
		CompletionTokens: completion,
		TotalTokens:      prompt + completion,
		Scene:            scene,
		LatencyMs:        latencyMs,
		Success:          success,
	}
	// 估价（CNY）
	if r.cost != nil && success {
		if est, err := r.cost.Estimate(provider, modelID, prompt, completion); err == nil && est != nil {
			rec.CostUSD = est.CostUSD
			rec.CostCNY = est.CostCNY
		}
	}
	if err := r.usageRepo.Insert(rec); err != nil {
		r.logger.Debugf("写 AI 用量记录失败（可忽略）: %v", err)
	}
}

// checkBudgetAfterUse 在每次成功调用后累加月度 token，检查是否触达预警/上限
//
// 当超过 WarningThresholdPct 时打警告日志（去抖 1 分钟）；
// 当超过 100% 且 Failover 启用时，主动触发一次 failover（reason=BudgetReached）。
func (r *AIRouter) checkBudgetAfterUse(deltaTokens int) {
	if r.cfg == nil {
		return
	}
	budget := r.cfg.AI.MonthlyTokenBudget
	if budget <= 0 || deltaTokens <= 0 {
		return
	}
	now := time.Now()
	monthKey := now.Year()*100 + int(now.Month())

	r.mu.Lock()
	if r.monthCountAt != monthKey {
		// 月切换：重置（懒回填，下次查表时再补真实数）
		r.monthCountTokens = 0
		r.monthCountAt = monthKey
		r.lastBudgetWarn = false
		r.lastBudgetReach = false
	}
	r.monthCountTokens += int64(deltaTokens)
	used := r.monthCountTokens
	warnThresh := r.cfg.AI.WarningThresholdPct
	r.mu.Unlock()

	if warnThresh <= 0 || warnThresh > 100 {
		warnThresh = 80
	}
	pct := int(used * 100 / budget)
	if pct >= 100 {
		r.handleBudgetReached(used, budget)
	} else if pct >= warnThresh {
		r.handleBudgetWarning(used, budget, pct)
	}
}

func (r *AIRouter) handleBudgetWarning(used, budget int64, pct int) {
	r.mu.Lock()
	first := !r.lastBudgetWarn
	r.lastBudgetWarn = true
	r.mu.Unlock()
	if first {
		r.logger.Warnf("⚠️ AI 月度 token 用量已达 %d%% (%d / %d)，请关注配额", pct, used, budget)
	}
}

func (r *AIRouter) handleBudgetReached(used, budget int64) {
	r.mu.Lock()
	first := !r.lastBudgetReach
	r.lastBudgetReach = true
	r.mu.Unlock()
	if !first {
		return
	}
	r.logger.Errorf("🚨 AI 月度 token 配额已耗尽 (%d / %d)", used, budget)
	// V10 重构：failover 功能已删除，不切换 provider
	return
}

// LoadMonthUsage 从仓储补全当月已使用的 token（启动 / 跨月时调用）
func (r *AIRouter) LoadMonthUsage() {
	if r.usageRepo == nil {
		return
	}
	now := time.Now()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	used, err := r.usageRepo.SumTotalTokens(monthStart, now.Add(time.Minute), "")
	if err != nil {
		return
	}
	r.mu.Lock()
	r.monthCountTokens = used
	r.monthCountAt = now.Year()*100 + int(now.Month())
	r.mu.Unlock()
}

// Snapshot 用于前端 Dashboard：返回 router 完整状态
type AIRouterSnapshot struct {
	PreferredProvider   string              `json:"preferred_provider"`
	CurrentActive       string              `json:"current_active"`
	CurrentModel        string              `json:"current_model"`       // V8：当前生效 model（同 provider 内 failover 推进后）
	PreferredModel      string              `json:"preferred_model"`     // V8：用户偏好主模型（profile.Model）
	CurrentModelChain   []string            `json:"current_model_chain"` // V8：当前 provider 的模型链
	LastSwitchedAt      int64               `json:"last_switched_at"`
	FailoverEnabled     bool                `json:"failover_enabled"`
	Chain               []string            `json:"chain"`
	MonthlyTokenBudget  int64               `json:"monthly_token_budget"`
	MonthlyTokenUsed    int64               `json:"monthly_token_used"`
	MonthlyTokenPct     int                 `json:"monthly_token_pct"`
	WarningThresholdPct int                 `json:"warning_threshold_pct"`
	ConsecutiveErrors   int                 `json:"consecutive_errors"`
	AutoRecoverAfterMin int                 `json:"auto_recover_after_min"`
	ProviderTotals      []ProviderTotalView `json:"provider_totals"`
}

// ProviderTotalView 单个 provider 的当月用量摘要
type ProviderTotalView struct {
	Provider     string   `json:"provider"`
	Calls        int64    `json:"calls"`
	TotalTokens  int64    `json:"total_tokens"`
	CostCNY      float64  `json:"cost_cny"`
	Enabled      bool     `json:"enabled"`
	Configured   bool     `json:"configured"`
	CurrentModel string   `json:"current_model,omitempty"` // V8：本 provider 当前生效模型
	ModelChain   []string `json:"model_chain,omitempty"`   // V8：本 provider 模型链
}

// GetSnapshot 拉取 AIRouter 当前状态（前端 dashboard 用）
func (r *AIRouter) GetSnapshot() AIRouterSnapshot {
	r.mu.RLock()
	cur := r.currentActive
	consec := r.consecutiveErrors
	used := r.monthCountTokens
	last := r.lastSwitchedAt
	r.mu.RUnlock()

	snap := AIRouterSnapshot{
		PreferredProvider: r.PreferredProvider(),
		CurrentActive:     cur,
		LastSwitchedAt:    last.Unix(),
		ConsecutiveErrors: consec,
		MonthlyTokenUsed:  used,
	}
	if r.cfg != nil {
		snap.FailoverEnabled = false // V10: failover 已删除
		snap.Chain = r.FailoverChain()
		snap.MonthlyTokenBudget = r.cfg.AI.MonthlyTokenBudget
		snap.WarningThresholdPct = r.cfg.AI.WarningThresholdPct
		snap.AutoRecoverAfterMin = 0 // V10: failover 已删除

		// V10: 从扁平字段读取模型信息
		snap.CurrentModel = r.cfg.AI.ActiveModel
		snap.PreferredModel = r.cfg.AI.ActiveModel
	}
	if snap.MonthlyTokenBudget > 0 {
		snap.MonthlyTokenPct = int(used * 100 / snap.MonthlyTokenBudget)
	}
	// 当月按 provider 聚合
	if r.usageRepo != nil {
		now := time.Now()
		monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		if rows, err := r.usageRepo.SumByProvider(monthStart, now.Add(time.Minute)); err == nil {
			for _, row := range rows {
				view := ProviderTotalView{
					Provider:     row.Provider,
					Calls:        row.Calls,
					TotalTokens:  row.TotalTokens,
					CostCNY:      row.CostCNY,
					Enabled:      true,
					Configured:   true,
					CurrentModel: r.cfg.AI.ActiveModel,
				}
				snap.ProviderTotals = append(snap.ProviderTotals, view)
			}
		}
	}
	return snap
}

// truncForLog 截断字符串用于日志记录
func truncForLog(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
