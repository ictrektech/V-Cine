// 番号刮削 - 批量刮削与运营中心
// 功能：
//   - 批量刮削任务启动 / 暂停 / 恢复 / 取消 / 进度实时跟踪
//   - 镜像状态查看 / 健康检查 / 自定义切换
//   - 元数据缓存管理
//   - 定时调度配置
//   - 失败分析报表 + 一键重试失败
import { useCallback, useEffect, useState } from 'react'
import { adultScraperApi } from '@/api'
import type {
  AdultBatchTask,
  AdultBatchProgressEvent,
  AdultSchedulerConfig,
  AdultScrapeReport,
  MirrorStatus,
} from '@/api/adultScraper'
import AdultFolderScraperPanel from './AdultFolderScraperPanel'
import AdultCookieLoginPanel from './AdultCookieLoginPanel'
import {
  Play,
  Pause,
  Square,
  RefreshCw,
  Trash2,
  Clock,
  BarChart3,
  Globe,
  Database,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Wifi,
  WifiOff,
  TrendingUp,
  History,
  RotateCw,
  FolderSearch,
  Cookie,
} from 'lucide-react'
import clsx from 'clsx'
import { useDialog } from '@/components/Dialog'

import { useTranslation } from '@/i18n'

type Tab = 'batch' | 'folder' | 'cookies' | 'mirrors' | 'cache' | 'scheduler' | 'report'

export default function AdultScraperProSection() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('batch')

  return (
    <div className="rounded-xl p-5" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)' }}>
      <div className="mb-4 flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-purple-400" />
        <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{t('asp.title')}</h3>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 pb-2" style={{ borderBottom: '1px solid var(--border-default)' }}>
        <TabButton active={tab === 'batch'} onClick={() => setTab('batch')} icon={<Play className="h-4 w-4" />} label={t('asp.tabBatch')} />
        <TabButton active={tab === 'folder'} onClick={() => setTab('folder')} icon={<FolderSearch className="h-4 w-4" />} label={t('asp.tabFolder')} />
        <TabButton active={tab === 'cookies'} onClick={() => setTab('cookies')} icon={<Cookie className="h-4 w-4" />} label={t('asp.tabCookies')} />
        <TabButton active={tab === 'mirrors'} onClick={() => setTab('mirrors')} icon={<Globe className="h-4 w-4" />} label={t('asp.tabMirrors')} />
        <TabButton active={tab === 'cache'} onClick={() => setTab('cache')} icon={<Database className="h-4 w-4" />} label={t('asp.tabCache')} />
        <TabButton active={tab === 'scheduler'} onClick={() => setTab('scheduler')} icon={<Clock className="h-4 w-4" />} label={t('asp.tabScheduler')} />
        <TabButton active={tab === 'report'} onClick={() => setTab('report')} icon={<TrendingUp className="h-4 w-4" />} label={t('asp.tabReport')} />
      </div>

      {tab === 'batch' && <BatchPanel />}
      {tab === 'folder' && <AdultFolderScraperPanel />}
      {tab === 'cookies' && <AdultCookieLoginPanel />}
      {tab === 'mirrors' && <MirrorsPanel />}
      {tab === 'cache' && <CachePanel />}
      {tab === 'scheduler' && <SchedulerPanel />}
      {tab === 'report' && <ReportPanel />}
    </div>
  )
}

function TabButton({
  active, onClick, icon, label,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-purple-500/20 text-purple-500 dark:text-purple-300' : 'hover:bg-[var(--nav-hover-bg)]',
      )}
      style={!active ? { color: 'var(--text-secondary)' } : undefined}
    >
      {icon}
      {label}
    </button>
  )
}

// ==================== 批量刮削面板 ====================

