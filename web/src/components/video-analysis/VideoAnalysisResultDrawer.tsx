import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, FileVideo } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { streamApi } from '@/api/stream'
import { usePosterVersion } from '@/stores/mediaRefresh'
import { routes } from '@/lib/routes'
import { useTranslation } from '@/i18n'
import type { VideoAnalysisTask } from '@/types/videoAnalysis'
import { formatVideoAnalysisError, formatVideoAnalysisTime, videoAnalysisStatusKeys, videoAnalysisStatusMeta } from './videoAnalysisResultUtils'
import VideoAnalysisResultPanel from './VideoAnalysisResultPanel'

interface VideoAnalysisResultDrawerProps {
  task: VideoAnalysisTask | null
  onClose: () => void
}

/** 视频分析结果抽层：顶部任务信息（状态/耗时/错误），内部复用结果面板内容 */
export default function VideoAnalysisResultDrawer({ task, onClose }: VideoAnalysisResultDrawerProps) {
  // 常驻挂载 + open 受控：关闭时 Radix 先播放退出动画（下滑/模糊淡出）再卸载；
  // visibleTask 保留最后一条任务，供关闭动画期间渲染面板内容
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [visibleTask, setVisibleTask] = useState(task)
  // 订阅海报版本戳：刮削/替换海报后自动绕过浏览器缓存
  usePosterVersion()
  useEffect(() => {
    if (task) setVisibleTask(task)
  }, [task])

  return (
    <Drawer open={!!task} onOpenChange={(open) => { if (!open) onClose() }}>
      <DrawerContent title={t('vat.resultTitle')} description={t('vat.resultDesc')} size="2xl">
        {visibleTask && (
          <div className="flex flex-col gap-4">
            {/* 顶部任务信息条 */}
            <div className="flex items-start gap-3 rounded-xl border bg-muted/30 p-3">
              <img
                src={streamApi.getPosterUrl(visibleTask.media_id)}
                alt=""
                className="h-16 w-11 shrink-0 rounded-md border border-border object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="flex items-center gap-1.5 truncate font-semibold text-foreground">
                    <FileVideo size={16} className="text-primary" />
                    {visibleTask.media_title || t('vat.untitled')}
                  </h3>
                  <Badge variant="outline" className={videoAnalysisStatusMeta[visibleTask.status].className}>{t(videoAnalysisStatusKeys[visibleTask.status])}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('vat.executionN', { n: visibleTask.seq || visibleTask.attempt || 1 })} · {visibleTask.trigger === 'auto' ? t('vat.triggerAuto') : t('vat.triggerManual')} · {t('vat.submittedAt', { time: formatVideoAnalysisTime(visibleTask.created_at) })}
                </p>
                {visibleTask.error_message && (
                  <p className="mt-1 truncate text-xs text-red-400" title={formatVideoAnalysisError(visibleTask.error_message, t)}>{formatVideoAnalysisError(visibleTask.error_message, t)}</p>
                )}
              </div>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => navigate(routes.player(visibleTask.media_id))}>
                <ExternalLink /> {t('vat.openPlayer')}
              </Button>
            </div>

            {/* 结果内容：工作流时间线 + 摘要/告警 + 场景九宫格 */}
            <VideoAnalysisResultPanel task={visibleTask} />
          </div>
        )}
      </DrawerContent>
    </Drawer>
  )
}
