import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, Loader2, RefreshCw, RotateCcw, ScanLine, Search, Trash2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { videoAnalysisApi } from '@/api'
import { streamApi } from '@/api/stream'
import { usePosterVersion } from '@/stores/mediaRefresh'
import { useAuthStore } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useDialog } from '@/components/Dialog'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/i18n'
import { useWebSocket } from '@/hooks/useWebSocket'
import { toAppUrl } from '@/lib/appUrl'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/routes'
import type { VideoAnalysisDetailedStats, VideoAnalysisStatistics, VideoAnalysisStatus, VideoAnalysisTask } from '@/types/videoAnalysis'
import VideoAnalysisResultDrawer from './VideoAnalysisResultDrawer'
import { formatVideoAnalysisError, formatVideoAnalysisTime, videoAnalysisStageKeys, videoAnalysisStatusKeys, videoAnalysisStatusMeta } from './videoAnalysisResultUtils'

const statusFilters: Array<{ value: '' | VideoAnalysisStatus; labelKey: string }> = [
  { value: '', labelKey: 'vat.statusAll' }, { value: 'queued', labelKey: 'vat.statusQueued' }, { value: 'running', labelKey: 'vat.statusRunning' },
  { value: 'succeeded', labelKey: 'vat.statusSucceeded' }, { value: 'partial', labelKey: 'vat.statusPartial' }, { value: 'failed', labelKey: 'vat.statusFailed' },
]

function StatusBadge({ status }: { status: VideoAnalysisStatus }) {
  const { t } = useTranslation()
  const meta = videoAnalysisStatusMeta[status]
  return (
    <Badge key={status} variant="outline" className={cn('gap-1 animate-in zoom-in-125 duration-300', meta.className)}>
      {status === 'running' ? <Loader2 className="h-3 w-3 animate-spin" /> : status === 'succeeded' ? <CheckCircle2 className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}
      {t(videoAnalysisStatusKeys[status])}
    </Badge>
  )
}

interface TaskActionButtonsProps {
  task: VideoAnalysisTask
  retrying: string | null
  deleting: string | null
  onRetry: () => void
  onDelete: () => void
  onOpenResult: () => void
}

function TaskActionButtons({ task, retrying, deleting, onRetry, onDelete, onOpenResult }: TaskActionButtonsProps) {
  const { t } = useTranslation()
  return (
    <div className="inline-flex items-center gap-1">
      {(task.status === 'succeeded' || task.status === 'partial') && (
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onOpenResult} title={t('vat.viewResult')}>
          <ScanLine />{t('vat.result')}
        </Button>
      )}
      {(task.status === 'failed' || task.status === 'partial') && (
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={retrying === task.id} onClick={onRetry}>
          {retrying === task.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}{t('common.retry')}
        </Button>
      )}
      {task.status !== 'running' && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
          disabled={deleting === task.id}
          onClick={onDelete}
          title={t('vat.deleteTaskTitle')}
        >
          {deleting === task.id ? <Loader2 className="animate-spin" /> : <Trash2 />}{t('common.delete')}
        </Button>
      )}
    </div>
  )
}

interface VideoAnalysisTaskTabProps {
  disabled?: boolean
  disabledReason?: string
}

