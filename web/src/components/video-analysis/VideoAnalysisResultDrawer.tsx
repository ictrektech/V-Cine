import { ExternalLink, FileVideo } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { streamApi } from '@/api/stream'
import { openAppUrl } from '@/lib/appUrl'
import { routes } from '@/lib/routes'
import type { VideoAnalysisTask } from '@/types/videoAnalysis'
import { formatVideoAnalysisError, formatVideoAnalysisTime, videoAnalysisStatusMeta } from './videoAnalysisResultUtils'
import VideoAnalysisResultPanel from './VideoAnalysisResultPanel'

interface VideoAnalysisResultDrawerProps {
  task: VideoAnalysisTask | null
  onClose: () => void
}

/** 视频分析结果抽层：顶部任务信息（状态/耗时/错误），内部复用结果面板内容 */
export default function VideoAnalysisResultDrawer({ task, onClose }: VideoAnalysisResultDrawerProps) {
  if (!task) return null

  return (
    <Drawer open onOpenChange={(open) => { if (!open) onClose() }}>
      <DrawerContent title="分析结果" description="场景检测与结构化分析结果" size="2xl">
        <div className="flex flex-col gap-4">
          {/* 顶部任务信息条 */}
          <div className="flex items-start gap-3 rounded-xl border bg-muted/30 p-3">
            <img
              src={streamApi.getPosterUrl(task.media_id)}
              alt=""
              className="h-16 w-11 shrink-0 rounded-md border border-border object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="flex items-center gap-1.5 truncate font-semibold text-foreground">
                  <FileVideo size={16} className="text-primary" />
                  {task.media_title || '未命名媒体'}
                </h3>
                <Badge variant="outline" className={videoAnalysisStatusMeta[task.status].className}>{videoAnalysisStatusMeta[task.status].label}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                第 {task.seq || task.attempt || 1} 次执行 · {task.trigger === 'auto' ? '媒体库自动分析' : '手动提交'} · 提交于 {formatVideoAnalysisTime(task.created_at)}
              </p>
              {task.error_message && (
                <p className="mt-1 truncate text-xs text-red-400" title={formatVideoAnalysisError(task.error_message)}>{formatVideoAnalysisError(task.error_message)}</p>
              )}
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => openAppUrl(routes.player(task.media_id))}>
              <ExternalLink /> 打开播放器
            </Button>
          </div>

          {/* 结果内容：工作流时间线 + 摘要/告警 + 场景九宫格 */}
          <VideoAnalysisResultPanel task={task} />
        </div>
      </DrawerContent>
    </Drawer>
  )
}
