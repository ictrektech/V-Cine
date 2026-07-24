import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Clock3, Loader2, RefreshCw, RotateCcw, Search, ScanLine } from 'lucide-react'
import { videoAnalysisApi } from '@/api'
import { useToast } from '@/components/Toast'
import { useWebSocket } from '@/hooks/useWebSocket'
import type { VideoAnalysisStatistics, VideoAnalysisStatus, VideoAnalysisTask } from '@/types/videoAnalysis'
import VideoAnalysisResultPanel from './VideoAnalysisResultPanel'

const statusMeta: Record<VideoAnalysisStatus, { label: string; className: string }> = {
  queued: { label: '排队中', className: 'text-surface-300 bg-surface-600/30' },
  running: { label: '分析中', className: 'text-amber-300 bg-amber-500/10' },
  succeeded: { label: '已完成', className: 'text-emerald-300 bg-emerald-500/10' },
  partial: { label: '部分完成', className: 'text-amber-300 bg-amber-500/10' },
  failed: { label: '失败', className: 'text-red-300 bg-red-500/10' },
  skipped: { label: '已跳过', className: 'text-surface-400 bg-surface-600/20' },
}

const stageLabels = { detect: '场景检测', structure: '结构分析', describe: '场景描述', done: '完成' }
const statusFilters: Array<{ value: '' | VideoAnalysisStatus; label: string }> = [
  { value: '', label: '全部状态' }, { value: 'queued', label: '排队中' }, { value: 'running', label: '分析中' },
  { value: 'succeeded', label: '已完成' }, { value: 'partial', label: '部分完成' }, { value: 'failed', label: '失败' },
]

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—'
}

