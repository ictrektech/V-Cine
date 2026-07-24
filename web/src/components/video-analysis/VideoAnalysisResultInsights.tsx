import { AlertCircle, Timer } from 'lucide-react'
import type { VideoAnalysisResult } from '@/types/videoAnalysis'
import { getVideoAnalysisTimingEntries } from './videoAnalysisResultUtils'

interface VideoAnalysisResultInsightsProps {
  result: VideoAnalysisResult
}

export default function VideoAnalysisResultInsights({ result }: VideoAnalysisResultInsightsProps) {
  const timingEntries = getVideoAnalysisTimingEntries(result)
  if (!result.warnings?.length && timingEntries.length === 0) return null

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-white/5 bg-black/10 p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium"><AlertCircle size={14} className="text-amber-300" /> 告警</div>
        {result.warnings?.length ? (
          <ul className="space-y-2 text-sm text-surface-300">
            {result.warnings.map((warning, index) => (
              <li key={`${warning.code || 'warning'}-${index}`} className="rounded-lg bg-white/5 px-3 py-2">
                <div className="font-medium text-surface-200">{warning.code || 'WARNING'}</div>
                <div className="mt-1">{warning.message}</div>
              </li>
            ))}
          </ul>
        ) : <div className="text-sm text-surface-500">无告警</div>}
      </div>
      <div className="rounded-xl border border-white/5 bg-black/10 p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Timer size={14} className="text-neon" /> 阶段耗时</div>
        {timingEntries.length ? (
          <ul className="space-y-2 text-sm text-surface-300">
            {timingEntries.map(([stage, seconds]) => (
              <li key={stage} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                <span>{stage}</span>
                <span className="text-surface-200">{seconds.toFixed(2)}s</span>
              </li>
            ))}
          </ul>
        ) : <div className="text-sm text-surface-500">无阶段耗时数据</div>}
      </div>
    </div>
  )
}
