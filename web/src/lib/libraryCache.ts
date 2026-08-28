import type { Library } from '@/types'

const KEY = 'nowen-libraries'

export function loadCachedLibraries(): Library[] | undefined {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function saveCachedLibraries(libraries: Library[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(libraries))
  } catch {
    // 缓存写入失败不影响主流程
  }
}
