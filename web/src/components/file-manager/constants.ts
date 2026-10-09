import type { Media, Library, FileManagerStats } from '@/types'

// 远程视频禁用的提示 i18n key（渲染处用 t() 翻译）
export const REMOTE_ANALYSIS_DISABLED_TIP = 'fm.remoteAnalysisDisabledTip'

// 数据源选项
// 自动：走完整多源降级链（Adult → TMDb → 豆瓣 → TheTVDB/Bangumi → Fanart → AI）
export const SOURCE_OPTIONS: { value: string; label?: string; labelKey?: string }[] = [
  { value: 'auto', labelKey: 'fm.sourceAuto' },
  { value: 'tmdb', label: 'TMDb' },
  { value: 'bangumi', label: 'Bangumi' },
  { value: 'ai', labelKey: 'fm.sourceAi' },
]

// 语言选项
// 仅含中文文案的条目用 labelKey 走 i18n，语言本名（English 等）不翻译
export const LANGUAGE_OPTIONS: { value: string; label?: string; labelKey?: string; flag: string }[] = [
  { value: '', labelKey: 'fm.langNone', flag: '🌐' },
  { value: 'zh', labelKey: 'fm.langZh', flag: '🇨🇳' },
  { value: 'en', label: 'English', flag: '🇺🇸' },
  { value: 'ja', label: '日本語', flag: '🇯🇵' },
  { value: 'ko', label: '한국어', flag: '🇰🇷' },
  { value: 'fr', label: 'Français', flag: '🇫🇷' },
  { value: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { value: 'es', label: 'Español', flag: '🇪🇸' },
  { value: 'pt', label: 'Português', flag: '🇧🇷' },
  { value: 'ru', label: 'Русский', flag: '🇷🇺' },
  { value: 'it', label: 'Italiano', flag: '🇮🇹' },
  { value: 'th', label: 'ไทย', flag: '🇹🇭' },
  { value: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
]

// 排序选项（文案走 i18n）
export const SORT_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'created_at', labelKey: 'fm.sortCreatedAt' },
  { value: 'title', labelKey: 'fm.sortTitle' },
  { value: 'year', labelKey: 'fm.sortYear' },
  { value: 'rating', labelKey: 'fm.sortRating' },
  { value: 'file_size', labelKey: 'fm.sortFileSize' },
  { value: 'updated_at', labelKey: 'fm.sortUpdatedAt' },
]

// 格式化文件大小
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// Tab 类型
export type TabType = 'library' | 'files' | 'analysis' | 'adult' | 'preprocess'

// 对话框类型
export type DialogType = 'none' | 'import' | 'batchImport' | 'detail' | 'rename' | 'logs' | 'batchAnalyze'

// 文件管理器共享状态接口
export interface FileManagerState {
  // 数据
  files: Media[]
  total: number
  page: number
  loading: boolean
  stats: FileManagerStats | null
  libraries: Library[]
  // 筛选
  keyword: string
  filterLibrary: string
  filterMediaType: string
  filterScraped: string
  sortBy: string
  sortOrder: string
  showFilters: boolean
  // 选择
  selectedIds: Set<string>
  // 视图
  viewMode: 'table' | 'grid'
  // 刮削源
  scrapeSource: string
}
