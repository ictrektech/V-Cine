import { Card } from '@/components/ui/card'
import type { VideoAnalysisResult } from '@/types/videoAnalysis'
import { formatVideoAnalysisSeconds } from './videoAnalysisResultUtils'

interface VideoAnalysisResultSummaryProps {
  result: VideoAnalysisResult
}

export default function VideoAnalysisResultSummary({ result }: VideoAnalysisResultSummaryProps) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card className="p-3 text-sm"><div className="text-muted-foreground">时长</div><div className="mt-1 font-medium text-foreground">{formatVideoAnalysisSeconds(result.duration)}</div></Card>
      <Card className="p-3 text-sm"><div className="text-muted-foreground">分辨率</div><div className="mt-1 font-medium text-foreground">{result.width || '—'} × {result.height || '—'}</div></Card>
      <Card className="p-3 text-sm"><div className="text-muted-foreground">编码 / FPS</div><div className="mt-1 font-medium text-foreground">{result.codec || '—'} / {result.fps || '—'}</div></Card>
      <Card className="p-3 text-sm"><div className="text-muted-foreground">耗时</div><div className="mt-1 font-medium text-foreground">{result.elapsed_sec != null ? `${result.elapsed_sec.toFixed(1)}s` : '—'}</div></Card>
    </div>
  )
}
