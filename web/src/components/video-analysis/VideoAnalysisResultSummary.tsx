import type { VideoAnalysisResult } from '@/types/videoAnalysis'
import { formatVideoAnalysisSeconds } from './videoAnalysisResultUtils'

interface VideoAnalysisResultSummaryProps {
  result: VideoAnalysisResult
}

export default function VideoAnalysisResultSummary({ result }: VideoAnalysisResultSummaryProps) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className="rounded-xl bg-white/5 p-3 text-sm"><div className="text-surface-400">时长</div><div className="mt-1 font-medium">{formatVideoAnalysisSeconds(result.duration)}</div></div>
      <div className="rounded-xl bg-white/5 p-3 text-sm"><div className="text-surface-400">分辨率</div><div className="mt-1 font-medium">{result.width || '—'} × {result.height || '—'}</div></div>
      <div className="rounded-xl bg-white/5 p-3 text-sm"><div className="text-surface-400">编码 / FPS</div><div className="mt-1 font-medium">{result.codec || '—'} / {result.fps || '—'}</div></div>
      <div className="rounded-xl bg-white/5 p-3 text-sm"><div className="text-surface-400">耗时</div><div className="mt-1 font-medium">{result.elapsed_sec != null ? `${result.elapsed_sec.toFixed(1)}s` : '—'}</div></div>
    </div>
  )
}
