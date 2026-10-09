import { useCallback, useEffect, useState } from 'react'
import { CloudDownload, Download, Loader2, RefreshCw } from 'lucide-react'
import { videoAnalysisApi, type ModelHubModelStatus } from '@/api/videoAnalysis'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/Toast'
import { useAuthStore } from '@/stores/auth'

const POLL_INTERVAL = 3000

// 提取错误展示文案：后端业务 error 字段 > Error.message > 兜底文案。
function errorMessage(e: unknown, fallback: string): string {
  if (!(e instanceof Error)) return fallback
  const data = (e as { response?: { data?: { error?: string } } }).response?.data
  return data?.error || e.message || fallback
}

/** 展示 Model Hub 缺失模型的“一键下载”入口：查询状态 → 触发下载 → 展示进度。 */
export default function ModelHubDownloadNotice({ model }: { model: string }) {
  const toast = useToast()
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const [status, setStatus] = useState<ModelHubModelStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [pulling, setPulling] = useState(false)
  const [error, setError] = useState('')

  const fetchStatus = useCallback(async () => {
    try {
      const res = await videoAnalysisApi.getModelHubStatus(model)
      setStatus(res.data.data)
      setError('')
    } catch (e) {
      setError(errorMessage(e, '查询模型状态失败'))
    } finally {
      setLoading(false)
    }
  }, [model])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  // 下载中每 3s 轮询进度；下载完成/失败后自动停止
  const s = status?.status
  useEffect(() => {
    if (s !== 'pulling') return
    const id = setInterval(fetchStatus, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [s, fetchStatus])

  const startDownload = async () => {
    setPulling(true)
    try {
      await videoAnalysisApi.pullModelHubModel(model)
      toast.success('已开始下载模型，请稍候…')
      await fetchStatus()
    } catch (e) {
      const msg = errorMessage(e, '触发下载失败')
      toast.error(msg)
      setError(msg)
    } finally {
      setPulling(false)
    }
  }

  const retryQuery = () => {
    setLoading(true)
    fetchStatus()
  }

  // 状态文案：ready/pulling 有专属文案，其余（missing/failed/unsupported/未知）统一缺省文案
  const hintTexts: Record<string, string> = { ready: '已就绪，可重试场景描述', pulling: '正在下载…' }
  const hintText = hintTexts[s ?? ''] ?? '未下载，需先拉取到 Model Hub 才能生成场景描述'
  const hintClassName = s === 'ready' ? 'text-emerald-400' : 'text-amber-300'

  // 缺失模型统一提示卡片；管理员可触发下载
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
      <CloudDownload className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs text-foreground">
          场景描述模型 <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-amber-300">{status?.requested || model}</code>{' '}
          <span className={hintClassName}>{hintText}</span>
        </p>
        {status?.status === 'pulling' && (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-amber-400 transition-all"
                style={{ width: `${Math.min(100, Math.round((status.progress ?? 0) * 100))}%` }}
              />
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground">{Math.round((status.progress ?? 0) * 100)}%</span>
            {status.current_file && <span className="truncate text-[11px] text-muted-foreground">{status.current_file}</span>}
          </div>
        )}
        {status?.status === 'failed' && (
          <p className="text-[11px] text-red-400">下载失败：{status.error_msg || '未知错误'}</p>
        )}
        {error && !status && <p className="text-[11px] text-red-400">{error}</p>}
        {status?.status === 'unsupported' && (
          <p className="text-[11px] text-muted-foreground">该模型不是 Model Hub 托管的模型，请检查模型配置或联系管理员。</p>
        )}
        <div className="flex gap-2 pt-0.5">
          {isAdmin && (status?.status === 'missing' || status?.status === 'failed' || !status) && (
            <Button variant="outline" size="sm" className="h-7" disabled={pulling} onClick={startDownload}>
              {pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              下载到 Model Hub
            </Button>
          )}
          {isAdmin && status?.status === 'pulling' && (
            <span className="inline-flex h-7 items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 下载中…
            </span>
          )}
          <Button variant="ghost" size="sm" className="h-7" onClick={retryQuery} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> 刷新状态
          </Button>
          {!isAdmin && <span className="text-[11px] text-muted-foreground">请联系管理员下载该模型后重试</span>}
        </div>
      </div>
    </div>
  )
}
