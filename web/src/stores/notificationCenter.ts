import type { LucideIcon } from 'lucide-react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Film, Rss, Clapperboard, Subtitles, Settings2, ScanLine } from 'lucide-react'

// ==================== 通知中心全局状态 ====================
// 所有后台任务的实时进度与结果通知（刮削/扫描/转码/字幕/视频分析等），
// 通过 WS 事件桥接写入，localStorage 持久化，刷新页面不丢失。

export type NotificationType =
  | 'scrape'    // 刮削（元数据/番号）
  | 'scan'      // 媒体库扫描
  | 'transcode' // 转码
  | 'subtitle'  // 字幕（ASR/翻译）
  | 'analysis'  // 视频结构化分析
  | 'system'    // 系统级（批量汇总等）

export type NotificationStatus =
  | 'running'  // 进行中（实时更新，不产生未读）
  | 'success'  // 成功（未读）
  | 'failed'   // 失败（未读）
  | 'partial'  // 部分成功（未读）
  | 'info'     // 一般信息（未读）

export type NotificationStepStatus =
  | 'trying'   // 执行中
  | 'success'  // 成功
  | 'failed'   // 失败
  | 'source'   // 成功且为最终来源
  | 'disabled' // 数据源未启用（来自调度计划）
  | 'skipped'  // 本次跳过（来自调度计划）
  | 'pending'  // 计划内未执行到

export interface NotificationStep {
  provider: string
  status: NotificationStepStatus
  error?: string
}

/** 数据源调度计划项：用于在通知里展示"完整链路"（未执行到/被跳过也显示） */
export type NotificationPlanState = 'planned' | 'disabled' | 'skipped'

export interface NotificationPlanStep {
  provider: string
  state: NotificationPlanState
  reason?: string
}

export interface NotificationItem {
  /** 唯一 ID：同一任务的实时更新复用同一 ID（如 scrape:{mediaID}） */
  id: string
  type: NotificationType
  title: string
  message: string
  status: NotificationStatus
  /** 刮削链路来源（可选） */
  source?: string
  /** 刮削链路各步状态（可选，仅 running 时有值） */
  steps?: NotificationStep[]
  /** 完整数据源调度计划（可选）：与 steps 合并后可展示"运行到哪一步/哪些被跳过" */
  plan?: NotificationPlanStep[]
  /** 批量进度（可选） */
  progress?: { current: number; total: number; success: number; failed: number }
  /** 点击跳转的任务处理页路径：非空时通知条可点击直达 */
  link?: string
  timestamp: number
  read: boolean
}

const MAX_NOTIFICATIONS = 100
const STORAGE_KEY = 'nv-notification-center'

/** 通知类型图标（组件引用，消费方自行指定尺寸） */
export const TYPE_ICONS: Record<NotificationType, LucideIcon> = {
  scrape: Film,
  scan: Rss,
  transcode: Clapperboard,
  subtitle: Subtitles,
  analysis: ScanLine,
  system: Settings2,
}

/** 通知类型中文标签（用于在通知条上直观标识任务类型） */
export const TYPE_LABELS: Record<NotificationType, string> = {
  scrape: '刮削',
  scan: '媒体库扫描',
  transcode: '转码',
  subtitle: '字幕',
  analysis: '视频分析',
  system: '系统任务',
}

/** 状态徽标文案与配色 */
export const STATUS_META: Record<string, { label: string; className: string }> = {
  running: { label: '进行中', className: 'bg-amber-500/15 text-amber-500 border-transparent' },
  success: { label: '成功', className: 'bg-emerald-500/15 text-emerald-500 border-transparent' },
  failed: { label: '失败', className: 'bg-red-500/15 text-red-500 border-transparent' },
  partial: { label: '部分完成', className: 'bg-blue-500/15 text-blue-500 border-transparent' },
  info: { label: '通知', className: 'bg-muted text-[var(--text-tertiary)] border-transparent' },
}

interface NotificationCenterState {
  notifications: NotificationItem[]
  /** 面板是否展开 */
  open: boolean

  /**
   * 写入/更新通知：同 ID 实时更新（running 不累计未读），新完成通知置为未读。
   * options.restart：用户主动发起的新一轮任务。即使旧通知仍停留在 running，
   * 也按"重跑"处理（刷新 timestamp、重置未读），从而保证重新弹窗。
   */
  push: (item: Omit<NotificationItem, 'timestamp' | 'read'>, options?: { restart?: boolean }) => void
  /** 打开/关闭面板（打开时自动全部已读） */
  setOpen: (open: boolean) => void
  markAllRead: () => void
  clear: () => void
  remove: (id: string) => void
}

export const useNotificationCenterStore = create<NotificationCenterState>()(
  persist(
    (set) => ({
      notifications: [],
      open: false,

      push: (item, options) =>
        set((state) => {
          const now = Date.now()
          const idx = state.notifications.findIndex((n) => n.id === item.id)
          const isFinal = item.status !== 'running'

          let notifications: NotificationItem[]
          if (idx >= 0) {
            // 已存在：实时更新
            const prev = state.notifications[idx]
            // 新一轮开始：终态（或未知态）→ running，或调用方显式标记重跑。
            // 必须刷新 timestamp 并重新置为未读，否则重跑的任务既不会弹窗，
            // 刷新页面后也会因 timestamp 过旧而不被识别为新任务。
            const restarting = !isFinal && (options?.restart === true || prev.status !== 'running')
            // 保留原 timestamp；变为最终态或重跑开始时刷新时间
            const updated: NotificationItem = {
              ...prev,
              ...item,
              timestamp: isFinal || restarting ? now : prev.timestamp,
              read: restarting ? false : prev.read,
            }
            notifications = [...state.notifications]
            notifications[idx] = updated
          } else {
            const created: NotificationItem = { ...item, timestamp: now, read: false }
            notifications = [created, ...state.notifications]
          }

          // 截断到最大条数
          if (notifications.length > MAX_NOTIFICATIONS) {
            notifications = notifications.slice(0, MAX_NOTIFICATIONS)
          }
          return { notifications }
        }),

      setOpen: (open) =>
        set((state) => ({
          open,
          // 打开面板时全部已读
          notifications: open
            ? state.notifications.map((n) => ({ ...n, read: true }))
            : state.notifications,
        })),

      markAllRead: () =>
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
        })),

      clear: () => set({ notifications: [] }),

      remove: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),
    }),
    {
      name: STORAGE_KEY,
      // 仅持久化通知列表，面板开合状态不持久化
      partialize: (state) => ({ notifications: state.notifications }),
    },
  ),
)

/** 未读数（最终态且未读） */
export function selectUnreadCount(state: { notifications: NotificationItem[] }): number {
  return state.notifications.filter((n) => n.status !== 'running' && !n.read).length
}

/** 是否有进行中的任务 */
export function selectHasRunning(state: { notifications: NotificationItem[] }): boolean {
  return state.notifications.some((n) => n.status === 'running')
}
