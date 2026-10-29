import { create } from 'zustand'

/**
 * 全局海报/封面"版本戳"。
 *
 * 用途：当刮削完成（WS: scrape_completed）或用户手动替换元数据时，
 * 调用 bumpPosterVersion() 更新版本号，所有图片 URL 会带上新的 ?v=xxx，
 * 浏览器视作新请求，强制加载最新海报。
 *
 * 派生封面（WS: poster_ready）只影响单个媒体，用 posterVersions 按 ID 递增，
 * 避免为了一张图重载整页图片。
 *
 * 设计要点：
 * 1. 用 Date.now() 作为初始值，保证页面刷新后也会与之前的 URL 区分；
 * 2. bump 时也用 Date.now() 而不是 +1，避免并发多次调用被合并为一次自增；
 * 3. 组件中通过 useMediaRefreshStore(s => s.posterVersion) 订阅，获得细粒度更新。
 */
interface MediaRefreshState {
  posterVersion: number
  /** 按媒体 ID 的版本戳：派生封面生成完成时只递增对应条目 */
  posterVersions: Record<string, number>
  bumpPosterVersion: () => void
  bumpPoster: (mediaId: string) => void
}

export const useMediaRefreshStore = create<MediaRefreshState>((set) => ({
  posterVersion: Date.now(),
  posterVersions: {},
  bumpPosterVersion: () => set({ posterVersion: Date.now() }),
  bumpPoster: (mediaId) =>
    set((s) => ({ posterVersions: { ...s.posterVersions, [mediaId]: Date.now() } })),
}))

/** 便捷 hook：仅订阅版本号（避免在 selector 中解构整个 state） */
export const usePosterVersion = () => useMediaRefreshStore((s) => s.posterVersion)

/** 非组件环境（如 WS 回调）下直接 bump */
export const bumpPosterVersion = () => useMediaRefreshStore.getState().bumpPosterVersion()

/** 非组件环境下按媒体 ID bump（派生封面就绪时使用） */
export const bumpPoster = (mediaId: string) => useMediaRefreshStore.getState().bumpPoster(mediaId)
