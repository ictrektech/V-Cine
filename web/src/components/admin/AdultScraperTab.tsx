import { useCallback, useEffect, useMemo, useState } from 'react'
import { adultScraperApi } from '@/api'
import { useWebSocket, WS_EVENTS } from '@/hooks/useWebSocket'
import { useTranslation } from '@/i18n'
import type {
  AdultBatchItemResult,
  AdultBatchTask,
  AdultCacheStats,
  AdultLazyResultView,
  AdultLazyStatus,
  AdultLazyTaskView,
  AdultSchedulerStatus,
  AdultScrapeReport,
  AdultScraperConfig,
  FolderBatchTask,
  FolderScanResult,
} from '@/api/adultScraper'


import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clock,
  Database,
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Shield,
  Square,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react'

import clsx from 'clsx'
import FileBrowser from '@/components/FileBrowser'

type Notice = { type: 'success' | 'error' | 'info'; text: string }




const LAZY_DEFAULTS = {
  minRequestInterval: 1500,
  maxRequestInterval: 3000,
  concurrency: 2,
  aggregated: true,
}

const taskStatusLabelKeys: Record<string, string> = {
  running: 'ast.statusRunning',
  paused: 'ast.statusPaused',
  cancelled: 'ast.statusCancelled',
  completed: 'ast.statusCompleted',
  failed: 'ast.statusFailed',
}

function formatTime(value?: string) {
  if (!value) return '--'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString()
}

function progressOf(task?: AdultLazyTaskView | null) {
  if (!task || task.total <= 0) return 0
  return Math.min(100, Math.round((task.current / task.total) * 100))
}




function isScraperUsable(config: AdultScraperConfig | null) {
  if (!config?.enabled) return false
  return (config.sources || []).some((source) => source.enabled)
}

