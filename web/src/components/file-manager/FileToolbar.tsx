import type { Library } from '@/types'
import {
  Search,
  Filter,
  Plus,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  CheckSquare,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { toAppUrl } from '@/lib/appUrl'
import { routes } from '@/lib/routes'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { SORT_OPTIONS, SOURCE_OPTIONS, REMOTE_ANALYSIS_DISABLED_TIP } from './constants'
import { useTranslation } from '@/i18n'
import {
  Sparkles,
  Wand2,
  Trash2,
  ScanSearch,
} from 'lucide-react'

interface FileToolbarProps {
  // 搜索
  keyword: string
  onKeywordChange: (val: string) => void
  // 筛选
  showFilters: boolean
  onToggleFilters: () => void
  filterLibrary: string
  onFilterLibraryChange: (val: string) => void
  filterMediaType: string
  onFilterMediaTypeChange: (val: string) => void
  filterScraped: string
  onFilterScrapedChange: (val: string) => void
  sortBy: string
  onSortByChange: (val: string) => void
  sortOrder: string
  onToggleSortOrder: () => void
  libraries: Library[]
  // 操作
  onImport: () => void
  // 视图
  viewMode: 'table' | 'grid'
  onViewModeChange: (mode: 'table' | 'grid') => void
  // 批量操作
  selectedCount: number
  scrapeSource: string
  onScrapeSourceChange: (val: string) => void
  onBatchScrape: () => void
  onBatchAnalyze: () => void
  videoAnalysisEnabled?: boolean
  videoAnalysisDisabledReason?: string
  remoteVideoEnabled?: boolean
  selectedAllRemote?: boolean
  onBatchRename: () => void
  onBatchDelete: () => void
  onClearSelection: () => void
  // 额外内容（如AI助手按钮），渲染在视图切换按钮右侧
  children?: React.ReactNode
}

export default function FileToolbar({
  keyword, onKeywordChange,
  showFilters, onToggleFilters,
  filterLibrary, onFilterLibraryChange,
  filterMediaType, onFilterMediaTypeChange,
  filterScraped, onFilterScrapedChange,
  sortBy, onSortByChange,
  sortOrder, onToggleSortOrder,
  libraries,
  onImport,
  viewMode, onViewModeChange,
  selectedCount,
  scrapeSource, onScrapeSourceChange,
  onBatchScrape, onBatchAnalyze, videoAnalysisEnabled = true, videoAnalysisDisabledReason, remoteVideoEnabled = false, selectedAllRemote = false,
  onBatchRename, onBatchDelete, onClearSelection,
  children,
}: FileToolbarProps) {
  const { t } = useTranslation()
  const remoteDisabled = selectedAllRemote && !remoteVideoEnabled
  const analysisDisabled = !videoAnalysisEnabled || remoteDisabled
  let analysisTitle: string | undefined
  if (!videoAnalysisEnabled) {
    analysisTitle = videoAnalysisDisabledReason || t('fm.analysisNotEnabled')
  } else if (remoteDisabled) {
    analysisTitle = t(REMOTE_ANALYSIS_DISABLED_TIP)
  } else if (selectedAllRemote) {
    analysisTitle = t('fm.remoteAnalysisHint')
  }

  return (
    <div className="glass-panel rounded-xl p-4 space-y-3">
      {/* 第一行：搜索和操作按钮 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 搜索 */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <Input
            type="text"
            placeholder={t('fm.searchPlaceholder')}
            value={keyword}
            onChange={e => onKeywordChange(e.target.value)}
            className="w-full pl-9 pr-3 text-sm rounded-lg"
          />
        </div>

        {/* 筛选切换 */}
        <button
          onClick={onToggleFilters}
          className={clsx('btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm', showFilters && 'text-neon')}
        >
          <Filter size={16} /> {t('search.filter')}
          {showFilters ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div className="h-6 w-px bg-surface-700" />

        {/* 导入按钮 */}
        <button onClick={onImport} className="btn-primary flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm">
          <Plus size={16} /> {t('fm.importFiles')}
        </button>

        <div className="h-6 w-px bg-surface-700" />

        {/* 视图切换 */}
        <div className="flex items-center rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border-default)' }}>
          <button
            onClick={() => onViewModeChange('table')}
            className={clsx('px-2.5 py-1.5 text-xs', viewMode === 'table' ? 'bg-neon-blue/20 text-neon' : 'text-surface-400')}
          >
            {t('fm.viewList')}
          </button>
          <button
            onClick={() => onViewModeChange('grid')}
            className={clsx('px-2.5 py-1.5 text-xs', viewMode === 'grid' ? 'bg-neon-blue/20 text-neon' : 'text-surface-400')}
          >
            {t('fm.viewGrid')}
          </button>
        </div>

        {/* 额外内容插槽（如AI助手按钮） */}
        {children}
      </div>

      {/* 筛选行 */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
          <select value={filterLibrary} onChange={e => onFilterLibraryChange(e.target.value)}
            className="input-glass px-3 py-1.5 text-sm rounded-lg">
            <option value="">{t('fm.filterAllLibraries')}</option>
            {libraries.map(lib => <option key={lib.id} value={lib.id}>{lib.name}</option>)}
          </select>
          <select value={filterMediaType} onChange={e => onFilterMediaTypeChange(e.target.value)}
            className="input-glass px-3 py-1.5 text-sm rounded-lg">
            <option value="">{t('fm.filterAllTypes')}</option>
            <option value="movie">{t('media.movie')}</option>
            <option value="episode">{t('media.episode')}</option>
          </select>
          <select value={filterScraped} onChange={e => onFilterScrapedChange(e.target.value)}
            className="input-glass px-3 py-1.5 text-sm rounded-lg">
            <option value="">{t('fm.filterAllStatus')}</option>
            <option value="true">{t('fm.statScraped')}</option>
            <option value="false">{t('fm.statUnscraped')}</option>
          </select>
          <select value={sortBy} onChange={e => onSortByChange(e.target.value)}
            className="input-glass px-3 py-1.5 text-sm rounded-lg">
            {SORT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>)}
          </select>
          <button onClick={onToggleSortOrder}
            className="btn-ghost flex items-center gap-1 px-2 py-1.5 rounded-lg text-sm">
            <ArrowUpDown size={14} /> {sortOrder === 'desc' ? t('fm.sortDesc') : t('fm.sortAsc')}
          </button>
        </div>
      )}

      {/* 批量操作栏 */}
      {selectedCount > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-surface)' }}>
          <Badge variant="outline" className="gap-1.5 rounded-full border-transparent bg-neon-blue/10 px-3 py-1 text-sm font-medium text-neon">
            <CheckSquare size={14} /> {t('fm.selectedCount', { count: selectedCount })}
          </Badge>

          <Separator orientation="vertical" className="h-6" />

          <Select value={scrapeSource} onValueChange={onScrapeSourceChange}>
            <SelectTrigger className="h-9 w-auto rounded-lg px-3 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.labelKey ? t(opt.labelKey) : opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="sm"
            className="bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 hover:text-blue-200"
            onClick={onBatchScrape}
          >
            <Sparkles size={14} /> {t('fm.batchScrape')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/20 hover:text-cyan-200"
            onClick={onBatchAnalyze}
            disabled={analysisDisabled}
            title={analysisTitle}
          >
            <ScanSearch size={14} /> {t('fm.batchAnalyze')}
          </Button>
          {!videoAnalysisEnabled && (
            <Button
              variant="ghost"
              size="sm"
              className="px-2.5 text-xs text-amber-300 hover:bg-amber-400/10 hover:text-amber-200"
              onClick={() => { window.location.href = toAppUrl(routes.admin()) }}
              title={videoAnalysisDisabledReason || t('fm.goAnalysisConfig')}
            >
              {t('fm.goConfig')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="bg-purple-400/10 text-purple-300 hover:bg-purple-400/20 hover:text-purple-200"
            onClick={onBatchRename}
          >
            <Wand2 size={14} /> {t('fm.batchRename')}
          </Button>

          <Separator orientation="vertical" className="h-6" />

          <Button
            variant="outline"
            size="sm"
            className="border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:text-red-200"
            onClick={onBatchDelete}
          >
            <Trash2 size={14} /> {t('common.delete')}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-surface-400 hover:text-surface-200"
            onClick={onClearSelection}
          >
            <X size={14} /> {t('fm.cancelSelection')}
          </Button>
        </div>
      )}
    </div>
  )
}
