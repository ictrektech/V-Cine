import { useState, useEffect, useCallback } from 'react'
import { aiApi } from '@/api'
import { useToast } from '@/components/Toast'
import { useDialog } from '@/components/Dialog'
import { useTranslation } from '@/i18n'
import type { AIStatus, AIErrorLog, AICacheStats, AITestResult } from '@/types'
import {
  Sparkles,
  Power,
  Eye,
  EyeOff,
  Cpu,
  Search,
  MessageSquare,
  Database as DatabaseIcon,
  Trash2,
  Play,
  Loader2,
  Check,
  X,
  AlertTriangle,
  Clock,
  BarChart3,
  Settings,
  Shield,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Wifi,
  WifiOff,
  Rocket,
  Film,
  Plus,
  Pencil,
} from 'lucide-react'
import clsx from 'clsx'

// ==================== 提供商预设 ====================
// ==================== 测试用例预设 ====================
const SEARCH_TEST_CASES = [
  '帮我找一部2023年的科幻电影',
  '有没有评分8分以上的日本动画',
  '最近有什么好看的悬疑剧',
  '诺兰导演的电影',
]

const RECOMMEND_TEST_CASES = [
  { title: '星际穿越', genres: '科幻,冒险,剧情' },
  { title: '你的名字', genres: '动画,爱情,奇幻' },
  { title: '肖申克的救赎', genres: '剧情,犯罪' },
]

