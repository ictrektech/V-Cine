/**
 * 应用 URL 层：唯一处理 VOS 子路径前缀的地方。
 *
 * 业务代码不要直接 `window.location.href = '/...'` 或裸拼前缀，统一走：
 * - 同窗口跳转：React Router `Link` / `useNavigate().navigate(...)`
 * - 外部链接/文件下载：`window.open(url, '_blank')`
 */
import { withBasePath } from './basePath'

/** 给根相对路径加上 VOS 子路径前缀。 */
export function toAppUrl(path: string): string {
  return withBasePath(path)
}
