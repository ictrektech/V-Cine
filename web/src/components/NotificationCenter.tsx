import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell,
  Check,
  CheckCheck,
  Trash2,
  X,
  Loader2,
  XCircle,
  Minus,
} from 'lucide-react'
import { useNotificationCenterStore, selectUnreadCount, selectHasRunning, TYPE_ICONS, TYPE_LABELS, STATUS_META, type NotificationItem, type NotificationStep, type NotificationPlanStep } from '@/stores/notificationCenter'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

// ==================== 类型与状态定义 ====================

/** 计划状态 → 链路步骤状态（与后端 ScrapePlanStep.State 对应，新增状态需同步更新此表） */
const PLAN_STATE_STATUS: Record<NotificationPlanStep['state'], NotificationStep['status']> = {
  planned: 'pending',
  disabled: 'disabled',
  skipped: 'skipped',
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return `${Math.floor(hour / 24)} 天前`
}

/**
 * 链路步骤徽标（颜色语义）：
 * trying 转圈（黄）/ failed 红叉（红）/ success·source 绿勾（来源带标记）/
 * disabled 黄色实心（该项未启用，带"未启用"字样）/
 * skipped 灰色实心（本次跳过，带"跳过"字样，原因见 tooltip）/ pending 灰色虚线（未执行到）
 */
function StepBadge({ step }: { step: NotificationStep }) {
  const isSource = step.status === 'source'
  const isDisabled = step.status === 'disabled'
  const isSkipped = step.status === 'skipped'
  const isPending = step.status === 'pending'
  // disabled / skipped / pending 时 error 里放的是原因说明（来自调度计划）
  const title = step.error || undefined
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 px-1.5 py-0.5 text-[10px] font-medium',
        (step.status === 'trying' || isDisabled) && 'border-amber-500/30 bg-amber-500/10 text-amber-500',
        step.status === 'failed' && 'border-red-500/30 bg-red-500/10 text-red-500',
        (step.status === 'success' || isSource) && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
        isSkipped && 'border-border bg-muted/40 text-[var(--text-secondary)]',
        isPending && 'border-dashed border-border/70 text-[var(--text-tertiary)]',
      )}
      title={title}
    >
      {step.status === 'trying' ? (
        <Loader2 size={9} className="animate-spin" />
      ) : step.status === 'failed' ? (
        <XCircle size={9} />
      ) : isDisabled || isSkipped ? (
        <Minus size={9} />
      ) : isPending ? null : (
        <Check size={9} />
      )}
      {step.provider}
      {isSource && <span className="rounded bg-emerald-500/20 px-1 text-[9px]">来源</span>}
      {isDisabled && <span className="text-[9px] opacity-70">未启用</span>}
      {isSkipped && <span className="text-[9px] opacity-70">跳过</span>}
    </Badge>
  )
}

/**
 * 链路步骤聚合：同一数据源保留最终状态（trying → success/failed/source），
 * 保持首次出现顺序，用于最终通知展示完整链路。
 */
function aggregateSteps(steps: NotificationStep[]): NotificationStep[] {
  const map = new Map<string, NotificationStep>()
  for (const s of steps) {
    map.set(s.provider, s)
  }
  return Array.from(map.values())
}

/**
 * 合并"调度计划 + 实际执行结果"得到完整链路：
 * - 计划内且已执行 → 用实际状态（成功/失败/进行中）
 * - 计划内但未执行 → 未启用显示 disabled（黄），计划要求跳过显示 skipped（灰），
 *   其余显示 pending（灰虚线，未执行到）
 * - 计划外的实际步骤（无计划的链路）→ 原样追加
 */
function buildChain(item: NotificationItem): NotificationStep[] {
  const actual = aggregateSteps(item.steps || [])
  const byProvider = new Map(actual.map((s) => [s.provider, s]))
  const chain: NotificationStep[] = []
  const used = new Set<string>()

  for (const p of item.plan || []) {
    used.add(p.provider)
    const step = byProvider.get(p.provider)
    if (step) {
      chain.push(step)
      continue
    }
    const isDisabled = p.state === 'disabled'
    const isSkipped = p.state === 'skipped'
    chain.push({
      provider: p.provider,
      status: PLAN_STATE_STATUS[p.state],
      error: isDisabled || isSkipped
        ? p.reason || (isDisabled ? '未启用' : '本次跳过')
        : item.status === 'running'
          ? '待执行'
          : '未执行（前序数据源已满足）',
    })
  }

  for (const s of actual) {
    if (!used.has(s.provider)) chain.push(s)
  }
  return chain
}

// ==================== 通知铃铛入口（Sidebar 快捷图标排用） ====================

