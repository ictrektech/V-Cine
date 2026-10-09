import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Play, SkipForward } from 'lucide-react'
import { videoAnalysisApi } from '@/api'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/i18n'
import type { VideoAnalysisStageStatus, VideoAnalysisWorkflow as WorkflowData } from '@/types/videoAnalysis'
import { formatVideoAnalysisError, formatVideoAnalysisSeconds } from './videoAnalysisResultUtils'
import ModelHubDownloadNotice from './ModelHubDownloadNotice'

const stagesOf = (wf: WorkflowData) => [
  { key: 'detect', status: wf.detect_status, duration: wf.stage_timings?.detect },
  { key: 'structure', status: wf.structure_status, duration: wf.stage_timings?.structure },
  { key: 'describe', status: wf.describe_status, duration: wf.stage_timings?.describe },
]

const POLL_INTERVAL = 3000
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'skipped', 'partial'])

const stageMeta: Record<string, { labelKey: string; icon: string }> = {
  detect: { labelKey: 'vat.stageDetect', icon: '🔍' },
  structure: { labelKey: 'vat.stageStructureWorkflow', icon: '🧩' },
  describe: { labelKey: 'vat.stageDescribe', icon: '📝' },
}

function stageStatusIcon(status: VideoAnalysisStageStatus) {
  switch (status) {
    case 'succeeded': return <CheckCircle2 className="w-5 h-5 text-emerald-400" />
    case 'failed': return <AlertCircle className="w-5 h-5 text-red-400" />
    case 'running': return <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
    default: return <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/50" />
  }
}

function StageStatusLabel({ status }: { status: VideoAnalysisStageStatus }) {
  const { t } = useTranslation()
  switch (status) {
    case 'succeeded': return <span className="text-emerald-400 text-sm">{t('vat.statusSucceeded')}</span>
    case 'failed': return <span className="text-red-400 text-sm">{t('vat.statusFailed')}</span>
    case 'running': return <span className="text-amber-400 text-sm">{t('vat.stageRunning')}</span>
    case 'skipped': return <span className="text-muted-foreground text-sm">{t('vat.statusSkipped')}</span>
    default: return <span className="text-muted-foreground text-sm">{t('vat.stageNotStarted')}</span>
  }
}

interface Props {
  taskId: string
  onUpdate?: () => void
}

