import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 可用的倍速选项
export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3] as const

interface PlayerState {
  // 当前播放状态
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  isFullscreen: boolean
  quality: string
  showControls: boolean
  // 新增：倍速播放
  playbackSpeed: number
  // 新增：画中画
  isPiP: boolean
  // 新增：手势控制
  gestureEnabled: boolean
  gestureOverlay: { type: string; value: number } | null
  // 外部请求跳转到绝对时间（秒）；播放器消费后应 clearSeekRequest
  seekRequest: { time: number; token: number } | null

  // 动作
  setPlaying: (isPlaying: boolean) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setVolume: (volume: number) => void
  setMuted: (isMuted: boolean) => void
  setFullscreen: (isFullscreen: boolean) => void
  setQuality: (quality: string) => void
  setShowControls: (show: boolean) => void
  setPlaybackSpeed: (speed: number) => void
  setPiP: (isPiP: boolean) => void
  setGestureEnabled: (enabled: boolean) => void
  setGestureOverlay: (overlay: { type: string; value: number } | null) => void
  requestSeek: (time: number) => void
  clearSeekRequest: () => void
  reset: () => void
}

const initialState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  isMuted: false,
  isFullscreen: false,
  quality: 'auto',
  showControls: true,
  playbackSpeed: 1,
  isPiP: false,
  gestureEnabled: true,
  gestureOverlay: null as { type: string; value: number } | null,
  seekRequest: null as { time: number; token: number } | null,
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      ...initialState,

      setPlaying: (isPlaying) => set({ isPlaying }),
      setCurrentTime: (currentTime) => set({ currentTime }),
      setDuration: (duration) => set({ duration }),
      setVolume: (volume) => set({ volume, isMuted: volume === 0 }),
      setMuted: (isMuted) => set({ isMuted }),
      setFullscreen: (isFullscreen) => set({ isFullscreen }),
      setQuality: (quality) => set({ quality }),
      setShowControls: (showControls) => set({ showControls }),
      setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
      setPiP: (isPiP) => set({ isPiP }),
      setGestureEnabled: (gestureEnabled) => set({ gestureEnabled }),
      setGestureOverlay: (gestureOverlay) => set({ gestureOverlay }),
      requestSeek: (time) => set({
        seekRequest: {
          time: Math.max(0, Number.isFinite(time) ? time : 0),
          token: Date.now(),
        },
      }),
      clearSeekRequest: () => set({ seekRequest: null }),
      reset: () => set({ ...initialState }),
    }),
    {
      name: 'nowen-player',
      partialize: (state) => ({
        volume: state.volume,
        isMuted: state.isMuted,
        playbackSpeed: state.playbackSpeed,
        gestureEnabled: state.gestureEnabled,
      }),
    }
  )
)
