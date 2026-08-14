import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ==================== 主题定义 ====================
export interface ThemeConfig {
  id: string
  name: string
  author: string
  description: string
  // CSS 变量
  vars: Record<string, string>
}

// ==================== 辅助函数：从 hex 生成透明度变体 ====================
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : null
}

function rgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return `rgba(0,0,0,${alpha})`
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

/** 根据主色和辅色生成完整的透明度变体 */
function generateNeonVars(neonBlue: string, neonPurple: string, isDark: boolean) {
  // 计算一个中间色调（用于渐变按钮）
  const blueRgb = hexToRgb(neonBlue)
  const midBlue = blueRgb
    ? `rgba(${Math.round(blueRgb.r * 0.75)}, ${Math.round(blueRgb.g * 0.75)}, ${Math.round(blueRgb.b * 0.75)}, 0.90)`
    : rgba(neonBlue, 0.9)

  return {
    '--neon-blue-4': rgba(neonBlue, 0.04),
    '--neon-blue-5': rgba(neonBlue, 0.05),
    '--neon-blue-6': rgba(neonBlue, 0.06),
    '--neon-blue-8': rgba(neonBlue, 0.08),
    '--neon-blue-10': rgba(neonBlue, 0.10),
    '--neon-blue-12': rgba(neonBlue, 0.12),
    '--neon-blue-15': rgba(neonBlue, 0.15),
    '--neon-blue-20': rgba(neonBlue, 0.20),
    '--neon-blue-25': rgba(neonBlue, 0.25),
    '--neon-blue-30': rgba(neonBlue, 0.30),
    '--neon-blue-40': rgba(neonBlue, 0.40),
    '--neon-blue-50': rgba(neonBlue, 0.50),
    '--neon-blue-90': rgba(neonBlue, isDark ? 0.90 : 0.95),
    '--neon-blue-mid': midBlue,
    '--neon-purple-8': rgba(neonPurple, 0.08),
    '--neon-purple-10': rgba(neonPurple, 0.10),
    '--neon-purple-15': rgba(neonPurple, 0.15),
    '--neon-purple-20': rgba(neonPurple, 0.20),
    '--neon-purple-glow-text': neonPurple,
    '--neon-glow-shadow-sm': `0 1px 3px rgba(0, 0, 0, ${isDark ? 0.25 : 0.08})`,
    '--neon-glow-shadow-md': `0 2px 8px rgba(0, 0, 0, ${isDark ? 0.3 : 0.1})`,
    '--neon-glow-shadow-lg': `0 4px 14px rgba(0, 0, 0, ${isDark ? 0.35 : 0.12})`,
    '--neon-glow-shadow-xl': `0 8px 28px rgba(0, 0, 0, ${isDark ? 0.4 : 0.14})`,
    '--neon-glow-shadow-inset': `inset 0 1px 0 rgba(255, 255, 255, ${isDark ? 0.05 : 0.7})`,
  }
}

/** 根据主色生成完整的语义化变量集合（深色主题） */
function generateDarkThemeVars(opts: {
  bgBase: string
  bgSurface: string
  textPrimary: string
  textSecondary: string
  neonBlue: string
  neonPurple: string
  neonPink?: string
  neonGreen?: string
}): Record<string, string> {
  const { bgBase, bgSurface, textPrimary, textSecondary, neonBlue, neonPurple } = opts
  const neonPink = opts.neonPink || '#d4d4d8'
  const neonGreen = opts.neonGreen || '#4ade80'

  return {
    '--neon-blue': neonBlue,
    '--neon-purple': neonPurple,
    '--neon-pink': neonPink,
    '--neon-green': neonGreen,
    '--bg-base': bgBase,
    '--bg-surface': bgSurface,
    '--bg-elevated': rgba(bgSurface, 0.9),
    '--bg-subtle': 'rgba(255, 255, 255, 0.03)',
    '--bg-card': rgba(bgSurface, 0.9),
    '--bg-input': rgba(bgSurface, 0.95),
    '--bg-overlay': 'rgba(0, 0, 0, 0.7)',
    '--bg-tooltip': '#27272a',
    '--bg-skeleton-from': 'rgba(255, 255, 255, 0.04)',
    '--bg-skeleton-to': 'rgba(255, 255, 255, 0.08)',
    '--text-primary': textPrimary,
    '--text-secondary': textSecondary,
    '--text-tertiary': rgba(textPrimary, 0.45),
    '--text-muted': rgba(textPrimary, 0.32),
    '--text-on-neon': bgBase,
    '--glass-bg': rgba(bgSurface, 0.7),
    '--glass-border': 'rgba(255, 255, 255, 0.08)',
    '--glass-blur': '16px',
    '--border-default': 'rgba(255, 255, 255, 0.08)',
    '--border-hover': 'rgba(255, 255, 255, 0.18)',
    '--border-strong': 'rgba(255, 255, 255, 0.14)',
    '--border-subtle': 'rgba(255, 255, 255, 0.05)',
    '--shadow-card': '0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2)',
    '--shadow-card-hover': '0 4px 12px rgba(0, 0, 0, 0.35)',
    '--shadow-elevated': '0 8px 24px rgba(0, 0, 0, 0.4)',
    '--shadow-neon': '0 1px 3px rgba(0, 0, 0, 0.3)',
    '--gradient-overlay-from': rgba(bgBase, 0.95),
    '--gradient-overlay-mid': rgba(bgBase, 0.5),
    '--selection-bg': rgba(neonBlue, 0.2),
    '--selection-text': '#fff',
    '--scrollbar-thumb': 'rgba(255, 255, 255, 0.18)',
    '--scrollbar-thumb-hover': 'rgba(255, 255, 255, 0.3)',
    '--focus-ring': rgba(neonBlue, 0.5),
    '--nav-hover-bg': 'rgba(255, 255, 255, 0.06)',
    '--nav-active-bg': 'rgba(255, 255, 255, 0.1)',
    '--noise-opacity': '0.012',
    '--progress-track-bg': 'rgba(255, 255, 255, 0.12)',
    '--progress-bar-glow': 'none',
    '--spinner-border': 'rgba(255, 255, 255, 0.3)',
    '--glass-panel-inset': 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
    '--glass-panel-strong-inset': 'inset 0 1px 0 rgba(255, 255, 255, 0.06)',
    '--modal-glow': '0 0 1px rgba(255, 255, 255, 0.08)',
    '--modal-panel-glow': 'none',
    '--grid-line-color': 'rgba(255, 255, 255, 0.08)',
    '--deco-glow-blue': 'rgba(255, 255, 255, 0.03)',
    '--deco-glow-purple': 'rgba(255, 255, 255, 0.02)',
    ...generateNeonVars(neonBlue, neonPurple, true),
  }
}

