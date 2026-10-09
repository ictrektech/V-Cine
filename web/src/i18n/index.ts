import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'
import jaJP from './locales/ja-JP'

// 支持的语言列表
export const SUPPORTED_LOCALES = [
  { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
  { code: 'en-US', name: 'English', flag: '🇺🇸' },
  { code: 'ja-JP', name: '日本語', flag: '🇯🇵' },
] as const

export type LocaleCode = typeof SUPPORTED_LOCALES[number]['code']
/** 语言偏好：auto = 跟随浏览器语言 */
export type LocalePreference = 'auto' | LocaleCode

// 语言包映射
const localeMessages: Record<LocaleCode, Record<string, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'ja-JP': jaJP,
}

// i18n Store
interface I18nStore {
  /** 只保存偏好；实际语言由 resolveLocale 推导，避免两处状态不同步 */
  preference: LocalePreference
  setLocale: (preference: LocalePreference) => void
}

// 检测浏览器语言：中文 → 简体中文，日文 → 日本語，其余（含英语与其它语种）→ English
function detectBrowserLocale(): LocaleCode {
  const browserLang = navigator.language || ''
  if (browserLang.startsWith('zh')) return 'zh-CN'
  if (browserLang.startsWith('ja')) return 'ja-JP'
  return 'en-US'
}

/** 将偏好解析为实际语言：auto 时读取浏览器语言 */
export function resolveLocale(preference: LocalePreference): LocaleCode {
  return preference === 'auto' ? detectBrowserLocale() : preference
}

export const useI18nStore = create<I18nStore>()(
  persist(
    (set) => ({
      preference: 'auto',
      setLocale: (preference: LocalePreference) => {
        set({ preference })
        // 更新 HTML lang 属性
        document.documentElement.lang = resolveLocale(preference)
      },
    }),
    {
      name: 'nowen-i18n',
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
  const locale = resolveLocale(useI18nStore.getState().preference)
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
 * 订阅 preference：语言切换时组件重渲染；t 每次调用现读 store，天然响应式
 */
export function useTranslation() {
  const preference = useI18nStore((s) => s.preference)
  const setLocale = useI18nStore((s) => s.setLocale)
  return { t, locale: resolveLocale(preference), setLocale }
}

// 初始化 i18n（App 启动时调用）：setLocale 内部会同步 <html lang>
export function initI18n() {
  const { preference, setLocale } = useI18nStore.getState()
  setLocale(preference)
}
