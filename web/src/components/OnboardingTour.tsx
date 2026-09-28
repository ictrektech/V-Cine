import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { libraryApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useOnboardingStore } from '@/stores/onboarding'
import { useTranslation } from '@/i18n'
import { useWebSocket, type WSEventType } from '@/hooks/useWebSocket'
import { anchorSelector } from '@/lib/onboarding/anchors'
import { TOUR_STEPS } from '@/lib/onboarding/steps'

/**
 * 聚光灯式导览引擎：渲染遮罩与气泡、测量当前步骤的目标、按声明式规则推进步骤。
 * 锚点契约在 `@/lib/onboarding/anchors`，步骤声明在 `@/lib/onboarding/steps`。
 *
 * 遮罩用"四块拼合"：洞的位置完全不渲染，因此目标元素可被真实点击。
 * 关闭语义：ESC = 本次关闭；「不再自动显示」= 永久停止自动弹出（仍可从侧边栏唤起）。
 */

const HOLE_PADDING = 6
const BUBBLE_GAP = 12
const BUBBLE_WIDTH = 300
const BUBBLE_HEIGHT = 210
const BUBBLE_MARGIN = 8
const MASK_COLOR = 'rgba(0, 0, 0, 0.68)'
/** 目标位移（动画、滚动条出现等）的补测间隔；晚挂载由 MutationObserver 即时补测 */
const TARGET_POLL_MS = 300
/** 遮罩区域标记：点击遮罩必须阻止事件传播，否则下层浮层会当成"点击外部"而关闭 */
const MASK_ATTR = 'data-onboarding-mask'

type Rect = { left: number; top: number; width: number; height: number }
type Point = { left: number; top: number }

/**
 * 测量目标元素。同一锚点可能有多个实例（「新增媒体库」在工具栏与空态各一个），
 * 取 DOM 中最后一个可见的——空态按钮更靠后，也正好是空库用户的视线焦点。
 */
function measure(selector: string): Rect | null {
  let found: Rect | null = null
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      found = { left: r.left, top: r.top, width: r.width, height: r.height }
    }
  }
  return found
}

const sameRect = (a: Rect, b: Rect) =>
  a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height

/** 气泡定位：放洞下方，放不下翻到上方，再夹进视口内；任何情况都不压住高亮区 */
function placeBubble(hole: Rect, viewportW: number, viewportH: number): Point {
  const clamp = (v: number, max: number) =>
    Math.min(Math.max(v, BUBBLE_MARGIN), Math.max(max, BUBBLE_MARGIN))
  const below = hole.top + hole.height + BUBBLE_GAP
  return {
    left: clamp(hole.left + hole.width / 2 - BUBBLE_WIDTH / 2, viewportW - BUBBLE_WIDTH - BUBBLE_MARGIN),
    top: clamp(
      below + BUBBLE_HEIGHT <= viewportH - BUBBLE_MARGIN ? below : hole.top - BUBBLE_GAP - BUBBLE_HEIGHT,
      viewportH - BUBBLE_HEIGHT - BUBBLE_MARGIN,
    ),
  }
}