// 内置主题（中性色板）
export const builtinThemes: ThemeConfig[] = [
  {
    id: 'neon-dark',
    name: '深色',
    author: 'nowen',
    description: 'shadcn 中性深色主题',
    vars: generateDarkThemeVars({
      bgBase: '#09090b',
      bgSurface: '#121214',
      textPrimary: '#fafafa',
      textSecondary: '#a1a1aa',
      neonBlue: '#fafafa',
      neonPurple: '#d4d4d8',
      neonPink: '#d4d4d8',
      neonGreen: '#4ade80',
    }),
  },
  {
    id: 'pure-light',
    name: '浅色',
    author: 'nowen',
    description: 'shadcn 中性浅色主题',
    vars: {
      '--neon-blue': '#18181b',
      '--neon-purple': '#71717a',
      '--neon-pink': '#a1a1aa',
      '--neon-green': '#059669',
      '--glass-bg': 'rgba(255, 255, 255, 0.85)',
      '--glass-border': 'rgba(0, 0, 0, 0.08)',
      '--glass-blur': '16px',
      '--bg-base': '#ffffff',
      '--bg-surface': '#fafafa',
      '--bg-elevated': '#ffffff',
      '--bg-subtle': 'rgba(0, 0, 0, 0.02)',
      '--bg-card': 'rgba(255, 255, 255, 0.95)',
      '--bg-input': '#ffffff',
      '--bg-overlay': 'rgba(0, 0, 0, 0.35)',
      '--bg-tooltip': '#18181b',
      '--bg-skeleton-from': 'rgba(0, 0, 0, 0.04)',
      '--bg-skeleton-to': 'rgba(0, 0, 0, 0.08)',
      '--text-primary': '#18181b',
      '--text-secondary': '#52525b',
      '--text-tertiary': '#71717a',
      '--text-muted': '#a1a1aa',
      '--text-on-neon': '#ffffff',
      '--border-default': 'rgba(0, 0, 0, 0.1)',
      '--border-hover': 'rgba(0, 0, 0, 0.2)',
      '--border-strong': 'rgba(0, 0, 0, 0.14)',
      '--border-subtle': 'rgba(0, 0, 0, 0.06)',
      '--shadow-card': '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)',
      '--shadow-card-hover': '0 4px 12px rgba(0, 0, 0, 0.1)',
      '--shadow-elevated': '0 8px 24px rgba(0, 0, 0, 0.12)',
      '--shadow-neon': '0 1px 3px rgba(0, 0, 0, 0.08)',
      '--gradient-overlay-from': 'rgba(255, 255, 255, 0.95)',
      '--gradient-overlay-mid': 'rgba(255, 255, 255, 0.5)',
      '--selection-bg': 'rgba(0, 0, 0, 0.12)',
      '--selection-text': '#18181b',
      '--scrollbar-thumb': 'rgba(0, 0, 0, 0.18)',
      '--scrollbar-thumb-hover': 'rgba(0, 0, 0, 0.3)',
      '--focus-ring': 'rgba(0, 0, 0, 0.4)',
      '--nav-hover-bg': 'rgba(0, 0, 0, 0.05)',
      '--nav-active-bg': 'rgba(0, 0, 0, 0.08)',
      '--noise-opacity': '0.005',
      '--progress-track-bg': 'rgba(0, 0, 0, 0.1)',
      '--progress-bar-glow': 'none',
      '--spinner-border': 'rgba(0, 0, 0, 0.3)',
      '--glass-panel-inset': 'inset 0 1px 0 rgba(255, 255, 255, 0.7)',
      '--glass-panel-strong-inset': 'inset 0 1px 0 rgba(255, 255, 255, 0.9)',
      '--modal-glow': '0 0 1px rgba(0, 0, 0, 0.08)',
      '--modal-panel-glow': 'none',
      '--grid-line-color': 'rgba(0, 0, 0, 0.08)',
      '--deco-glow-blue': 'rgba(0, 0, 0, 0.03)',
      '--deco-glow-purple': 'rgba(0, 0, 0, 0.02)',
      ...generateNeonVars('#18181b', '#71717a', false),
    },
  },
]

