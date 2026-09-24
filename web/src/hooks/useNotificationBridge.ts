import { useEffect } from 'react'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useNotificationCenterStore, type NotificationStep, type NotificationPlanStep, type NotificationStatus } from '@/stores/notificationCenter'
import type { VideoAnalysisTask } from '@/types/videoAnalysis'
import { videoAnalysisStageLabels, formatVideoAnalysisError } from '@/components/video-analysis/videoAnalysisResultUtils'
import { routes } from '@/lib/routes'

// ==================== 全局 WS 事件 → 通知中心桥接 ====================
// 将各类后台任务事件写入通知中心：
//   - scrape_chain:        刮削链路（单条媒体实时链路 + 批量汇总，含文件管理页；
//                          终态由后端收敛为恰好广播一次，无步骤时退化简单卡片）
//   - scan_completed:       媒体库扫描完成
//   - transcode_*:          转码开始/完成/失败
//   - asr_*/translate_*:    字幕 ASR 与翻译
//   - video_analysis_task_update: 视频结构化分析（仅手动触发，一条媒体一张卡；
//                          自动分析不推送）

interface ChainEventData {
  media_id?: string
  title?: string
  status?: string
  source?: string
  steps?: NotificationStep[]
  plan?: NotificationPlanStep[]
  current?: number
  total?: number
  success?: number
  failed?: number
  message?: string
}

interface GenericEventData {
  media_id?: string
  task_id?: string
  title?: string
  status?: string
  progress?: number
  message?: string
}

// 视频分析阶段状态（后端 VideoAnalysisStageStatus）→ 通知链路步骤状态
const analysisStageStatusMap: Record<string, NotificationStep['status']> = {
  running: 'trying',
  succeeded: 'success',
  failed: 'failed',
  skipped: 'skipped',
}

// 视频分析任务状态（后端 VideoAnalysisStatus）→ 通知状态（queued 归一化为 running）
const analysisStatusMap: Record<string, NotificationStatus> = {
  queued: 'running',
  running: 'running',
  succeeded: 'success',
  partial: 'partial',
  failed: 'failed',
}

