import { AlertCircle } from 'lucide-react'
import { useTranslation } from '@/i18n'
import type { VideoAnalysisResult } from '@/types/videoAnalysis'

interface VideoAnalysisResultInsightsProps {
  result: VideoAnalysisResult
}

/** 告警：仅在有告警时显示。阶段耗时已在顶部工作流状态面板展示，不再重复。 */
export default function VideoAnalysisResultInsights({ result }: VideoAnalysisResultInsightsProps) {
  const { t } = useTranslation()
  if (!result.warnings?.length) return null

  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium"><AlertCircle size={14} className="text-amber-400" /> {t('vat.warnings')}</div>
      <ul className="space-y-2 text-sm text-muted-foreground">
        {result.warnings.map((warning, index) => (
          <li key={`${warning.code || 'warning'}-${index}`} className="rounded-md border bg-background px-3 py-2">
            <div className="font-medium text-foreground">{warning.code || 'WARNING'}</div>
            <div className="mt-1">{warning.message}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