export default function AdultScraperSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AdultScraperConfig | null>(null)
  const [folderPath, setFolderPath] = useState('')
  const [folderScan, setFolderScan] = useState<FolderScanResult | null>(null)
  const [tasks, setTasks] = useState<FolderBatchTask[]>([])
  const [mediaTasks, setMediaTasks] = useState<AdultBatchTask[]>([])
  const [failedItems, setFailedItems] = useState<AdultBatchItemResult[]>([])
  const [report, setReport] = useState<AdultScrapeReport | null>(null)
  const [schedulerInfo, setSchedulerInfo] = useState<AdultSchedulerStatus | null>(null)
  const [cacheStats, setCacheStats] = useState<AdultCacheStats | null>(null)
  const [currentTaskView, setCurrentTaskView] = useState<AdultLazyTaskView | null>(null)
  const [recentResultViews, setRecentResultViews] = useState<AdultLazyResultView[]>([])
  const [folderFailedCount, setFolderFailedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [opsLoading, setOpsLoading] = useState(false)
  const [retryingFailed, setRetryingFailed] = useState(false)
  const [triggeringSchedule, setTriggeringSchedule] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)
  const [showFolderBrowser, setShowFolderBrowser] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const { on, off } = useWebSocket()

  const showNotice = useCallback((type: Notice['type'], text: string) => {
    setNotice({ type, text })
    window.setTimeout(() => setNotice(null), 4500)
  }, [])

  const loadConfig = useCallback(async () => {
    try {
      const res = await adultScraperApi.getConfig()
      setConfig(res.data.data)
    } catch {
      showNotice('error', t('ast.loadCfgFailed'))
    }
  }, [showNotice])

  const applyLazyStatus = useCallback((data: AdultLazyStatus) => {
    setTasks([...(data.folder_tasks?.active || []), ...(data.folder_tasks?.history || [])])
    setMediaTasks([...(data.media_tasks?.active || []), ...(data.media_tasks?.history || [])])
    setReport(data.report || null)
    setFailedItems(data.failed_items || [])
    setSchedulerInfo(data.scheduler || null)
    setCacheStats(data.cache?.stats || null)
    setCurrentTaskView(data.current_task || null)
    setRecentResultViews(data.recent_results || [])
    setFolderFailedCount(data.folder_failed_count || 0)
  }, [])

  const loadTasks = useCallback(async () => {
    try {
      const res = await adultScraperApi.getLazyStatus(7)
      applyLazyStatus(res.data.data)
    } catch {
      // 轮询失败不打扰用户
    }
  }, [applyLazyStatus])

  const loadOperations = useCallback(async () => {
    setOpsLoading(true)
    try {
      const res = await adultScraperApi.getLazyStatus(7)
      applyLazyStatus(res.data.data)
    } finally {
      setOpsLoading(false)
    }
  }, [applyLazyStatus])



  useEffect(() => {
    let mounted = true
    const init = async () => {
      setLoading(true)
      await Promise.all([loadConfig(), loadTasks()])
      if (mounted) setLoading(false)
    }
    init()
    return () => { mounted = false }
  }, [loadConfig, loadTasks])

  useEffect(() => {
    const timer = window.setInterval(loadTasks, 10000)
    return () => window.clearInterval(timer)
  }, [loadTasks])

  useEffect(() => {
    let refreshTimer: number | null = null
    const refresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        loadTasks()
      }, 250)
    }
    const events = [
      WS_EVENTS.ADULT_BATCH_STARTED,
      WS_EVENTS.ADULT_BATCH_PROGRESS,
      WS_EVENTS.ADULT_BATCH_COMPLETED,
      WS_EVENTS.ADULT_BATCH_FAILED,
      WS_EVENTS.ADULT_BATCH_CANCELLED,
      WS_EVENTS.ADULT_FOLDER_BATCH_STARTED,
      WS_EVENTS.ADULT_FOLDER_BATCH_PROGRESS,
      WS_EVENTS.ADULT_FOLDER_BATCH_COMPLETED,
      WS_EVENTS.ADULT_FOLDER_BATCH_FAILED,
      WS_EVENTS.ADULT_FOLDER_BATCH_CANCELLED,
    ]
    events.forEach((event) => on(event, refresh))
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      events.forEach((event) => off(event, refresh))
    }
  }, [loadTasks, off, on])

  useEffect(() => {
    if (showAdvanced) loadOperations()
  }, [loadOperations, showAdvanced])

  const unifiedTasks = useMemo<AdultLazyTaskView[]>(() => {
    const folder = tasks.map((task) => ({
      id: task.id,
      kind: 'folder' as const,
      status: task.status,
      total: task.total,
      current: task.current,
      success: task.success,
      failed: task.failed,
      skipped: task.skipped,
      started_at: task.started_at,
      finished_at: task.finished_at,
      aggregated: task.aggregated,
      concurrency: task.concurrency,
    }))
    const media = mediaTasks.map((task) => ({
      id: task.id,
      kind: 'library' as const,
      status: task.status,
      total: task.total,
      current: task.current,
      success: task.success,
      failed: task.failed,
      skipped: task.skipped,
      started_at: task.started_at,
      finished_at: task.finished_at,
      aggregated: task.aggregated,
      concurrency: task.concurrency,
    }))
    return [...folder, ...media].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
  }, [mediaTasks, tasks])
  const runningTask = currentTaskView?.status === 'running' ? currentTaskView : unifiedTasks.find((task) => task.status === 'running') || null
  const currentTask = currentTaskView || runningTask || unifiedTasks[0] || null
  const results = recentResultViews

  const successCount = results.filter((item) => item.status === 'success').length
  const failedCount = results.filter((item) => item.status === 'failed').length
  const skippedCount = results.filter((item) => item.status === 'skipped').length
  const taskProgress = progressOf(currentTask)
  const usable = isScraperUsable(config)




  const scanCurrentFolder = async (silent = false) => {
    const path = folderPath.trim()
    if (!path) {
      if (!silent) showNotice('error', t('ast.pickDirFirst'))
      return null
    }
    setScanning(true)
    try {
      const res = await adultScraperApi.scanFolder(path, true, 0)
      setFolderScan(res.data.data)
      if (!silent) {
        showNotice('success', t('ast.scanDone', { with: res.data.data.with_code, total: res.data.data.total }))
      }
      return res.data.data
    } catch (err: any) {
      showNotice('error', err?.response?.data?.error || t('ast.scanFailed'))
      return null
    } finally {
      setScanning(false)
    }
  }

  const startLazyScrape = async () => {
    const path = folderPath.trim()
    if (!path) {
      showNotice('error', t('ast.pickDirFirst'))
      return
    }
    if (runningTask) {
      showNotice('info', t('ast.taskRunning'))
      return
    }

    setStarting(true)
    try {
      const res = await adultScraperApi.startLazy({
        path,
        recursive: true,
        max_depth: 0,
        aggregated: LAZY_DEFAULTS.aggregated,
        concurrency: LAZY_DEFAULTS.concurrency,
      })
      setFolderScan(res.data.data.scan)
      if (res.data.data.queued === 0) {
        showNotice('info', t('ast.noNewVideos'))
      } else {
        showNotice('success', t('ast.started', { queued: res.data.data.queued }))
      }
      await Promise.all([loadConfig(), loadTasks()])
    } catch (err: any) {
      showNotice('error', err?.response?.data?.error || t('ast.startFailed'))
    } finally {
      setStarting(false)
    }
  }


  const stopRunningTask = async () => {
    if (!runningTask) return
    setStopping(true)
    try {
      if (runningTask.kind === 'folder') {
        await adultScraperApi.cancelFolderBatch(runningTask.id)
      } else {
        await adultScraperApi.cancelBatch(runningTask.id)
      }
      showNotice('info', t('ast.stopRequested'))
      await loadTasks()
    } catch (err: any) {
      showNotice('error', err?.response?.data?.error || t('ast.stopFailed'))
    } finally {
      setStopping(false)
    }
  }

  const retryFailedItems = async () => {
    setRetryingFailed(true)
    try {
      const res = await adultScraperApi.retryLazyFailed({ days: 7, concurrency: LAZY_DEFAULTS.concurrency, aggregated: LAZY_DEFAULTS.aggregated })
      const data = res.data.data
      if (data.retry_count === 0) {
        showNotice('info', t('ast.noRetry'))
      } else {
        showNotice('success', t('ast.retrySubmitted', { count: data.retry_count, folder: data.folder_retry_count, media: data.media_retry_count }))
      }
      await Promise.all([loadTasks(), loadOperations()])
    } catch (err: any) {
      showNotice('error', err?.response?.data?.error || t('ast.retryFailed'))
    } finally {
      setRetryingFailed(false)
    }
  }


  const triggerSchedulerNow = async () => {
    setTriggeringSchedule(true)
    try {
      await adultScraperApi.triggerScheduler()
      showNotice('success', t('ast.triggered'))
      await Promise.all([loadTasks(), loadOperations()])
    } catch (err: any) {
      showNotice('error', err?.response?.data?.error || t('ast.triggerFailed'))
    } finally {
      setTriggeringSchedule(false)
    }
  }

  const clearMetadataCache = async () => {
    setClearingCache(true)
    try {
      await adultScraperApi.clearCache()
      showNotice('success', t('ast.cacheCleared'))
      await loadOperations()
    } catch (err: any) {
      showNotice('error', err?.response?.data?.error || t('ast.cacheClearFailed'))
    } finally {
      setClearingCache(false)
    }
  }

  const resetLazyDefaults = async () => {

    try {
      await adultScraperApi.updateConfig({
        enabled: true,
        enable_javbus: true,
        enable_javdb: true,
        min_request_interval: LAZY_DEFAULTS.minRequestInterval,
        max_request_interval: LAZY_DEFAULTS.maxRequestInterval,
      })
      await loadConfig()
      showNotice('success', t('ast.defaultsRestored'))
    } catch {
      showNotice('error', t('ast.restoreFailed'))
    }
  }

  if (loading) {
    return (
      <section className="glass-panel rounded-xl p-8">
        <div className="flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <Loader2 size={18} className="animate-spin text-neon" />
          {t('ast.loading')}
        </div>
      </section>
    )
  }

  return (
    <>
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-wide" style={{ color: 'var(--text-primary)' }}>
              <Shield size={20} className="text-neon/70" />
              {t('ast.title')}
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {t('ast.desc')}
            </p>
          </div>
          <div className={clsx(
            'rounded-full px-3 py-1 text-xs font-medium',
            usable ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400',
          )}>
            {usable ? t('ast.ready') : t('ast.initOnFirstRun')}
          </div>
        </div>

        {notice && (
          <div className={clsx(
            'flex items-center gap-2 rounded-lg px-4 py-3 text-sm animate-slide-up',
            notice.type === 'success' && 'bg-green-500/10 text-green-400',
            notice.type === 'error' && 'bg-red-500/10 text-red-400',
            notice.type === 'info' && 'bg-blue-500/10 text-blue-400',
          )}>
            {notice.type === 'success' ? <CheckCircle2 size={16} /> : notice.type === 'error' ? <XCircle size={16} /> : <AlertTriangle size={16} />}
            {notice.text}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-elevated)' }}>
          <div className="border-b px-5 py-4" style={{ borderColor: 'var(--border-default)' }}>
            <div className="flex flex-col gap-3 lg:flex-row">
              <div className="relative flex-1">
                <FolderOpen size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
                <input
                  value={folderPath}
                  onChange={(e) => {
                    setFolderPath(e.target.value)
                    setFolderScan(null)
                  }}
                  className="input pl-9 text-sm"
                  placeholder={t('ast.dirPlaceholder')}
                />
              </div>
              <button onClick={() => setShowFolderBrowser(true)} className="btn-ghost gap-2 px-4 py-2 text-sm">
                <FolderOpen size={16} />
                {t('ast.pickDir')}
              </button>
              <button onClick={() => scanCurrentFolder(false)} disabled={scanning || !folderPath.trim()} className="btn-ghost gap-2 px-4 py-2 text-sm">
                {scanning ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                {t('ast.prescan')}
              </button>
              <button onClick={startLazyScrape} disabled={starting || scanning || Boolean(runningTask)} className="btn-primary gap-2 px-6 py-2 text-sm">
                {starting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {t('ast.start')}
              </button>
              {runningTask && (
                <button onClick={stopRunningTask} disabled={stopping} className="btn-ghost gap-2 px-4 py-2 text-sm text-red-400">
                  {stopping ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
                  {t('ast.stop')}
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <StatCard label={t('ast.statTotal')} value={folderScan?.total ?? currentTask?.total ?? 0} accent="text-neon" />
                <StatCard label={t('ast.statWithCode')} value={folderScan?.with_code ?? 0} accent="text-green-400" />
                <StatCard label={t('ast.statSkipped')} value={currentTask?.skipped ?? skippedCount} accent="text-yellow-400" />
                <StatCard label={t('ast.statFailed')} value={currentTask?.failed ?? failedCount} accent="text-red-400" />
              </div>

              <div className="rounded-xl p-4" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)' }}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className={clsx(
                      'flex h-9 w-9 items-center justify-center rounded-full',
                      runningTask ? 'bg-green-500/10 text-green-400' : 'bg-surface-700 text-surface-400',
                    )}>
                      {runningTask ? <Loader2 size={18} className="animate-spin" /> : <Database size={17} />}
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {currentTask ? t(taskStatusLabelKeys[currentTask.status] || currentTask.status) : t('ast.waitStart')}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {currentTask ? t('ast.startedAt', { time: formatTime(currentTask.started_at) }) : t('ast.waitHint')}
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-neon/10 px-2.5 py-1 text-xs font-medium text-neon">{taskProgress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-800">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all" style={{ width: `${taskProgress}%` }} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <span>{t('ast.success')} <b className="font-mono text-green-400">{currentTask?.success ?? successCount}</b></span>
                  <span>{t('ast.statFailed')} <b className="font-mono text-red-400">{currentTask?.failed ?? failedCount}</b></span>
                  <span>{t('ast.statSkipped')} <b className="font-mono text-yellow-400">{currentTask?.skipped ?? skippedCount}</b></span>
                </div>
              </div>

              <div className="rounded-xl p-4" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)' }}>
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  <Zap size={15} className="text-neon" />
                  {t('ast.defaultPolicy')}
                </div>
                <div className="grid gap-2 text-xs md:grid-cols-2" style={{ color: 'var(--text-secondary)' }}>
                  <LazyRule text={t('ast.rule1')} />
                  <LazyRule text={t('ast.rule2')} />
                  <LazyRule text={t('ast.rule3')} />
                  <LazyRule text={t('ast.rule4')} />
                  <LazyRule text={t('ast.rule5')} />
                  <LazyRule text={t('ast.rule6')} />
                </div>
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)' }}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  <Clock size={15} />
                  {t('ast.recent')}
                </div>
                <button onClick={loadTasks} className="text-xs text-neon hover:underline">
                  {t('common.refresh')}
                </button>
              </div>
              <div className="max-h-[520px] space-y-1 overflow-auto pr-1 text-xs">
                {results.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-8 text-center" style={{ borderColor: 'var(--border-default)', color: 'var(--text-tertiary)' }}>
                    {t('ast.noRecords')}
                  </div>
                ) : results.slice(0, 100).map((item, index) => (
                  <div
                    key={`${item.code}-${item.path}-${index}`}
                    className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-white/5"
                    title={item.message || item.path}
                  >
                    <span className={clsx(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      item.status === 'success' ? 'bg-green-400' : item.status === 'failed' ? 'bg-red-400' : 'bg-yellow-400',
                    )} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono" style={{ color: item.status === 'success' ? '#4ade80' : item.status === 'failed' ? '#f87171' : '#facc15' }}>
                          {item.code || 'UNKNOWN'}
                        </span>
                        {item.source && <span className="rounded bg-surface-700 px-1.5 py-0.5 text-[10px] text-surface-400">{item.source}</span>}
                      </div>
                      <div className="truncate" style={{ color: 'var(--text-tertiary)' }}>
                        {item.status === 'failed' ? (item.message || item.title || item.path) : (item.title || item.message || item.path)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <CollapsibleSection
          open={showAdvanced}
          onToggle={() => setShowAdvanced((v) => !v)}
          icon={<Settings size={15} />}
          title={t('ast.opsCenter')}
          hint={t('ast.opsHint')}
        >
          {opsLoading && (
            <div className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-blue-400 bg-blue-500/10">
              <Loader2 size={13} className="animate-spin" />
              {t('ast.loadingOps')}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <OperationCard icon={<BarChart3 size={15} />} title={t('ast.report7d')}>
              <div className="space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <p>{t('ast.processed', { count: report?.total_processed ?? 0 })}</p>
                <p>{t('ast.successCount', { count: report?.total_success ?? 0 })}</p>
                <p>{t('ast.failedCount', { count: report?.total_failed ?? 0 })}</p>
                <p>{t('ast.successRate', { rate: Math.round((report?.overall_rate || 0) * 100) })}</p>
              </div>
            </OperationCard>

            <OperationCard icon={<RotateCcw size={15} />} title={t('ast.retry')}>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {t('ast.failed7d', { count: failedItems.length + folderFailedCount })}
                <span className="ml-1 text-[10px]">{t('ast.folderMedia', { folder: folderFailedCount, media: failedItems.length })}</span>
              </p>
              <button onClick={retryFailedItems} disabled={retryingFailed || failedItems.length + folderFailedCount === 0} className="btn-primary mt-3 gap-2 px-3 py-1.5 text-xs">
                {retryingFailed ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                {t('ast.retryBtn')}
              </button>
            </OperationCard>

            <OperationCard icon={<Clock size={15} />} title={t('ast.scheduler')}>
              <div className="space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <p>{t('ast.status', { status: schedulerInfo?.config?.Enabled ? t('ast.enabled') : t('ast.disabled') })}</p>
                <p>{t('ast.lastRun', { time: formatTime(schedulerInfo?.last_run_at) })}</p>
              </div>
              <button onClick={triggerSchedulerNow} disabled={triggeringSchedule} className="btn-ghost mt-3 gap-2 px-3 py-1.5 text-xs">
                {triggeringSchedule ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                {t('ast.runNow')}
              </button>
            </OperationCard>

            <OperationCard icon={<Database size={15} />} title={t('ast.cache')}>
              <div className="space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <p>{t('ast.entries', { used: cacheStats?.size ?? 0, max: cacheStats?.max_size ?? 0 })}</p>
                <p>{t('ast.hits', { count: cacheStats?.total_hit ?? 0 })}</p>
              </div>
              <button onClick={clearMetadataCache} disabled={clearingCache} className="btn-ghost mt-3 gap-2 px-3 py-1.5 text-xs text-red-400">
                {clearingCache ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                {t('ast.clearCacheBtn')}
              </button>
            </OperationCard>
          </div>

          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <div className="rounded-xl p-4" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)' }}>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('ast.history')}</p>
                <button onClick={() => Promise.all([loadTasks(), loadOperations()])} className="text-xs text-neon hover:underline">{t('ast.reload')}</button>
              </div>
              <div className="max-h-56 space-y-2 overflow-auto text-xs">
                {unifiedTasks.length === 0 ? (
                  <p style={{ color: 'var(--text-tertiary)' }}>{t('ast.noHistory')}</p>
                ) : unifiedTasks.slice(0, 12).map((task) => (
                  <div key={`${task.kind}-${task.id}`} className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-primary)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{task.kind === 'folder' ? t('ast.folderScrape') : t('ast.libBatch')}</span>
                      <span className={task.status === 'completed' ? 'text-green-400' : task.status === 'failed' ? 'text-red-400' : 'text-yellow-400'}>{t(taskStatusLabelKeys[task.status] || task.status)}</span>
                    </div>
                    <div className="mt-1 flex gap-3 font-mono" style={{ color: 'var(--text-tertiary)' }}>
                      <span>{task.current}/{task.total}</span>
                      <span>{t('ast.taskSuccess', { count: task.success })}</span>
                      <span>{t('ast.taskFailed', { count: task.failed })}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)' }}>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('ast.diagnostics')}</p>
                <button onClick={() => setShowDiagnostics((v) => !v)} className="text-xs text-neon hover:underline">
                  {showDiagnostics ? t('ast.collapse') : t('ast.expand')}
                </button>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {t('ast.diagHint')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={resetLazyDefaults} className="btn-primary gap-2 px-3 py-1.5 text-xs">
                  <RefreshCw size={12} />
                  {t('ast.restoreDefaults')}
                </button>
                <button onClick={() => Promise.all([loadConfig(), loadOperations()])} className="btn-ghost gap-2 px-3 py-1.5 text-xs">
                  <RefreshCw size={12} />
                  {t('ast.reload')}
                </button>
              </div>
              {showDiagnostics && (
                <div className="mt-3 space-y-2">
                  {(config?.sources || []).map((source) => (
                    <div key={source.id} className="flex items-center justify-between rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--bg-primary)' }}>
                      <div className="min-w-0">
                        <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>{source.name}</p>
                        <p className="truncate" style={{ color: 'var(--text-tertiary)' }}>{source.url || t('ast.notConfigured')}</p>
                      </div>
                      <span className={source.enabled ? 'text-green-400' : 'text-surface-500'}>{source.enabled ? t('ast.enabled') : t('ast.disabled')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CollapsibleSection>

      </section>

      <FileBrowser
        open={showFolderBrowser}
        onClose={() => setShowFolderBrowser(false)}
        onSelect={(selectedPath) => {
          setFolderPath(selectedPath)
          setFolderScan(null)
          setShowFolderBrowser(false)
        }}
        initialPath={folderPath || undefined}
      />
    </>
  )
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)' }}>
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      <p className={clsx('mt-1 font-mono text-2xl font-semibold', accent)}>{value}</p>
    </div>
  )
}

function LazyRule({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--bg-primary)' }}>
      <CheckCircle2 size={13} className="shrink-0 text-green-400" />
      <span>{text}</span>
    </div>
  )
}

function OperationCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)' }}>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        {icon}
        {title}
      </div>
      {children}
    </div>
  )
}

function CollapsibleSection({
  open,
  onToggle,
  icon,
  title,
  hint,
  children,
}: {
  open: boolean
  onToggle: () => void
  icon: React.ReactNode
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}>
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          {icon}
          {title}
          <span className="text-[10px] font-normal" style={{ color: 'var(--text-tertiary)' }}>{hint}</span>
        </span>
        <ChevronDown size={15} className={clsx('transition-transform text-surface-500', open && 'rotate-180')} />
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  )
}
