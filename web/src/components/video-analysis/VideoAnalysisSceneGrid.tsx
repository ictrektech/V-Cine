import { Grid2X2, ImageOff, Loader2, PlayCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n'
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
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-foreground"><Grid2X2 size={14} className="text-primary" /> {t('vat.sceneList')}</div>
          <p className="mt-1 text-xs text-muted-foreground">{totalPages > 1 ? t('vat.scenePerPageWithPages', { perPage: VIDEO_ANALYSIS_SCENES_PER_PAGE, pages: totalPages }) : t('vat.scenePerPage', { perPage: VIDEO_ANALYSIS_SCENES_PER_PAGE })}</p>
        </div>
      </div>

      {scenes.length === 0 ? (
        <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          {t('vat.sceneEmpty')}
        </div>
      ) : (
        <>
          <div key={page} className="animate-in fade-in-0 duration-200 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {scenes.map((scene) => {
            const gridState = gridMap[scene.scene_index]
            return (
              <article key={scene.scene_index} className="rounded-lg border bg-background p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="font-medium text-foreground">{t('vat.sceneN', { n: scene.scene_index + 1 })}</div>
                  <div className="text-xs text-muted-foreground">{formatVideoAnalysisSeconds(scene.start_time)} → {formatVideoAnalysisSeconds(scene.end_time)}</div>
                </div>

                <div className="relative aspect-video overflow-hidden rounded-md border bg-muted/30">
                  {scene.grid_available ? (
                    gridState?.url ? (
                      <img src={gridState.url} alt={t('vat.sceneGridAlt', { n: scene.scene_index + 1 })} className="animate-in fade-in-0 duration-300 h-full w-full object-cover" />
                    ) : gridState?.loading ? (
                      <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 size={18} className="animate-spin" /></div>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                        {gridState?.error ? <RefreshCw size={18} /> : <Loader2 size={18} className="animate-spin" />}
                        <span className="text-xs">{gridState?.error || t('vat.sceneLoadingImage')}</span>
                      </div>
                    )
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                      <ImageOff size={18} />
                      <span className="text-xs">{t('vat.sceneGridMissing')}</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t('vat.sceneFrames', { start: scene.start_frame, end: scene.end_frame })}</span>
                    {(scene.status || scene.error) && <span>{scene.status || scene.error}</span>}
                  </div>
                  <p className="min-h-[40px] break-words text-foreground">
                    {scene.description || scene.error || t('vat.sceneNoDescription')}
                  </p>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" onClick={() => onOpenScene(scene)}>
                    <PlayCircle /> {t('vat.scenePlayFrom')}
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={onPreviousPage}>{t('vat.prevPage')}</Button>
              <span className="text-muted-foreground">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={onNextPage}>{t('vat.nextPage')}</Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
