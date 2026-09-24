import { useState, useEffect, useRef } from 'react'
import { Loader2, X } from 'lucide-react'
import { useNotificationCenterStore, TYPE_ICONS, STATUS_META, type NotificationItem } from '@/stores/notificationCenter'
import { cn } from '@/lib/utils'

// ==================== 右上角通知弹窗（紧凑版，自动消失） ====================
// 监听通知中心 store：新任务启动 / 任务进入终态时在右上角弹出轻量卡片，
// 点击打开通知中心查看详情（完整链路在通知中心内展示）。

const POPUP_MAX = 3
const POPUP_DISMISS_MS = 4500

export default function NotificationToaster() {
  const notifications = useNotificationCenterStore((s) => s.notifications)
  const open = useNotificationCenterStore((s) => s.open)
  const setOpen = useNotificationCenterStore((s) => s.setOpen)
  // 弹窗只记录 id，内容实时从 store 读取（链路更新时弹窗同步刷新）
  const [popupIds, setPopupIds] = useState<string[]>([])
  const prevStatusRef = useRef<Map<string, string>>(new Map())
  const initializedRef = useRef(false)
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    // 首次运行（含页面加载恢复历史）：历史通知仅记录不弹窗；
    // 但刚创建的进行中通知（如页面刷新后恢复的任务）仍立即弹出
    if (!initializedRef.current) {
      notifications.forEach((n) => {
        const fresh = Date.now() - n.timestamp < 30000
        if (n.status === 'running' && fresh) {
          setPopupIds((prevIds) => [n.id, ...prevIds].slice(0, POPUP_MAX))
        }
        prevStatusRef.current.set(n.id, n.status)
      })
      initializedRef.current = true
      return
    }

    notifications.forEach((n) => {
      const prev = prevStatusRef.current.get(n.id)
      prevStatusRef.current.set(n.id, n.status)
      const isNew = prev === undefined
      const becameFinal = prev === 'running' && n.status !== 'running'
      // 重跑：用户重新发起同一任务（状态回到 running）。
      // store 的 push 已在重跑时重置未读，这里只需弹窗
      const restarted = n.status === 'running' && prev !== undefined && prev !== 'running'
      if (!isNew && !becameFinal && !restarted) return // running 中的原地更新不弹窗，避免刷屏

      setPopupIds((prevIds) => [n.id, ...prevIds.filter((id) => id !== n.id)].slice(0, POPUP_MAX))

      if (n.status !== 'running') {
        // 终态：定时消失；进行中的弹窗持续显示，不自动消失
        const old = timersRef.current.get(n.id)
        if (old) clearTimeout(old)
        timersRef.current.set(n.id, setTimeout(() => {
          setPopupIds((prevIds) => prevIds.filter((id) => id !== n.id))
          timersRef.current.delete(n.id)
        }, POPUP_DISMISS_MS))
      }
    })
  }, [notifications])

  // 面板展开时清空弹窗（内容一致，避免重复）
  useEffect(() => {
    if (open) {
      timersRef.current.forEach((t) => clearTimeout(t))
      timersRef.current.clear()
      setPopupIds([])
    }
  }, [open])

  const dismiss = (id: string) => {
    const old = timersRef.current.get(id)
    if (old) clearTimeout(old)
    timersRef.current.delete(id)
    setPopupIds((prev) => prev.filter((pid) => pid !== id))
  }

  const popupItems = popupIds
    .map((id) => notifications.find((n) => n.id === id))
    .filter((n): n is NotificationItem => Boolean(n))

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex flex-col items-end gap-2">
      {popupItems.map((item) => {
        const source = item.source
        return (
          <div
            key={item.id}
            onClick={() => {
              setOpen(true)
              dismiss(item.id)
            }}
            className="animate-in fade-in slide-in-from-top-2 zoom-in-95 duration-200 motion-reduce:animate-none pointer-events-auto flex w-80 cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-background p-3 shadow-lg transition-shadow hover:shadow-xl"
          >
            {/* 类型图标 */}
            <span className="mt-0.5 flex-shrink-0 text-muted-foreground">
              {(() => { const Icon = TYPE_ICONS[item.type]; return <Icon size={13} /> })()}
            </span>

            {/* 内容 */}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-medium text-foreground">{item.title}</p>
                <StatusBadge status={item.status} />
              </div>
              <p className="truncate text-[11px] text-muted-foreground">{item.message}</p>
              {source && (
                <p className="text-[10px] text-muted-foreground">
                  来源: <span className="font-medium text-emerald-500">{source}</span>
                </p>
              )}
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation()
                dismiss(item.id)
              }}
              className="flex-shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              title="关闭"
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function StatusBadge({ status }: { status: NotificationItem['status'] }) {
  const meta = STATUS_META[status] || STATUS_META.info
  return (
    <span
      className={cn(
        'inline-flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
        meta.className,
      )}
    >
      {status === 'running' && <Loader2 size={9} className="animate-spin" />}
      {meta.label}
    </span>
  )
}
