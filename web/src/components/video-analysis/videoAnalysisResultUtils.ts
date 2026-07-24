import type { VideoAnalysisResult } from '@/types/videoAnalysis'

export const VIDEO_ANALYSIS_SCENES_PER_PAGE = 12

export function formatVideoAnalysisSeconds(value?: number) {
  if (value == null || Number.isNaN(value)) return '—'
  const total = Math.max(0, Math.floor(value))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function getVideoAnalysisTimingEntries(result: VideoAnalysisResult) {
  return Object.entries(result.stage_timings || {}).sort((a, b) => a[0].localeCompare(b[0]))
}
