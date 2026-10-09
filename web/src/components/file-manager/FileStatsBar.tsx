import { FileManagerStats } from '@/types'
import {
  FileVideo,
  Film,
  Tv,
  Check,
  AlertCircle,
  HardDrive,
  Download,
  FileText,
  AlertTriangle,
  XCircle,
} from 'lucide-react'
import clsx from 'clsx'
import { formatFileSize } from './constants'
import { useTranslation } from '@/i18n'

interface FileStatsBarProps {
  stats: FileManagerStats
}

// 统计卡片组件
export default function FileStatsBar({ stats }: FileStatsBarProps) {
  const { t } = useTranslation()
  // 基础指标（始终显示）
  const baseItems = [
    { labelKey: 'fm.statTotalFiles', value: stats.total_files, icon: FileVideo, color: 'text-blue-400' },
    { labelKey: 'fm.statMovies', value: stats.movie_count, icon: Film, color: 'text-purple-400' },
    { labelKey: 'fm.statEpisodes', value: stats.episode_count, icon: Tv, color: 'text-green-400' },
    { labelKey: 'fm.statScraped', value: stats.scraped_count, icon: Check, color: 'text-emerald-400' },
    { labelKey: 'fm.statUnscraped', value: stats.unscraped_count, icon: AlertCircle, color: 'text-amber-400' },
    { labelKey: 'fm.statTotalSize', value: formatFileSize(stats.total_size_bytes), icon: HardDrive, color: 'text-cyan-400' },
    { labelKey: 'fm.statRecentImports', value: stats.recent_imports, icon: Download, color: 'text-indigo-400' },
    { labelKey: 'fm.statOperations', value: stats.recent_operations, icon: FileText, color: 'text-pink-400' },
  ]

  // 动态指标：只有存在才显示（按需）
  const extraItems: { labelKey: string; value: number; icon: typeof FileVideo; color: string }[] = []
  if ((stats.partial_count ?? 0) > 0) {
    extraItems.push({ labelKey: 'fm.statPartial', value: stats.partial_count!, icon: AlertTriangle, color: 'text-orange-400' })
  }
  if ((stats.failed_count ?? 0) > 0) {
    extraItems.push({ labelKey: 'fm.statFailed', value: stats.failed_count!, icon: XCircle, color: 'text-red-400' })
  }

  const items = [...baseItems, ...extraItems]

  // 根据 items 数量动态选择 lg 列数（8 或 9 或 10），保持单行展示
  const lgColsMap: Record<number, string> = {
    8: 'lg:grid-cols-8',
    9: 'lg:grid-cols-9',
    10: 'lg:grid-cols-10',
  }
  const lgCols = lgColsMap[items.length] || 'lg:grid-cols-8'

  return (
    <div
      className={clsx(
        'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 rounded-lg overflow-hidden',
        lgCols
      )}
      style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
    >
      {items.map((item, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-2.5 py-1.5 border-r border-b last:border-r-0"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <item.icon size={14} className={clsx('shrink-0', item.color)} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
              {item.value}
            </div>
            <div className="text-[10px] leading-tight truncate" style={{ color: 'var(--text-tertiary)' }}>
              {t(item.labelKey)}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
