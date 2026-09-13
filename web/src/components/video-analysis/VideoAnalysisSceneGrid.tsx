import { Grid2X2, ImageOff, Loader2, PlayCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-foreground"><Grid2X2 size={14} className="text-primary" /> 场景列表</div>
          <p className="mt-1 text-xs text-muted-foreground">每页 {VIDEO_ANALYSIS_SCENES_PER_PAGE} 个场景{totalPages > 1 ? `，共 ${totalPages} 页` : ''}。</p>
        </div>
      </div>

      {scenes.length === 0 ? (
        <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          当前结果没有可展示的场景。
        </div>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {scenes.map((scene) => {
            const gridState = gridMap[scene.scene_index]
            return (
              <article key={scene.scene_index} className="rounded-lg border bg-background p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="font-medium text-foreground">场景 #{scene.scene_index + 1}</div>
                  <div className="text-xs text-muted-foreground">{formatVideoAnalysisSeconds(scene.start_time)} → {formatVideoAnalysisSeconds(scene.end_time)}</div>
                </div>

                <div className="relative aspect-video overflow-hidden rounded-md border bg-muted/30">
                  {scene.grid_available ? (
                    gridState?.url ? (
                      <img src={gridState.url} alt={`场景 ${scene.scene_index + 1} 九宫格`} className="h-full w-full object-cover" />
                    ) : gridState?.loading ? (
                      <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 size={18} className="animate-spin" /></div>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                        {gridState?.error ? <RefreshCw size={18} /> : <Loader2 size={18} className="animate-spin" />}
                        <span className="text-xs">{gridState?.error || '加载图片中…'}</span>
                      </div>
                    )
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                      <ImageOff size={18} />
                      <span className="text-xs">九宫格图片缺失</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>帧 {scene.start_frame} - {scene.end_frame}</span>
                    {(scene.status || scene.error) && <span>{scene.status || scene.error}</span>}
                  </div>
                  <p className="min-h-[40px] break-words text-foreground">
                    {scene.description || scene.error || '暂无场景描述。'}
                  </p>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" onClick={() => onOpenScene(scene)}>
                    <PlayCircle /> 从该片段播放
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={onPreviousPage}>上一页</Button>
              <span className="text-muted-foreground">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={onNextPage}>下一页</Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
