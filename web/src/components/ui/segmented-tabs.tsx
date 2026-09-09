import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { LucideIcon } from 'lucide-react'

// ==================== 分段式 Tab ====================
export interface SegmentedTabItem {
  key: string
  label: string
  icon?: LucideIcon
  /** 可选计数徽章（如影视库的 全部/电影/剧集 数量） */
  count?: number
  /** 隐藏该 tab（如按开关条件显示的成人刮削） */
  hidden?: boolean
}

interface SegmentedTabsProps {
  tabs: SegmentedTabItem[]
  /** 当前激活的 tab key */
  active: string
  onChange: (key: string) => void
  className?: string
}

export default function SegmentedTabs({
  tabs,
  active,
  onChange,
  className,
}: SegmentedTabsProps) {
  return (
    <TabsPrimitive.Root value={active} onValueChange={onChange}>
      <TabsPrimitive.List
        className={
          'inline-flex items-center gap-1 rounded-xl p-1 outline-none ' +
          'animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none ' +
          className
        }
        style={{ background: 'var(--glass-bg)', border: '1px solid var(--neon-blue-6)' }}
      >
        {tabs
          .filter((tab) => !tab.hidden)
          .map((tab) => {
            const Icon = tab.icon
            return (
              <TabsPrimitive.Trigger
                key={tab.key}
                value={tab.key}
                className={
                  'group flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium outline-none ' +
                  'transition-[color,background-color,box-shadow] duration-200 motion-reduce:transition-none ' +
                  'focus-visible:ring-2 focus-visible:ring-neon/40 ' +
                  // 选中态：霓虹高亮 + 内描边（与全站 neon 语言一致）
                  'data-[state=active]:font-semibold data-[state=active]:text-[var(--neon-blue)] ' +
                  'data-[state=active]:bg-[var(--neon-blue-15)] ' +
                  'data-[state=active]:shadow-[inset_0_0_0_1px_var(--neon-blue-30)] ' +
                  // 未选中态
                  'data-[state=inactive]:text-[var(--text-muted)] ' +
                  'data-[state=inactive]:hover:text-[var(--text-primary)]'
                }
              >
                {Icon && <Icon size={13} />}
                <span>{tab.label}</span>
                {typeof tab.count === 'number' && (
                  <span
                    className={
                      'rounded-full px-1.5 py-px text-[11px] leading-tight transition-colors duration-200 ' +
                      'bg-[var(--neon-blue-6)] text-[var(--text-tertiary)] ' +
                      'group-data-[state=active]:bg-[var(--neon-blue-30)] group-data-[state=active]:text-[var(--text-primary)]'
                    }
                  >
                    {tab.count}
                  </span>
                )}
              </TabsPrimitive.Trigger>
            )
          })}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  )
}
