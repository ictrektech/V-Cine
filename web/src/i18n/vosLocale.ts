import type { LocaleCode } from './index'

/** VOS bridge 的语言部分类型视图（oauth2 类型在 vos-oidc.ts 单独声明） */
interface VosLocaleBridge {
  getState?: () => Promise<{ locale?: unknown }>
  broadcast?: {
    on: (event: 'locale-change', handler: (state: { locale?: unknown }) => void) => () => void
  }
}

/**
 * 将 VOS 下发的语言标签归一化为 nowen-video 支持的语言码。
 * VOS 可能下发 en-US / en / zh / zh-Hans / zh-Hant / ja 等，统一映射到
 * zh-CN / zh-TW / en-US / ja-JP。
 */
export function normalizeVosLocale(value: unknown): LocaleCode | null {
  if (typeof value !== 'string') return null
  const tag = value.trim().replace(/_/g, '-').toLowerCase()
  if (/^zh-(tw|hk|mo|hant)(-|$)/.test(tag)) return 'zh-TW'
  if (tag === 'zh' || /^zh-(cn|sg|hans)(-|$)/.test(tag)) return 'zh-CN'
  if (tag === 'ja' || tag.startsWith('ja-')) return 'ja-JP'
  if (tag === 'en' || tag.startsWith('en-')) return 'en-US'
  return null
}

/**
 * 订阅 VOS 语言变化。遵循最新版 VOS 桥接约定：
 *   1. 先订阅 locale-change，再读取 getState 快照，避免启动期间事件丢失；
 *   2. 用 revision 计数防止旧快照覆盖新事件；
 *   3. VOS 在 iframe onload 之后才注入 bridge，用 50ms 轮询等待（最多 10s）；
 *   4. 非 iframe（独立打开 / Tauri）直接跳过，由调用方降级到浏览器语言。
 */
export function listenForVosLocale(apply: (locale: LocaleCode) => void): () => void {
  if (typeof window === 'undefined' || window.parent === window) return () => {}

  let active = true
  let stop: (() => void) | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let revision = 0
  const started = Date.now()

  function connect(): boolean {
    const bridge = (window as unknown as { vos_platform?: VosLocaleBridge }).vos_platform
    if (!bridge) return false

    const update = (state: { locale?: unknown }) => {
      const locale = normalizeVosLocale(state.locale)
      if (active && locale) apply(locale)
    }

    try {
      // 先订阅，保证 VOS 在 getState 之前推的语言不丢
      stop = bridge.broadcast?.on('locale-change', state => {
        revision++
        update(state)
      })
      // 后读快照；若订阅后已收到新事件，则丢弃旧快照
      const snapshotRevision = revision
      void bridge.getState?.().then(state => {
        if (revision === snapshotRevision) update(state)
      }).catch(() => undefined)
    } catch { /* 旧版 bridge 可能没有 getState */ }

    return true
  }

  if (!connect()) {
    timer = setInterval(() => {
      if (connect() || Date.now() - started >= 10000) clearInterval(timer)
    }, 50)
  }

  return () => {
    active = false
    clearInterval(timer)
    stop?.()
  }
}
