import { useEffect, useState } from 'react'

const QUERY = '(max-width: 767.98px)' // Tailwind md 断点（48rem = 768px）以下视为小屏

/** 是否小屏（<md，含平台 iframe 窄视口）。普通函数，可在 useState 初始化器中直接调用 */
export const isSmallScreen = () =>
  typeof window !== 'undefined' && window.matchMedia(QUERY).matches

/** 小屏响应式状态，随窗口变化实时更新 */
export function useIsSmallScreen(): boolean {
  const [small, setSmall] = useState(isSmallScreen)
  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const onChange = (e: MediaQueryListEvent) => setSmall(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return small
}