export default function AITab() {
  const toast = useToast()
  const dialog = useDialog()
  const { t } = useTranslation()

  // ==================== 状态 ====================
  const [status, setStatus] = useState<AIStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // 配置编辑
  const [editEnabled, setEditEnabled] = useState(false)
  const [editProvider, setEditProvider] = useState('openai')
  const [editTimeout, setEditTimeout] = useState(30)
  const [editSmartSearch, setEditSmartSearch] = useState(true)
  const [editRecommendReason, setEditRecommendReason] = useState(true)
  const [editMetadataEnhance, setEditMetadataEnhance] = useState(true)
  const [editDescribeEnabled, setEditDescribeEnabled] = useState(false)
  const [editMonthlyBudget, setEditMonthlyBudget] = useState(0)
  const [editCacheTTL, setEditCacheTTL] = useState(168)
  const [editMaxConcurrent, setEditMaxConcurrent] = useState(3)
  const [editRequestInterval, setEditRequestInterval] = useState(200)

  const [editDescribeAPIBase, setEditDescribeAPIBase] = useState('')
  const [editDescribeAPIKey, setEditDescribeAPIKey] = useState('')
  const [editDescribeModel, setEditDescribeModel] = useState('')
  const [showDescribeAPIKey, setShowDescribeAPIKey] = useState(false)
  const [showDescribe, setShowDescribe] = useState(false)

  // 缓存
  const [cacheStats, setCacheStats] = useState<AICacheStats | null>(null)
  const [clearingCache, setClearingCache] = useState(false)

  // 错误日志
  const [errorLogs, setErrorLogs] = useState<AIErrorLog[]>([])

  // ==================== 供应商配置（扁平字段） ====================
  const [showErrors, setShowErrors] = useState(false)

  // ==================== 供应商列表管理 ====================
  type ProviderItem = { id: string; name: string; api_base: string; model: string; enabled: boolean; api_key_configured: boolean; active: boolean }
  const [providers, setProviders] = useState<ProviderItem[]>([])
  const [showProviderDialog, setShowProviderDialog] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ProviderItem | null>(null)
  const [providerForm, setProviderForm] = useState({ name: '', api_base: '', api_key: '', model: '' })
  const [providerSaving, setProviderSaving] = useState(false)


  // AutoPilot 切换繁忙态
  const [autoPilotBusy, setAutoPilotBusy] = useState(false)

  // 功能测试
  const [testingSearch, setTestingSearch] = useState(false)
  const [searchTestQuery, setSearchTestQuery] = useState('')
  const [searchTestResult, setSearchTestResult] = useState<AITestResult | null>(null)
  const [testingRecommend, setTestingRecommend] = useState(false)
  const [recommendTestTitle, setRecommendTestTitle] = useState('')
  const [recommendTestGenres, setRecommendTestGenres] = useState('')
  const [recommendTestResult, setRecommendTestResult] = useState<AITestResult | null>(null)

  // ==================== 数据加载 ====================
  const fetchStatus = useCallback(async () => {
    try {
      const res = await aiApi.getStatus()
      const s = res.data.data
      setStatus(s)
      setEditEnabled(s.enabled)
      setEditProvider(s.active_provider || s.provider)
      setEditTimeout(s.timeout || 30)
      setEditSmartSearch(s.enable_smart_search)
      setEditRecommendReason(s.enable_recommend_reason)
      setEditMetadataEnhance(s.enable_metadata_enhance)
      setEditDescribeEnabled(s.describe_enabled ?? false)
      const sc = s.scene_describe_ai || { api_base: '', model: '' }
      setEditDescribeAPIBase(sc.api_base || '')
      setEditDescribeModel(sc.model || '')
      setEditMonthlyBudget(s.monthly_budget)
      setEditCacheTTL(s.cache_ttl_hours || 168)
      setEditMaxConcurrent(s.max_concurrent || 3)
      setEditRequestInterval(s.request_interval_ms || 200)
      // 从 status 中提取供应商列表
      if (s.providers && Array.isArray(s.providers)) {
        setProviders(s.providers)
      }
    } catch {
      // 静默
    }
  }, [])

  const fetchCacheStats = useCallback(async () => {
    try {
      const res = await aiApi.getCacheStats()
      setCacheStats(res.data.data)
    } catch {
      // 静默
    }
  }, [])

  const fetchErrorLogs = useCallback(async () => {
    try {
      const res = await aiApi.getErrorLogs()
      setErrorLogs(res.data.data || [])
    } catch {
      // 静默
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await Promise.all([fetchStatus(), fetchCacheStats(), fetchErrorLogs()])
      setLoading(false)
    }
    load()
  }, [fetchStatus, fetchCacheStats, fetchErrorLogs])

  // ==================== 供应商列表操作 ====================
  const openAddProvider = () => {
    setEditingProvider(null)
    setProviderForm({ name: '', api_base: '', api_key: '', model: '' })
    setShowProviderDialog(true)
  }

  const openEditProvider = (p: ProviderItem) => {
    setEditingProvider(p)
    setProviderForm({ name: p.name, api_base: p.api_base, api_key: '', model: p.model })
    setShowProviderDialog(true)
  }

  const handleSaveProvider = async () => {
    if (!providerForm.name.trim()) {
      toast.error('请填写供应商名称')
      return
    }
    setProviderSaving(true)
    try {
      if (editingProvider) {
        // 更新
        const data: { name?: string; api_base?: string; api_key?: string; model?: string } = {}
        if (providerForm.name.trim()) data.name = providerForm.name.trim()
        if (providerForm.api_base.trim()) data.api_base = providerForm.api_base.trim()
        if (providerForm.api_key.trim()) data.api_key = providerForm.api_key.trim()
        if (providerForm.model.trim()) data.model = providerForm.model.trim()
        await aiApi.updateProvider(editingProvider.id, data)
        toast.success('供应商已更新')
      } else {
        // 新增
        await aiApi.addProvider({
          name: providerForm.name.trim(),
          api_base: providerForm.api_base.trim() || undefined,
          api_key: providerForm.api_key.trim() || undefined,
          model: providerForm.model.trim() || undefined,
        })
        toast.success('供应商已添加')
      }
      setShowProviderDialog(false)
      await fetchStatus()
    } catch {
      toast.error(editingProvider ? '更新失败' : '添加失败')
    } finally {
      setProviderSaving(false)
    }
  }

  const handleDeleteProvider = async (p: ProviderItem) => {
    const ok = await dialog.confirm({
      title: '删除供应商',
      message: `确定删除「${p.name}」？此操作不可撤销。`,
      confirmText: '删除',
      variant: 'warning',
    })
    if (!ok) return
    try {
      await aiApi.deleteProvider(p.id)
      toast.success('供应商已删除')
      await fetchStatus()
    } catch {
      toast.error('删除失败')
    }
  }

  const handleSetProviderActive = async (p: ProviderItem) => {
    try {
      await aiApi.setActive({ provider: p.name, model: p.model || undefined })
      toast.success(`已切换到「${p.name}」`)
      await fetchStatus()
    } catch {
      toast.error('切换失败')
    }
  }

  const handleSaveAdvanced = async () => {
    setSaving(true)
    try {
      await aiApi.updateConfig({
        timeout: editTimeout,
        monthly_budget: editMonthlyBudget,
        cache_ttl_hours: editCacheTTL,
        max_concurrent: editMaxConcurrent,
        request_interval_ms: editRequestInterval,
      })
      toast.success('全局设置已保存')
      await fetchStatus()
    } catch {
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  // ==================== AutoPilot 切换 ====================
  const handleToggleAutoPilot = async (enable: boolean) => {
    if (autoPilotBusy) return
    setAutoPilotBusy(true)
    try {
      if (enable) {
        // 开启时：把当前编辑面板里的 provider+key 一起带上，方便首次开通
        const params: { provider?: string } = {}
        if (editProvider) params.provider = editProvider
        await aiApi.enableAutoPilot(params)
        toast.success('AI 全自动托管模式已开启')
      } else {
        await aiApi.updateConfig({ auto_pilot: false })
        toast.success('AI 全自动托管模式已关闭')
      }
      await fetchStatus()
    } catch {
      toast.error(enable ? '开启托管模式失败' : '关闭托管模式失败')
    } finally {
      setAutoPilotBusy(false)
    }
  }

  // ==================== 缓存管理 ====================
  const handleClearCache = async () => {
    const ok = await dialog.confirm({
      title: '清空 AI 缓存',
      message: '确定清空所有 AI 缓存？清空后下次请求将重新调用 AI API。',
      confirmText: '清空',
      variant: 'warning',
    })
    if (!ok) return
    setClearingCache(true)
    try {
      const res = await aiApi.clearCache()
      toast.success(`已清空 ${res.data.data.cleared} 条缓存`)
      await fetchCacheStats()
    } catch {
      toast.error(t('aiTab.clearCacheFailed'))
    } finally {
      setClearingCache(false)
    }
  }

  // ==================== 功能测试 ====================
  const handleTestSearch = async (query?: string) => {
    const q = query || searchTestQuery
    if (!q.trim()) return
    setTestingSearch(true)
    setSearchTestResult(null)
    if (query) setSearchTestQuery(query)
    try {
      const res = await aiApi.testSmartSearch(q)
      setSearchTestResult(res.data.data)
    } catch {
      toast.error(t('aiTab.searchTestFailed'))
    } finally {
      setTestingSearch(false)
    }
  }

  const handleTestRecommend = async (title?: string, genres?: string) => {
    const titleVal = title || recommendTestTitle
    const g = genres || recommendTestGenres
    if (!titleVal.trim()) return
    setTestingRecommend(true)
    setRecommendTestResult(null)
    if (title) {
      setRecommendTestTitle(title)
      setRecommendTestGenres(genres || '')
    }
    try {
      const res = await aiApi.testRecommendReason(titleVal, g)
      setRecommendTestResult(res.data.data)
    } catch {
      toast.error(t('aiTab.recommendTestFailed'))
    } finally {
      setTestingRecommend(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-neon" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ==================== 状态概览卡片 ==================== */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* 服务状态 */}
        <div className="glass-panel rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            {status?.enabled && status?.api_configured ? (
              <Wifi size={16} className="text-green-400" />
            ) : (
              <WifiOff size={16} className="text-surface-500" />
            )}
            <span className="text-xs font-medium text-theme-muted">
              服务状态
            </span>
          </div>
          <p
            className={clsx(
              'text-sm font-semibold',
              status?.enabled && status?.api_configured ? 'text-green-400' : 'text-surface-500'
            )}
          >
            {status?.enabled ? (status?.api_configured ? '已启用' : '未配置密钥') : '未启用'}
          </p>
        </div>

        {/* 本月调用 */}
        <div className="glass-panel rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 size={16} className="text-neon/60" />
            <span className="text-xs font-medium text-theme-muted">
              本月调用
            </span>
          </div>
          <p className="text-sm font-semibold text-theme-primary">
            {status?.monthly_calls || 0}
            {status?.monthly_budget ? (
              <span className="text-xs font-normal text-surface-500"> / {status.monthly_budget}</span>
            ) : (
              <span className="text-xs font-normal text-surface-500"> 次</span>
            )}
          </p>
        </div>

        {/* Token 消耗 */}
        <div className="glass-panel rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Cpu size={16} className="text-purple-400/60" />
            <span className="text-xs font-medium text-theme-muted">
              Token 消耗
            </span>
          </div>
          <p className="text-sm font-semibold text-theme-primary">
            {((status?.total_tokens || 0) / 1000).toFixed(1)}K
          </p>
        </div>

        {/* 缓存条目 */}
        <div className="glass-panel rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <DatabaseIcon size={16} className="text-cyan-400/60" />
            <span className="text-xs font-medium text-theme-muted">
              缓存条目
            </span>
          </div>
          <p className="text-sm font-semibold text-theme-primary">
            {status?.cache_entries || 0}
          </p>
        </div>
      </div>

      {/* ==================== 🚀 全自动托管模式（AutoPilot）==================== */}
      <section>
        <div
          className="glass-panel rounded-xl p-5 border"
          style={{
            background: status?.auto_pilot
              ? 'linear-gradient(135deg, var(--neon-blue-10), transparent 60%)'
              : undefined,
            borderColor: status?.auto_pilot ? 'var(--neon-blue-30, rgba(56,189,248,0.3))' : 'transparent',
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'var(--neon-blue-10)' }}
              >
                <Rocket size={22} className="text-neon" />
              </div>
              <div className="min-w-0">
                <p className="text-base font-semibold text-theme-primary flex items-center gap-2">
                  全自动托管模式
                  {status?.auto_pilot && (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-neon/10 text-neon">
                      Active
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-theme-muted leading-relaxed">
                  新增媒体库自动执行：<span className="text-theme-secondary">AI 识别 → 归类 → 命名 → 元数据刮削 → AI 兜底</span>，
                  仅写数据库不改原文件，强制云端 LLM。
                </p>
              </div>
            </div>
            <button
              onClick={() => handleToggleAutoPilot(!status?.auto_pilot)}
              disabled={autoPilotBusy}
              className="toggle-switch toggle-switch-lg"
              role="switch"
              aria-checked={!!status?.auto_pilot}
              aria-label="全自动托管模式"
            >
              <span className="toggle-switch-thumb" />
            </button>
          </div>
          {!status?.api_configured && (
            <div className="mt-3 flex items-center gap-2 text-xs text-yellow-400">
              <AlertTriangle size={14} />
              请先在下方填写并保存 API Key，托管模式才能生效
            </div>
          )}
          {status?.auto_pilot && status?.api_configured && (
            <div className="mt-3 flex items-center gap-2 text-xs text-green-400">
              <Check size={14} />
              托管模式已生效：后续扫描入库的文件将自动调用 {status.provider} / {status.model}
            </div>
          )}
        </div>
      </section>

      {/* ==================== AI 功能开关（高频操作，前置） ==================== */}
      <section>
        <h2
          className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-wide text-theme-primary"
        >
          <Power size={20} className="text-neon/60" />
          AI 功能
        </h2>

        <div className="glass-panel rounded-xl p-5 space-y-4">
          {/* 总开关 */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                style={{ background: editEnabled ? 'var(--neon-blue-10)' : 'var(--nav-hover-bg)' }}
              >
                <Power size={18} className={editEnabled ? 'text-neon' : 'text-surface-500'} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-theme-primary">
                  启用 AI 功能
                </p>
                <p className="text-xs text-theme-muted">
                  全局开关，关闭后所有 AI 功能将停用
                </p>
              </div>
            </div>
            <button
              onClick={() => setEditEnabled(!editEnabled)}
              className="toggle-switch toggle-switch-lg shrink-0"
              role="switch"
              aria-checked={editEnabled}
              aria-label="启用 AI 功能"
            >
              <span className="toggle-switch-thumb" />
            </button>
          </div>

          {/* 子功能开关卡片（2 列网格，一眼掌握） */}
          <div className={clsx('grid grid-cols-1 gap-2 sm:grid-cols-2 transition-opacity', !editEnabled && 'opacity-50')}>
            {[
              {
                key: 'search',
                label: '智能搜索',
                desc: '自然语言 → 结构化查询参数',
                icon: Search,
                value: editSmartSearch,
                setter: setEditSmartSearch,
              },
              {
                key: 'recommend',
                label: '推荐理由',
                desc: 'AI 生成个性化推荐文案',
                icon: MessageSquare,
                value: editRecommendReason,
                setter: setEditRecommendReason,
              },
              {
                key: 'metadata',
                label: '元数据增强',
                desc: '传统数据源失败时用 AI 补充',
                icon: Sparkles,
                value: editMetadataEnhance,
                setter: setEditMetadataEnhance,
              },
              {
                key: 'describe',
                label: '场景描述',
                desc: '视频场景检测后自动生成文字描述',
                icon: Film,
                value: editDescribeEnabled,
                setter: setEditDescribeEnabled,
              },
            ].map((item) => {
              const Icon = item.icon
              return (
                <div
                  key={item.key}
                  className="flex items-center justify-between gap-2 rounded-lg p-3"
                  style={{ background: 'var(--nav-hover-bg)' }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon size={16} className="text-neon/50 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-theme-primary">{item.label}</p>
                      <p className="text-xs text-theme-muted truncate">{item.desc}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => item.setter(!item.value)}
                    className="toggle-switch toggle-switch-sm shrink-0"
                    role="switch"
                    aria-checked={item.value}
                    aria-label={item.label}
                  >
                    <span className="toggle-switch-thumb" />
                  </button>
                </div>
              )
            })}
          </div>

          {/* 场景描述视觉模型配置（仅在启用场景描述时显示） */}
          {editDescribeEnabled && (
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}>
              <button
                onClick={() => setShowDescribe(!showDescribe)}
                className="flex w-full items-center justify-between text-sm font-medium text-theme-secondary transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Film size={14} className="text-violet-400/60" />
                  视觉模型配置
                </span>
                {showDescribe ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              <p className="mt-1 text-xs text-theme-muted">
                场景描述需要视觉模型（如 minicpm-v、gpt-4o-vision），与文字 LLM 分开配置。
              </p>

              {showDescribe && (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-theme-secondary">
                      API 地址
                    </label>
                    <input
                      type="text"
                      value={editDescribeAPIBase}
                      onChange={(e) => setEditDescribeAPIBase(e.target.value)}
                      className="input font-mono text-sm"
                      placeholder="http://10.144.144.232:31536/v1"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-theme-secondary">
                      API 密钥
                    </label>
                    <div className="relative">
                      <input
                        type={showDescribeAPIKey ? 'text' : 'password'}
                        value={editDescribeAPIKey}
                        onChange={(e) => setEditDescribeAPIKey(e.target.value)}
                        className="input pr-10 font-mono text-sm"
                        placeholder="sk-..."
                      />
                      <button
                        onClick={() => setShowDescribeAPIKey(!showDescribeAPIKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300 transition-colors"
                      >
                        {showDescribeAPIKey ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-theme-secondary">
                      模型名称
                    </label>
                    <input
                      type="text"
                      value={editDescribeModel}
                      onChange={(e) => setEditDescribeModel(e.target.value)}
                      className="input font-mono text-sm"
                      placeholder="minicpm-v:latest"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ==================== 供应商列表 ==================== */}
      <section>
        <h2
          className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-wide text-theme-primary"
        >
          <Settings size={20} className="text-neon/60" />
          供应商列表
        </h2>

        <div className="glass-panel rounded-xl p-5 space-y-3">
          {/* 供应商行 */}
          {providers.length === 0 ? (
            <div className="py-6 text-center text-sm text-theme-muted">
              暂无供应商，请点击下方按钮新增
            </div>
          ) : (
            providers.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 transition-colors"
                style={{
                  border: p.active ? '1px solid var(--neon-blue)' : '1px solid var(--border-subtle)',
                  background: p.active ? 'var(--neon-blue-10)' : 'var(--bg-surface)',
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={clsx(
                      'h-2.5 w-2.5 rounded-full shrink-0',
                      p.active ? 'bg-green-400' : 'bg-surface-500'
                    )}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-theme-primary truncate">{p.name}</span>
                      {p.active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium text-neon"
                          style={{ background: 'var(--neon-blue-10)' }}>
                          激活中
                        </span>
                      )}
                      {!p.enabled && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium text-surface-500"
                          style={{ background: 'var(--nav-hover-bg)' }}>
                          已禁用
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-theme-muted truncate mt-0.5">
                      {p.model || '未配置模型'} · {p.api_base || '默认 API'}
                      {!p.api_key_configured && ' · ⚠️ 未配置密钥'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!p.active && (
                    <button
                      onClick={() => handleSetProviderActive(p)}
                      className="btn-ghost gap-1 px-2.5 py-1 text-xs text-neon hover:text-neon"
                    >
                      <Play size={12} />
                      启用
                    </button>
                  )}
                  <button
                    onClick={() => openEditProvider(p)}
                    className="btn-ghost gap-1 px-2.5 py-1 text-xs"
                  >
                    <Pencil size={12} />
                    设置
                  </button>
                  <button
                    onClick={() => handleDeleteProvider(p)}
                    className="btn-ghost gap-1 px-2.5 py-1 text-xs text-red-400 hover:text-red-300"
                  >
                    <Trash2 size={12} />
                    删除
                  </button>
                </div>
              </div>
            ))
          )}

          {/* 新增供应商按钮 */}
          <button
            onClick={openAddProvider}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-3 text-sm text-theme-secondary transition-colors hover:text-neon"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <Plus size={16} />
            新增供应商
          </button>
        </div>
      </section>

      {/* ==================== 新增/编辑供应商弹窗 ==================== */}
      {showProviderDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-panel rounded-2xl w-full max-w-md mx-4 p-6 space-y-4" style={{ background: 'var(--bg-card)' }}>
            <h3 className="text-lg font-semibold text-theme-primary">
              {editingProvider ? '编辑供应商' : '新增供应商'}
            </h3>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-theme-secondary">
                  名称 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={providerForm.name}
                  onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
                  className="input w-full"
                  placeholder="例如：DeepSeek / OpenAI"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-theme-secondary">API Base</label>
                <input
                  type="text"
                  value={providerForm.api_base}
                  onChange={(e) => setProviderForm({ ...providerForm, api_base: e.target.value })}
                  className="input w-full font-mono text-sm"
                  placeholder="https://api.deepseek.com/v1"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-theme-secondary">API Key</label>
                <input
                  type="password"
                  value={providerForm.api_key}
                  onChange={(e) => setProviderForm({ ...providerForm, api_key: e.target.value })}
                  className="input w-full font-mono text-sm"
                  placeholder={editingProvider?.api_key_configured ? '已配置（留空不改）' : 'sk-...'}
                />
                {editingProvider?.api_key_configured && !providerForm.api_key && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-green-400">
                    <Check size={12} /> 密钥已配置（留空不会清除）
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-theme-secondary">默认模型</label>
                <input
                  type="text"
                  value={providerForm.model}
                  onChange={(e) => setProviderForm({ ...providerForm, model: e.target.value })}
                  className="input w-full font-mono text-sm"
                  placeholder="deepseek-chat / gpt-4o"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowProviderDialog(false)}
                className="btn-ghost px-4 py-2 text-sm"
              >
                取消
              </button>
              <button
                onClick={handleSaveProvider}
                disabled={providerSaving || !providerForm.name.trim()}
                className="btn-primary gap-1.5 px-5 py-2 text-sm"
              >
                {providerSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 全局设置 ==================== */}
      <section>
        <h2
          className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-wide text-theme-primary"
        >
          <Settings size={20} className="text-neon/60" />
          全局设置
        </h2>

        <div className="glass-panel rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-theme-muted">请求超时（秒）</label>
              <input type="number" value={editTimeout} onChange={(e) => setEditTimeout(Number(e.target.value))}
                className="input text-sm" min={5} max={120} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-theme-muted">月度预算上限（0=不限）</label>
              <input type="number" value={editMonthlyBudget} onChange={(e) => setEditMonthlyBudget(Number(e.target.value))}
                className="input text-sm" min={0} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-theme-muted">缓存时长（小时）</label>
              <input type="number" value={editCacheTTL} onChange={(e) => setEditCacheTTL(Number(e.target.value))}
                className="input text-sm" min={0} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-theme-muted">最大并发数</label>
              <input type="number" value={editMaxConcurrent} onChange={(e) => setEditMaxConcurrent(Number(e.target.value))}
                className="input text-sm" min={1} max={10} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-theme-muted">请求间隔（毫秒）</label>
              <input type="number" value={editRequestInterval} onChange={(e) => setEditRequestInterval(Number(e.target.value))}
                className="input text-sm" min={0} />
            </div>
          </div>
          <button
            onClick={handleSaveAdvanced}
            disabled={saving}
            className="btn-primary gap-1.5 px-4 py-1.5 text-xs"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            保存设置
          </button>
        </div>
      </section>

      {/* ==================== 使用统计 ==================== */}
      <section>
        <h2
          className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-wide text-theme-primary"
        >
          <BarChart3 size={20} className="text-neon/60" />
          使用统计
        </h2>

        <div className="glass-panel rounded-xl p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="text-center">
              <p className="text-2xl font-bold text-neon">{status?.monthly_calls || 0}</p>
              <p className="mt-1 text-xs text-theme-muted">
                本月请求次数
              </p>
              {status?.monthly_budget ? (
                <div className="mt-2">
                  <div className="h-1.5 w-full rounded-full" style={{ background: 'var(--progress-track-bg)' }}>
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{
                        background: 'var(--neon-blue)',
                        width: `${Math.min(100, ((status.monthly_calls || 0) / status.monthly_budget) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-surface-500">
                    {Math.round(((status.monthly_calls || 0) / status.monthly_budget) * 100)}% 已用
                  </p>
                </div>
              ) : null}
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-theme-primary">
                {((status?.total_prompt_tokens || 0) / 1000).toFixed(1)}K
              </p>
              <p className="mt-1 text-xs text-theme-muted">
                输入 Token
              </p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-theme-primary">
                {((status?.total_completion_tokens || 0) / 1000).toFixed(1)}K
              </p>
              <p className="mt-1 text-xs text-theme-muted">
                输出 Token
              </p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-purple-400">
                ${(((status?.total_tokens || 0) / 1000000) * 0.15).toFixed(4)}
              </p>
              <p className="mt-1 text-xs text-theme-muted">
                费用估算 (gpt-4o-mini)
              </p>
            </div>
          </div>

          {/* 配额预警 */}
          {status?.monthly_budget && status.monthly_calls >= status.monthly_budget * 0.8 ? (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-yellow-500/10 px-4 py-2.5 text-sm text-yellow-400">
              <AlertTriangle size={16} />
              {status.monthly_calls >= status.monthly_budget
                ? '月度配额已用尽，AI 功能暂停'
                : `月度配额已使用 ${Math.round((status.monthly_calls / status.monthly_budget) * 100)}%，请注意用量`}
            </div>
          ) : null}
        </div>
      </section>

      {/* ==================== 缓存管理 ==================== */}
      <section>
        <h2
          className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-wide text-theme-primary"
        >
          <DatabaseIcon size={20} className="text-neon/60" />
          缓存管理
        </h2>

        <div className="glass-panel rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div>
                <p className="text-sm font-medium text-theme-primary">
                  {cacheStats?.active_entries || 0} 条有效缓存
                </p>
                <p className="text-xs text-theme-muted">
                  共 {cacheStats?.total_entries || 0} 条 · {cacheStats?.expired_entries || 0} 条已过期 · TTL{' '}
                  {cacheStats?.ttl_hours || 0}h
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchCacheStats()}
                className="btn-ghost gap-1 px-3 py-1.5 text-xs"
              >
                <RefreshCw size={12} />
                刷新
              </button>
              <button
                onClick={handleClearCache}
                disabled={clearingCache || !cacheStats?.total_entries}
                className="btn-ghost gap-1 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
              >
                {clearingCache ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                清空缓存
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== 功能测试 ==================== */}
      <section>
        <h2
          className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-wide text-theme-primary"
        >
          <Play size={20} className="text-neon/60" />
          功能测试
        </h2>

        <div className="space-y-4">
          {/* 智能搜索测试 */}
          <div className="glass-panel rounded-xl p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-theme-primary">
              <Search size={16} className="text-neon/60" />
              智能搜索测试
            </h3>

            <div className="flex gap-2">
              <input
                type="text"
                value={searchTestQuery}
                onChange={(e) => setSearchTestQuery(e.target.value)}
                className="input flex-1 text-sm"
                placeholder="输入自然语言查询..."
                onKeyDown={(e) => e.key === 'Enter' && handleTestSearch()}
              />
              <button
                onClick={() => handleTestSearch()}
                disabled={testingSearch || !searchTestQuery.trim()}
                className="btn-primary gap-1.5 px-4 py-2 text-sm whitespace-nowrap"
              >
                {testingSearch ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                测试
              </button>
            </div>

            {/* 预设用例 */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SEARCH_TEST_CASES.map((tc) => (
                <button
                  key={tc}
                  onClick={() => handleTestSearch(tc)}
                  disabled={testingSearch}
                  className="rounded-md px-2 py-1 text-[11px] transition-colors hover:bg-white/[0.05]"
                  style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
                >
                  {tc}
                </button>
              ))}
            </div>

            {/* 搜索测试结果 */}
            {searchTestResult && (
              <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--nav-hover-bg)' }}>
                <div className="flex items-center gap-2 mb-2">
                  {searchTestResult.success ? (
                    <Check size={14} className="text-green-400" />
                  ) : (
                    <X size={14} className="text-red-400" />
                  )}
                  <span className="text-xs text-surface-400">
                    {searchTestResult.latency_ms}ms
                  </span>
                </div>
                {searchTestResult.intent && (
                  <pre className="text-xs font-mono text-surface-300 overflow-x-auto">
                    {JSON.stringify(searchTestResult.intent, null, 2)}
                  </pre>
                )}
                {searchTestResult.error && (
                  <p className="text-xs text-red-400">{searchTestResult.error}</p>
                )}
              </div>
            )}
          </div>

          {/* 推荐理由测试 */}
          <div className="glass-panel rounded-xl p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-theme-primary">
              <MessageSquare size={16} className="text-neon/60" />
              推荐理由测试
            </h3>

            <div className="flex gap-2">
              <input
                type="text"
                value={recommendTestTitle}
                onChange={(e) => setRecommendTestTitle(e.target.value)}
                className="input flex-1 text-sm"
                placeholder="影片名称"
              />
              <input
                type="text"
                value={recommendTestGenres}
                onChange={(e) => setRecommendTestGenres(e.target.value)}
                className="input w-40 text-sm"
                placeholder="类型（逗号分隔）"
              />
              <button
                onClick={() => handleTestRecommend()}
                disabled={testingRecommend || !recommendTestTitle.trim()}
                className="btn-primary gap-1.5 px-4 py-2 text-sm whitespace-nowrap"
              >
                {testingRecommend ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                测试
              </button>
            </div>

            {/* 预设用例 */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {RECOMMEND_TEST_CASES.map((tc) => (
                <button
                  key={tc.title}
                  onClick={() => handleTestRecommend(tc.title, tc.genres)}
                  disabled={testingRecommend}
                  className="rounded-md px-2 py-1 text-[11px] transition-colors hover:bg-white/[0.05]"
                  style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
                >
                  {tc.title}
                </button>
              ))}
            </div>

            {/* 推荐理由测试结果 */}
            {recommendTestResult && (
              <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--nav-hover-bg)' }}>
                <div className="flex items-center gap-2 mb-2">
                  {recommendTestResult.success ? (
                    <Check size={14} className="text-green-400" />
                  ) : (
                    <X size={14} className="text-red-400" />
                  )}
                  <span className="text-xs text-surface-400">
                    {recommendTestResult.latency_ms}ms
                  </span>
                </div>
                {recommendTestResult.reason && (
                  <p className="text-sm text-theme-primary">
                    💡 {recommendTestResult.reason}
                  </p>
                )}
                {recommendTestResult.error && (
                  <p className="text-xs text-red-400">{recommendTestResult.error}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ==================== 错误日志 ==================== */}
      <section>
        <button
          onClick={() => {
            setShowErrors(!showErrors)
            if (!showErrors) fetchErrorLogs()
          }}
          className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-wide transition-colors text-theme-primary"
        >
          <AlertTriangle size={20} className="text-neon/60" />
          错误日志
          {errorLogs.length > 0 && (
            <span className="ml-1 rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
              {errorLogs.length}
            </span>
          )}
          {showErrors ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {showErrors && (
          <div className="glass-panel rounded-xl overflow-hidden">
            {errorLogs.length === 0 ? (
              <div className="py-8 text-center">
                <Check size={24} className="mx-auto mb-2 text-green-400" />
                <p className="text-sm text-theme-muted">
                  暂无错误记录
                </p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                {errorLogs.map((log, i) => (
                  <div key={i} className="flex items-start gap-3 px-5 py-3">
                    <X size={14} className="mt-0.5 text-red-400 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-mono text-red-400">
                          {log.action}
                        </span>
                        <span className="text-[10px] text-surface-500">
                          <Clock size={10} className="inline mr-0.5" />
                          {log.time}
                        </span>
                        <span className="text-[10px] text-surface-500">{log.latency_ms}ms</span>
                      </div>
                      <p className="mt-1 text-xs text-surface-400 break-all">{log.error}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ==================== 权限说明 ==================== */}
      <section className="rounded-xl p-4" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)' }}>
        <div className="flex items-start gap-3">
          <Shield size={16} className="mt-0.5 text-neon/50 flex-shrink-0" />
          <div>
            <p className="text-xs font-medium text-theme-secondary">
              权限说明
            </p>
            <p className="mt-1 text-xs text-theme-muted">
              AI 配置仅管理员可修改。所有配置变更将实时生效，API 密钥以加密方式存储。
              AI 功能调用不会上传任何用户隐私数据，仅发送影片标题和类型等公开信息。
            </p>
          </div>
        </div>
      </section>

    </div>
  )
}
