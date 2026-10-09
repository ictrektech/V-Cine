import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Film, ImageOff, Loader2 } from 'lucide-react'
import { videoAnalysisApi } from '@/api'
import { usePlayerStore } from '@/stores/player'
import { useTranslation } from '@/i18n'
import type { VideoAnalysisResult, VideoAnalysisSceneResult } from '@/types/videoAnalysis'
import { formatVideoAnalysisSeconds } from '@/components/video-analysis/videoAnalysisResultUtils'

const INITIAL_SCENE_LIMIT = 50
const SCENE_PAGE_SIZE = 50

interface PlayerScenePanelProps {
  mediaId: string
  collapsed: boolean
  onToggle: () => void
}

type GridState = {
  loading: boolean
  url?: string
  error?: string
}

/**
 * 播放器右侧场景侧栏：展示视频分析结果中的场景列表。
 * - 首次最多加载 50 条，滚到底再追加 50
 * - 九宫格按已展示场景按需拉取 blob
 * - 点击场景通过 store.requestSeek 跳转
 */
export default function PlayerScenePanel({ mediaId, collapsed, onToggle }: PlayerScenePanelProps) {
  const { t } = useTranslation()
  const requestSeek = usePlayerStore((s) => s.requestSeek)
  const currentTime = usePlayerStore((s) => s.currentTime)

  const [result, setResult] = useState<VideoAnalysisResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [visibleCount, setVisibleCount] = useState(INITIAL_SCENE_LIMIT)
  const [gridMap, setGridMap] = useState<Record<number, GridState>>({})
  const requestedGridsRef = useRef<Set<number>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setUnavailable(false)
    setResult(null)
    setVisibleCount(INITIAL_SCENE_LIMIT)
    setGridMap((prev) => {
      Object.values(prev).forEach((item) => {
        if (item.url) URL.revokeObjectURL(item.url)
      })
      return {}
    })
    requestedGridsRef.current = new Set()

    videoAnalysisApi
      .getResult(mediaId)
      .then((res) => {
        if (cancelled) return
        const data = res.data.data
        if (!data?.scenes?.length) {
          setUnavailable(true)
          setResult(null)
          return
        }
        setResult(data)
      })
      .catch(() => {
        if (!cancelled) {
          setUnavailable(true)
          setResult(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [mediaId])

  const scenes = result?.scenes || []
  const visibleScenes = useMemo(() => scenes.slice(0, visibleCount), [scenes, visibleCount])
  const hasMore = visibleCount < scenes.length

  // IntersectionObserver：滚到底部追加更多场景
  useEffect(() => {
    if (collapsed || !hasMore) return
    const root = listRef.current
    const sentinel = loadMoreSentinelRef.current
    if (!root || !sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(scenes.length, count + SCENE_PAGE_SIZE))
        }
      },
      { root, rootMargin: '120px', threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [collapsed, hasMore, scenes.length, visibleCount])

  // 按需加载已展示场景的九宫格
  useEffect(() => {
    if (!result || collapsed) return
    const taskId = result.task_id
    visibleScenes.forEach((scene) => {
      if (!scene.grid_available) return
      if (requestedGridsRef.current.has(scene.scene_index)) return
      requestedGridsRef.current.add(scene.scene_index)
      setGridMap((prev) => ({ ...prev, [scene.scene_index]: { loading: true } }))
      videoAnalysisApi
        .getSceneGridBlob(mediaId, scene.scene_index, taskId)
        .then((res) => {
          const objectUrl = URL.createObjectURL(res.data)
          setGridMap((prev) => {
            if (prev[scene.scene_index]?.url) URL.revokeObjectURL(prev[scene.scene_index].url!)
            return { ...prev, [scene.scene_index]: { loading: false, url: objectUrl } }
          })
        })
        .catch(() => {
          requestedGridsRef.current.delete(scene.scene_index)
          setGridMap((prev) => ({
            ...prev,
            [scene.scene_index]: { loading: false, error: t('sp.gridLoadFailed') },
          }))
        })
    })
  }, [collapsed, mediaId, result, visibleScenes])

  // 卸载时释放 object URL
  useEffect(() => {
    return () => {
      setGridMap((prev) => {
        Object.values(prev).forEach((item) => {
          if (item.url) URL.revokeObjectURL(item.url)
        })
        return {}
      })
    }
  }, [])

  const activeSceneIndex = useMemo(() => {
    if (!scenes.length) return -1
    let active = scenes[0].scene_index
    for (const scene of scenes) {
      if (currentTime >= scene.start_time) active = scene.scene_index
      else break
    }
    return active
  }, [currentTime, scenes])

  const handleSceneClick = useCallback(
    (scene: VideoAnalysisSceneResult) => {
      requestSeek(Math.max(0, scene.start_time || 0))
    },
    [requestSeek],
  )

  // 无结果时不占位（折叠按钮也不显示），避免无分析媒体干扰播放
  if (!loading && (unavailable || !result)) {
    return null
  }

  if (collapsed) {
    // 保持组件挂载（由父级单一实例驱动），仅渲染贴边展开条
    return (
      <div className="relative h-full w-0 shrink-0 overflow-visible">
        <div className="absolute right-0 top-1/2 z-[55] -translate-y-1/2">
          <button
            type="button"
            onClick={onToggle}
            aria-label={t('sp.expandAria')}
            title={t('sp.expandTitle')}
            className="flex h-12 w-8 items-center justify-center rounded-l-lg text-white backdrop-blur-md transition-all hover:w-9"
            style={{ background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(255,255,255,0.08)', borderRight: 'none' }}
          >
            <ChevronLeft size={16} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <aside
      className="flex h-full w-[min(360px,34vw)] shrink-0 flex-col border-l border-white/10 bg-black/85 backdrop-blur-md"
      aria-label={t('sp.listAria')}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-white">
            <Film size={14} className="shrink-0 text-cyan-300" />
            {t('sp.title')}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-white/45">
            {loading ? t('sp.loading') : t('sp.count', { count: result?.scene_count || scenes.length })}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label={t('sp.collapseAria')}
          title={t('sp.collapseTitle')}
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {loading ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-white/50">
            <Loader2 size={18} className="animate-spin text-cyan-300" />
            <span className="text-xs">{t('sp.loadingScenes')}</span>
          </div>
        ) : (
          <ul className="space-y-2">
            {visibleScenes.map((scene) => {
              const grid = gridMap[scene.scene_index]
              const isActive = scene.scene_index === activeSceneIndex
              return (
                <li key={scene.scene_index}>
                  <button
                    type="button"
                    onClick={() => handleSceneClick(scene)}
                    className={`w-full rounded-xl border p-2.5 text-left transition ${
                      isActive
                        ? 'border-cyan-400/40 bg-cyan-400/10'
                        : 'border-white/5 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-white">{t('sp.sceneN', { n: scene.scene_index + 1 })}</span>
                      <span className="text-[11px] tabular-nums text-white/50">
                        {formatVideoAnalysisSeconds(scene.start_time)} – {formatVideoAnalysisSeconds(scene.end_time)}
                      </span>
                    </div>
                    {scene.description ? (
                      <p className="mb-2 line-clamp-2 text-xs leading-relaxed text-white/65">{scene.description}</p>
                    ) : (
                      <p className="mb-2 text-xs text-white/35">{t('sp.noDescription')}</p>
                    )}
                    <div className="relative aspect-video overflow-hidden rounded-lg border border-white/5 bg-black/40">
                      {scene.grid_available ? (
                        grid?.url ? (
                          <img
                            src={grid.url}
                            alt={t('sp.gridAlt', { n: scene.scene_index + 1 })}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : grid?.error ? (
                          <div className="flex h-full flex-col items-center justify-center gap-1 text-white/40">
                            <ImageOff size={14} />
                            <span className="text-[10px]">{grid.error}</span>
                          </div>
                        ) : (
                          <div className="flex h-full items-center justify-center text-white/40">
                            <Loader2 size={14} className="animate-spin" />
                          </div>
                        )
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-1 text-white/35">
                          <ImageOff size={14} />
                          <span className="text-[10px]">{t('sp.noGrid')}</span>
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {hasMore && (
          <div ref={loadMoreSentinelRef} className="flex items-center justify-center py-3 text-[11px] text-white/40">
            <Loader2 size={12} className="mr-1.5 animate-spin" />
            {t('sp.loadMore')}
          </div>
        )}
        {!loading && !hasMore && scenes.length > INITIAL_SCENE_LIMIT && (
          <p className="py-3 text-center text-[11px] text-white/30">{t('sp.loadedAll', { count: scenes.length })}</p>
        )}
      </div>
    </aside>
  )
}