// 亮色主题 ID 列表
const lightThemeIds = new Set(['pure-light'])

// 根据主题 ID 判断是 dark 还是 light
function resolveMode(themeId: string): 'dark' | 'light' {
  return lightThemeIds.has(themeId) ? 'light' : 'dark'
}

// ==================== 主题 Store ====================
interface ThemeStore {
  currentThemeId: string
  theme: 'dark' | 'light'
  customThemes: ThemeConfig[]
  setTheme: (id: string) => void
  toggleTheme: () => void
  addCustomTheme: (theme: ThemeConfig) => void
  removeCustomTheme: (id: string) => void
  getAllThemes: () => ThemeConfig[]
  getCurrentTheme: () => ThemeConfig | undefined
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      currentThemeId: 'neon-dark',
      theme: 'dark' as const,
      customThemes: [],

      setTheme: (id: string) => {
        const allThemes = [...builtinThemes, ...get().customThemes]
        // 防御无效主题 ID（如已删除的内置主题），回退到默认深色主题
        const safeId = allThemes.some((t) => t.id === id) ? id : 'neon-dark'
        const mode = resolveMode(safeId)
        set({ currentThemeId: safeId, theme: mode })
        applyTheme(safeId, allThemes)
      },

      toggleTheme: () => {
        const { theme, currentThemeId, customThemes } = get()
        // dark → pure-light，light → 上一个深色主题（默认 neon-dark）
        if (theme === 'dark') {
          const newId = 'pure-light'
          set({ currentThemeId: newId, theme: 'light' })
          applyTheme(newId, [...builtinThemes, ...customThemes])
        } else {
          // 切回默认深色主题；若之前的 ID 无效（如已删除的内置主题）则回退 neon-dark
          const allThemes = [...builtinThemes, ...customThemes]
          const fallbackDark = allThemes.some((t) => t.id === currentThemeId) && !lightThemeIds.has(currentThemeId)
            ? currentThemeId
            : 'neon-dark'
          set({ currentThemeId: fallbackDark, theme: 'dark' })
          applyTheme(fallbackDark, allThemes)
        }
      },

      addCustomTheme: (theme: ThemeConfig) => {
        set((state) => ({
          customThemes: [...state.customThemes.filter((t) => t.id !== theme.id), theme],
        }))
      },

      removeCustomTheme: (id: string) => {
        set((state) => ({
          customThemes: state.customThemes.filter((t) => t.id !== id),
          currentThemeId: state.currentThemeId === id ? 'neon-dark' : state.currentThemeId,
        }))
      },

      getAllThemes: () => [...builtinThemes, ...get().customThemes],

      getCurrentTheme: () => {
        const all = [...builtinThemes, ...get().customThemes]
        return all.find((t) => t.id === get().currentThemeId)
      },
    }),
    {
      name: 'nowen-theme',
    }
  )
)

// 记录上一次应用的主题变量 key，用于切换时清理旧值
let lastAppliedKeys: string[] = []

// ==================== 主题应用函数 ====================
export function applyTheme(themeId: string, allThemes: ThemeConfig[]) {
  const theme = allThemes.find((t) => t.id === themeId)
  if (!theme) return

  const root = document.documentElement

  // 设置 data-theme 属性，驱动 CSS 中的 [data-theme="dark"] / [data-theme="light"]
  root.setAttribute('data-theme', resolveMode(themeId))

  // 先清除上一次主题设置的内联样式，避免残留
  lastAppliedKeys.forEach((key) => {
    root.style.removeProperty(key)
  })

  // 应用新主题变量
  const newKeys = Object.keys(theme.vars)
  Object.entries(theme.vars).forEach(([key, value]) => {
    root.style.setProperty(key, value)
  })
  lastAppliedKeys = newKeys
}

// 初始化主题（App 启动时调用）
export function initTheme() {
  const state = useThemeStore.getState()
  const allThemes = [...builtinThemes, ...state.customThemes]
  // 持久化的主题 ID 可能已不存在（如旧版内置主题被移除），回退到默认深色主题
  if (!allThemes.some((t) => t.id === state.currentThemeId)) {
    state.setTheme('neon-dark')
    return
  }
  applyTheme(state.currentThemeId, allThemes)
}
