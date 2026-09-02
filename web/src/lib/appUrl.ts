/**
 * 应用 URL 层：唯一处理 VOS 子路径前缀的地方。
 *
 * 业务代码不要直接 `window.open('/...')` 或裸拼前缀，
 * 统一走：
 * - 同窗口跳转：React Router `Link` / `navigate`
 * - 新窗口跳转：`openAppUrl(routes.xxx(...))`
 */
import { withBasePath } from './basePath'

/** 给根相对路径加上 VOS 子路径前缀。 */
export function toAppUrl(path: string): string {
  return withBasePath(path)
}

/** 在新窗口/新标签页打开内部应用页面。 */
export function openAppUrl(path: string, target = '_blank') {
  window.open(toAppUrl(path), target, 'noopener,noreferrer')
}