export default function OnboardingTour() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const { t } = useTranslation()
  const { on, off } = useWebSocket()
  const open = useOnboardingStore((s) => s.open)
  const step = useOnboardingStore((s) => s.step)
  const close = useOnboardingStore((s) => s.close)
  const dismissForever = useOnboardingStore((s) => s.dismissForever)
  const maybeAutoOpen = useOnboardingStore((s) => s.maybeAutoOpen)
  const goTo = useOnboardingStore((s) => s.goTo)

  const active = isAdmin && open
  const stepIndex = step
  const current = TOUR_STEPS[stepIndex]
  const isLast = stepIndex >= TOUR_STEPS.length - 1
  // 操作驱动的步骤不提供导航按钮，否则用户会绕过真实操作，引导就失去意义
  const isManual = !current.advance
  const targetSelector = anchorSelector(current.anchor)

  const [rect, setRect] = useState<Rect | null>(null)

  // 任务式引导只对"还没有任何媒体库"的新用户有意义；已有库的用户可从侧边栏手动唤起
  useEffect(() => {
    if (!isAdmin) return
    libraryApi
      .list()
      .then((res) => {
        if ((res.data.data || []).length === 0) maybeAutoOpen()
      })
      .catch(() => { /* 查询失败不打扰，需要时可用侧边栏入口手动打开 */ })
  }, [isAdmin, maybeAutoOpen])

  // 测量目标。切换步骤先清空，避免沿用上一步的高亮位置
  useLayoutEffect(() => {
    if (!active) return
    setRect(null)

    let disposed = false
    let last: Rect | null = null
    let observer: MutationObserver | undefined

    const update = () => {
      if (disposed) return false
      const next = measure(targetSelector)
      if (!next) {
        // 目标被卸载（弹窗取消/路由切换）：清掉过期的高亮与洞，避免指向别处
        if (last) { last = null; setRect(null) }
        return false
      }
      observer?.disconnect()
      // 位置没变不 setState，避免轮询期间无谓的重渲染
      if (!last || !sameRect(last, next)) {
        last = next
        setRect(next)
      }
      return true
    }

    const poll = window.setInterval(update, TARGET_POLL_MS)
    if (!update()) {
      // 目标尚未挂载（跨页面/弹窗）时用 MutationObserver 持续等待
      observer = new MutationObserver(() => { update() })
      observer.observe(document.body, { childList: true, subtree: true })
    }
    window.addEventListener('resize', update)

    return () => {
      disposed = true
      window.clearInterval(poll)
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [active, targetSelector, stepIndex])

  // 声明式推进：click / appear / wsEvent；缺省即 manual，只响应按钮
  useEffect(() => {
    if (!active) return
    const rule = current.advance
    if (!rule) return

    const advance = () => goTo(stepIndex + 1)

    if (rule.on === 'click') {
      // 捕获阶段挂在 document 上、每次点击实时定位：目标可能晚于本步骤挂载，
      // 也可能被 React 重渲染替换；同一入口可能有多处（工具栏与空态各一个），
      // 因此必须遍历全部匹配元素。
      const handler = (e: MouseEvent) => {
        if (!(e.target instanceof Node)) return
        for (const el of document.querySelectorAll(targetSelector)) {
          if (el.contains(e.target)) {
            advance()
            return
          }
        }
      }
      document.addEventListener('click', handler, true)
      return () => document.removeEventListener('click', handler, true)
    }

    if (rule.on === 'appear') {
      // 目标已存在即视为完成，直接推进；否则非 manual 步骤会卡死
      if (document.querySelector(rule.selector)) {
        advance()
        return
      }
      const observer = new MutationObserver(() => {
        if (document.querySelector(rule.selector)) {
          observer.disconnect()
          advance()
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      return () => observer.disconnect()
    }

    const handler = () => advance()
    on(rule.event as WSEventType, handler)
    return () => off(rule.event as WSEventType, handler)
  }, [active, current, stepIndex, targetSelector, goTo, on, off])

  // 点击遮罩时阻止事件继续传播：Radix Dialog 等浮层会把"遮罩上的点击"判定为点击外部并自行关闭，
  // 导致当前高亮目标消失、引导卡住。必须在 window 捕获阶段拦下，才能先于浮层挂在 document 上的监听；
  // 洞里的目标不在此过滤范围内，点击照常生效。
  useEffect(() => {
    if (!active) return
    const handler = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(`[${MASK_ATTR}]`)) {
        e.stopPropagation()
      }
    }
    window.addEventListener('pointerdown', handler, true)
    window.addEventListener('click', handler, true)
    return () => {
      window.removeEventListener('pointerdown', handler, true)
      window.removeEventListener('click', handler, true)
    }
  }, [active])

  // ESC 退出（仅本次关闭）；左右方向键切换步骤
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return }
      // 可编辑焦点下不劫持方向键：fill-form 步骤打字/选目录时按方向键不应切步
      const editable =
        e.target instanceof HTMLElement &&
        e.target.closest('input, textarea, select, [contenteditable="true"]')
      if (editable) return
      if (e.key === 'ArrowRight') goTo(stepIndex + 1)
      else if (e.key === 'ArrowLeft') goTo(stepIndex - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, stepIndex, close, goTo])

  if (!active) return null

  const viewportW = window.innerWidth
  const viewportH = window.innerHeight

  const hole = rect
    ? {
        left: rect.left - HOLE_PADDING,
        top: rect.top - HOLE_PADDING,
        width: rect.width + HOLE_PADDING * 2,
        height: rect.height + HOLE_PADDING * 2,
      }
    : null

  const bubble: Point = hole
    ? placeBubble(hole, viewportW, viewportH)
    : {
        left: Math.max(viewportW / 2 - BUBBLE_WIDTH / 2, BUBBLE_MARGIN),
        top: Math.max(viewportH / 2 - BUBBLE_HEIGHT / 2, BUBBLE_MARGIN),
      }

  const maskClass = 'absolute transition-all duration-300 ease-out'
  const maskStyle = { background: MASK_COLOR }

  return createPortal(
    // 容器不吃事件，让洞里的目标元素保持可点击；有洞才铺遮罩（找不到目标时不锁屏，气泡居中提示）
    <div
      className="fixed inset-0 z-[1000] pointer-events-none"
      role="dialog"
      aria-modal="true"
      aria-label={t('onboard.trigger')}
    >
      {hole && (
        <>
          <div {...{ [MASK_ATTR]: '' }} className={`${maskClass} pointer-events-auto`} style={{ ...maskStyle, left: 0, top: 0, width: viewportW, height: Math.max(hole.top, 0) }} />
          <div {...{ [MASK_ATTR]: '' }} className={`${maskClass} pointer-events-auto`} style={{ ...maskStyle, left: 0, top: hole.top + hole.height, width: viewportW, height: Math.max(viewportH - hole.top - hole.height, 0) }} />
          <div {...{ [MASK_ATTR]: '' }} className={`${maskClass} pointer-events-auto`} style={{ ...maskStyle, left: 0, top: hole.top, width: Math.max(hole.left, 0), height: hole.height }} />
          <div {...{ [MASK_ATTR]: '' }} className={`${maskClass} pointer-events-auto`} style={{ ...maskStyle, left: hole.left + hole.width, top: hole.top, width: Math.max(viewportW - hole.left - hole.width, 0), height: hole.height }} />
          {/* 高亮描边（不吃事件，避免挡住目标点击） */}
          <div
            className="absolute pointer-events-none rounded-xl transition-all duration-300 ease-out"
            style={{
              left: hole.left,
              top: hole.top,
              width: hole.width,
              height: hole.height,
              border: '2px solid var(--neon-blue)',
            }}
          />
        </>
      )}

      {/* 气泡 */}
      <div
        className="absolute pointer-events-auto rounded-2xl p-4 shadow-2xl"
        style={{
          left: bubble.left,
          top: bubble.top,
          width: BUBBLE_WIDTH,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
        }}
      >
        <div className="mb-1 text-[11px] font-medium tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
          {stepIndex + 1} / {TOUR_STEPS.length}
        </div>
        <h3 className="font-display text-base font-bold" style={{ color: 'var(--text-primary)' }}>
          {t(current.titleKey)}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {rect ? t(current.descKey) : t('onboard.strayed')}
        </p>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={dismissForever}
            className="text-xs transition-colors hover:text-neon"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('onboard.dismissForever')}
          </button>
          <div className="flex-1" />
          {isLast ? (
            // 末步：允许不等后台任务跑完就收尾
            <button type="button" onClick={close} className="btn-primary px-4 py-1.5 text-sm">
              {t('onboard.finish')}
            </button>
          ) : isManual ? (
            <>
              {stepIndex > 0 && (
                <button type="button" onClick={() => goTo(stepIndex - 1)} className="btn-ghost px-3 py-1.5 text-sm">
                  {t('onboard.prev')}
                </button>
              )}
              <button type="button" onClick={() => goTo(stepIndex + 1)} className="btn-primary px-4 py-1.5 text-sm">
                {t('onboard.next')}
              </button>
            </>
          ) : (
            // 操作驱动的步骤：不给导航按钮，只提示"按高亮处操作"
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('onboard.hintAuto')}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
