import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ExternalLink, FileVideo, Loader2 } from 'lucide-react'
import { videoAnalysisApi } from '@/api'
import type { VideoAnalysisResult, VideoAnalysisSceneResult, VideoAnalysisTask } from '@/types/videoAnalysis'
import VideoAnalysisResultInsights from './VideoAnalysisResultInsights'
import VideoAnalysisResultSummary from './VideoAnalysisResultSummary'
import VideoAnalysisSceneGrid, { type VideoAnalysisSceneGridState } from './VideoAnalysisSceneGrid'
import { VIDEO_ANALYSIS_SCENES_PER_PAGE } from './videoAnalysisResultUtils'

interface VideoAnalysisResultPanelProps {
  task: VideoAnalysisTask | null
  onClose?: () => void
}

export default function VideoAnalysisResultPanel({ task, onClose }: VideoAnalysisResultPanelProps) {
  const [result, setResult] = useState<VideoAnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [gridMap, setGridMap] = useState<Record<number, VideoAnalysisSceneGridState>>({})

  useEffect(() => {
    setPage(1)
    setGridMap({})
    if (!task) {
      setResult(null)
      setError('')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    videoAnalysisApi.getResult(task.media_id, task.id)
      .then((res) => {
        if (cancelled) return
        setResult(res.data.data)
      })
      .catch((err: any) => {
        if (cancelled) return
        if (err?.response?.status === 404) setError('当前任务还没有可展示的结果，请稍后再试。')
        else setError(err?.response?.data?.error || '加载分析结果失败')
        setResult(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      setGridMap((prev) => {
        Object.values(prev).forEach((item) => {
          if (item.url) URL.revokeObjectURL(item.url)
        })
        return {}
      })
    }
  }, [task])

  const totalPages = useMemo(() => {
    const count = result?.scenes.length || 0
    return Math.max(1, Math.ceil(count / VIDEO_ANALYSIS_SCENES_PER_PAGE))
  }, [result?.scenes.length])

  const visibleScenes = useMemo(() => {
    if (!result) return []
    const start = (page - 1) * VIDEO_ANALYSIS_SCENES_PER_PAGE
    return result.scenes.slice(start, start + VIDEO_ANALYSIS_SCENES_PER_PAGE)
  }, [page, result])

  useEffect(() => {
    if (!task || !result) return
    let cancelled = false
    visibleScenes.forEach((scene) => {
      if (!scene.grid_available || gridMap[scene.scene_index]?.loading || gridMap[scene.scene_index]?.url || gridMap[scene.scene_index]?.error) return
      setGridMap((prev) => ({ ...prev, [scene.scene_index]: { loading: true } }))
      videoAnalysisApi.getSceneGridBlob(task.media_id, scene.scene_index, task.id)
        .then((res) => {
          if (cancelled) return
          const objectUrl = URL.createObjectURL(res.data)
          setGridMap((prev) => {
            if (prev[scene.scene_index]?.url) URL.revokeObjectURL(prev[scene.scene_index].url!)
            return { ...prev, [scene.scene_index]: { loading: false, url: objectUrl } }
          })
        })
        .catch(() => {
          if (cancelled) return
          setGridMap((prev) => ({ ...prev, [scene.scene_index]: { loading: false, error: '加载图片失败' } }))
        })
    })
    return () => {
      cancelled = true
    }
  }, [gridMap, result, task, visibleScenes])

  if (!task) {
    return (
      <section className="glass-panel rounded-xl p-4" aria-labelledby="video-analysis-result-heading">
        <div className="flex items-start gap-2 text-sm text-amber-100">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-300" />
          <div>
            <h3 id="video-analysis-result-heading" className="font-medium">无法定位结果任务</h3>
            <p className="mt-1 text-surface-300">当前筛选或分页中未包含该任务，请调整筛选条件后重试。</p>
          </div>
        </div>
      </section>
    )
  }

  const openSceneInPlayer = (scene: VideoAnalysisSceneResult) => {
    const start = Math.max(0, Math.floor(scene.start_time || 0))
    window.open(`/play/${task.media_id}?start=${start}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <section className="glass-panel rounded-xl p-4 space-y-4" aria-labelledby="video-analysis-result-heading">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 id="video-analysis-result-heading" className="flex items-center gap-2 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            <FileVideo size={18} className="text-neon" /> 结果详情
          </h3>
          <p className="mt-1 text-xs text-surface-400">
            {task.media_title || '未命名媒体'} · 任务 {task.id.slice(0, 8)} · {result?.scene_count ?? 0} 个场景
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onClose && <button onClick={onClose} className="btn-ghost rounded-lg px-3 py-2 text-sm">收起结果</button>}
          <button onClick={() => window.open(`/play/${task.media_id}`, '_blank', 'noopener,noreferrer')} className="btn-ghost rounded-lg px-3 py-2 text-sm inline-flex items-center gap-1.5">
            <ExternalLink size={14} /> 打开播放器
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-white/5 bg-black/10 py-16 text-center">
          <Loader2 className="mx-auto animate-spin text-neon" />
          <p className="mt-2 text-sm text-surface-400">正在加载结果详情…</p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-4 text-sm text-amber-100">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-300" />
            <div>
              <div className="font-medium">无法展示结果详情</div>
              <p className="mt-1 text-surface-300">{error}</p>
            </div>
          </div>
        </div>
      ) : !result ? null : (
        <>
          <VideoAnalysisResultSummary result={result} />
          <VideoAnalysisResultInsights result={result} />
          <VideoAnalysisSceneGrid
            scenes={visibleScenes}
            page={page}
            totalPages={totalPages}
            gridMap={gridMap}
            onPreviousPage={() => setPage((value) => Math.max(1, value - 1))}
            onNextPage={() => setPage((value) => Math.min(totalPages, value + 1))}
            onOpenScene={openSceneInPlayer}
          />
        </>
      )}
    </section>
  )
}