export function useNotificationBridge() {
  const { on, off } = useWebSocket()

  useEffect(() => {
    const push = useNotificationCenterStore.getState().push
    const remove = useNotificationCenterStore.getState().remove

    // ---------- 刮削链路（单条媒体 + 批量汇总） ----------
    const handleChain = (data: ChainEventData) => {
      if (!data) return

      // 批量汇总事件（无 steps）：更新批量进度
      if (!data.steps || data.steps.length === 0) {
        if (data.current && data.current > 0) {
          push({
            id: 'batch:scrape',
            type: 'system',
            title: '批量刮削',
            message: data.message || `进度 [${data.current}/${data.total}] 成功 ${data.success}, 失败 ${data.failed}`,
            status: data.status === 'completed' ? 'success' : 'running',
            progress: {
              current: data.current || 0,
              total: data.total || 0,
              success: data.success || 0,
              failed: data.failed || 0,
            },
            link: routes.tasks.files,
          })
          return
        }
        // 终态但无链路步骤（未走调度链的 fallback 路径）：退化为简单卡片，保证通知不丢
        if (data.media_id && data.status && data.status !== 'running') {
          push({
            id: `scrape:${data.media_id}`,
            type: 'scrape',
            title: data.title || '未识别',
            message: data.message || (data.status === 'failed' ? '刮削失败' : '刮削完成'),
            status: (data.status === 'failed' ? 'failed' : data.status === 'partial' ? 'partial' : 'success') as any,
            link: routes.tasks.files,
          })
        }
        return
      }

      // 链路卡片事件：running 实时更新，完成时作为最终通知保留
      if (!data.media_id) return
      push({
        id: `scrape:${data.media_id}`,
        type: 'scrape',
        title: data.title || '未识别',
        message:
          data.status === 'running'
            ? data.message || '正在刮削...'
            : data.message || (data.status === 'failed' ? '刮削失败' : '刮削完成'),
        // 后端终态是 DB 状态（scraped/partial/failed），归一化为前端通知状态
        status: (data.status === 'scraped' ? 'success' : data.status || 'running') as any,
        source: data.source,
        steps: data.steps,
        // 完整调度计划：与 steps 合并后展示"完整链路 + 未执行/跳过"
        plan: data.plan?.length ? data.plan : undefined,
        link: routes.tasks.files,
      })
    }

    // ---------- 媒体库扫描（started/completed/failed 统一 ID，实时更新） ----------
    const scanPush = (status: 'running' | 'success' | 'failed', message: string) => {
      push({
        id: 'scan:status',
        type: 'scan',
        title: '媒体库扫描',
        status,
        message,
        link: routes.tasks.library,
      })
    }

    const handleScanStarted = (data: GenericEventData) => scanPush('running', data?.message || '正在扫描媒体库...')
    const handleScanCompleted = (data: GenericEventData) => scanPush('success', data?.message || '扫描完成')
    const handleScanFailed = (data: GenericEventData) => scanPush('failed', data?.message || '扫描失败')

    // ---------- 转码 ----------
    const handleTranscode = (data: GenericEventData, final: boolean, ok: boolean) => {
      if (!final && !data?.media_id) return
      push({
        id: `transcode:${data?.media_id || data?.task_id || 'unknown'}`,
        type: 'transcode',
        title: data?.title || '转码任务',
        message: data?.message || (ok ? '转码完成' : '转码失败'),
        status: final ? (ok ? 'success' : 'failed') : 'running',
        link: routes.tasks.video,
      })
    }

    // ---------- 视频结构化分析（仅手动触发） ----------
    const handleVideoAnalysis = (data: VideoAnalysisTask & { deleted?: boolean }) => {
      if (!data) return
      // 删除事件：后端只广播 { id, media_id, deleted }，无状态字段，直接移除对应卡片
      if (data.deleted) {
        if (data.media_id) remove(`analysis:${data.media_id}`)
        return
      }
      // 自动分析不推送；skipped 非真实执行，跳过
      if (data.trigger !== 'manual' || data.status === 'skipped') return

      // queued 归一化为 running：立即展示且不计未读
      const status: NotificationStatus = analysisStatusMap[data.status] || 'running'
      const stageLabel = videoAnalysisStageLabels[data.stage]
      // 三阶段链路徽标：detect → structure → describe（空状态阶段不出现）
      const steps: NotificationStep[] = (['detect', 'structure', 'describe'] as const).flatMap((stage) => {
        const stepStatus = analysisStageStatusMap[data[`${stage}_status`]]
        return stepStatus ? [{ provider: videoAnalysisStageLabels[stage], status: stepStatus }] : []
      })

      let message: string
      if (data.status === 'queued') message = '已排队，等待视频分析'
      else if (data.status === 'running') message = `正在${stageLabel}中 ${Math.round(data.progress ?? 0)}%`
      else if (data.status === 'succeeded') message = '视频结构化分析完成'
      else if (data.status === 'partial') message = '视频结构化分析部分完成'
      else message = formatVideoAnalysisError(data.error_message) || '视频结构化分析失败'

      push({
        id: `analysis:${data.media_id}`,
        type: 'analysis',
        title: data.media_title || '视频分析',
        message,
        status,
        steps: steps.length ? steps : undefined,
        link: routes.tasks.analysis(data.id, data.status === 'succeeded' || data.status === 'partial'),
      })
    }

    // ---------- 字幕 ASR / 翻译 ----------
    const handleSubtitle = (data: GenericEventData, kind: 'asr' | 'translate', final: boolean, ok: boolean) => {
      if (!final && !data?.media_id && !data?.task_id) return
      push({
        id: `subtitle:${kind}:${data?.media_id || data?.task_id || 'unknown'}`,
        type: 'subtitle',
        title: data?.title || (kind === 'asr' ? 'AI 字幕生成' : '字幕翻译'),
        message: data?.message || (ok ? '完成' : '失败'),
        status: final ? (ok ? 'success' : 'failed') : 'running',
        link: routes.tasks.subtitle,
      })
    }

    // 事件名 → 处理函数映射表：注册与注销共用
    const handlers: Array<[string, (data: any) => void]> = [
      ['scrape_chain', handleChain],
      ['scan_started', handleScanStarted],
      ['scan_completed', handleScanCompleted],
      ['scan_failed', handleScanFailed],
      ['transcode_started', (d) => handleTranscode(d, false, true)],
      ['transcode_completed', (d) => handleTranscode(d, true, true)],
      ['transcode_failed', (d) => handleTranscode(d, true, false)],
      ['asr_started', (d) => handleSubtitle(d, 'asr', false, true)],
      ['asr_completed', (d) => handleSubtitle(d, 'asr', true, true)],
      ['asr_failed', (d) => handleSubtitle(d, 'asr', true, false)],
      ['translate_completed', (d) => handleSubtitle(d, 'translate', true, true)],
      ['translate_failed', (d) => handleSubtitle(d, 'translate', true, false)],
      ['video_analysis_task_update', handleVideoAnalysis],
    ]

    handlers.forEach(([event, handler]) => on(event as any, handler))
    return () => handlers.forEach(([event, handler]) => off(event as any, handler))
  }, [on, off])

  return null
}
