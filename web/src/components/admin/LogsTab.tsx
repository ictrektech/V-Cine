import { useState, useEffect, useCallback } from 'react'
import { adminApi } from '@/api'
import type { SystemLog, SystemLogStats } from '@/types'
import { usePagination } from '@/hooks/usePagination'
import Pagination from '@/components/Pagination'
import {
  FileText,
  AlertTriangle,
  AlertCircle,
  Info,
  Bug,
  Download,
  Trash2,
  RefreshCw,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  Clock,
  Globe,
  User,
  Loader2,
  Activity,
  Server,
  Play,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { useTranslation } from '@/i18n'
import { Modal } from '@/components/ui/modal'

// 日志级别配置
const LEVEL_CONFIG: Record<string, { labelKey: string; color: string; bg: string; icon: typeof Info }> = {
  error: { labelKey: 'logs.levelError', color: 'text-red-400', bg: 'bg-red-500/10', icon: AlertCircle },
  warn: { labelKey: 'logs.levelWarn', color: 'text-yellow-400', bg: 'bg-yellow-500/10', icon: AlertTriangle },
  info: { labelKey: 'logs.levelInfo', color: 'text-blue-400', bg: 'bg-blue-500/10', icon: Info },
  debug: { labelKey: 'logs.levelDebug', color: 'text-surface-400', bg: 'bg-surface-500/10', icon: Bug },
}

// 日志类型配置
const TYPE_CONFIG: Record<string, { labelKey: string; icon: typeof Globe }> = {
  api: { labelKey: 'logs.typeApi', icon: Globe },
  playback: { labelKey: 'logs.typePlayback', icon: Play },
  system: { labelKey: 'logs.typeSystem', icon: Server },
}

// HTTP 方法颜色
const METHOD_COLORS: Record<string, string> = {
  GET: 'text-green-400',
  POST: 'text-blue-400',
  PUT: 'text-yellow-400',
  DELETE: 'text-red-400',
  PATCH: 'text-purple-400',
}

export default function LogsTab() {
  const { t, locale } = useTranslation()
  const [logs, setLogs] = useState<SystemLog[]>([])
  const [stats, setStats] = useState<SystemLogStats | null>(null)
  const [total, setTotal] = useState(0)
  const { page, size: pageSize, setPage, setSize, totalPages: calcTotalPages } = usePagination({ initialSize: 30 })
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 过滤条件
  const [filterType, setFilterType] = useState('')
  const [filterLevel, setFilterLevel] = useState('')
  const [filterKeyword, setFilterKeyword] = useState('')
  const [filterMethod, setFilterMethod] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // {t('logs.clean')}对话框
  const [showCleanDialog, setShowCleanDialog] = useState(false)
  const [cleanDays, setCleanDays] = useState(30)
  const [cleaning, setCleaning] = useState(false)

  // 加载日志
  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, any> = { page, size: pageSize }
      if (filterType) params.type = filterType
      if (filterLevel) params.level = filterLevel
      if (filterKeyword) params.keyword = filterKeyword
      if (filterMethod) params.method = filterMethod

      const res = await adminApi.listSystemLogs(params)
      setLogs(res.data.data || [])
      setTotal(res.data.total)
    } catch {
      // 静默处理
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, filterType, filterLevel, filterKeyword, filterMethod])

  // 加载统计
  const loadStats = useCallback(async () => {
    try {
      const res = await adminApi.getSystemLogStats()
      setStats(res.data.data)
    } catch {
      // 静默处理
    }
  }, [])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  // 搜索防抖
  const [searchInput, setSearchInput] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilterKeyword(searchInput)
      setPage(1)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  // {t('logs.export')}
  const handleExport = async () => {
    setExporting(true)
    try {
      const params: Record<string, any> = {}
      if (filterType) params.type = filterType
      if (filterLevel) params.level = filterLevel
      if (filterKeyword) params.keyword = filterKeyword
      if (filterMethod) params.method = filterMethod

      const res = await adminApi.exportSystemLogs(params)
      const blob = new Blob([res.data as any], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `system-logs-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // 静默处理
    } finally {
      setExporting(false)
    }
  }

  // 清理
  const handleClean = async () => {
    setCleaning(true)
    try {
      await adminApi.cleanSystemLogs(cleanDays)
      setShowCleanDialog(false)
      loadLogs()
      loadStats()
    } catch {
      // 静默处理
    } finally {
      setCleaning(false)
    }
  }

  const totalPages = calcTotalPages(total)

  // 格式化时间
  const formatTime = (raw: string) => {
    const d = new Date(raw)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return t('logs.justNow')
    if (diff < 3600000) return t('timeFormat.minutesAgo', { minutes: Math.floor(diff / 60000) })
    if (diff < 86400000) return t('timeFormat.hoursAgo', { hours: Math.floor(diff / 3600000) })
    return d.toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div className="space-y-6">
      {/* ===== 统计卡片 ===== */}
      {stats && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="glass-panel-subtle rounded-xl p-4">
            <div className="flex items-center gap-2 text-sm text-surface-400">
              <FileText size={14} className="text-neon/60" />
              {t('logs.totalTitle')}
            </div>
            <p className="mt-2 font-display text-2xl font-bold tracking-wide" style={{ color: 'var(--text-primary)' }}>
              {stats.total.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-surface-500">
              {t('logs.todayCount', { count: stats.today_count.toLocaleString() })}
            </p>
          </div>

          <div className="glass-panel-subtle rounded-xl p-4">
            <div className="flex items-center gap-2 text-sm text-surface-400">
              <AlertCircle size={14} className="text-red-400/60" />
              {t('logs.todayError')}
            </div>
            <p className={clsx('mt-2 font-display text-2xl font-bold tracking-wide', stats.today_errors > 0 ? 'text-red-400' : '')} style={stats.today_errors === 0 ? { color: 'var(--text-primary)' } : undefined}>
              {stats.today_errors}
            </p>
            <p className="mt-1 text-xs text-surface-500">
              {t('logs.totalError', { count: (stats.level_counts?.error || 0).toLocaleString() })}
            </p>
          </div>

          <div className="glass-panel-subtle rounded-xl p-4">
            <div className="flex items-center gap-2 text-sm text-surface-400">
              <Globe size={14} className="text-neon/60" />
              {t('logs.typeApi')}
            </div>
            <p className="mt-2 font-display text-2xl font-bold tracking-wide" style={{ color: 'var(--text-primary)' }}>
              {(stats.type_counts?.api || 0).toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-surface-500">
              {t('logs.playErrorCount', { count: (stats.type_counts?.playback || 0).toLocaleString() })}
            </p>
          </div>

          <div className="glass-panel-subtle rounded-xl p-4">
            <div className="flex items-center gap-2 text-sm text-surface-400">
              <Server size={14} className="text-neon/60" />
              {t('logs.typeSystem')}
            </div>
            <p className="mt-2 font-display text-2xl font-bold tracking-wide" style={{ color: 'var(--text-primary)' }}>
              {(stats.type_counts?.system || 0).toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-surface-500">
              {t('logs.warnCount', { count: (stats.level_counts?.warn || 0).toLocaleString() })}
            </p>
          </div>
        </div>
      )}

      {/* ===== 工具栏 ===== */}
      <div className="flex flex-wrap items-center gap-3">
        {/* 搜索框 */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="input pl-9 pr-3 py-2 text-sm w-full"
            placeholder={t('logs.searchPlaceholder')}
          />
        </div>

        {/* 快捷过滤按钮 */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => { setFilterLevel(filterLevel === 'error' ? '' : 'error'); setPage(1) }}
            className={clsx('btn-ghost px-3 py-2 text-xs gap-1.5 rounded-lg', filterLevel === 'error' && 'bg-red-500/10 text-red-400')}
          >
            <AlertCircle size={13} />
            {t('logs.onlyError')}
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx('btn-ghost px-3 py-2 text-xs gap-1.5 rounded-lg', showFilters && 'text-neon')}
          >
            <Filter size={13} />
            {t('logs.filter')}
          </button>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1.5">
          <button onClick={() => { loadLogs(); loadStats() }} className="btn-ghost px-3 py-2 text-xs gap-1.5 rounded-lg" disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {t('logs.refresh')}
          </button>
          <button onClick={handleExport} className="btn-ghost px-3 py-2 text-xs gap-1.5 rounded-lg" disabled={exporting}>
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {t('logs.export')}
          </button>
          <button onClick={() => setShowCleanDialog(true)} className="btn-ghost px-3 py-2 text-xs gap-1.5 rounded-lg text-red-400 hover:text-red-300">
            <Trash2 size={13} />
            {t('logs.clean')}
          </button>
        </div>
      </div>

      {/* ===== 展开的筛选面板 ===== */}
      {showFilters && (
        <div className="glass-panel-subtle rounded-xl p-4 flex flex-wrap gap-4 animate-slide-up">
          <div>
            <label className="block text-xs text-surface-400 mb-1.5">{t('logs.typeLabel')}</label>
            <select
              value={filterType}
              onChange={(e) => { setFilterType(e.target.value); setPage(1) }}
              className="input text-sm py-1.5 px-3 min-w-[120px]"
            >
              <option value="">{t('logs.allTypes')}</option>
              <option value="api">{t('logs.typeApi')}</option>
              <option value="playback">{t('logs.typePlayback')}</option>
              <option value="system">{t('logs.typeSystem')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-surface-400 mb-1.5">{t('logs.levelLabel')}</label>
            <select
              value={filterLevel}
              onChange={(e) => { setFilterLevel(e.target.value); setPage(1) }}
              className="input text-sm py-1.5 px-3 min-w-[120px]"
            >
              <option value="">{t('logs.allLevels')}</option>
              <option value="error">{t('logs.levelError')}</option>
              <option value="warn">{t('logs.levelWarn')}</option>
              <option value="info">{t('logs.levelInfo')}</option>
              <option value="debug">{t('logs.levelDebug')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-surface-400 mb-1.5">{t('logs.methodLabel')}</label>
            <select
              value={filterMethod}
              onChange={(e) => { setFilterMethod(e.target.value); setPage(1) }}
              className="input text-sm py-1.5 px-3 min-w-[120px]"
            >
              <option value="">{t('logs.allMethods')}</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          {(filterType || filterLevel || filterMethod || filterKeyword) && (
            <div className="flex items-end">
              <button
                onClick={() => { setFilterType(''); setFilterLevel(''); setFilterMethod(''); setSearchInput(''); setFilterKeyword(''); setPage(1) }}
                className="btn-ghost px-3 py-1.5 text-xs gap-1 text-surface-400 hover:text-surface-200"
              >
                <X size={12} />
                {t('logs.clearFilters')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===== 日志列表 ===== */}
      <div className="glass-panel rounded-xl overflow-hidden">
        {/* 表头 */}
        <div className="hidden md:grid grid-cols-[80px_70px_1fr_100px_80px_140px] gap-3 px-4 py-2.5 text-xs font-medium text-surface-400" style={{ borderBottom: '1px solid var(--border-default)' }}>
          <span>{t('logs.colLevel')}</span>
          <span>{t('logs.colType')}</span>
          <span>{t('logs.colMsg')}</span>
          <span>{t('logs.colStatus')}</span>
          <span>{t('logs.colCost')}</span>
          <span>{t('logs.colTime')}</span>
        </div>

        {/* 日志条目 */}
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-neon" />
            <span className="ml-3 text-sm text-surface-400">{t('logs.loading')}</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Activity size={40} className="text-surface-600 mb-3" />
            <p className="text-sm text-surface-500">{t('logs.empty')}</p>
            <p className="text-xs text-surface-600 mt-1">{t('logs.emptyHint')}</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border-default)' }}>
            {logs.map((log) => {
              const levelCfg = LEVEL_CONFIG[log.level] || LEVEL_CONFIG.info
              const typeCfg = TYPE_CONFIG[log.type] || TYPE_CONFIG.system
              const LevelIcon = levelCfg.icon
              const isExpanded = expandedId === log.id

              return (
                <div key={log.id}>
                  {/* 主行 */}
                  <div
                    className="grid grid-cols-1 md:grid-cols-[80px_70px_1fr_100px_80px_140px] gap-1 md:gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-[var(--nav-hover-bg)]"
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                  >
                    {/* 级别 */}
                    <div className="flex items-center gap-1.5">
                      <span className={clsx('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full', levelCfg.bg, levelCfg.color)}>
                        <LevelIcon size={11} />
                        <span className="hidden sm:inline">{t(levelCfg.labelKey)}</span>
                      </span>
                    </div>

                    {/* 类型 */}
                    <div className="flex items-center">
                      <span className="text-xs text-surface-400">{t(typeCfg.labelKey)}</span>
                    </div>

                    {/* 消息 */}
                    <div className="flex items-center gap-2 min-w-0">
                      {log.method && (
                        <span className={clsx('text-xs font-mono font-semibold flex-shrink-0', METHOD_COLORS[log.method] || 'text-surface-400')}>
                          {log.method}
                        </span>
                      )}
                      <span className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                        {log.path || log.message}
                      </span>
                      {isExpanded ? <ChevronUp size={12} className="flex-shrink-0 text-surface-500" /> : <ChevronDown size={12} className="flex-shrink-0 text-surface-500" />}
                    </div>

                    {/* 状态码 */}
                    <div className="flex items-center">
                      {log.status_code > 0 && (
                        <span className={clsx(
                          'text-xs font-mono font-medium px-2 py-0.5 rounded',
                          log.status_code >= 500 ? 'bg-red-500/10 text-red-400' :
                          log.status_code >= 400 ? 'bg-yellow-500/10 text-yellow-400' :
                          log.status_code >= 300 ? 'bg-blue-500/10 text-blue-400' :
                          'bg-green-500/10 text-green-400'
                        )}>
                          {log.status_code}
                        </span>
                      )}
                    </div>

                    {/* 耗时 */}
                    <div className="flex items-center">
                      {log.latency_ms > 0 && (
                        <span className={clsx(
                          'text-xs font-mono',
                          log.latency_ms > 1000 ? 'text-red-400' :
                          log.latency_ms > 300 ? 'text-yellow-400' :
                          'text-surface-400'
                        )}>
                          {log.latency_ms}ms
                        </span>
                      )}
                    </div>

                    {/* 时间 */}
                    <div className="flex items-center gap-1.5 text-xs text-surface-500">
                      <Clock size={11} />
                      {formatTime(log.created_at)}
                    </div>
                  </div>

                  {/* 展开详情 */}
                  {isExpanded && (
                    <div className="px-4 pb-3 pt-1 animate-slide-up" style={{ background: 'var(--nav-hover-bg)' }}>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        {log.message && (
                          <div>
                            <span className="text-surface-500">{t('logs.detailMsg')}</span>
                            <span className="text-surface-300 ml-1">{log.message}</span>
                          </div>
                        )}
                        {log.path && (
                          <div>
                            <span className="text-surface-500">{t('logs.detailPath')}</span>
                            <span className="text-surface-300 ml-1 font-mono">{log.path}</span>
                          </div>
                        )}
                        {log.client_ip && (
                          <div className="flex items-center gap-1">
                            <Globe size={11} className="text-surface-500" />
                            <span className="text-surface-500">IP：</span>
                            <span className="text-surface-300">{log.client_ip}</span>
                          </div>
                        )}
                        {log.username && (
                          <div className="flex items-center gap-1">
                            <User size={11} className="text-surface-500" />
                            <span className="text-surface-500">{t('logs.detailUser')}</span>
                            <span className="text-surface-300">{log.username}</span>
                          </div>
                        )}
                        {log.media_title && (
                          <div>
                            <span className="text-surface-500">{t('logs.detailMedia')}</span>
                            <span className="text-surface-300 ml-1">{log.media_title}</span>
                          </div>
                        )}
                        {log.source && (
                          <div>
                            <span className="text-surface-500">{t('logs.detailSource')}</span>
                            <span className="text-surface-300 ml-1">{log.source}</span>
                          </div>
                        )}
                        {log.user_agent && (
                          <div className="sm:col-span-2 lg:col-span-3">
                            <span className="text-surface-500">User-Agent：</span>
                            <span className="text-surface-300 ml-1 break-all">{log.user_agent}</span>
                          </div>
                        )}
                        {log.detail && (
                          <div className="sm:col-span-2 lg:col-span-3">
                            <span className="text-surface-500">{t('logs.detailDetail')}</span>
                            <pre className="mt-1 p-2 rounded bg-black/30 text-surface-300 text-[11px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto">
                              {log.detail}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* 分页 */}
        {total > 0 && (
          <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border-default)' }}>
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              pageSizeOptions={[20, 30, 50, 100, 200]}
              onPageChange={setPage}
              onPageSizeChange={setSize}
            />
          </div>
        )}
      </div>

      {/* ===== 清理对话框 ===== */}
      <Modal open={showCleanDialog} onClose={() => setShowCleanDialog(false)} className="max-w-md">
          <div className="glass-panel rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              {t('logs.clearTitle')}
            </h3>
            <p className="text-sm text-surface-400 mb-4">
              {t('logs.clearDesc')}
            </p>
            <div className="mb-5">
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                {t('logs.keepLast')}
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={cleanDays}
                  onChange={(e) => setCleanDays(Math.max(1, parseInt(e.target.value) || 1))}
                  className="input text-sm py-2 px-3 w-24"
                  min={1}
                />
                <span className="text-sm text-surface-400">{t('logs.days')}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => setShowCleanDialog(false)} className="btn-ghost px-4 py-2 text-sm">
                {t('common.cancel')}
              </button>
              <button
                onClick={handleClean}
                disabled={cleaning}
                className="btn-primary px-4 py-2 text-sm gap-1.5"
                style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' }}
              >
                {cleaning ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {t('logs.confirm')}
              </button>
            </div>
          </div>
        </Modal>
    </div>
  )
}
