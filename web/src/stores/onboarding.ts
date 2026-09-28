import { create } from 'zustand'
import { TOUR_STEPS } from '@/lib/onboarding/steps'

// 完成标记：写入后不再自动弹出（仍可从侧边栏"使用引导"入口手动唤起）
const ONBOARDING_KEY = 'nowen:onboarding:done'

function readDone(): boolean {
  try {
    return Boolean(window.localStorage.getItem(ONBOARDING_KEY))
  } catch {
    return false
  }
}

// 只被下面的动作读写、不驱动渲染，模块级变量即可
let done = readDone()

interface OnboardingState {
  /** 导览是否打开 */
  open: boolean
  /** 当前步骤下标 */
  step: number
  /** 手动唤起：从头开始（不改变自动弹出标记） */
  requestOpen: () => void
  /** 本次关闭（不写标记，下次进入仍会自动弹出） */
  close: () => void
  /** 永久停止自动弹出（写入标记，仍可手动唤起） */
  dismissForever: () => void
  /** 首次自动弹出；已标记过则什么都不做 */
  maybeAutoOpen: () => void
  /** 跳到指定步骤（越界一律夹到合法范围，调用方无需自己 Math.min/Math.max） */
  goTo: (step: number) => void
}

/**
 * 导览开关与步骤状态。
 *
 * 唤起入口在 Sidebar、导览层挂在 Layout，两处需要共享同一个"是否打开"，
 * 因此外置到 store。
 */
export const useOnboardingStore = create<OnboardingState>((set) => ({
  open: false,
  step: 0,

  // 手动查看一律从第一步开始，避免上次残留的步骤下标
  requestOpen: () => set({ open: true, step: 0 }),

  close: () => set({ open: false }),

  dismissForever: () => {
    try { window.localStorage.setItem(ONBOARDING_KEY, '1') } catch { /* ignore */ }
    done = true
    set({ open: false })
  },

  maybeAutoOpen: () => {
    if (done) return
    set({ open: true, step: 0 })
  },

  goTo: (step) => set({ step: Math.min(Math.max(step, 0), TOUR_STEPS.length - 1) }),
}))