export function NotificationBell() {
  const setOpen = useNotificationCenterStore((s) => s.setOpen)
  const unread = useNotificationCenterStore(selectUnreadCount)
  const hasRunning = useNotificationCenterStore(selectHasRunning)

  return (
    // 与侧边栏其它快捷图标（语言/主题/登出）保持同一套原生按钮样式，
    // 不使用 shadcn Button（其 base 样式会改字号/图标尺寸与颜色令牌）
    <button
      onClick={() => setOpen(true)}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg text-surface-400 transition-colors hover:text-neon hover:bg-neon-blue/5"
      title="通知中心"
      aria-label="通知中心"
    >
      <Bell className="h-4 w-4" />
      {unread > 0 && (
        <span
          className={cn(
            'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums',
            'bg-[var(--neon-blue)] text-[var(--text-on-neon)]',
          )}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
      {hasRunning && (
        <span className="absolute -left-0.5 -top-0.5 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
        </span>
      )}
    </button>
  )
}

// ==================== 通知中心（右侧 Sheet 抽屉） ====================

export default function NotificationCenter() {
  const open = useNotificationCenterStore((s) => s.open)
  const setOpen = useNotificationCenterStore((s) => s.setOpen)
  const notifications = useNotificationCenterStore((s) => s.notifications)
  const clear = useNotificationCenterStore((s) => s.clear)
  const remove = useNotificationCenterStore((s) => s.remove)
  const unread = useNotificationCenterStore(selectUnreadCount)

  const sorted = useMemo(
    () => [...notifications].sort((a, b) => b.timestamp - a.timestamp),
    [notifications]
  )

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="flex flex-col gap-0 p-0">
        <SheetHeader className="flex-row items-center space-y-0 border-b px-4 py-3.5">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Bell size={16} className="text-primary" />
            通知中心
            {unread > 0 && <Badge className="rounded-full px-1.5 text-[10px]">{unread} 未读</Badge>}
          </SheetTitle>
          <SheetDescription className="sr-only">后台任务通知列表</SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="space-y-2 p-3">
            {sorted.length > 0 ? (
              sorted.map((item) => <NotificationRow key={item.id} item={item} onRemove={remove} />)
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Bell size={36} className="mb-3 text-[var(--text-tertiary)]/50" />
                <p className="text-sm text-[var(--text-primary)]">暂无通知</p>
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">刮削、扫描、转码、视频分析等任务的通知会显示在这里</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {sorted.length > 0 && (
          <>
            <Separator />
            <div className="flex items-center justify-between px-4 py-2.5">
              <Button variant="ghost" size="sm" onClick={() => useNotificationCenterStore.getState().markAllRead()}>
                <CheckCheck size={13} />
                全部已读
              </Button>
              <Button variant="ghost" size="sm" className="text-[var(--text-tertiary)] hover:text-red-500" onClick={clear}>
                <Trash2 size={13} />
                清空
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** 通知中心抽屉内的一行通知 */
function NotificationRow({ item, onRemove }: { item: NotificationItem; onRemove: (id: string) => void }) {
  const statusMeta = STATUS_META[item.status] || STATUS_META.info
  const navigate = useNavigate()
  const setOpen = useNotificationCenterStore((s) => s.setOpen)
  // 完整链路：计划中的每一步都会展示（未执行到=灰虚线，跳过=灰实心）
  const chain = buildChain(item)
  const failedCount = chain.filter((s) => s.status === 'failed').length
  const batchPct =
    item.progress && item.progress.total
      ? Math.round((item.progress.current / item.progress.total) * 100)
      : 0

  return (
    <div
      role={item.link ? 'button' : undefined}
      tabIndex={item.link ? 0 : undefined}
      onClick={() => {
        // 无跳转目标则静默
        if (!item.link) return
        navigate(item.link)
        setOpen(false)
      }}
      onKeyDown={(e) => {
        if (!item.link) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(item.link)
          setOpen(false)
        }
      }}
      className={cn(
        'group relative space-y-1.5 rounded-lg border border-border bg-card px-3 py-2 transition-colors hover:bg-accent/50',
        item.status === 'failed' && 'border-red-500/25 bg-red-500/5',
        !item.read && 'border-amber-500/40 bg-amber-500/10',
        item.link && 'cursor-pointer',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]">
            {(() => { const Icon = TYPE_ICONS[item.type]; return <Icon size={10} /> })()}
            {TYPE_LABELS[item.type]}
          </span>
          <p className="truncate text-xs font-medium text-[var(--text-secondary)]">{item.title}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <Badge variant="outline" className={cn('px-1.5 text-[10px]', statusMeta.className)}>
            {item.status === 'running' && <Loader2 size={9} className="animate-spin" />}
            {statusMeta.label}
          </Badge>
          {!item.read && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-amber-500" title="未读" />}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove(item.id)
            }}
            className="rounded p-0.5 text-[var(--text-tertiary)] opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
            title="删除"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      <p className="line-clamp-3 text-sm leading-snug text-[var(--text-primary)]">{item.message}</p>

      {/* 完整刮削链路：成功/失败/跳过/未执行 一目了然 */}
      {chain.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chain.map((step, i) => (
            <StepBadge key={`${step.provider}-${i}`} step={step} />
          ))}
        </div>
      )}

      {/* 批量进度条 */}
      {item.progress && item.status === 'running' && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${batchPct}%` }} />
        </div>
      )}

      {/* 底部元信息：来源 / 失败数 / 时间 */}
      <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
        <span>
          {item.source && <>来源: <span className="font-medium text-emerald-500">{item.source}</span></>}
          {failedCount > 0 && <span className="ml-2 text-red-500">{failedCount} 个源失败</span>}
        </span>
        <span>{timeAgo(item.timestamp)}</span>
      </div>
    </div>
  )
}
