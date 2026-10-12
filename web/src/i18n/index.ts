import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'
import enUS from './locales/en-US'
import jaJP from './locales/ja-JP'
import { listenForVosLocale } from './vosLocale'

// 支持的语言列表
export const SUPPORTED_LOCALES = [
  { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
  { code: 'zh-TW', name: '繁體中文', flag: '🇹🇼' },
  { code: 'en-US', name: 'English', flag: '🇺🇸' },
  { code: 'ja-JP', name: '日本語', flag: '🇯🇵' },
] as const

export type LocaleCode = typeof SUPPORTED_LOCALES[number]['code']
/** 语言偏好：auto = 跟随 VOS（iframe 内）或浏览器语言（独立打开） */
export type LocalePreference = 'auto' | LocaleCode

// 语言包映射
const localeMessages: Record<LocaleCode, Record<string, string>> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP,
}

// i18n Store
interface I18nStore {
  /** 只保存偏好；实际语言由 resolveLocale 推导，避免两处状态不同步 */
  preference: LocalePreference
  /** VOS 平台实时语言（只读输入，不持久化）；auto 模式下优先于浏览器语言 */
  platformLocale: LocaleCode | null
  setLocale: (preference: LocalePreference) => void
  setPlatformLocale: (locale: LocaleCode | null) => void
}

// 检测浏览器语言：中文简/繁 → 对应中文，日文 → 日本語，其余（含英语与其它语种）→ English
function detectBrowserLocale(): LocaleCode {
  const browserLang = navigator.language || ''
  if (browserLang.startsWith('zh-TW') || browserLang.startsWith('zh-Hant') || browserLang.startsWith('zh-HK')) return 'zh-TW'
  if (browserLang.startsWith('zh')) return 'zh-CN'
  if (browserLang.startsWith('ja')) return 'ja-JP'
  return 'en-US'
}

/**
 * 将偏好解析为实际语言。
 * auto 时优先级：VOS bridge 实时语言 > 浏览器语言。
 * 手动选择具体语言时锁定，忽略 VOS 与浏览器。
 */
export function resolveLocale(
  preference: LocalePreference,
  platformLocale: LocaleCode | null = null
): LocaleCode {
  if (preference !== 'auto') return preference
  if (platformLocale) return platformLocale
  return detectBrowserLocale()
}

export const useI18nStore = create<I18nStore>()(
  persist(
    (set) => ({
      preference: 'auto',
      platformLocale: null,
      setLocale: (preference) => {
        set({ preference })
        // 更新 HTML lang 属性
        document.documentElement.lang = resolveLocale(preference, useI18nStore.getState().platformLocale)
      },
      setPlatformLocale: (platformLocale) => {
        set({ platformLocale })
        // 仅 auto 模式下同步 HTML lang；手动锁定的语言不受 VOS 影响
        const { preference } = useI18nStore.getState()
        if (preference === 'auto') {
          document.documentElement.lang = resolveLocale('auto', platformLocale)
        }
      },
    }),
    {
      name: 'nowen-i18n',
      // platformLocale 是运行时输入，不持久化；重启后重新从 VOS bridge 获取
      partialize: (state) => ({ preference: state.preference }),
    }
  )
)

/**
 * 翻译函数
 * @param key 翻译键
 * @param params 插值参数，如 { count: 5 }
 * @returns 翻译后的文本
 */
export type TFunc = (key: string, params?: Record<string, string | number>) => string

export function t(key: string, params?: Record<string, string | number>): string {
  const { preference, platformLocale } = useI18nStore.getState()
  const locale = resolveLocale(preference, platformLocale)
  const messages = localeMessages[locale] || localeMessages['zh-CN']
  let text = messages[key] || localeMessages['zh-CN'][key] || key

  // 处理插值参数 {count} -> 5
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.split(`{${k}}`).join(String(v))
    })
  }

  return text
}

/**
 * React Hook: 获取翻译函数（响应式）
 * 订阅 preference 与 platformLocale：语言切换时组件重渲染；t 每次调用现读 store，天然响应式
 */
export function useTranslation() {
  const preference = useI18nStore((s) => s.preference)
  const platformLocale = useI18nStore((s) => s.platformLocale)
  const setLocale = useI18nStore((s) => s.setLocale)
  return { t, locale: resolveLocale(preference, platformLocale), setLocale }
}

// 初始化 i18n（App 启动时调用）：setLocale 内部会同步 <html lang>
export function initI18n() {
  const { preference, setLocale } = useI18nStore.getState()
  setLocale(preference)

  // 接入 VOS 语言桥接：iframe 内自动等待注入并订阅；独立打开时内部跳过
  listenForVosLocale(locale => {
    useI18nStore.getState().setPlatformLocale(locale)
  })
}
