import api from './client'
import type {
  SearchIntent,
  AIStatus,
  AIErrorLog,
  AICacheStats,
  AITestResult,
} from '@/types'

// ==================== AI 智能功能 ====================
export const aiApi = {
  // AI 智能搜索（解析自然语言查询）
  smartSearch: (q: string) =>
    api.get<{ data: SearchIntent }>('/ai/search', { params: { q } }),

  // 获取 AI 服务状态（管理员）
  getStatus: () =>
    api.get<{ data: AIStatus }>('/admin/ai/status'),

  // 更新 AI 配置（管理员）
  updateConfig: (updates: Partial<{
    enabled: boolean
    auto_pilot: boolean
    block_local_ai: boolean
    provider: string
    api_base: string
    api_key: string
    model: string
    timeout: number
    enable_smart_search: boolean
    enable_recommend_reason: boolean
    enable_metadata_enhance: boolean
    describe_enabled: boolean
    scene_describe_ai: { provider_id: string; model: string }
    monthly_budget: number
    cache_ttl_hours: number
    max_concurrent: number
    request_interval_ms: number
    desensitize?: {
      enabled?: boolean
      base_url?: string
      timeout?: number
      ner?: boolean
    }
  }>) =>
    api.put<{ message: string; data: AIStatus }>('/admin/ai/config', updates),

  // 一键启用全自动托管模式（管理员）
  // 提供 provider / api_key 即可，会自动填好 api_base / model，并打开所有 AI 子开关
  enableAutoPilot: (params?: { provider?: string; api_key?: string }) =>
    api.post<{ message: string; data: AIStatus }>('/admin/ai/auto-pilot', params || {}),

  // 测试 AI 连接（管理员）
  testConnection: (providerId?: string) =>
    api.post<{ data: AITestResult }>('/admin/ai/test', { provider_id: providerId || '' }),

  // 测试脱敏服务健康（管理员）
  testDesensitize: () =>
    api.post<{ data: {
      success: boolean
      error?: string
      configured?: boolean
      latency_ms?: number
      rules?: number
      result?: string
    } }>('/admin/ai/desensitize/test'),

  // 清空 AI 缓存（管理员）
  clearCache: () =>
    api.delete<{ message: string; data: { cleared: number } }>('/admin/ai/cache'),

  // 获取缓存统计（管理员）
  getCacheStats: () =>
    api.get<{ data: AICacheStats }>('/admin/ai/cache'),

  // 获取错误日志（管理员）
  getErrorLogs: () =>
    api.get<{ data: AIErrorLog[] }>('/admin/ai/errors'),

  // 测试智能搜索（管理员）
  testSmartSearch: (query: string) =>
    api.post<{ data: AITestResult }>('/admin/ai/test/search', { query }),

  // 测试推荐理由（管理员）
  testRecommendReason: (title: string, genres: string) =>
    api.post<{ data: AITestResult }>('/admin/ai/test/recommend', { title, genres }),

  // ==================== V7：AI 智能调度器 / 用量监控 / 故障转移 ====================

  // 列出所有 AI 提供商的开箱即用预设
  listProviderPresets: () =>
    api.get<{ data: import('@/types').AIProviderPreset[] }>('/admin/ai/presets'),

  // 一键配置通义千问（仅需提供 api_key）
  quickConfigQwen: (apiKey: string) =>
    api.post<{ message: string; data: { status: import('@/types').AIStatus; test: import('@/types').AITestResult } }>(
      '/admin/ai/quick-config/qwen',
      { api_key: apiKey },
    ),

  // 获取 AIRouter 当前状态（首选/生效 provider、月用量、切换链等）
  getRouterSnapshot: () =>
    api.get<{ data: import('@/types').AIRouterSnapshot }>('/admin/ai/router'),

  // 强制切换到指定 provider
  forceSwitchProvider: (provider: string) =>
    api.post<{ message: string; data: import('@/types').AIRouterSnapshot }>('/admin/ai/router/switch', { provider }),

  // 恢复主 provider
  restoreProvider: () =>
    api.post<{ message: string; data: import('@/types').AIRouterSnapshot }>('/admin/ai/router/restore'),

  // 切换审计日志
  listFailoverLogs: (limit = 100) =>
    api.get<{ data: import('@/types').AIFailoverLog[] }>('/admin/ai/router/logs', { params: { limit } }),

  // 用量曲线（按天聚合）
  getUsageBuckets: (range: 'day' | 'week' | 'month' | 'year' = 'month', provider?: string) =>
    api.get<{ data: import('@/types').AIUsageReport }>('/admin/ai/usage', { params: { range, provider } }),

  // ==================== 供应商管理（扁平字段） ====================

  // 设置当前激活的供应商和模型
  setActive: (params: { provider: string; model?: string; api_base?: string; api_key?: string }) =>
    api.post<{ message: string; data: AIStatus }>('/admin/ai/set-active', params),

  // 供应商列表
  listProviders: () =>
    api.get<{ data: import('@/types').AIStatus['providers'] }>('/admin/ai/providers'),

  // 新增供应商
  addProvider: (data: { name: string; api_base?: string; api_key?: string; models?: Array<{ name: string; is_vision: boolean; is_default: boolean }> }) =>
    api.post<{ message: string; data: import('@/types').AIStatus['providers'] }>('/admin/ai/providers', data),

  // 更新供应商
  updateProvider: (id: string, data: { name?: string; api_base?: string; api_key?: string; models?: Array<{ name: string; is_vision: boolean; is_default: boolean }>; enabled?: boolean }) =>
    api.put<{ message: string; data: import('@/types').AIStatus['providers'] }>(`/admin/ai/providers/${id}`, data),

  // 删除供应商
  deleteProvider: (id: string) =>
    api.delete<{ message: string }>(`/admin/ai/providers/${id}`),

  // 获取供应商可用模型列表
  fetchModels: (data: { base_url: string; api_key?: string }) =>
    api.post<{ data: string[] }>('/admin/ai/providers/fetch-models', data),
}

// ==================== AI 助手 ====================
export const aiAssistantApi = {
  // 对话
  chat: (data: {
    session_id?: string
    message: string
    media_ids?: string[]
    library_id?: string
  }) =>
    api.post<{ data: import('@/types').ChatResponse }>('/admin/assistant/chat', data),

  // 执行操作
  executeAction: (data: { session_id: string; action_id: string }) =>
    api.post<{ data: import('@/types').ExecuteResponse }>('/admin/assistant/execute', data),

  // 撤销操作
  undoOperation: (opId: string) =>
    api.post<{ data: import('@/types').ExecuteResponse }>(`/admin/assistant/undo/${opId}`),

  // 获取会话
  getSession: (sessionId: string) =>
    api.get<{ data: import('@/types').ChatSession }>(`/admin/assistant/session/${sessionId}`),

  // 删除会话
  deleteSession: (sessionId: string) =>
    api.delete(`/admin/assistant/session/${sessionId}`),

  // 获取操作历史
  getOperationHistory: (limit?: number) =>
    api.get<{ data: import('@/types').AssistantOperation[] }>('/admin/assistant/history', { params: { limit } }),

  // 误分类分析
  analyzeMisclassification: () =>
    api.get<{ data: import('@/types').MisclassificationReport }>('/admin/assistant/misclassification'),

  // 批量重分类
  reclassifyFiles: (data: import('@/types').ReclassifyRequest) =>
    api.post<{ data: import('@/types').ReclassifyResult }>('/admin/assistant/reclassify', data),
}
