/**
 * 推荐配置步骤的目标锚点。
 *
 * 值必须与设置项上的 data-setup-target 属性一致。
 * 新增步骤时，这里和对应组件上的属性要同时改。
 */
export type SetupTarget = 'metadata' | 'ai-provider' | 'ai-switch' | 'video-analysis' | 'describe'

export function setupTargetSelector(target: SetupTarget): string {
  return `[data-setup-target="${target}"]`
}
