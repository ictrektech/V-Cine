/**
 * 能力发现（capabilities）类型。
 *
 * 对应后端 GET /api/capabilities 的三态设计：
 * - available          依赖齐备，功能可以运行
 * - disabled           依赖齐备，但开关没有打开
 * - missing_dependency 缺少依赖，打开开关也无法运行
 *
 * 前端另有本地状态 unknown：接口未返回、加载失败或组件不在 Provider 内。
 * unknown 必须放行功能，不得因为探测失败阻塞基础媒体功能。
 */

export type CapabilityState = 'available' | 'disabled' | 'missing_dependency' | 'unknown'

/** 后端已实现的能力项 ID。新增能力时前后端同步。 */
export type CapabilityId =
  | 'metadata'
  | 'ai'
  | 'ai_auto_pilot'
  | 'ai_smart_search'
  | 'ai_recommend_reason'
  | 'ai_metadata_enhance'
  | 'video_analysis'
  | 'video_analysis_describe'
  | 'video_analysis_remote'
  | 'scene_search'

/** 补依赖的位置：drawer 对应 /admin?drawer=<drawer>。 */
export interface CapabilityFix {
  drawer: string
}

export interface Capability {
  id: CapabilityId
  state: Exclude<CapabilityState, 'unknown'>
  /** i18n 文案 key，可用状态为空。 */
  reason?: string
  fix?: CapabilityFix
}