export default function VideoAnalysisTaskTab({ disabled = false, disabledReason = '' }: VideoAnalysisTaskTabProps) {
  const toast = useToast()
  const { t } = useTranslation()
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  // 海报版本戳：刮削/替换海报后自动绕过浏览器缓存
  usePosterVersion()
  const dialog = useDialog()
  const { on, off } = useWebSocket()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tasks, setTasks] = useState<VideoAnalysisTask[]>([])
  const [statistics, setStatistics] = useState<VideoAnalysisStatistics>({})
  const [detailedStats, setDetailedStats] = useState<VideoAnalysisDetailedStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const urlStatus = searchParams.get('analysisStatus')
  const urlKeyword = searchParams.get('analysisKeyword') || ''
  const urlTaskId = searchParams.get('analysisTaskId') || ''
  const urlLastSkipped = searchParams.get('analysisLastSkipped') || ''
  const urlResultTaskId = searchParams.get('analysisResultTaskId') || ''
  const urlPage = Math.max(1, Number(searchParams.get('analysisPage') || '1') || 1)
  const [status, setStatus] = useState<'' | VideoAnalysisStatus>((urlStatus as '' | VideoAnalysisStatus) || '')
  const [keyword, setKeyword] = useState(urlKeyword)
  const [query, setQuery] = useState(urlKeyword)
  const [page, setPage] = useState(urlPage)
  const [total, setTotal] = useState(0)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [resultTaskOverride, setResultTaskOverride] = useState<VideoAnalysisTask | null>(null)
  const pageSize = 20

  // 分组展开：expandedMedia 为当前展开的媒体 ID，历史记录按需拉取
  const [expandedMedia, setExpandedMedia] = useState<string | null>(null)
  const [history, setHistory] = useState<VideoAnalysisTask[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    setStatus((urlStatus as '' | VideoAnalysisStatus) || '')
    setKeyword(urlKeyword)
    setQuery(urlKeyword)
    setPage(urlPage)
  }, [urlKeyword, urlPage, urlStatus])

  const syncUrl = useCallback((next: { status?: '' | VideoAnalysisStatus; keyword?: string; page?: number }) => {
    const params = new URLSearchParams(searchParams)
    const nextStatus = next.status ?? status
    const nextKeyword = next.keyword ?? query
    const nextPage = next.page ?? page
    if (nextStatus) params.set('analysisStatus', nextStatus)
    else params.delete('analysisStatus')
    if (nextKeyword) params.set('analysisKeyword', nextKeyword)
    else params.delete('analysisKeyword')
    if (nextPage > 1) params.set('analysisPage', String(nextPage))
    else params.delete('analysisPage')
    setSearchParams(params, { replace: true })
  }, [page, query, searchParams, setSearchParams, status])

  const load = useCallback(async (quiet = false) => {
    if (disabled) return
    if (!quiet) setLoading(true)
    try {
      const [taskResponse, statsResponse, detailedResponse] = await Promise.all([
        videoAnalysisApi.listTasks({ page, page_size: pageSize, status: status || undefined, keyword: query || undefined, group_by_media: true }),
        videoAnalysisApi.statistics(),
        videoAnalysisApi.detailedStatistics().catch(() => ({ data: { data: null } })),
      ])
      setTasks(taskResponse.data.data.tasks || [])
      setTotal(taskResponse.data.data.total || 0)
      setStatistics(statsResponse.data.data || {})
      setDetailedStats(detailedResponse.data.data || null)
      setUnavailable(false)
    } catch {
      setUnavailable(true)
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [page, status, query, disabled])

  useEffect(() => { load() }, [load])

  const loadHistory = useCallback(async (mediaId: string, quiet = false) => {
    if (!quiet) setHistoryLoading(true)
    try {
      const res = await videoAnalysisApi.listTasks({ media_id: mediaId, page_size: 5 })
      setHistory(res.data.data.tasks || [])
    } catch {
      setHistory([])
    } finally {
      if (!quiet) setHistoryLoading(false)
    }
  }, [])

  // 展开的媒体变化时拉取历史记录（后端按媒体保留最近 5 条）
  useEffect(() => {
    if (expandedMedia) loadHistory(expandedMedia)
  }, [expandedMedia, loadHistory])

  useEffect(() => {
    const handleUpdate = () => {
      load(true)
      if (expandedMedia) loadHistory(expandedMedia, true)
    }
    on('video_analysis_task_update', handleUpdate)
    return () => off('video_analysis_task_update', handleUpdate)
  }, [on, off, load, expandedMedia, loadHistory])

  const retry = async (task: VideoAnalysisTask) => {
    setRetrying(task.id)
    try {
      await videoAnalysisApi.retryTask(task.id)
      await load(true)
      if (expandedMedia) loadHistory(expandedMedia, true)
    } catch {
      toast.error(t('vat.retryFailed'))
    } finally {
      setRetrying(null)
    }
  }

  const removeTask = async (task: VideoAnalysisTask) => {
    const ok = await dialog.confirm({
      title: t('vat.deleteDialogTitle'),
      message: t('vat.deleteDialogMsg', { title: task.media_title || t('vat.untitled') }),
      confirmText: t('common.delete'),
      variant: 'danger',
    })
    if (!ok) return
    setDeleting(task.id)
    try {
      await videoAnalysisApi.deleteTask(task.id)
      // 若正在查看该任务结果，收起详情并清掉焦点标记
      if (urlResultTaskId === task.id || urlTaskId === task.id) {
        const params = new URLSearchParams(searchParams)
        if (urlResultTaskId === task.id) params.delete('analysisResultTaskId')
        if (urlTaskId === task.id) params.delete('analysisTaskId')
        setSearchParams(params, { replace: true })
      }
      toast.success(t('vat.deleted'))
      await load(true)
      if (expandedMedia) loadHistory(expandedMedia, true)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('vat.deleteFailed'))
    } finally {
      setDeleting(null)
    }
  }

  const resultTaskInList = useMemo(
    () => (urlResultTaskId ? tasks.some((task) => task.id === urlResultTaskId) : false),
    [tasks, urlResultTaskId],
  )

  useEffect(() => {
    if (!urlResultTaskId || resultTaskInList) {
      setResultTaskOverride(null)
      return
    }
    let cancelled = false
    videoAnalysisApi.getTask(urlResultTaskId)
      .then((res) => {
        if (!cancelled) setResultTaskOverride(res.data.data)
      })
      .catch(() => {
        if (!cancelled) setResultTaskOverride(null)
      })
    return () => {
      cancelled = true
    }
  }, [urlResultTaskId, resultTaskInList])

  const selectedResultTask = useMemo(() => {
    if (!urlResultTaskId) return null
    return tasks.find((task) => task.id === urlResultTaskId) || resultTaskOverride || null
  }, [tasks, urlResultTaskId, resultTaskOverride])

  const openResult = useCallback((task: VideoAnalysisTask) => {
    const params = new URLSearchParams(searchParams)
    params.set('analysisTaskId', task.id)
    params.set('analysisResultTaskId', task.id)
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

  const closeResult = useCallback(() => {
    const params = new URLSearchParams(searchParams)
    params.delete('analysisResultTaskId')
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const activeCount = (statistics.queued || 0) + (statistics.running || 0)
  const statusSummary = t(statusFilters.find((item) => item.value === status)?.labelKey || 'vat.statusAll')

  return (
    <section className="space-y-4" aria-labelledby="video-analysis-heading">
      <Card className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 id="video-analysis-heading" className="flex items-center gap-2 font-semibold text-foreground">
            <ScanLine className="h-[18px] w-[18px] text-primary" />{t('vat.title')}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('vat.subtitle')}{query ? ` · ${t('vat.currentFilter', { query })}` : ''}{status ? ` · ${statusSummary}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span>{t('vat.active')} <strong className="text-sm text-foreground">{activeCount}</strong></span>
          <span>{t('vat.statusSucceeded')} <strong className="text-sm text-emerald-400">{statistics.succeeded || 0}</strong></span>
          <span>{t('vat.statusFailed')} <strong className="text-sm text-red-400">{statistics.failed || 0}</strong></span>
          <span>{t('vat.successRate')} <strong className="text-sm text-foreground">{detailedStats ? `${Math.round(detailedStats.success_rate)}%` : '—'}</strong></span>
          {detailedStats && detailedStats.total_tasks > 0 && (
            <>
              <span>{t('vat.avgElapsed')} <strong className="text-sm text-foreground">{detailedStats.avg_elapsed_seconds > 0 ? `${Math.round(detailedStats.avg_elapsed_seconds)}${t('vat.seconds')}` : '—'}</strong></span>
              <span>{t('vat.errorRate')} <strong className="text-sm text-red-400">{detailedStats.error_rate > 0 ? `${detailedStats.error_rate.toFixed(1)}%` : '0%'}</strong></span>
              <span>{t('vat.statusPartial')} <strong className="text-sm text-amber-400">{detailedStats.partial_rate > 0 ? `${detailedStats.partial_rate.toFixed(1)}%` : '0%'}</strong></span>
            </>
          )}
        </div>
      </Card>

      {urlLastSkipped && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div>
              <div className="font-medium text-amber-400">{t('vat.lastSkippedTitle')}</div>
              <p className="mt-1 text-muted-foreground">{urlLastSkipped}</p>
            </div>
          </div>
        </div>
      )}

      <Card className="flex flex-col gap-3 p-3 sm:flex-row">
        <form className="relative flex-1" onSubmit={(event) => { event.preventDefault(); const nextKeyword = keyword.trim(); setPage(1); setQuery(nextKeyword); syncUrl({ keyword: nextKeyword, page: 1 }) }}>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input aria-label={t('vat.searchAria')} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t('vat.searchPlaceholder')} className="h-9 pl-9" />
        </form>
        <select aria-label={t('vat.filterByStatus')} value={status} onChange={(event) => { const nextStatus = event.target.value as '' | VideoAnalysisStatus; setPage(1); setStatus(nextStatus); syncUrl({ status: nextStatus, page: 1 }) }} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
          {statusFilters.map((item) => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}
        </select>
        <Button variant="outline" size="sm" className="h-9 px-3" onClick={() => load()}><RefreshCw />{t('vat.refresh')}</Button>
      </Card>

      <Card className="overflow-hidden">
        {disabled ? (
          <div className="px-4 py-16 text-center" role="status"><AlertCircle className="mx-auto text-amber-400" /><h3 className="mt-3 font-medium">{t('vat.disabledTitle')}</h3><p className="mt-1 text-sm text-muted-foreground">{disabledReason || t('vat.disabledDesc')}</p><div className="mt-4 flex flex-wrap items-center justify-center gap-2"><Button variant="outline" size="sm" onClick={() => { window.location.href = toAppUrl(routes.admin()) }}>{t('vat.goConfig')}</Button></div></div>
        ) : loading ? (
          <div className="divide-y divide-border" aria-busy="true" aria-label={t('vat.loadingTasks')}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-14 w-10 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        ) : unavailable ? (
          <div className="px-4 py-16 text-center" role="alert"><AlertCircle className="mx-auto text-amber-400" /><h3 className="mt-3 font-medium">{t('vat.loadFailed')}</h3><p className="mt-1 text-sm text-muted-foreground">{t('vat.loadFailedDesc')}</p><div className="mt-4 flex flex-wrap items-center justify-center gap-2"><Button variant="outline" size="sm" onClick={() => load()}>{t('vat.recheck')}</Button><Button variant="outline" size="sm" onClick={() => { window.location.href = toAppUrl(routes.admin()) }}>{t('vat.goConfig')}</Button></div></div>
        ) : tasks.length === 0 ? (
          <div className="py-16 text-center"><ScanLine className="mx-auto text-muted-foreground" /><h3 className="mt-3 font-medium">{t('vat.empty')}</h3><p className="mt-1 text-sm text-muted-foreground">{t('vat.emptyHint')}</p></div>
        ) : (
          <div className="divide-y divide-border">
            {tasks.map((task) => {
              const isFocused = urlTaskId !== '' && task.id === urlTaskId
              const expanded = expandedMedia === task.media_id
              const historyTasks = expanded ? history.filter((item) => item.id !== task.id) : []
              return (
                <div key={task.id} className={cn(isFocused && 'bg-accent/40')}>
                  {/* 组头 = 该媒体最新一条任务 */}
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                    <button onClick={() => setExpandedMedia(expanded ? null : task.media_id)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={expanded}>
                      <img
                        src={streamApi.getPosterUrl(task.media_id)}
                        alt=""
                        loading="lazy"
                        className="h-14 w-10 shrink-0 rounded-md border border-border object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-foreground" title={task.media_title}>
                          {task.media_title || t('vat.untitled')}
                          {isFocused && <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px] font-normal">{t('vat.currentFocus')}</Badge>}
                          {expanded && <Badge variant="outline" className="ml-2 border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-normal text-emerald-400">{t('vat.latest')}</Badge>}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{task.trigger === 'auto' ? t('vat.triggerAuto') : t('vat.triggerManual')} · {formatVideoAnalysisTime(task.created_at)}</div>
                        {task.status === 'running' && (
                          <div className="mt-1.5 flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">{t(videoAnalysisStageKeys[task.stage] || 'vat.stageDone')} {Math.round(task.progress)}%</span>
                            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }} /></div>
                          </div>
                        )}
                        {task.error_message && task.status !== 'running' && (
                          <p className="mt-1 max-w-52 truncate text-xs text-red-400" title={formatVideoAnalysisError(task.error_message, t)}>{formatVideoAnalysisError(task.error_message, t)}</p>
                        )}
                        {task.missing_model && task.status !== 'running' && (
                          <p className="mt-0.5 text-[11px] text-amber-400">{t('vat.missingModel', { model: task.missing_model })}{isAdmin ? t('vat.missingModelAdmin') : t('vat.missingModelContact')}</p>
                        )}
                      </div>
                      <StatusBadge status={task.status} />
                    </button>
                    <TaskActionButtons
                      task={task}
                      retrying={retrying}
                      deleting={deleting}
                      onRetry={() => retry(task)}
                      onDelete={() => removeTask(task)}
                      onOpenResult={() => openResult(task)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setExpandedMedia(expanded ? null : task.media_id)}
                      aria-expanded={expanded}
                      title={t('vat.historyTitle')}
                    >
                      <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} />
                    </Button>
                  </div>
                  {/* 展开的历史执行记录（后端按媒体保留最近 5 条） */}
                  {expanded && (
                    <div className="animate-in fade-in-0 slide-in-from-top-1 duration-200 border-t border-border bg-muted/30 px-4 py-2">
                      {historyLoading ? (
                        <div className="space-y-2 py-2" aria-busy="true" aria-label={t('vat.loadingHistory')}>
                          <Skeleton className="h-4 w-2/3" />
                          <Skeleton className="h-4 w-1/2" />
                        </div>
                      ) : historyTasks.length === 0 ? (
                        <div className="py-2 text-xs text-muted-foreground">{t('vat.noEarlierHistory')}</div>
                      ) : (
                        <>
                          <div className="py-1 text-xs text-muted-foreground">{t('vat.historyRecent', { count: 5 })}</div>
                          <div className="divide-y divide-border">
                            {historyTasks.map((item) => (
                              <div key={item.id} className="flex flex-wrap items-center gap-2 py-2 sm:gap-3">
                                <span className="w-16 shrink-0 text-xs text-muted-foreground">{t('vat.attemptN', { n: item.seq || item.attempt || 1 })}</span>
                                <StatusBadge status={item.status} />
                                {item.error_message && <p className="min-w-0 flex-1 truncate text-xs text-red-400" title={formatVideoAnalysisError(item.error_message, t)}>{formatVideoAnalysisError(item.error_message, t)}</p>}
                                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatVideoAnalysisTime(item.created_at)}</span>
                                <TaskActionButtons
                                  task={item}
                                  retrying={retrying}
                                  deleting={deleting}
                                  onRetry={() => retry(item)}
                                  onDelete={() => removeTask(item)}
                                  onOpenResult={() => openResult(item)}
                                />
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {!loading && !unavailable && total > 0 && (
        <nav aria-label={t('vat.paginationAria')} className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t('vat.totalMedia', { total })}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => { const next = page - 1; setPage(next); syncUrl({ page: next }) }}>{t('vat.prevPage')}</Button>
            <span className="text-muted-foreground">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => { const next = page + 1; setPage(next); syncUrl({ page: next }) }}>{t('vat.nextPage')}</Button>
          </div>
        </nav>
      )}

      <VideoAnalysisResultDrawer task={selectedResultTask} onClose={closeResult} />
    </section>
  )
}
