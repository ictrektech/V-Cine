import { useMemo } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { CheckCircle2, ChevronRight, CircleAlert } from 'lucide-react'
import { useCapabilities } from '@/hooks/useCapabilities'
import { useTranslation } from '@/i18n'
import type { SetupTarget } from '@/lib/setupTargets'

/**
 * 推荐配置入口（管理页标题栏）。
 *
 * 一个入口承担两件事：
 * - 状态：当前处于基础模式 / 增强模式 / 完整模式，还剩几项。
 * - 动作：展开推荐清单，逐项直达对应设置分区。
 *
 * 清单顺序按依赖排列：
 * 元数据刮削（无依赖）→ AI 供应商（无依赖）→ AI 开关（依赖供应商）
 * → 视频场景识别（无依赖）→ 视频场景描述（依赖视频场景识别）。
 *
 * 状态未知时不显示。
 */

type SetupMode = 'base' | 'enhanced' | 'full'

type SetupStep = {
  id: string
  titleKey: string
  descKey: string
  done: boolean
  drawer: string
  /** 抽屉内具体设置项的锚点，跳转后高亮该元素。 */
  target: SetupTarget
}

interface SetupAdvisorProps {
  /** 元数据刮削是否已配置（TMDb 或豆瓣任一）。 */
  metadataConfigured: boolean
  onOpenDrawer: (id: string, target?: SetupTarget) => void
}

export default function SetupAdvisor({ metadataConfigured, onOpenDrawer }: SetupAdvisorProps) {
  const { t } = useTranslation()
  const { get, stateOf } = useCapabilities()

  const aiState = stateOf('ai')
  const vaState = stateOf('video_analysis')

  const steps = useMemo<SetupStep[]>(() => {
    const aiReason = get('ai')?.reason ?? ''
    // 供应商步骤只看连接信息是否齐备，开关状态留给下一步判断。
    const providerDone = aiReason !== 'capability.ai.no_provider' && aiReason !== 'capability.ai.missing_model'
    return [
      { id: 'metadata', titleKey: 'admin.setupStepMetadata', descKey: 'admin.setupStepMetadataDesc', done: metadataConfigured, drawer: 'metadata', target: 'metadata' },
      { id: 'ai-provider', titleKey: 'admin.setupStepAiProvider', descKey: 'admin.setupStepAiProviderDesc', done: providerDone, drawer: 'ai-providers', target: 'ai-provider' },
      { id: 'ai-switch', titleKey: 'admin.setupStepAiSwitch', descKey: 'admin.setupStepAiSwitchDesc', done: aiState === 'available', drawer: 'ai', target: 'ai-switch' },
      { id: 'video-analysis', titleKey: 'admin.setupStepVideoAnalysis', descKey: 'admin.setupStepVideoAnalysisDesc', done: vaState === 'available', drawer: 'video-analysis', target: 'video-analysis' },
      { id: 'describe', titleKey: 'admin.setupStepDescribe', descKey: 'admin.setupStepDescribeDesc', done: stateOf('video_analysis_describe') === 'available', drawer: 'video-analysis', target: 'describe' },
    ]
  }, [metadataConfigured, get, stateOf, aiState, vaState])

  if (aiState === 'unknown' || vaState === 'unknown') return null

  const doneCount = steps.filter((step) => step.done).length
  const remaining = steps.length - doneCount
  // 全部步骤完成才算完整模式。
  const mode: SetupMode = remaining === 0 ? 'full' : aiState === 'available' ? 'enhanced' : 'base'
  const modeKey = mode === 'full' ? 'admin.setupModeFull' : mode === 'enhanced' ? 'admin.setupModeEnhanced' : 'admin.setupModeBase'
  const label = remaining > 0 ? `${t(modeKey)} · ${t('admin.setupRemaining', { count: remaining })}` : t(modeKey)
  const isFull = mode === 'full'
  // 三档配色：基础=橙（待处理）、增强=蓝（进行中）、完整=灰（已定型，不抢注意力）
  const chipStyle =
    mode === 'full'
      ? { color: '#9CA3AF', background: 'rgba(156,163,175,0.14)' }
      : mode === 'enhanced'
        ? { color: '#38BDF8', background: 'var(--neon-blue-15)', border: '1px solid var(--neon-blue-30)' }
        : { color: '#F59E0B', background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.3)' }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all hover:brightness-110"
          style={chipStyle}
          aria-label={t('admin.setupAdvisorTitle')}
        >
          {isFull ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
          {label}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl p-3 shadow-2xl outline-none"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
        >
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-xs font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--text-tertiary)' }}>
              {t('admin.setupAdvisorTitle')}
            </span>
            <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
              {doneCount}/{steps.length}
            </span>
          </div>
          <p className="mb-2 px-1 text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            {t('admin.setupAdvisorHint')}
          </p>

          <ul className="space-y-0.5">
            {steps.map((step, index) => (
              <li key={step.id}>
                {/* 点击后先关闭浮层，再打开抽屉 */}
                <Popover.Close asChild>
                <button
                  onClick={() => onOpenDrawer(step.drawer, step.target)}
                  disabled={step.done}
                  className="flex w-full items-start gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-[var(--nav-hover-bg)] disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums"
                    style={
                      step.done
                        ? { color: '#16A34A', background: 'rgba(22,163,74,0.12)' }
                        : { color: 'var(--text-tertiary)', background: 'var(--nav-hover-bg)' }
                    }
                  >
                    {step.done ? <CheckCircle2 size={12} /> : index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block text-sm font-medium"
                      style={{ color: step.done ? 'var(--text-tertiary)' : 'var(--text-primary)' }}
                    >
                      {t(step.titleKey)}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                      {step.done ? t('admin.setupDone') : t(step.descKey)}
                    </span>
                  </span>
                  {!step.done && <ChevronRight size={14} className="mt-1 shrink-0" style={{ color: 'var(--text-tertiary)' }} />}
                </button>
                </Popover.Close>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