export default function VideoAnalysisWorkflow({ taskId }: Props) {
  const toast = useToast()
  const { t } = useTranslation()
  const [workflow, setWorkflow] = useState<WorkflowData | null>(null)
  const [loading, setLoading] = useState(true)
  const [stages, setStages] = useState<Array<{ key: string; status: VideoAnalysisStageStatus; duration?: number }>>([])
  const [running, setRunning] = useState<string | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchRef = useRef<() => void>()

  const fetch = useCallback(async () => {
    try {
      const res = await videoAnalysisApi.getWorkflow(taskId)
      const wf = res.data.data
      setWorkflow(wf)
      setStages(stagesOf(wf))
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [taskId])

  // Store fetch in ref so polling closure always gets the latest
  fetchRef.current = fetch

  useEffect(() => { fetch() }, [fetch])

  // Poll while the workflow status is not terminal
  useEffect(() => {
    if (!workflow || TERMINAL_STATUSES.has(workflow.status)) {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current)
        pollTimerRef.current = null
      }
      return
    }
    const poll = () => {
      pollTimerRef.current = setTimeout(() => {
        fetchRef.current?.()
        poll()
      }, POLL_INTERVAL)
    }
    poll()
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [workflow?.status])

  // 执行完成后拉取最新状态，根据实际结果显示准确的 toast
  const fetchAndToast = useCallback(async (prefix?: string) => {
    try {
      const res = await videoAnalysisApi.getWorkflow(taskId)
      const wf = res.data.data
      setWorkflow(wf)
      setStages(stagesOf(wf))
      setLoading(false)

      const allSucceeded = ['detect', 'structure', 'describe'].every(
        (k) => wf[`${k}_status` as keyof typeof wf] === 'succeeded',
      )
      const anyRunning = ['detect', 'structure', 'describe'].some(
        (k) => wf[`${k}_status` as keyof typeof wf] === 'running',
      )
      const anyFailed = ['detect', 'structure', 'describe'].some(
        (k) => wf[`${k}_status` as keyof typeof wf] === 'failed',
      )
      const anySkipped = ['detect', 'structure', 'describe'].some(
        (k) => wf[`${k}_status` as keyof typeof wf] === 'skipped',
      )

      if (wf.status === 'failed') {
        toast.error(formatVideoAnalysisError(wf.error_message, t) || t('vat.workflowFailed'))
      } else if (anyRunning) {
        toast.info(prefix ? t('vat.workflowRunningWithPrefix', { prefix }) : t('vat.workflowRunning'))
      } else if (allSucceeded) {
        toast.success(t('vat.workflowCompleted'))
      } else if (anyFailed) {
        toast.warning(t('vat.workflowPartialFailed'))
      } else if (anySkipped && allSucceeded === false) {
        toast.info(t('vat.workflowDescribeSkipped'))
      } else {
        toast.success(t('vat.workflowDone'))
      }
    } catch {
      // 若刷新失败，仍然保持之前的 toast（不额外干扰）
    }
  }, [taskId, toast])

  const runStage = async (stage: string) => {
    setRunning(stage)
    try {
      await videoAnalysisApi.runStage(taskId, stage)
      await fetchAndToast()
    } catch (e: any) {
      toast.error(formatVideoAnalysisError(e?.response?.data?.error, t) || e?.message || t('common.error'))
    } finally {
      setRunning(null)
    }
  }

  const runAll = async () => {
    setRunning('all')
    try {
      await videoAnalysisApi.runAll(taskId)
      await fetchAndToast()
    } catch (e: any) {
      toast.error(formatVideoAnalysisError(e?.response?.data?.error, t) || e?.message || t('common.error'))
    } finally {
      setRunning(null)
    }
  }

  const runMissing = async () => {
    setRunning('missing')
    try {
      await videoAnalysisApi.runMissing(taskId)
      await fetchAndToast()
    } catch (e: any) {
      toast.error(formatVideoAnalysisError(e?.response?.data?.error, t) || e?.message || t('common.error'))
    } finally {
      setRunning(null)
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-muted-foreground text-sm p-4"><Loader2 className="w-4 h-4 animate-spin" />{t('vat.workflowLoading')}</div>
  }

  if (!workflow) {
    return <div className="text-red-400 text-sm p-4">{t('vat.workflowLoadFailed')}</div>
  }

  return (
    <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{t('vat.workflowTitle')}</h3>
        <span className={`rounded-md px-2 py-0.5 text-xs ${workflow.status === 'succeeded' ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : workflow.status === 'failed' ? 'border border-red-500/20 bg-red-500/10 text-red-400' : workflow.status === 'running' || workflow.status === 'partial' ? 'border border-amber-500/20 bg-amber-500/10 text-amber-400' : 'border-transparent bg-secondary text-secondary-foreground'}`}>
          {workflow.status === 'succeeded' ? t('vat.statusSucceeded') : workflow.status === 'failed' ? t('vat.statusFailed') : workflow.status === 'running' ? t('vat.stageRunning') : workflow.status === 'partial' ? t('vat.statusPartial') : t('vat.statusQueued')}
        </span>
      </div>

      {workflow.missing_model && (
        <ModelHubDownloadNotice model={workflow.missing_model} />
      )}

      <div className="space-y-2">
        {stages.map((s, idx) => {
          const meta = stageMeta[s.key]
          const isRunning = running === s.key
          const isDisabled = isRunning || running === 'all' || running === 'missing'
          return (
            <div key={s.key} className="flex items-center gap-3 rounded-md border bg-transparent px-3 py-2">
              <div className="flex-shrink-0">{stageStatusIcon(isRunning ? 'running' : s.status)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{idx + 1}. {meta ? t(meta.labelKey) : s.key}</span>
                  <StageStatusLabel status={isRunning ? 'running' : s.status} />
                  {typeof s.duration === 'number' && (
                    <span className="text-xs text-muted-foreground" title={t('vat.stageDurationTitle')}>{formatVideoAnalysisSeconds(s.duration)}</span>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                disabled={s.status === 'succeeded' || s.status === 'skipped' || isDisabled}
                onClick={() => runStage(s.key)}
              >
                {isRunning ? <Loader2 className="animate-spin" /> : null}
                {s.status === 'succeeded' ? t('vat.statusSucceeded') : s.status === 'skipped' ? t('vat.statusSkipped') : s.status === 'failed' ? t('common.retry') : t('vat.stageRun')}
              </Button>
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" disabled={running !== null} onClick={runAll}>
          {running === 'all' ? <Loader2 className="animate-spin" /> : <Play />}
          {t('vat.runAll')}
        </Button>
        <Button variant="outline" size="sm" disabled={running !== null} onClick={runMissing}>
          {running === 'missing' ? <Loader2 className="animate-spin" /> : <SkipForward />}
          {t('vat.runMissing')}
        </Button>
      </div>
    </div>
  )
}