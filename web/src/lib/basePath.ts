/**
 * VOS 子路径（basePath）辅助模块。
 *
 * VOS 构建时通过 VITE_BASE 注入前缀（如 /app/com.ictrek.nowen-video/），
 * Vite 会把它作为 BASE_URL；根路径/Tauri 构建不设 VITE_BASE，BASE_URL 为
 * '/' 或 './'，此时 basePath 为空串。
 *
 * 兼容旧的后端注入 window.__NOWEN_BASE_PATH__，便于过渡期运行旧镜像。
 */

/** 读取 basePath，剥掉尾斜杠；未配置返回空串。 */
export function getBasePath(): string {
  if (typeof window === 'undefined') return ''

  const viteBase = import.meta.env.BASE_URL
  if (viteBase && viteBase !== '/' && viteBase !== './') {
    return viteBase.replace(/\/+$/, '')
  }

  const injected = window.__NOWEN_BASE_PATH__
  if (typeof injected === 'string' && injected) {
    return injected.replace(/\/+$/, '')
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
