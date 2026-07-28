import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Play, SkipForward } from 'lucide-react'
import { videoAnalysisApi } from '@/api'
import { useToast } from '@/components/Toast'
import type { VideoAnalysisStageStatus, VideoAnalysisWorkflow as WorkflowData } from '@/types/videoAnalysis'

const stageMeta: Record<string, { label: string; icon: string }> = {
  detect: { label: '场景检测', icon: '🔍' },
  structure: { label: '场景结构化', icon: '🧩' },
  describe: { label: '场景描述', icon: '📝' },
}

function stageStatusIcon(status: VideoAnalysisStageStatus) {
  switch (status) {
    case 'succeeded': return <CheckCircle2 className="w-5 h-5 text-emerald-400" />
    case 'failed': return <AlertCircle className="w-5 h-5 text-red-400" />
    case 'running': return <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
    default: return <div className="w-5 h-5 rounded-full border-2 border-surface-500" />
  }
}

function stageStatusLabel(status: VideoAnalysisStageStatus) {
  switch (status) {
    case 'succeeded': return <span className="text-emerald-400 text-sm">已完成</span>
    case 'failed': return <span className="text-red-400 text-sm">失败</span>
    case 'running': return <span className="text-amber-400 text-sm">运行中</span>
    case 'skipped': return <span className="text-surface-400 text-sm">已跳过</span>
    default: return <span className="text-surface-400 text-sm">未开始</span>
  }
}

interface Props {
  taskId: string
  onUpdate?: () => void
}

export default function VideoAnalysisWorkflow({ taskId }: Props) {
  const toast = useToast()
  const [workflow, setWorkflow] = useState<WorkflowData | null>(null)
  const [loading, setLoading] = useState(true)
  const [stages, setStages] = useState<Array<{ key: string; status: VideoAnalysisStageStatus }>>([])
  const [running, setRunning] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    try {
      const res = await videoAnalysisApi.getWorkflow(taskId)
      const wf = res.data.data
      setWorkflow(wf)
      setStages([
        { key: 'detect', status: wf.detect_status },
        { key: 'structure', status: wf.structure_status },
        { key: 'describe', status: wf.describe_status },
      ])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => { fetch() }, [fetch])

  const runStage = async (stage: string) => {
    setRunning(stage)
    try {
      await videoAnalysisApi.runStage(taskId, stage)
      toast.success(`${stageMeta[stage]?.label || stage} 已启动`)
      setTimeout(fetch, 1000)
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || '操作失败')
    } finally {
      setRunning(null)
    }
  }

  const runAll = async () => {
    setRunning('all')
    try {
      await videoAnalysisApi.runAll(taskId)
      toast.success('全部阶段已执行完成')
      setTimeout(fetch, 1000)
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || '操作失败')
    } finally {
      setRunning(null)
    }
  }

  const runMissing = async () => {
    setRunning('missing')
    try {
      await videoAnalysisApi.runMissing(taskId)
      toast.success('缺失阶段已补齐')
      setTimeout(fetch, 1000)
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || '操作失败')
    } finally {
      setRunning(null)
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-surface-400 text-sm p-4"><Loader2 className="w-4 h-4 animate-spin" />加载工作流状态...</div>
  }

  if (!workflow) {
    return <div className="text-red-400 text-sm p-4">无法加载工作流状态</div>
  }

  return (
    <div className="bg-surface-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-surface-200">工作流状态</h3>
        <span className={`text-xs px-2 py-0.5 rounded ${workflow.status === 'succeeded' ? 'bg-emerald-500/10 text-emerald-300' : workflow.status === 'failed' ? 'bg-red-500/10 text-red-300' : workflow.status === 'running' ? 'bg-amber-500/10 text-amber-300' : 'bg-surface-600/30 text-surface-300'}`}>
          {workflow.status === 'succeeded' ? '已完成' : workflow.status === 'failed' ? '失败' : workflow.status === 'running' ? '运行中' : workflow.status === 'partial' ? '部分完成' : '排队中'}
        </span>
      </div>

      <div className="space-y-2">
        {stages.map((s, idx) => {
          const meta = stageMeta[s.key]
          const isRunning = running === s.key
          const isDisabled = isRunning || running === 'all' || running === 'missing'
          return (
            <div key={s.key} className="flex items-center gap-3 bg-surface-800 rounded px-3 py-2">
              <div className="flex-shrink-0">{stageStatusIcon(isRunning ? 'running' : s.status)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-surface-100 text-sm font-medium">{idx + 1}. {meta?.label || s.key}</span>
                  {stageStatusLabel(isRunning ? 'running' : s.status)}
                </div>
              </div>
              <button
                className={`flex-shrink-0 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  s.status === 'succeeded' || s.status === 'skipped'
                    ? 'bg-surface-600/30 text-surface-400 cursor-not-allowed'
                    : isDisabled
                    ? 'bg-surface-600/30 text-surface-400 cursor-not-allowed'
                    : 'bg-blue-500/10 text-blue-300 hover:bg-blue-500/20'
                }`}
                disabled={s.status === 'succeeded' || s.status === 'skipped' || isDisabled}
                onClick={() => runStage(s.key)}
              >
                {isRunning ? <Loader2 className="w-3 h-3 animate-spin inline" /> : null}
                {s.status === 'succeeded' ? '已完成' : s.status === 'skipped' ? '已跳过' : s.status === 'failed' ? '重试' : '运行'}
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            running === 'all' ? 'bg-surface-600/30 text-surface-400 cursor-not-allowed' : 'bg-blue-500/10 text-blue-300 hover:bg-blue-500/20'
          }`}
          disabled={running !== null}
          onClick={runAll}
        >
          {running === 'all' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          全部运行
        </button>
        <button
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            running === 'missing' ? 'bg-surface-600/30 text-surface-400 cursor-not-allowed' : 'bg-surface-600/30 text-surface-200 hover:bg-surface-500/30'
          }`}
          disabled={running !== null}
          onClick={runMissing}
        >
          {running === 'missing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SkipForward className="w-3.5 h-3.5" />}
          运行缺失阶段
        </button>
      </div>
    </div>
  )
}