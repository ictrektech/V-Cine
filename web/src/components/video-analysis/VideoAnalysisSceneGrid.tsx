import { Grid2X2, ImageOff, Loader2, PlayCircle, RefreshCw } from 'lucide-react'
import type { VideoAnalysisSceneResult } from '@/types/videoAnalysis'
import { VIDEO_ANALYSIS_SCENES_PER_PAGE, formatVideoAnalysisSeconds } from './videoAnalysisResultUtils'

export type VideoAnalysisSceneGridState = {
  loading: boolean
  url?: string
  error?: string
}

interface VideoAnalysisSceneGridProps {
  scenes: VideoAnalysisSceneResult[]
  page: number
  totalPages: number
  gridMap: Record<number, VideoAnalysisSceneGridState>
  onPreviousPage: () => void
  onNextPage: () => void
  onOpenScene: (scene: VideoAnalysisSceneResult) => void
}

export default function VideoAnalysisSceneGrid({
  scenes,
  page,
  totalPages,
  gridMap,
  onPreviousPage,
  onNextPage,
  onOpenScene,
}: VideoAnalysisSceneGridProps) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/10 p-3">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium"><Grid2X2 size={14} className="text-neon" /> 场景列表</div>
          <p className="mt-1 text-xs text-surface-400">每页 {VIDEO_ANALYSIS_SCENES_PER_PAGE} 个场景，避免一次渲染过多图片。</p>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <button disabled={page <= 1} onClick={onPreviousPage} className="btn-ghost rounded-lg px-3 py-1.5 disabled:opacity-40">上一页</button>
            <span className="text-surface-400">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={onNextPage} className="btn-ghost rounded-lg px-3 py-1.5 disabled:opacity-40">下一页</button>
          </div>
        )}
      </div>

      {scenes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-surface-500">
          当前结果没有可展示的场景。
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {scenes.map((scene) => {
            const gridState = gridMap[scene.scene_index]
            return (
              <article key={scene.scene_index} className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="font-medium text-surface-100">场景 #{scene.scene_index + 1}</div>
                  <div className="text-xs text-surface-400">{formatVideoAnalysisSeconds(scene.start_time)} → {formatVideoAnalysisSeconds(scene.end_time)}</div>
                </div>

                <div className="relative overflow-hidden rounded-lg border border-white/5 bg-black/20 aspect-video">
                  {scene.grid_available ? (
                    gridState?.url ? (
                      <img src={gridState.url} alt={`场景 ${scene.scene_index + 1} 九宫格`} className="h-full w-full object-cover" />
                    ) : gridState?.loading ? (
                      <div className="flex h-full items-center justify-center text-surface-400"><Loader2 size={18} className="animate-spin" /></div>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-2 text-surface-500">
                        {gridState?.error ? <RefreshCw size={18} /> : <Loader2 size={18} className="animate-spin" />}
                        <span className="text-xs">{gridState?.error || '加载图片中…'}</span>
                      </div>
                    )
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-surface-500">
                      <ImageOff size={18} />
                      <span className="text-xs">九宫格图片缺失</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between text-xs text-surface-400">
                    <span>帧 {scene.start_frame} - {scene.end_frame}</span>
                    {(scene.status || scene.error) && <span>{scene.status || scene.error}</span>}
                  </div>
                  <p className="min-h-[40px] text-surface-300 break-words">
                    {scene.description || scene.error || '暂无场景描述。'}
                  </p>
                  <button onClick={() => onOpenScene(scene)} className="btn-ghost inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-cyan-300 hover:bg-cyan-400/10">
                    <PlayCircle size={14} /> 从该片段播放
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
