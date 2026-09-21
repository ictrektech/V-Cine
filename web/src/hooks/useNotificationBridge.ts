import { useEffect } from 'react'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useNotificationCenterStore, type NotificationStep, type NotificationPlanStep } from '@/stores/notificationCenter'

// ==================== 全局 WS 事件 → 通知中心桥接 ====================
// 将各类后台任务事件写入通知中心：
//   - scrape_chain:        刮削链路（单条媒体实时链路 + 批量汇总，含文件管理页；
//                          终态由后端收敛为恰好广播一次，无步骤时退化简单卡片）
//   - scan_completed:       媒体库扫描完成
//   - transcode_*:          转码开始/完成/失败
//   - asr_*/translate_*:    字幕 ASR 与翻译

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

export function useNotificationBridge() {
  const { on, off } = useWebSocket()

  useEffect(() => {
    const push = useNotificationCenterStore.getState().push

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
      })
    }

    const handleScanStarted = (data: GenericEventData) => scanPush('running', data?.message || '正在扫描媒体库...')
    const handleScanCompleted = (data: GenericEventData) => scanPush('success', data?.message || '扫描完成')
    const handleScanFailed = (data: GenericEventData) => scanPush('failed', data?.message || '扫描失败')

    // ---------- URL 刮削任务（刮削数据管理页）实时状态 ----------
    const handleTaskUpdate = (data: any) => {
      if (!data?.id) return
      const status = data.status || 'pending'
      if (status === 'pending') return
      const isFinal = status === 'scraped' || status === 'completed' || status === 'failed'
      push({
        id: `task:${data.id}`,
        type: 'scrape',
        title: data.result_title || data.title || data.url || '刮削任务',
        message:
          status === 'scraping' ? '正在刮削...' :
          status === 'translating' ? '正在翻译...' :
          status === 'failed' ? (data.error_message || '刮削失败') :
          '完成',
        status: (isFinal ? (status === 'failed' ? 'failed' : 'success') : 'running') as any,
      })
    }

    // ---------- 转码 ----------
    const handleTranscode = (data: GenericEventData, final: boolean, ok: boolean) => {
      if (!final && !data?.media_id) return
      push({
        id: `transcode:${data?.media_id || data?.task_id || 'unknown'}`,
        type: 'transcode',
        title: data?.title || '转码任务',
        message: data?.message || (ok ? '转码完成' : '转码失败'),
        status: final ? (ok ? 'success' : 'failed') : 'running',
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
      })
    }

    // 事件名 → 处理函数映射表：注册与注销共用
    const handlers: Array<[string, (data: any) => void]> = [
      ['scrape_chain', handleChain],
      ['scrape_task_update', handleTaskUpdate],
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
    ]

    handlers.forEach(([event, handler]) => on(event as any, handler))
    return () => handlers.forEach(([event, handler]) => off(event as any, handler))
  }, [on, off])

  return null
}
