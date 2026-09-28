import { WS_EVENTS } from '@/hooks/useWebSocket'
import { ANCHORS, anchorSelector, type OnboardingAnchor } from './anchors'

/**
 * 步骤推进规则（声明式）。
 *
 * 业务组件不参与推进判断：引擎内部用点击监听 / MutationObserver / WS 订阅求值。
 * 因此新增或调整步骤，只需改这个文件 + 在目标元素上加锚点。
 */
export type AdvanceRule =
  /** 用户点击了目标元素 */
  | { on: 'click' }
  /** 等待某元素出现 */
  | { on: 'appear'; selector: string }
  /** 等待全局 WS 事件（如扫描完成） */
  | { on: 'wsEvent'; event: string }

export interface TourStep {
  /** 高亮目标 */
  anchor: OnboardingAnchor
  titleKey: string
  descKey: string
  /** 推进规则，缺省为 manual（只能点「下一步」推进） */
  advance?: AdvanceRule
}

const scanButtonSelector = anchorSelector(ANCHORS.scanNowButton)

/**
 * 任务式导览：带用户走完"添加媒体库 → 扫描入库"的完整流程。
 *
 * 推进由真实操作驱动（点击控件 / 弹窗关闭 / 扫描完成事件），
 * 因此用户不是在"看说明"，而是在真实完成一次配置。
 */
export const TOUR_STEPS: TourStep[] = [
  {
    anchor: ANCHORS.libraryManagerNav,
    titleKey: 'onboard.task.openManager.title',
    descKey: 'onboard.task.openManager.desc',
    advance: { on: 'click' },
  },
  {
    anchor: ANCHORS.createLibraryButton,
    titleKey: 'onboard.task.createLibrary.title',
    descKey: 'onboard.task.createLibrary.desc',
    advance: { on: 'click' },
  },
  {
    // 整块高亮创建弹窗：用户需要填名称、选路径，最后点「确认创建」
    // 创建成功后弹窗切到成功面板（「立即扫描」出现）即进入下一步
    anchor: ANCHORS.createLibraryDialog,
    titleKey: 'onboard.task.fillForm.title',
    descKey: 'onboard.task.fillForm.desc',
    advance: { on: 'appear', selector: scanButtonSelector },
  },
  {
    anchor: ANCHORS.scanNowButton,
    titleKey: 'onboard.task.scan.title',
    descKey: 'onboard.task.scan.desc',
    advance: { on: 'click' },
  },
  {
    // 收尾：扫描在后台进行，完成后影片出现在影视库（也可手动结束）
    anchor: ANCHORS.browseNav,
    titleKey: 'onboard.task.done.title',
    descKey: 'onboard.task.done.desc',
    advance: { on: 'wsEvent', event: WS_EVENTS.SCAN_COMPLETED },
  },
]