export default function VideoAnalysisTaskTab() {
  const toast = useToast()
  const { on, off } = useWebSocket()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tasks, setTasks] = useState<VideoAnalysisTask[]>([])
  const [statistics, setStatistics] = useState<VideoAnalysisStatistics>({})
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
  const [resultTaskOverride, setResultTaskOverride] = useState<VideoAnalysisTask | null>(null)
  const pageSize = 20

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
    if (!quiet) setLoading(true)
    try {
      const [taskResponse, statsResponse] = await Promise.all([
        videoAnalysisApi.listTasks({ page, page_size: pageSize, status: status || undefined, keyword: query || undefined }),
        videoAnalysisApi.statistics(),
      ])
      setTasks(taskResponse.data.data.tasks || [])
      setTotal(taskResponse.data.data.total || 0)
      setStatistics(statsResponse.data.data || {})
      setUnavailable(false)
    } catch {
      setUnavailable(true)
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [page, status, query])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const handleUpdate = () => load(true)
    on('video_analysis_task_update', handleUpdate)
    return () => off('video_analysis_task_update', handleUpdate)
  }, [on, off, load])

  const retry = async (task: VideoAnalysisTask) => {
    setRetrying(task.id)
    try {
      await videoAnalysisApi.retryTask(task.id)
      toast.success('已从失败阶段重新排队')
      await load(true)
    } catch {
      toast.error('重试失败，请检查任务状态或视频文件')
    } finally {
      setRetrying(null)
    }
  }

  useEffect(() => {
    if (!urlResultTaskId) {
      setResultTaskOverride(null)
      return
    }
    const existing = tasks.find((task) => task.id === urlResultTaskId)
    if (existing) {
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
  }, [tasks, urlResultTaskId])

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
  const statusSummary = useMemo(() => statusFilters.find((item) => item.value === status)?.label || '全部状态', [status])

  return (
    <section className="space-y-4" aria-labelledby="video-analysis-heading">
      <div className="glass-panel rounded-xl p-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 id="video-analysis-heading" className="font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <ScanLine size={18} className="text-neon" />视频分析任务
          </h2>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>统一查看场景检测与视频结构分析进度{query ? ` · 当前筛选：${query}` : ''}{status ? ` · ${statusSummary}` : ''}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs min-w-64">
          <div className="rounded-lg bg-white/5 px-3 py-2"><strong className="block text-base">{activeCount}</strong>进行中</div>
          <div className="rounded-lg bg-emerald-500/10 px-3 py-2"><strong className="block text-base text-emerald-300">{statistics.succeeded || 0}</strong>已完成</div>
          <div className="rounded-lg bg-red-500/10 px-3 py-2"><strong className="block text-base text-red-300">{statistics.failed || 0}</strong>失败</div>
        </div>
      </div>

      {urlLastSkipped && (
        <div className="glass-panel rounded-xl border border-amber-400/20 bg-amber-500/5 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-300" />
            <div>
              <div className="font-medium text-amber-200">最近一次批量提交包含自动跳过</div>
              <p className="mt-1 text-surface-300">{urlLastSkipped}</p>
            </div>
          </div>
        </div>
      )}

      <div className="glass-panel rounded-xl p-3 flex flex-col gap-3 sm:flex-row">
        <form className="relative flex-1" onSubmit={(event) => { event.preventDefault(); const nextKeyword = keyword.trim(); setPage(1); setQuery(nextKeyword); syncUrl({ keyword: nextKeyword, page: 1 }) }}>
          <Search size={15} className="absolute left-3 top-2.5 text-surface-500" aria-hidden="true" />
          <input aria-label="搜索视频分析任务" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索媒体标题" className="w-full rounded-lg border bg-transparent py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-neon" style={{ borderColor: 'var(--border-default)' }} />
        </form>
        <select aria-label="按状态筛选" value={status} onChange={(event) => { const nextStatus = event.target.value as '' | VideoAnalysisStatus; setPage(1); setStatus(nextStatus); syncUrl({ status: nextStatus, page: 1 }) }} className="rounded-lg border bg-surface-900 px-3 py-2 text-sm" style={{ borderColor: 'var(--border-default)' }}>
          {statusFilters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <button onClick={() => load()} className="btn-ghost rounded-lg px-3 py-2 text-sm flex items-center justify-center gap-1.5"><RefreshCw size={14} />刷新</button>
      </div>

      <div className="glass-panel rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-16 text-center" aria-busy="true"><Loader2 className="mx-auto animate-spin text-neon" /><p className="mt-2 text-sm text-surface-400">正在加载任务…</p></div>
        ) : unavailable ? (
          <div className="py-16 px-4 text-center" role="alert"><AlertCircle className="mx-auto text-amber-400" /><h3 className="mt-3 font-medium">无法加载视频分析任务</h3><p className="mt-1 text-sm text-surface-400">请检查网络，或确认 video_analysis、Scene 与 Structure 服务已正确配置。</p><div className="mt-4 flex flex-wrap items-center justify-center gap-2"><button onClick={() => load()} className="btn-ghost rounded-lg px-4 py-2 text-sm">重新检查</button><button onClick={() => { window.location.href = '/admin#ai' }} className="btn-ghost rounded-lg px-4 py-2 text-sm text-amber-300 hover:bg-amber-400/10">前往系统配置</button></div></div>
        ) : tasks.length === 0 ? (
          <div className="py-16 px-4 text-center"><ScanLine className="mx-auto text-surface-500" /><h3 className="mt-3 font-medium">暂无视频分析任务</h3><p className="mt-1 text-sm text-surface-400">从文件列表选择视频并发起分析后，任务会显示在这里。</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-surface-400 border-b" style={{ borderColor: 'var(--border-default)' }}><tr><th className="px-4 py-3 font-medium">媒体</th><th className="px-3 py-3 font-medium">状态</th><th className="px-3 py-3 font-medium">阶段 / 进度</th><th className="px-3 py-3 font-medium">提交时间</th><th className="px-4 py-3 font-medium text-right">操作</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {tasks.map((task) => {
                  const meta = statusMeta[task.status]
                  const isFocused = urlTaskId !== '' && task.id === urlTaskId
                  return <tr key={task.id} className={isFocused ? 'bg-neon-blue/10' : 'hover:bg-white/[0.025]'}>
                    <td className="px-4 py-3 max-w-xs"><div className="font-medium truncate" title={task.media_title}>{task.media_title || '未命名媒体'}{isFocused && <span className="ml-2 inline-flex rounded bg-neon-blue/15 px-1.5 py-0.5 text-[10px] text-neon">当前关注</span>}</div><div className="text-xs text-surface-500 mt-1">{task.trigger === 'auto' ? '媒体库自动分析' : '手动提交'} · 第 {task.attempt || 0} 次执行</div></td>
                    <td className="px-3 py-3"><span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${meta.className}`}>{task.status === 'running' ? <Loader2 size={12} className="animate-spin" /> : task.status === 'succeeded' ? <CheckCircle2 size={12} /> : <Clock3 size={12} />}{meta.label}</span>{task.error_message && <p className="mt-1 max-w-52 truncate text-xs text-red-300" title={task.error_message}>{task.error_message}</p>}</td>
                    <td className="px-3 py-3"><div className="flex justify-between text-xs mb-1"><span>{stageLabels[task.stage]}</span><span>{Math.round(task.progress)}%</span></div><div className="h-1.5 w-40 rounded-full bg-surface-700 overflow-hidden"><div className="h-full bg-neon-blue transition-all" style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }} /></div></td>
                    <td className="px-3 py-3 text-xs text-surface-400">{formatTime(task.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        {(task.status === 'succeeded' || task.status === 'partial') && (
                          <button onClick={() => openResult(task)} className="btn-ghost rounded-lg px-2.5 py-1.5 text-xs inline-flex items-center gap-1 text-cyan-300 hover:bg-cyan-400/10">
                            <ScanLine size={13} /> 结果详情
                          </button>
                        )}
                        {(task.status === 'failed' || task.status === 'partial') && <button disabled={retrying === task.id} onClick={() => retry(task)} className="btn-ghost rounded-lg px-2.5 py-1.5 text-xs inline-flex items-center gap-1 disabled:opacity-50">{retrying === task.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}重试</button>}
                      </div>
                    </td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && !unavailable && total > 0 && <nav aria-label="视频分析任务分页" className="flex items-center justify-between text-sm"><span className="text-surface-400">共 {total} 项</span><div className="flex items-center gap-2"><button disabled={page <= 1} onClick={() => { const next = page - 1; setPage(next); syncUrl({ page: next }) }} className="btn-ghost rounded-lg px-3 py-1.5 disabled:opacity-40">上一页</button><span className="text-surface-400">{page} / {totalPages}</span><button disabled={page >= totalPages} onClick={() => { const next = page + 1; setPage(next); syncUrl({ page: next }) }} className="btn-ghost rounded-lg px-3 py-1.5 disabled:opacity-40">下一页</button></div></nav>}

      {urlResultTaskId && (
        <VideoAnalysisResultPanel task={selectedResultTask} onClose={closeResult} />
      )}
    </section>
  )
}
