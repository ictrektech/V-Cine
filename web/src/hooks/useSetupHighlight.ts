import { useEffect } from 'react'
import { setupTargetSelector, type SetupTarget } from '@/lib/setupTargets'

const HIGHLIGHT_CLASS = 'setup-highlight'
/** 光圈持续时间，与 CSS 动画的 2 次播放（1.4s × 2 = 2.8s）对齐。 */
const HIGHLIGHT_MS = 3000
/** 等目标元素出现的最长时间。抽屉内容异步加载，需要重试窗口。 */
const OBSERVE_TIMEOUT_MS = 4000

/**
 * 滚动到目标设置项并加一圈脉冲光圈。
 *
 * 两个触发场景：
 * - 从推荐配置清单跳进抽屉，需要定位到具体开关。
 * - 目标元素可能还没渲染（抽屉数据未回来），用 MutationObserver 等它出现。
 *
 * nonce 用来支持「重复点击同一项」：目标相同但 nonce 变化时重新定位。
 * allow 为 false（抽屉未打开）时不执行。
 */
export function useSetupHighlight(target: SetupTarget | undefined, nonce: number | undefined, allow = true) {
  useEffect(() => {
    if (!allow || !target) return

    let el: HTMLElement | null = null
    let highlightTimer: number | undefined
    let observeTimer: number | undefined
    let observer: MutationObserver | undefined

    const run = (node: HTMLElement) => {
      el = node
      node.scrollIntoView({ behavior: 'smooth', block: 'center' })
      node.classList.add(HIGHLIGHT_CLASS)
      highlightTimer = window.setTimeout(() => node.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS)
    }

    const find = () => document.querySelector<HTMLElement>(setupTargetSelector(target))

    const existing = find()
    if (existing) {
      run(existing)
    } else {
      observer = new MutationObserver(() => {
        const node = find()
        if (!node) return
        observer?.disconnect()
        observer = undefined
        run(node)
      })
      observer.observe(document.body, { childList: true, subtree: true })
      observeTimer = window.setTimeout(() => observer?.disconnect(), OBSERVE_TIMEOUT_MS)
    }

    return () => {
      observer?.disconnect()
      if (highlightTimer) clearTimeout(highlightTimer)
      if (observeTimer) clearTimeout(observeTimer)
      el?.classList.remove(HIGHLIGHT_CLASS)
    }
  }, [target, nonce, allow])
}
