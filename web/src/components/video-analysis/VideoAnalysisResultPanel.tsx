import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Loader2 } from 'lucide-react'
import { videoAnalysisApi } from '@/api'
import type { VideoAnalysisResult, VideoAnalysisSceneResult, VideoAnalysisTask } from '@/types/videoAnalysis'
import VideoAnalysisResultInsights from './VideoAnalysisResultInsights'
import VideoAnalysisResultSummary from './VideoAnalysisResultSummary'
import VideoAnalysisSceneGrid, { type VideoAnalysisSceneGridState } from './VideoAnalysisSceneGrid'
import VideoAnalysisWorkflow from './VideoAnalysisWorkflow'
import { VIDEO_ANALYSIS_SCENES_PER_PAGE } from './videoAnalysisResultUtils'
import { routes } from '@/lib/routes'

interface VideoAnalysisResultPanelProps {
  task: VideoAnalysisTask | null
}

export default function VideoAnalysisResultPanel({ task }: VideoAnalysisResultPanelProps) {
  const navigate = useNavigate()
  const [result, setResult] = useState<VideoAnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [gridMap, setGridMap] = useState<Record<number, VideoAnalysisSceneGridState>>({})
  // Tracks which scene indexes already started a grid fetch. Must not live in effect deps
  // (putting gridMap there re-runs cleanup with cancelled=true and freezes the spinner).
  const requestedGridScenesRef = useRef<Set<number>>(new Set())
  const gridFetchGenerationRef = useRef(0)

  const taskId = task?.id
  const mediaId = task?.media_id
  const taskStatus = task?.status

  useEffect(() => {
    setPage(1)
    setResult(null)
    setError('')
    gridFetchGenerationRef.current += 1
    requestedGridScenesRef.current = new Set()
    setGridMap((prev) => {
      Object.values(prev).forEach((item) => {
        if (item.url) URL.revokeObjectURL(item.url)
      })
      return {}
    })
    if (!taskId || !mediaId) {
      setLoading(false)
      return
    }
    let cancelled = false
    const generation = gridFetchGenerationRef.current
    setLoading(true)
    videoAnalysisApi.getResult(mediaId, taskId)
      .then((res) => {
        if (cancelled || generation !== gridFetchGenerationRef.current) return
        setResult(res.data.data)
      })
      .catch((err: any) => {
        if (cancelled || generation !== gridFetchGenerationRef.current) return
        if (err?.response?.status === 404) setError('当前任务还没有可展示的结果，请稍后再试。')
        else setError(err?.response?.data?.error || '加载分析结果失败')
        setResult(null)
      })
      .finally(() => {
        if (!cancelled && generation === gridFetchGenerationRef.current) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [taskId, mediaId, taskStatus])

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
    if (!taskId || !mediaId || !result) return
    const generation = gridFetchGenerationRef.current

    visibleScenes.forEach((scene) => {
      if (!scene.grid_available) return
      if (requestedGridScenesRef.current.has(scene.scene_index)) return
      requestedGridScenesRef.current.add(scene.scene_index)

      setGridMap((prev) => ({ ...prev, [scene.scene_index]: { loading: true } }))
      videoAnalysisApi.getSceneGridBlob(mediaId, scene.scene_index, taskId)
        .then((res) => {
          if (generation !== gridFetchGenerationRef.current) return
          const objectUrl = URL.createObjectURL(res.data)
          setGridMap((prev) => {
            if (prev[scene.scene_index]?.url) URL.revokeObjectURL(prev[scene.scene_index].url!)
            return { ...prev, [scene.scene_index]: { loading: false, url: objectUrl } }
          })
        })
        .catch(() => {
          if (generation !== gridFetchGenerationRef.current) return
          // Allow a later remount/page visit to retry this scene.
          requestedGridScenesRef.current.delete(scene.scene_index)
          setGridMap((prev) => ({ ...prev, [scene.scene_index]: { loading: false, error: '加载图片失败' } }))
        })
    })
  }, [result, mediaId, taskId, visibleScenes])

  if (!task) {
    return (
      <section className="rounded-xl border bg-muted/30 p-4" aria-labelledby="video-analysis-result-heading">
        <div className="flex items-start gap-2 text-sm text-amber-100">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-400" />
          <div>
            <h3 id="video-analysis-result-heading" className="font-medium">无法定位结果任务</h3>
            <p className="mt-1 text-muted-foreground">当前筛选或分页中未包含该任务，请调整筛选条件后重试。</p>
          </div>
        </div>
      </section>
    )
  }

  const openSceneInPlayer = (scene: VideoAnalysisSceneResult) => {
    const start = Math.max(0, Math.floor(scene.start_time || 0))
    navigate(routes.player(task.media_id, start))
  }

  return (
    <section className="space-y-4">
      <VideoAnalysisWorkflow taskId={task.id} />

      {loading ? (
        <div className="rounded-xl border border bg-muted/30 py-16 text-center">
          <Loader2 className="mx-auto animate-spin text-primary" />
          <p className="mt-2 text-sm text-muted-foreground">正在加载结果详情…</p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-4 text-sm text-amber-100">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-400" />
            <div>
              <div className="font-medium">无法展示结果详情</div>
              <p className="mt-1 text-muted-foreground">{error}</p>
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
