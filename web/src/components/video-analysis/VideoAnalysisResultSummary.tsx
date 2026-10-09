import { Card } from '@/components/ui/card'
import { useTranslation } from '@/i18n'
import type { VideoAnalysisResult } from '@/types/videoAnalysis'
import { formatVideoAnalysisSeconds } from './videoAnalysisResultUtils'

interface VideoAnalysisResultSummaryProps {
  result: VideoAnalysisResult
}

export default function VideoAnalysisResultSummary({ result }: VideoAnalysisResultSummaryProps) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card className="p-3 text-sm"><div className="text-muted-foreground">{t('vat.summaryDuration')}</div><div className="mt-1 font-medium text-foreground">{formatVideoAnalysisSeconds(result.duration)}</div></Card>
      <Card className="p-3 text-sm"><div className="text-muted-foreground">{t('vat.summaryResolution')}</div><div className="mt-1 font-medium text-foreground">{result.width || '—'} × {result.height || '—'}</div></Card>
      <Card className="p-3 text-sm"><div className="text-muted-foreground">{t('vat.summaryCodecFps')}</div><div className="mt-1 font-medium text-foreground">{result.codec || '—'} / {result.fps || '—'}</div></Card>
      <Card className="p-3 text-sm"><div className="text-muted-foreground">{t('vat.summaryElapsed')}</div><div className="mt-1 font-medium text-foreground">{result.elapsed_sec != null ? `${result.elapsed_sec.toFixed(1)}s` : '—'}</div></Card>
    </div>
  )
}
