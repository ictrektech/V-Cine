/**
 * VOS 子路径（basePath）辅助模块。
 *
 * 接入 VOS 平台时，前端被 iframe 加载在 `/app/<app-id>/` 前缀下，
 * 服务端会向 index.html 注入：
 *   - `<base href="/app/<app-id>/">`：相对资源引用自动落到前缀下
 *   - `window.__NOWEN_BASE_PATH__ = "/app/<app-id>"`：供 JS 拼装绝对路径
 *
 * 独立部署（Tauri / 本地 server）时没有注入，__NOWEN_BASE_PATH__ 为空，
 * withBasePath 直接返回原路径，与旧行为完全一致。
 */

/** 读取注入的 basePath，剥掉尾斜杠；未注入返回空串。 */
export function getBasePath(): string {
  if (typeof window === 'undefined') return ''
  const base = window.__NOWEN_BASE_PATH__
  if (typeof base === 'string' && base) {
    return base.replace(/\/+$/, '')
  }
  return ''
}

/** 给绝对路径加上 basePath 前缀；空 basePath 或已带前缀时原样返回。 */
export function withBasePath(path: string): string {
  const base = getBasePath()
  if (!base) return path
  // 仅处理相对路径（以 / 开头）；绝对 URL（http/https/blob/data 等）原样透传
  if (!path.startsWith('/')) return path
  if (path === base || path.startsWith(base + '/')) return path
  return `${base}${path}`
}
