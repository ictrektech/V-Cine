import { useState, useEffect, useCallback } from 'react'
import { aiApi } from '@/api'
import { useToast } from '@/components/Toast'
import { useDialog } from '@/components/Dialog'
import { Modal } from '@/components/ui/modal'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n'
import { extractErrMsg } from '@/utils/error'
import type { AIStatus, AIErrorLog, AICacheStats, AITestResult } from '@/types'
import {
  Sparkles,
  Power,
  Eye,
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
  Activity,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Wifi,
  WifiOff,
  Rocket,
  Plus,
  Pencil,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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

// ==================== 分组导航定义（左栏点击点） ====================
type AISectionKey = 'overview' | 'providers' | 'advanced' | 'ops'

const AI_SECTIONS: { key: AISectionKey; label: string; icon: LucideIcon }[] = [
  { key: 'overview', label: '概览与托管', icon: Power },
  { key: 'providers', label: 'AI 提供商', icon: Settings },
  { key: 'advanced', label: '高级设置', icon: Shield },
  { key: 'ops', label: '运维诊断', icon: Activity },
]

export default function AITab() {
  const toast = useToast()
  const dialog = useDialog()
  const { t } = useTranslation()

  // ==================== 状态 ====================
  const [status, setStatus] = useState<AIStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingFeatures, setSavingFeatures] = useState(false)

  // 配置编辑
  const [editEnabled, setEditEnabled] = useState(false)
  const [editProvider, setEditProvider] = useState('openai')
  const [editTimeout, setEditTimeout] = useState(30)
  const [editSmartSearch, setEditSmartSearch] = useState(true)
  const [editRecommendReason, setEditRecommendReason] = useState(true)
  const [editMetadataEnhance, setEditMetadataEnhance] = useState(true)
  const [editMonthlyBudget, setEditMonthlyBudget] = useState(0)
  const [editCacheTTL, setEditCacheTTL] = useState(168)
  const [editMaxConcurrent, setEditMaxConcurrent] = useState(3)
  const [editRequestInterval, setEditRequestInterval] = useState(200)

  // 数据脱敏
  const [editDesensitize, setEditDesensitize] = useState(false)
  const [editDesensitizeURL, setEditDesensitizeURL] = useState('')
  const [editDesensitizeTimeout, setEditDesensitizeTimeout] = useState(3)
  const [editDesensitizeNER, setEditDesensitizeNER] = useState(false)
  const [editDesensitizeImageEnabled, setEditDesensitizeImageEnabled] = useState(false)
  const [editDesensitizeImageTimeout, setEditDesensitizeImageTimeout] = useState(30)
  const [editDesensitizeImageScopes, setEditDesensitizeImageScopes] = useState<string[]>(['embedding'])
  const [dsTest, setDsTest] = useState<{ testing: boolean; success: boolean | null; message: string }>({
    testing: false, success: null, message: '',
  })

  // 缓存
  const [cacheStats, setCacheStats] = useState<AICacheStats | null>(null)
  const [clearingCache, setClearingCache] = useState(false)

  // 错误日志
  const [errorLogs, setErrorLogs] = useState<AIErrorLog[]>([])

  // ==================== 供应商配置（扁平字段） ====================
  const [showErrors, setShowErrors] = useState(false)

  // 当前分组（左栏导航）
  const [section, setSection] = useState<AISectionKey>('overview')

  // ==================== 供应商列表管理 ====================
  type ModelItem = { name: string; is_vision: boolean; is_default: boolean }
  type ProviderItem = { id: string; name: string; api_base: string; models: ModelItem[]; enabled: boolean; api_key_configured: boolean; is_gateway: boolean; active: boolean }
  const [providers, setProviders] = useState<ProviderItem[]>([])
  const [showProviderDialog, setShowProviderDialog] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ProviderItem | null>(null)
  const [providerForm, setProviderForm] = useState<{ name: string; api_base: string; api_key: string; models: ModelItem[] }>({ name: '', api_base: '', api_key: '', models: [] })
  const [providerSaving, setProviderSaving] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null)
  const [fetchedSelected, setFetchedSelected] = useState<Set<string>>(new Set())
  const [fetchedSearch, setFetchedSearch] = useState('')
  // 测试连接状态：key = provider id，value = { testing, success, message }
  const [connTests, setConnTests] = useState<Record<string, { testing: boolean; success: boolean; message: string }>>({})


  // AutoPilot 切换繁忙态
  const [autoPilotBusy, setAutoPilotBusy] = useState(false)
  const [showAutoPilotWarning, setShowAutoPilotWarning] = useState(false)
  const [autoPilotCountdown, setAutoPilotCountdown] = useState(3)

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
      setEditProvider(s.active_provider)
      setEditTimeout(s.timeout || 30)
      setEditSmartSearch(s.enable_smart_search)
      setEditRecommendReason(s.enable_recommend_reason)
      setEditMetadataEnhance(s.enable_metadata_enhance)
      setEditMonthlyBudget(s.monthly_budget)
      setEditCacheTTL(s.cache_ttl_hours || 168)
      setEditMaxConcurrent(s.max_concurrent || 3)
      setEditRequestInterval(s.request_interval_ms || 200)
      // 数据脱敏
      const ds = s.desensitize || { enabled: false, base_url: '', timeout: 3, ner: false } as NonNullable<typeof s.desensitize>
      setEditDesensitize(ds.enabled)
      setEditDesensitizeURL(ds.base_url || '')
      setEditDesensitizeTimeout(ds.timeout || 3)
      setEditDesensitizeNER(ds.ner || false)
      setEditDesensitizeImageEnabled((ds as { image_enabled?: boolean }).image_enabled || false)
      setEditDesensitizeImageTimeout((ds as { image_timeout?: number }).image_timeout || 30)
      {
        const scopes = (ds as { image_scopes?: string[] }).image_scopes
        setEditDesensitizeImageScopes(Array.isArray(scopes) ? scopes : ['embedding'])
      }
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

  useEffect(() => {
    if (!showAutoPilotWarning || autoPilotCountdown <= 0) return
    const timer = setTimeout(() => setAutoPilotCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [showAutoPilotWarning, autoPilotCountdown])

  // ==================== 供应商列表操作 ====================
  const openAddProvider = () => {
    setEditingProvider(null)
    setProviderForm({ name: '', api_base: '', api_key: '', models: [] })
    resetFetchedModels()
    setShowProviderDialog(true)
  }

  const openEditProvider = (p: ProviderItem) => {
    setEditingProvider(p)
    setProviderForm({ name: p.name, api_base: p.api_base, api_key: '', models: [...p.models] })
    resetFetchedModels()
    setShowProviderDialog(true)
  }

  const resetFetchedModels = () => {
    setFetchedModels(null)
    setFetchedSelected(new Set())
    setFetchedSearch('')
  }

  // 网关判定：后端下发 is_gateway（config.IsVRouterGateway 唯一特征表），
  // 前端不再自行猜测。弹窗内表单用编辑对象的 is_gateway。
  const isBuiltInVRouter = editingProvider?.id === 'vrouter'
  const isGatewayForm = (): boolean => !!editingProvider?.is_gateway

  const handleFetchModels = async () => {
    if (!providerForm.api_base.trim()) {
      toast.error('请先填写 API Base')
      return
    }
    setFetchingModels(true)
    try {
      const res = await aiApi.fetchModels({
        base_url: providerForm.api_base.trim(),
        api_key: providerForm.api_key.trim() || undefined,
        provider_id: editingProvider?.id,
      })
      const names = (res.data.data || []).filter((n) => n.trim())
      if (names.length === 0) {
        toast.error('未获取到模型，请检查 API 地址与密钥')
        return
      }
      setFetchedModels(names)
      // 默认不勾选，由用户自行选择
      setFetchedSelected(new Set())
      toast.success(`已获取 ${names.length} 个模型，请勾选添加`)
    } catch (e) {
      toast.error(extractErrMsg(e) || '获取模型失败，请检查 API 地址与密钥')
    } finally {
      setFetchingModels(false)
    }
  }

  // 将勾选的模型追加到列表（仅在勾选面板内触发，fetchedModels 必非空）
  const confirmAddFetchedModels = () => {
    const picked = fetchedModels!.filter((n) => fetchedSelected.has(n))
    setProviderForm({
      ...providerForm,
      models: [
        ...providerForm.models,
        ...picked.map((name, i) => ({ name, is_vision: false, is_default: providerForm.models.length === 0 && i === 0 })),
      ],
    })
    resetFetchedModels()
    toast.success(`已添加 ${picked.length} 个模型`)
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
        const data: { name: string; api_base?: string; api_key?: string; models?: ModelItem[] } = {
          name: providerForm.name.trim(),
          models: providerForm.models,
        }
        if (providerForm.api_base.trim()) data.api_base = providerForm.api_base.trim()
        if (providerForm.api_key.trim()) data.api_key = providerForm.api_key.trim()
        await aiApi.updateProvider(editingProvider.id, data)
        toast.success('供应商已更新')
      } else {
        // 新增
        await aiApi.addProvider({
          name: providerForm.name.trim(),
          api_base: providerForm.api_base.trim() || undefined,
          api_key: providerForm.api_key.trim() || undefined,
          models: providerForm.models.length > 0 ? providerForm.models : undefined,
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
      // 优先用 is_default 标记的模型，否则取第一个
      const defaultModel = p.models.find(m => m.is_default)?.name || p.models[0]?.name
      await aiApi.setActive({ provider: p.id, model: defaultModel })
      toast.success(`已切换到「${p.name}」`)
      await fetchStatus()
    } catch {
      toast.error('切换失败')
    }
  }

  const handleTestConnection = async (p: ProviderItem) => {
    setConnTests(prev => ({ ...prev, [p.id]: { testing: true, success: false, message: '' } }))
    try {
      const res = await aiApi.testConnection(p.id)
      const data = res.data?.data
      if (data?.success) {
        setConnTests(prev => ({ ...prev, [p.id]: { testing: false, success: true, message: `连接成功 · ${data.latency_ms}ms` } }))
      } else {
        setConnTests(prev => ({ ...prev, [p.id]: { testing: false, success: false, message: data?.error || '连接失败' } }))
      }
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'response' in e
        ? (e as { response?: { data?: { error?: string } } }).response?.data?.error || '请求失败'
        : '请求失败'
      setConnTests(prev => ({ ...prev, [p.id]: { testing: false, success: false, message: msg } }))
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
        desensitize: {
          enabled: editDesensitize,
          base_url: editDesensitizeURL,
          timeout: editDesensitizeTimeout,
          ner: editDesensitizeNER,
          image_enabled: editDesensitizeImageEnabled,
          image_timeout: editDesensitizeImageTimeout,
          image_scopes: editDesensitizeImageScopes,
        },
      })
      toast.success('全局设置已保存')
      await fetchStatus()
    } catch {
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveFeatures = async () => {
    setSavingFeatures(true)
    try {
      await aiApi.updateConfig({
        enabled: editEnabled,
        enable_smart_search: editSmartSearch,
        enable_recommend_reason: editRecommendReason,
        enable_metadata_enhance: editMetadataEnhance,
      })
      toast.success('AI 功能已保存')
      await fetchStatus()
    } catch (e) {
      toast.error(extractErrMsg(e) || '保存 AI 功能失败')
    } finally {
      setSavingFeatures(false)
    }
  }

  // ==================== 数据脱敏测试 ====================
  const handleTestDesensitize = async () => {
    setDsTest({ testing: true, success: null, message: '' })
    try {
      const res = await aiApi.testDesensitize()
      const d = res.data.data
      if (d.success) {
        setDsTest({ testing: false, success: true, message: `服务正常 · ${d.latency_ms}ms` })
      } else {
        setDsTest({ testing: false, success: false, message: d.error || '测试失败' })
      }
    } catch {
      setDsTest({ testing: false, success: false, message: '无法连接测试服务' })
    }
  }

  // ==================== AutoPilot 切换 ====================
  const performToggleAutoPilot = async (enable: boolean) => {
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

  const handleToggleAutoPilot = async (enable: boolean) => {
    if (autoPilotBusy) return
    if (enable) {
      setShowAutoPilotWarning(true)
      setAutoPilotCountdown(3)
      return
    }
    await performToggleAutoPilot(false)
  }

  const confirmEnableAutoPilot = async () => {
    setShowAutoPilotWarning(false)
    setAutoPilotCountdown(3)
    await performToggleAutoPilot(true)
  }

  const cancelAutoPilotWarning = () => {
    setShowAutoPilotWarning(false)
    setAutoPilotCountdown(3)
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
      {/* 左右结构：左 = 分组导航（桌面纵排 sticky，右侧分界线 / 移动端横滑，底部分界线），右 = 当前分组内容 */}
      <div className="flex flex-col gap-4 lg:flex-row lg:gap-0">
      <div
        className="shrink-0 border-b lg:w-44 lg:border-b-0 lg:border-r"
        style={{ borderColor: 'var(--border-default)' }}
      >
      <nav
        aria-label="AI 服务分组"
        className="flex gap-1 overflow-x-auto pb-3 lg:sticky lg:top-0 lg:flex-col lg:gap-0.5 lg:overflow-x-visible lg:py-1 lg:pr-3"
      >
        {AI_SECTIONS.map((s) => {
          const Icon = s.icon
          const active = section === s.key
          return (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              aria-current={active || undefined}
              className={clsx(
                'flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium outline-none',
                'transition-[color,background-color] duration-200',
                'focus-visible:ring-2 focus-visible:ring-neon/40',
                active
                  ? 'bg-[var(--neon-blue-10)] text-[var(--neon-blue)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--nav-hover-bg)] hover:text-[var(--text-primary)]'
              )}
            >
              <Icon size={15} className="shrink-0" />
              <span>{s.label}</span>
              {active && <ChevronRight size={14} className="ml-auto hidden lg:block" />}
            </button>
          )
        })}
      </nav>
      </div>

      <div className="min-w-0 flex-1 space-y-6 lg:pl-6">
        {section === 'overview' && (
        <>
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
            {status?.enabled ? (status?.api_configured ? '已启用' : '未配置') : '未启用'}
          </p>
          {status?.enabled && status?.api_configured && !status?.active_model && (
            <p className="mt-1 flex items-center gap-1 text-xs text-yellow-400">
              <AlertTriangle size={12} /> 未选择模型，请到下方供应商设置中拉取
            </p> 
          )}
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
                  仅写数据库不改原文件，建议使用能力较强的模型以保证自动刮削质量。
                </p>
              </div>
            </div>
            <Switch
              checked={!!status?.auto_pilot}
              onCheckedChange={handleToggleAutoPilot}
              disabled={autoPilotBusy}
              aria-label="全自动托管模式"
            />
          </div>
          {!status?.api_configured && (
            <div className="mt-3 flex items-center gap-2 text-xs text-yellow-400">
              <AlertTriangle size={14} />
              请先在下方完成供应商配置并启用，托管模式才能生效
            </div>
          )}
          {status?.auto_pilot && status?.api_configured && !status?.active_model && (
            <div className="mt-3 flex items-center gap-2 text-xs text-yellow-400">
              <AlertTriangle size={14} />
              未选择模型，托管任务将无法调用 AI，请到下方供应商设置中拉取模型
            </div>
          )}
          {status?.auto_pilot && status?.api_configured && status?.active_model && (
            <div className="mt-3 flex items-center gap-2 text-xs text-green-400">
              <Check size={14} />
              托管模式已生效：后续扫描入库的文件将自动调用 {status.active_provider} / {status.active_model}
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
            <Switch
              checked={editEnabled}
              onCheckedChange={setEditEnabled}
              aria-label="启用 AI 功能"
            />
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
                  <Switch
                    checked={item.value}
                    onCheckedChange={item.setter}
                    aria-label={item.label}
                  />
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-end gap-2 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
            <button onClick={handleSaveFeatures} disabled={savingFeatures} className="btn-primary gap-1.5 px-4 py-1.5 text-xs disabled:opacity-50">
              {savingFeatures ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check size={14} />}
              保存 AI 功能
            </button>
          </div>
        </div>
      </section>

        </>
        )}
        {section === 'providers' && (
        <>
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
                      {p.id === 'vrouter' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium text-neon"
                          style={{ background: 'var(--nav-hover-bg)' }}>
                          内置
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
                      {p.models.length > 0
                        ? p.models.map(m => `${m.name}${m.is_default ? '(默认)' : ''}${m.is_vision ? '👁' : ''}`).join(', ')
                        : '未配置模型，请点击「设置」拉取模型'}
                      {' · '}{p.api_base || '默认 API'}
                      {p.is_gateway ? ' · 内网免鉴权' : ''}
                    </p>
                    {connTests[p.id] && !connTests[p.id].testing && (
                      <p className={`text-xs mt-0.5 ${connTests[p.id].success ? 'text-green-400' : 'text-red-400'}`}>
                        {connTests[p.id].success ? '✓ ' : '✗ '}{connTests[p.id].message}
                      </p>
                    )}
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
                    onClick={() => handleTestConnection(p)}
                    disabled={connTests[p.id]?.testing}
                    className="btn-ghost gap-1 px-2.5 py-1 text-xs text-green-400 hover:text-green-300 disabled:opacity-50"
                  >
                    {connTests[p.id]?.testing ? (
                      <><Loader2 size={12} className="animate-spin" /> 测试中</>
                    ) : (
                      <><Wifi size={12} /> 测试</>
                    )}
                  </button>
                  <button
                    onClick={() => openEditProvider(p)}
                    className="btn-ghost gap-1 px-2.5 py-1 text-xs"
                  >
                    <Pencil size={12} />
                    设置
                  </button>
                  <button
                    onClick={() => handleDeleteProvider(p)}
                    disabled={p.id === 'vrouter'}
                    title={p.id === 'vrouter' ? '内置 V-Router 供应商不可删除' : undefined}
                    className="btn-ghost gap-1 px-2.5 py-1 text-xs text-red-400 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed"
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

        </>
        )}
      {/* ==================== 开启全自动托管模式提示 ==================== */}
      <Modal open={showAutoPilotWarning} onClose={cancelAutoPilotWarning} className="max-w-md">
          <div className="glass-panel rounded-2xl p-6 space-y-4" style={{ background: 'var(--bg-card)' }}>
            <h3 className="text-lg font-semibold text-theme-primary">开启全自动托管模式</h3>
            <p className="text-sm text-theme-muted leading-relaxed">
              全自动托管会持续调用 AI 完成识别、命名和刮削，建议使用能力较强的模型以保证自动刮削质量。
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={cancelAutoPilotWarning} className="btn-ghost px-4 py-2 rounded-lg text-sm">
                取消
              </button>
              <button onClick={confirmEnableAutoPilot} disabled={autoPilotCountdown > 0} className="btn-primary gap-1.5 px-4 py-2 text-sm disabled:opacity-50">
                {autoPilotCountdown > 0 ? `开启（${autoPilotCountdown}s）` : '开启'}
              </button>
            </div>
          </div>
        </Modal>

      {/* ==================== 新增/编辑供应商弹窗 ==================== */}
      <Modal open={showProviderDialog} onClose={() => setShowProviderDialog(false)} className="max-w-md">
          <div className="glass-panel flex max-h-[calc(100vh-3rem)] flex-col rounded-2xl p-6" style={{ background: 'var(--bg-card)' }}>
            <h3 className="shrink-0 text-lg font-semibold text-theme-primary">
              {editingProvider ? '编辑供应商' : '新增供应商'}
            </h3>

            <div className="-mx-2 min-h-0 flex-1 space-y-3 overflow-y-auto px-2" style={{ scrollbarGutter: 'stable' }}>
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
                {isBuiltInVRouter ? (
                  <p className="input w-full font-mono text-sm bg-surface-700/50 text-theme-muted cursor-not-allowed truncate">
                    {providerForm.api_base || 'http://v-router:8080/v1'}
                  </p>
                ) : (
                  <input
                    type="text"
                    value={providerForm.api_base}
                    onChange={(e) => setProviderForm({ ...providerForm, api_base: e.target.value })}
                    className="input w-full font-mono text-sm"
                    placeholder="https://api.deepseek.com/v1"
                  />
                )}
              </div>
              {isBuiltInVRouter ? (
                <p className="flex items-center gap-1 text-xs text-green-400">
                  <Check size={12} /> V-Router 内网免鉴权，无需 API Key，地址由系统内置
                </p>
              ) : (
                <div>
                  <label className="mb-1 block text-sm font-medium text-theme-secondary">API Key</label>
                  <input
                    type="password"
                    value={providerForm.api_key}
                    onChange={(e) => setProviderForm({ ...providerForm, api_key: e.target.value })}
                    className="input w-full font-mono text-sm"
                    placeholder={isGatewayForm() ? '无需 API Key（内网免鉴权）' : 'sk-...（可选，服务商需要时必填）'}
                  />
                  {isGatewayForm() && !providerForm.api_key ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-green-400">
                      <Check size={12} /> 内网免鉴权，留空即可
                    </p>
                  ) : editingProvider?.api_key_configured && !providerForm.api_key && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-green-400">
                      <Check size={12} /> 密钥已配置（留空不会清除）
                    </p>
                  )}
                </div>
              )}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-sm font-medium text-theme-secondary">模型列表</label>
                  <button
                    type="button"
                    onClick={handleFetchModels}
                    disabled={fetchingModels || !providerForm.api_base.trim()}
                    className="btn-ghost gap-1 px-2 py-0.5 text-xs text-neon hover:text-neon disabled:opacity-50"
                    title="从 API 地址获取可用模型，勾选后添加"
                  >
                    {fetchingModels ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {fetchingModels ? '获取中…' : '自动获取'}
                  </button>
                </div>
                <div className="space-y-2">
                  {providerForm.models.map((m, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      {/* 默认模型单选 */}
                      <button
                        type="button"
                        onClick={() => {
                          if (m.is_default) return // 已是默认，不允许取消
                          const newModels = providerForm.models.map((item, i) => ({ ...item, is_default: i === idx }))
                          setProviderForm({ ...providerForm, models: newModels })
                        }}
                        className={`h-4 w-4 rounded-full border-2 shrink-0 transition-colors ${
                          m.is_default
                            ? 'border-neon bg-neon/20 cursor-default'
                            : 'border-surface-500 hover:border-surface-400 cursor-pointer'
                        }`}
                        title={m.is_default ? '默认模型' : '设为默认模型'}
                      />
                      <input
                        type="text"
                        value={m.name}
                        onChange={(e) => {
                          const newModels = [...providerForm.models]
                          newModels[idx] = { ...newModels[idx], name: e.target.value }
                          setProviderForm({ ...providerForm, models: newModels })
                        }}
                        className="input flex-1 font-mono text-sm"
                        placeholder="model-name"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const newModels = [...providerForm.models]
                          newModels[idx] = { ...newModels[idx], is_vision: !newModels[idx].is_vision }
                          setProviderForm({ ...providerForm, models: newModels })
                        }}
                        className={`px-2 py-1 text-xs rounded transition-colors ${
                          m.is_vision
                            ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                            : 'bg-surface-700 text-surface-400 border border-surface-600'
                        }`}
                        title={m.is_vision ? '视觉模型（点击取消）' : '标记为视觉模型'}
                      >
                        <Eye size={12} className="inline mr-1" />
                        {m.is_vision ? '视觉' : '文本'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const wasDefault = providerForm.models[idx].is_default
                          const newModels = providerForm.models.filter((_, i) => i !== idx)
                          // 如果删除的是默认模型，将第一个设为默认
                          if (wasDefault && newModels.length > 0) {
                            newModels[0] = { ...newModels[0], is_default: true }
                          }
                          setProviderForm({ ...providerForm, models: newModels })
                        }}
                        disabled={providerForm.models.length === 1}
                        className="text-surface-500 hover:text-red-400 transition-colors p-1 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={providerForm.models.length === 1 ? '至少保留一个模型' : '删除模型'}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const newModels = [...providerForm.models, { name: '', is_vision: false, is_default: providerForm.models.length === 0 }]
                      setProviderForm({ ...providerForm, models: newModels })
                    }}
                    className="flex items-center gap-1 text-xs text-theme-secondary hover:text-neon transition-colors"
                  >
                    <Plus size={12} /> 添加模型
                  </button>
                </div>
                {/* 获取到的模型勾选列表 */}
                {fetchedModels && (
                  <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}>
                    <input
                      type="text"
                      value={fetchedSearch}
                      onChange={(e) => setFetchedSearch(e.target.value)}
                      className="input w-full text-sm"
                      placeholder="搜索过滤模型…"
                    />
                    <div className="max-h-40 space-y-1 overflow-y-auto">
                      {(() => {
                        const kw = fetchedSearch.trim().toLowerCase()
                        const filtered = fetchedModels.filter((n) => !kw || n.toLowerCase().includes(kw))
                        if (filtered.length === 0) {
                          return <p className="py-2 text-center text-xs text-theme-muted">无匹配模型</p>
                        }
                        return filtered.map((name) => {
                          const already = providerForm.models.some((m) => m.name === name)
                          return (
                            <label
                              key={name}
                              className={clsx(
                                'flex items-center gap-2 rounded px-2 py-1 text-sm transition-colors',
                                already ? 'cursor-default opacity-50' : 'cursor-pointer hover:bg-surface-600/40'
                              )}
                            >
                              <Checkbox
                                checked={already || fetchedSelected.has(name)}
                                disabled={already}
                                onCheckedChange={(checked) => {
                                  setFetchedSelected((prev) => {
                                    const next = new Set(prev)
                                    if (checked) next.add(name)
                                    else next.delete(name)
                                    return next
                                  })
                                }}
                              />
                              <span className="min-w-0 flex-1 truncate font-mono text-xs text-theme-primary">{name}</span>
                              {already && <span className="shrink-0 text-[10px] text-green-400">已添加</span>}
                            </label>
                          )
                        })
                      })()}
                    </div>
                    <div className="flex items-center justify-between border-t pt-2" style={{ borderColor: 'var(--border-subtle)' }}>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            const existing = new Set(providerForm.models.map((m) => m.name))
                            setFetchedSelected(new Set(fetchedModels.filter((n) => !existing.has(n))))
                          }}
                          className="text-xs text-theme-secondary hover:text-neon"
                        >
                          全选
                        </button>
                        <button
                          type="button"
                          onClick={() => setFetchedSelected(new Set())}
                          className="text-xs text-theme-secondary hover:text-neon"
                        >
                          清空
                        </button>
                        <button
                          type="button"
                          onClick={resetFetchedModels}
                          className="text-xs text-theme-secondary hover:text-neon"
                        >
                          收起
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={confirmAddFetchedModels}
                        disabled={fetchedSelected.size === 0}
                        className="btn-primary gap-1 px-3 py-1 text-xs disabled:opacity-50"
                      >
                        <Plus size={12} />
                        添加所选{fetchedSelected.size > 0 ? `（${fetchedSelected.size}）` : ''}
                      </button>
                    </div>
                  </div>
                )}
                <p className="mt-1 text-xs text-theme-muted">● 默认模型 · 标记为「视觉」的模型可用于场景描述</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 pt-2">
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
      </Modal>

        {section === 'advanced' && (
        <>
      {/* ==================== 数据脱敏 ==================== */}
      <section>
        <h2
          className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-wide text-theme-primary"
        >
          <Shield size={20} className="text-neon/60" />
          数据脱敏
        </h2>

        <div className="glass-panel rounded-xl p-5 space-y-4">
          {/* 启用开关 */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                style={{ background: editDesensitize ? 'var(--neon-blue-10)' : 'var(--nav-hover-bg)' }}
              >
                <Shield size={18} className={editDesensitize ? 'text-neon' : 'text-surface-500'} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-theme-primary">
                  启用数据脱敏
                </p>
                <p className="text-xs text-theme-muted">
                  LLM 调用前自动脱敏敏感信息（手机号、身份证、密钥等）
                </p>
              </div>
            </div>
            <Switch
              checked={editDesensitize}
              onCheckedChange={setEditDesensitize}
              aria-label="启用数据脱敏"
            />
          </div>

          {/* 配置项（启用后展开） */}
          {editDesensitize && (
            <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-theme-muted">脱敏服务地址</label>
                  <input
                    type="text"
                    value={editDesensitizeURL}
                    onChange={(e) => setEditDesensitizeURL(e.target.value)}
                    placeholder="http://desensitize-backend:5000"
                    className="input text-sm w-full"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-theme-muted">超时（秒）</label>
                  <input
                    type="number"
                    value={editDesensitizeTimeout}
                    onChange={(e) => setEditDesensitizeTimeout(Number(e.target.value))}
                    className="input text-sm"
                    min={1}
                    max={30}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-theme-primary">NER 语义识别</p>
                  <p className="text-xs text-theme-muted">开启后额外识别人名、地址等语义信息（有并发限制）</p>
                </div>
                <Switch
                  checked={editDesensitizeNER}
                  onCheckedChange={setEditDesensitizeNER}
                  aria-label="NER 语义识别"
                />
              </div>
              <div className="h-px" style={{ background: 'var(--border-default)' }} />
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-theme-primary">图片脱敏</p>
                  <p className="text-xs text-theme-muted">开启后对外发图片先经脱敏服务打码（同一服务地址）</p>
                </div>
                <Switch
                  checked={editDesensitizeImageEnabled}
                  onCheckedChange={setEditDesensitizeImageEnabled}
                  aria-label="图片脱敏"
                />
              </div>
              {editDesensitizeImageEnabled && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-theme-muted">图片超时（秒）</label>
                    <input
                      type="number"
                      value={editDesensitizeImageTimeout}
                      onChange={(e) => setEditDesensitizeImageTimeout(Number(e.target.value) || 30)}
                      className="input text-sm"
                      min={1}
                      max={120}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-theme-muted">生效范围（可多选）</label>
                    <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-theme-primary">
                        <Checkbox
                          checked={editDesensitizeImageScopes.includes('embedding')}
                          onCheckedChange={(checked) => {
                            setEditDesensitizeImageScopes((prev) => checked ? [...prev.filter((s) => s !== 'embedding'), 'embedding'] : prev.filter((s) => s !== 'embedding'))
                          }}
                        />
                        Embedding（视频帧向量化）
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-theme-primary">
                        <Checkbox
                          checked={editDesensitizeImageScopes.includes('ai_assistant')}
                          onCheckedChange={(checked) => {
                            setEditDesensitizeImageScopes((prev) => checked ? [...prev.filter((s) => s !== 'ai_assistant'), 'ai_assistant'] : prev.filter((s) => s !== 'ai_assistant'))
                          }}
                        />
                        AI 助手图片上传
                      </label>
                    </div>
                    <p className="mt-1 text-[11px] text-theme-muted">可多选，新增功能时在此扩展选项</p>
                  </div>
                </div>
              )}
            </div>
          )}
          <button
            onClick={handleSaveAdvanced}
            disabled={saving}
            className="btn-primary gap-1.5 px-4 py-1.5 text-xs"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            保存脱敏设置
          </button>

          {/* 测试服务健康 */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleTestDesensitize}
              disabled={dsTest.testing}
              className="btn-ghost gap-1.5 px-4 py-1.5 text-xs"
            >
              {dsTest.testing ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
              测试服务健康
            </button>
            {dsTest.message && (
              <span
                className={"text-xs " + (dsTest.success ? "text-emerald-400" : "text-red-400")}
              >
                {dsTest.message}
              </span>
            )}
          </div>
        </div>
      </section>

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

        </>
        )}
        {section === 'ops' && (
        <>
      {/* ==================== 使用统计 ==================== */}
      <section>
        <h2
          className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-wide text-theme-primary"
        >
          <BarChart3 size={20} className="text-neon/60" />
          使用统计
        </h2>

        <div className="glass-panel rounded-xl p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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

        </>
        )}
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
      </div>

    </div>
  )
}
