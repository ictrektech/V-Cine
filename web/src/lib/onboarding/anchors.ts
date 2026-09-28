/**
 * 导览锚点契约。
 *
 * 业务组件只需在目标元素上写 `data-onboarding={ANCHORS.xxx}`，
 * 不需要 import 任何导览运行时代码——导览通过选择器查找目标，
 * 因此删掉导览不会影响任何业务文件。
 *
 * 命名约定：表达"这是什么"（业务语义），不表达"长什么样 / 在哪个位置"，
 * 这样组件重构、布局调整都不会破坏导览。
 *
 * 约束：锚点必须被 `steps.ts` 里的步骤消费。仅作入口标记、不参与步骤的元素不要加锚点。
 */
export const ONBOARDING_ATTR = 'data-onboarding'

export const ANCHORS = {
  // ── 侧边栏 ──
  /** 媒体库管理入口 */
  libraryManagerNav: 'library-manager-nav',
  /** 影视库入口 */
  browseNav: 'browse-nav',

  // ── 媒体库管理页（任务式引导使用） ──
  /** 新增媒体库按钮 */
  createLibraryButton: 'create-library-button',
  /** 创建媒体库弹窗容器 */
  createLibraryDialog: 'create-library-dialog',
  /** 创建成功后的"立即扫描"按钮 */
  scanNowButton: 'scan-now-button',
} as const

export type OnboardingAnchor = (typeof ANCHORS)[keyof typeof ANCHORS]

/** 锚点 → CSS 选择器 */
export function anchorSelector(anchor: OnboardingAnchor): string {
  return `[${ONBOARDING_ATTR}="${anchor}"]`
}
