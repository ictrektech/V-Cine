import { useEffect, useState } from 'react'
import { ExternalLink, FileVideo } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { streamApi } from '@/api/stream'
import { usePosterVersion } from '@/stores/mediaRefresh'
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
  // 常驻挂载 + open 受控：关闭时 Radix 先播放退出动画（下滑/模糊淡出）再卸载；
  // visibleTask 保留最后一条任务，供关闭动画期间渲染面板内容
  const [visibleTask, setVisibleTask] = useState(task)
  // 订阅海报版本戳：刮削/替换海报后自动绕过浏览器缓存
  usePosterVersion()
  useEffect(() => {
    if (task) setVisibleTask(task)
  }, [task])

  return (
    <Drawer open={!!task} onOpenChange={(open) => { if (!open) onClose() }}>
      <DrawerContent title="分析结果" description="场景检测与结构化分析结果" size="2xl">
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
                    {visibleTask.media_title || '未命名媒体'}
                  </h3>
                  <Badge variant="outline" className={videoAnalysisStatusMeta[visibleTask.status].className}>{videoAnalysisStatusMeta[visibleTask.status].label}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  第 {visibleTask.seq || visibleTask.attempt || 1} 次执行 · {visibleTask.trigger === 'auto' ? '媒体库自动分析' : '手动提交'} · 提交于 {formatVideoAnalysisTime(visibleTask.created_at)}
                </p>
                {visibleTask.error_message && (
                  <p className="mt-1 truncate text-xs text-red-400" title={formatVideoAnalysisError(visibleTask.error_message)}>{formatVideoAnalysisError(visibleTask.error_message)}</p>
                )}
              </div>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => openAppUrl(routes.player(visibleTask.media_id))}>
                <ExternalLink /> 打开播放器
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