function BatchPanel() {
  const { t } = useTranslation()
  const dialog = useDialog()
  const [tasks, setTasks] = useState<AdultBatchTask[]>([])
  const [history, setHistory] = useState<AdultBatchTask[]>([])
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [opts, setOpts] = useState({
    library_id: '',
    only_unscraped: true,
    dry_run: false,
    concurrency: 2,
    aggregated: false,
  })
  const [progressByTask, setProgressByTask] = useState<Record<string, AdultBatchProgressEvent>>({})

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adultScraperApi.listBatchTasks()
      setTasks(res.data.data.active || [])
      setHistory(res.data.data.history || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTasks()
    const timer = setInterval(loadTasks, 3000)
    return () => clearInterval(timer)
  }, [loadTasks])

  // WebSocket 订阅进度事件
  useEffect(() => {
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`)
      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data)
          if (data?.type === 'adult_batch_progress' && data?.data?.task_id) {
            setProgressByTask((prev) => ({ ...prev, [data.data.task_id]: data.data }))
          }
          if (data?.type === 'adult_batch_completed') {
            loadTasks()
          }
        } catch {}
      }
      return () => ws.close()
    } catch {}
  }, [loadTasks])

  const handleStart = async () => {
    setStarting(true)
    try {
      await adultScraperApi.startBatch(opts)
      await loadTasks()
    } catch (err: any) {
      await dialog.alert({ title: t('asp.startFailed'), message: err?.response?.data?.error || err?.message, variant: 'error' })
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 启动控制 */}
      <div className="rounded-lg p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}>
        <div className="mb-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('asp.newTask')}</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <LabelCheck label={t('asp.onlyUnscraped')} checked={opts.only_unscraped} onChange={(v) => setOpts({ ...opts, only_unscraped: v })} />
          <LabelCheck label={t('asp.previewMode')} checked={opts.dry_run} onChange={(v) => setOpts({ ...opts, dry_run: v })} />
          <LabelCheck label={t('asp.aggMode')} checked={opts.aggregated} onChange={(v) => setOpts({ ...opts, aggregated: v })} />
          <LabelNumber label={t('asp.concurrency')} value={opts.concurrency} onChange={(v) => setOpts({ ...opts, concurrency: v })} min={1} max={8} />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={handleStart}
            disabled={starting}
            className="flex items-center gap-1.5 rounded-lg bg-purple-500 px-4 py-2 text-sm font-medium text-white hover:bg-purple-600 disabled:opacity-60"
          >
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {t('asp.startBatch')}
          </button>
          <button onClick={loadTasks} className="rounded-lg p-2 hover:bg-[var(--nav-hover-bg)]" style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
            <RefreshCw className={clsx('h-4 w-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* 活跃任务 */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          <Loader2 className="h-4 w-4 animate-spin text-green-500" />
          {t('asp.runningTasks', { count: tasks.length })}
        </div>
        {tasks.length === 0 ? (
          <div className="rounded-lg p-4 text-center text-sm" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>{t('asp.noRunning')}</div>
        ) : (
          <div className="space-y-2">
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                live={progressByTask[t.id]}
                onPause={async () => { await adultScraperApi.pauseBatch(t.id); loadTasks() }}
                onResume={async () => { await adultScraperApi.resumeBatch(t.id); loadTasks() }}
                onCancel={async () => { await adultScraperApi.cancelBatch(t.id); loadTasks() }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 历史任务 */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          <History className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
          {t('asp.historyTasks', { count: history.length })}
        </div>
        {history.length === 0 ? (
          <div className="rounded-lg p-4 text-center text-sm" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>{t('asp.noHistory')}</div>
        ) : (
          <div className="space-y-2">
            {history.slice(0, 10).map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TaskRow({
  task, live, onPause, onResume, onCancel,
}: {
  task: AdultBatchTask
  live?: AdultBatchProgressEvent
  onPause?: () => void
  onResume?: () => void
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  const current = live?.current ?? task.current
  const success = live?.success ?? task.success
  const failed = live?.failed ?? task.failed
  const skipped = live?.skipped ?? task.skipped
  const total = task.total
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0

  const statusColor =
    task.status === 'completed' ? 'text-green-500'
      : task.status === 'failed' ? 'text-red-500'
        : task.status === 'cancelled' ? 'text-gray-400'
          : task.status === 'paused' ? 'text-yellow-500'
            : 'text-blue-500'

  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className={clsx('font-mono font-semibold', statusColor)}>{task.status.toUpperCase()}</span>
            <span style={{ color: 'var(--text-secondary)' }}>#{task.id.slice(0, 8)}</span>
            {task.aggregated && <span className="rounded bg-purple-500/20 px-1.5 text-xs text-purple-500 dark:text-purple-300">{t('asp.aggBadge')}</span>}
            {task.dry_run && <span className="rounded bg-gray-500/20 px-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{t('asp.previewBadge')}</span>}
          </div>
          {live?.media_title && (
            <div className="mt-1 truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
              {live.status === 'failed' ? '❌' : live.status === 'success' ? '✅' : '⏳'} {live.code} · {live.media_title}
              {live.err_msg && <span className="ml-2 text-red-500">{live.err_msg}</span>}
            </div>
          )}
        </div>
        {/* shrink-0：防止左侧长标题触发 flex 收缩，挤压图标按钮 */}
        <div className="flex shrink-0 items-center gap-1">
          {task.status === 'running' && onPause && (
            <button onClick={onPause} className="rounded p-1.5 hover:bg-[var(--nav-hover-bg)]" style={{ color: 'var(--text-secondary)' }} title={t('asp.pause')}>
              <Pause className="h-4 w-4" />
            </button>
          )}
          {task.status === 'paused' && onResume && (
            <button onClick={onResume} className="rounded p-1.5 hover:bg-[var(--nav-hover-bg)]" style={{ color: 'var(--text-secondary)' }} title={t('asp.resume')}>
              <Play className="h-4 w-4" />
            </button>
          )}
          {(task.status === 'running' || task.status === 'paused') && onCancel && (
            <button onClick={onCancel} className="rounded p-1.5 text-red-500 hover:bg-red-500/10" title={t('common.cancel')}>
              <Square className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* 进度条 */}
      <div className="mt-2">
        <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--border-default)' }}>
          <div className="h-full bg-gradient-to-r from-blue-400 to-purple-400 transition-all" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span>{current} / {total} ({percent}%)</span>
          <span>
            <span className="text-green-500">✓ {success}</span>
            {' · '}
            <span className="text-red-500">✗ {failed}</span>
            {' · '}
            <span style={{ color: 'var(--text-secondary)' }}>{t('asp.skipped', { count: skipped })}</span>
          </span>
        </div>
      </div>
    </div>
  )
}

// ==================== 镜像管理面板 ====================

function MirrorsPanel() {
  const { t } = useTranslation()
  const [data, setData] = useState<Record<string, { mirrors: MirrorStatus[]; preferred: string }> | null>(null)
  const [lastHealthAt, setLastHealthAt] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adultScraperApi.listMirrors()
      setData(res.data.data.sources)
      setLastHealthAt(res.data.data.last_health_at || '')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleHealthCheck = async () => {
    setChecking(true)
    try {
      await adultScraperApi.healthCheckMirrors()
      await load()
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('asp.lastHealth', { time: lastHealthAt ? new Date(lastHealthAt).toLocaleString() : t('asp.never') })}
        </div>
        <button
          onClick={handleHealthCheck}
          disabled={checking}
          className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-60"
        >
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t('asp.allHealth')}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--text-secondary)' }} /></div>
      ) : (
        <div className="space-y-3">
          {data && Object.entries(data).map(([src, v]) => (
            <div key={src} className="rounded-lg p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}>
              <div className="mb-2 flex items-center justify-between">
                <div className="font-medium uppercase" style={{ color: 'var(--text-primary)' }}>{src}</div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('asp.preferred', { name: v.preferred })}</div>
              </div>
              <div className="space-y-1">
                {v.mirrors.map((m, i) => (
                  <div key={i} className="flex items-center justify-between rounded px-2 py-1 text-xs" style={{ background: 'var(--nav-hover-bg)' }}>
                    <div className="flex items-center gap-2">
                      {m.healthy ? <Wifi className="h-3.5 w-3.5 text-green-500" /> : <WifiOff className="h-3.5 w-3.5 text-red-500" />}
                      <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{m.url}</span>
                    </div>
                    <div style={{ color: 'var(--text-secondary)' }}>
                      {m.latency_ms > 0 && <span>{m.latency_ms}ms</span>}
                      {m.fail_count > 0 && <span className="ml-2 text-red-500">{t('asp.failCount', { count: m.fail_count })}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ==================== 缓存管理面板 ====================

function CachePanel() {
  const { t } = useTranslation()
  const dialog = useDialog()
  const [stats, setStats] = useState<{ size: number; max_size: number; total_hit: number; ttl: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adultScraperApi.getCacheStats()
      setStats(res.data.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleClear = async () => {
    const ok = await dialog.confirm({
      title: t('asp.clearCacheTitle'),
      message: t('asp.clearCacheMsg'),
      confirmText: t('asp.clear'),
      variant: 'danger',
    })
    if (!ok) return
    await adultScraperApi.clearCache()
    await load()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t('asp.statEntries')} value={stats?.size ?? 0} />
        <StatCard label={t('asp.statMax')} value={stats?.max_size ?? 0} />
        <StatCard label={t('asp.statHits')} value={stats?.total_hit ?? 0} />
        <StatCard label={t('asp.statTtl')} value={stats?.ttl ?? '-'} />
      </div>
      <div className="flex items-center gap-2">
        <button onClick={load} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm hover:bg-[var(--nav-hover-bg)]" style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t('common.refresh')}
        </button>
        <button onClick={handleClear} className="flex items-center gap-1.5 rounded-lg bg-red-500/80 px-3 py-1.5 text-sm text-white hover:bg-red-600">
          <Trash2 className="h-4 w-4" />
          {t('asp.clear')}
        </button>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}>
      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

// ==================== 定时调度面板 ====================

function SchedulerPanel() {
  const { t } = useTranslation()
  const dialog = useDialog()
  const [cfg, setCfg] = useState<AdultSchedulerConfig>({
    Enabled: false,
    DailyHour: 3,
    DailyMinute: 30,
    Concurrency: 2,
    OnlyUnscraped: true,
    Aggregated: false,
  })
  const [lastRunAt, setLastRunAt] = useState('')
  const [lastTaskID, setLastTaskID] = useState('')
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    const res = await adultScraperApi.getScheduler()
    if (res.data.data.config) {
      setCfg(res.data.data.config)
    }
    setLastRunAt(res.data.data.last_run_at || '')
    setLastTaskID(res.data.data.last_task_id || '')
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    try {
      await adultScraperApi.updateScheduler(cfg)
      await dialog.alert({ title: t('asp.saved'), variant: 'success' })
    } finally {
      setSaving(false)
    }
  }

  const handleRunNow = async () => {
    setRunning(true)
    try {
      const res = await adultScraperApi.triggerScheduler()
      await dialog.alert({ title: t('asp.taskStarted'), message: res.data.data.task_id, variant: 'success' })
      await load()
    } catch (e: any) {
      await dialog.alert({ title: t('asp.startFailed'), message: e?.response?.data?.error || e?.message, variant: 'error' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}>
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <LabelCheck label={t('asp.enableDaily')} checked={cfg.Enabled} onChange={(v) => setCfg({ ...cfg, Enabled: v })} />
          <LabelCheck label={t('asp.onlyFailed')} checked={cfg.OnlyUnscraped} onChange={(v) => setCfg({ ...cfg, OnlyUnscraped: v })} />
          <LabelNumber label={t('asp.execHour')} value={cfg.DailyHour} onChange={(v) => setCfg({ ...cfg, DailyHour: v })} min={0} max={23} />
          <LabelNumber label={t('asp.execMinute')} value={cfg.DailyMinute} onChange={(v) => setCfg({ ...cfg, DailyMinute: v })} min={0} max={59} />
          <LabelNumber label={t('asp.concurrency')} value={cfg.Concurrency} onChange={(v) => setCfg({ ...cfg, Concurrency: v })} min={1} max={8} />
          <LabelCheck label={t('asp.useAgg')} checked={cfg.Aggregated} onChange={(v) => setCfg({ ...cfg, Aggregated: v })} />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSave} disabled={saving} className="rounded-lg bg-blue-500 px-4 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-60">
            {saving ? t('asp.saving') : t('asp.saveConfig')}
          </button>
          <button onClick={handleRunNow} disabled={running} className="flex items-center gap-1.5 rounded-lg bg-purple-500 px-3 py-1.5 text-sm text-white hover:bg-purple-600 disabled:opacity-60">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {t('asp.triggerNow')}
          </button>
        </div>
      </div>

      <div className="rounded-lg p-3 text-sm" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
        <div>{t('asp.lastRunAt', { time: lastRunAt ? new Date(lastRunAt).toLocaleString() : t('asp.neverRun') })}</div>
        {lastTaskID && <div style={{ color: 'var(--text-secondary)' }}>{t('asp.lastTaskId', { id: lastTaskID })}</div>}
      </div>
    </div>
  )
}

// ==================== 分析报表面板 ====================

function ReportPanel() {
  const { t } = useTranslation()
  const dialog = useDialog()
  const [days, setDays] = useState(7)
  const [report, setReport] = useState<AdultScrapeReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [failedCount, setFailedCount] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const [loadErr, setLoadErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr('')
    try {
      const [r1, r2] = await Promise.all([
        adultScraperApi.getReport(days),
        adultScraperApi.getFailedItems(days),
      ])
      setReport(r1.data.data)
      setFailedCount(r2.data.count || 0)
    } catch (e: any) {
      setLoadErr(e?.response?.data?.error || e?.message || t('asp.loadReportFailed'))
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])

  const handleRetry = async () => {
    const ok = await dialog.confirm({
      title: t('asp.retryTitle'),
      message: t('asp.retryMsg', { days, count: failedCount }),
      confirmText: t('asp.retry'),
      variant: 'warning',
    })
    if (!ok) return
    setRetrying(true)
    try {
      const res = await adultScraperApi.retryFailed({ days, concurrency: 2 })
      await dialog.alert({
        title: t('asp.retryStarted'),
        message: `task_id: ${res.data.data.task_id}${t('asp.retryItems', { count: res.data.data.retry_count })}`,
        variant: 'success',
      })
    } catch (e: any) {
      await dialog.alert({ title: t('asp.retryFailed'), message: e?.response?.data?.error || e?.message, variant: 'error' })
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span style={{ color: 'var(--text-secondary)' }}>{t('asp.timeRange')}</span>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value, 10))}
          className="rounded-lg px-2 py-1"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
        >
          <option value={1}>{t('asp.last1d')}</option>
          <option value={7}>{t('asp.last7d')}</option>
          <option value={30}>{t('asp.last30d')}</option>
          <option value={0}>{t('asp.all')}</option>
        </select>
        <button onClick={load} className="rounded-lg p-1.5 hover:bg-[var(--nav-hover-bg)]" style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
        {failedCount > 0 && (
          <button onClick={handleRetry} disabled={retrying} className="ml-auto flex items-center gap-1.5 rounded-lg bg-orange-500/80 px-3 py-1.5 text-sm text-white hover:bg-orange-600 disabled:opacity-60">
            {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            {t('asp.retryN', { count: failedCount })}
          </button>
        )}
      </div>

      {loadErr && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
          ⚠️ {loadErr}
        </div>
      )}

      {!report && !loadErr && loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('asp.generating')}
        </div>
      )}

      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label={t('asp.statTotal')} value={report.total_processed ?? 0} />
            <StatCard label={t('asp.statSuccess')} value={report.total_success ?? 0} />
            <StatCard label={t('asp.statFailed')} value={report.total_failed ?? 0} />
            <StatCard label={t('asp.statRate')} value={`${((report.overall_rate ?? 0) * 100).toFixed(1)}%`} />
          </div>

          <div>
            <div className="mb-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('asp.sourceRates')}</div>
            {(report.by_source ?? []).length === 0 ? (
              <div className="rounded-lg p-3 text-center text-xs" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
                {t('asp.noSourceData')}
              </div>
            ) : (
              <div className="space-y-1">
                {(report.by_source ?? []).map((s) => (
                  <div key={s.source} className="rounded p-2 text-xs" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{s.source}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{s.success}/{s.total} ({(s.success_rate * 100).toFixed(1)}%)</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full" style={{ background: 'var(--border-default)' }}>
                      <div className="h-full bg-green-500" style={{ width: `${s.success_rate * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {(report.by_prefix ?? []).length > 0 && (
            <div>
              <div className="mb-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('asp.topPrefixes')}</div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {(report.by_prefix ?? []).slice(0, 8).map((p) => (
                  <div key={p.prefix} className="rounded px-2 py-1 text-xs" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}>
                    <div className="font-mono" style={{ color: 'var(--text-primary)' }}>{p.prefix}</div>
                    <div style={{ color: 'var(--text-secondary)' }}>{p.success}/{p.total} · {(p.success_rate * 100).toFixed(0)}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(report.top_failures ?? []).length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-red-500">
                <AlertTriangle className="h-4 w-4" />
                {t('asp.mostFailed')}
              </div>
              <div className="flex flex-wrap gap-1">
                {(report.top_failures ?? []).map((c) => (
                  <span key={c} className="rounded bg-red-500/15 px-2 py-0.5 text-xs font-mono text-red-500 dark:text-red-300">{c}</span>
                ))}
              </div>
            </div>
          )}

          {(report.best_hours ?? []).length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-300">
                <CheckCircle2 className="h-4 w-4" />
                {t('asp.bestHours')}
              </div>
              <div className="flex gap-2">
                {(report.best_hours ?? []).map((h) => (
                  <span key={h} className="rounded bg-green-500/15 px-2 py-0.5 text-xs text-green-600 dark:text-green-300">{h}:00</span>
                ))}
              </div>
            </div>
          )}

          {(report.total_processed ?? 0) === 0 && (
            <div className="rounded-lg p-4 text-center text-xs" style={{ background: 'var(--bg-elevated)', border: '1px dashed var(--border-default)', color: 'var(--text-secondary)' }}>
              {t('asp.noReportData')}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ==================== 公共表单组件 ====================

function LabelCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded p-2 text-sm" style={{ background: 'var(--nav-hover-bg)', color: 'var(--text-primary)' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-purple-500" />
      <span>{label}</span>
    </label>
  )
}

function LabelNumber({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <label className="flex items-center gap-2 rounded p-2 text-sm" style={{ background: 'var(--nav-hover-bg)' }}>
      <span className="min-w-0 flex-1" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        min={min}
        max={max}
        className="w-20 rounded px-2 py-1 text-right"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
      />
    </label>
  )
}
