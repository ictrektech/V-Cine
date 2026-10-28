import { useEffect, useMemo, useState } from 'react'
import type { Media, Library, FileOperationLog, RenamePreview, RenameTemplate } from '@/types'
import { fileManagerApi, videoAnalysisApi } from '@/api'
import type { VideoAnalysisTask } from '@/types/videoAnalysis'
import { useToast } from '@/components/Toast'
import {
  Plus, Upload, Loader2, Check, X, Eye, Edit3,
  Sparkles, Wand2, ScanLine,
  HardDrive, History, Languages, ChevronsUpDown, Trash2, ScanSearch, ListTodo,
  FolderOpen, ChevronRight,
} from 'lucide-react'
import clsx from 'clsx'
import { Modal } from '@/components/ui/modal'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toAppUrl } from '@/lib/appUrl'
import { routes } from '@/lib/routes'
import FileBrowser from '@/components/FileBrowser'
import { importTargetApi, type ImportLocation } from '@/api/importTargets'
import { formatFileSize, LANGUAGE_OPTIONS, REMOTE_ANALYSIS_DISABLED_TIP } from './constants'
import { streamApi } from '@/api/stream'
import { storageTypeFromPath } from '@/lib/storageSchemes'
import { usePosterVersion } from '@/stores/mediaRefresh'
import { useTranslation } from '@/i18n'

// ==================== 导入文件对话框 ====================
interface ImportFileModalProps {
  open: boolean
  libraries: Library[]
  onClose: () => void
  onSuccess: () => void
}

// 视频扩展名（与后端库扫描支持的格式一致）
const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.rmvb', '.rm', '.3gp', '.strm']

// 按文件路径推导目标媒体库：路径以库根路径开头则选中该库，命中多个时取最长匹配
function guessLibraryId(path: string, libraries: Library[]): string {
  const hits = libraries
    .filter(lib => path === lib.path || path.startsWith(lib.path.endsWith('/') ? lib.path : lib.path + '/'))
    .sort((a, b) => b.path.length - a.path.length)
  return hits[0]?.id || ''
}

interface ImportFileFormProps {
  libraries: Library[]
  onCancel: () => void
  onSuccess: () => void
}

/**
 * 「添加视频」中「文件已在 NAS 上」的表单（不含 Modal 外壳）。
 * 由 ImportFileModal（单来源）与 MediaImportModal（双来源选择）复用。
 */
export function ImportFileForm({ libraries, onCancel, onSuccess }: ImportFileFormProps) {
  const toast = useToast()
  const { t } = useTranslation()
  const [importPath, setImportPath] = useState('')
  const [importTitle, setImportTitle] = useState('')
  const [importMediaType, setImportMediaType] = useState('movie')
  // 目标媒体库必选（library_id 为空会被 FK 外键拒绝），默认第一个库
  const [importLibraryId, setImportLibraryId] = useState(libraries[0]?.id || '')

  // libraries 异步加载后补默认值（组件随页面常驻挂载，初始值可能取到空数组）
  useEffect(() => {
    if (!importLibraryId && libraries[0]?.id) setImportLibraryId(libraries[0].id)
  }, [libraries, importLibraryId])
  const [importing, setImporting] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)

  // 零库冷启动：还没有媒体库时，按所选文件所在位置自动建库（与「添加视频」上传同一套规则）
  const [locations, setLocations] = useState<ImportLocation[]>([])
  useEffect(() => {
    if (libraries.length > 0) return
    let cancelled = false
    importTargetApi.targets()
      .then((res) => {
        if (!cancelled) setLocations((res.data?.data || []).filter((x) => x.uploadable))
      })
      .catch(() => {
        if (!cancelled) setLocations([])
      })
    return () => {
      cancelled = true
    }
  }, [libraries.length])

  /** 文件所属的落点（最长前缀匹配） */
  const pickLocationFor = (filePath: string): ImportLocation | undefined =>
    locations
      .filter((loc) => {
        const root = loc.local_path.endsWith('/') ? loc.local_path : `${loc.local_path}/`
        return filePath === loc.local_path || filePath.startsWith(root)
      })
      .sort((a, b) => b.local_path.length - a.local_path.length)[0]

  const handleImport = async () => {
    if (!importPath) { toast.error(t('fm.importPathRequired')); return }
    setImporting(true)
    try {
      let libraryId = importLibraryId
      if (!libraryId) {
        const loc = pickLocationFor(importPath)
        if (!loc) { toast.error(t('fm.importLibRequired')); return }
        const ensured = await importTargetApi.ensureLibrary(loc.local_path)
        libraryId = ensured.data?.data?.library_id || ''
        if (!libraryId) { toast.error(t('fm.importFailed')); return }
        setImportLibraryId(libraryId)
      }
      await fileManagerApi.importFile({
        file_path: importPath, title: importTitle || undefined,
        media_type: importMediaType, library_id: libraryId,
      })
      toast.success(t('fm.importSuccess'))
      onCancel()
      onSuccess()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('fm.importFailed'))
    } finally {
      setImporting(false)
    }
  }

  // 选中的文件不在任何媒体库目录内：仍可加入（单独条目），但要说明清楚（A 通道边界）
  const outsideAllLibraries = importPath !== '' && guessLibraryId(importPath, libraries) === ''

  return (
    <>
        <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          <Plus className="inline-block mr-2 mb-0.5" size={20} /> {t('fm.importTitle')}
        </h3>
        <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
          {t('fm.importDesc')}
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm mb-1 font-medium" style={{ color: 'var(--text-primary)' }}>
              {t('fm.serverFile')} <span style={{ color: 'var(--text-tertiary)' }}>*</span>
            </label>
            <button onClick={() => setBrowserOpen(true)}
              className="btn-ghost w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm border border-dashed transition-colors hover:border-neon hover:bg-neon/5">
              <FolderOpen size={16} className="flex-shrink-0 text-neon" />
              <span className="flex-1 text-left truncate font-medium" style={{ color: importPath ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                {importPath || t('fm.clickSelectFile')}
              </span>
              <ChevronRight size={14} className="flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} />
            </button>
            {outsideAllLibraries && (
              <p className="mt-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {t('fm.importOutsideLibrary')}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm mb-1 font-medium" style={{ color: 'var(--text-primary)' }}>
              {t('fm.colTitle')} <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('fm.titleAutoHint')}</span>
            </label>
            <input type="text" value={importTitle} onChange={e => setImportTitle(e.target.value)}
              placeholder={t('fm.titleAutoPlaceholder')} className="input-glass w-full px-3 py-2 rounded-lg text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1 font-medium" style={{ color: 'var(--text-primary)' }}>{t('fm.mediaTypeLabel')}</label>
              <Select value={importMediaType} onValueChange={v => setImportMediaType(v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('fm.selectType')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="movie">{t('media.movie')}</SelectItem>
                  <SelectItem value="episode">{t('media.episode')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm mb-1 font-medium" style={{ color: 'var(--text-primary)' }}>
                {t('fm.libraryLabel')}
                {libraries.length > 0 && <span style={{ color: 'var(--text-tertiary)' }}> *</span>}
              </label>
              {libraries.length > 0 ? (
                <Select value={importLibraryId} onValueChange={v => setImportLibraryId(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('fm.selectLibrary')} />
                  </SelectTrigger>
                  <SelectContent>
                    {libraries.map(lib => <SelectItem key={lib.id} value={lib.id}>{lib.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {t('fm.importWillCreateLibrary')}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onCancel} className="btn-ghost px-4 py-2 rounded-lg text-sm">{t('common.cancel')}</button>
          <button onClick={handleImport} disabled={importing}
            className="btn-primary flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm">
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {importing ? t('fm.importing') : t('fm.importBtn')}
          </button>
        </div>
      <FileBrowser open={browserOpen} onClose={() => setBrowserOpen(false)}
        selectMode="file" fileExtensions={VIDEO_EXTS}
        onSelect={(p) => {
          setImportPath(p)
          // 按文件路径自动推导目标媒体库（命中库根路径时），未命中保持当前选择
          const guessed = guessLibraryId(p, libraries)
          if (guessed) setImportLibraryId(guessed)
          setBrowserOpen(false)
        }} />
    </>
  )
}

/** 单来源场景的薄壳：仅「文件已在 NAS 上」时使用（无设备上传能力时由 MediaImportModal 直接复用） */
export function ImportFileModal({ open, libraries, onClose, onSuccess }: ImportFileModalProps) {
  return (
    <Modal open={open} onClose={onClose} className="max-w-lg">
      <div className="glass-panel-strong rounded-2xl p-6">
        <ImportFileForm libraries={libraries} onCancel={onClose} onSuccess={onSuccess} />
      </div>
    </Modal>
  )
}

// ==================== 编辑对话框 ====================
interface EditFileModalProps {
  media: Media
  onClose: () => void
  onSuccess: (media: Media) => void
}

export function EditFileModal({ media, onClose, onSuccess }: EditFileModalProps) {
  const toast = useToast()
  const { t } = useTranslation()
  const [editForm, setEditForm] = useState<Record<string, unknown>>({
    title: media.title, orig_title: media.orig_title, year: media.year,
    overview: media.overview, genres: media.genres, rating: media.rating,
    media_type: media.media_type, country: media.country, language: media.language,
  })

  const handleSave = async () => {
    try {
      const res = await fileManagerApi.updateFile(media.id, editForm)
      toast.success(t('fm.updateSuccess'))
      onClose()
      onSuccess(res.data.data)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('fm.updateFailed'))
    }
  }

  return (
    <Modal open onClose={onClose} className="max-w-lg">
      <div className="glass-panel-strong rounded-2xl p-6 max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          <Edit3 className="inline-block mr-2 mb-0.5" size={20} /> {t('fm.editTitle')}
        </h3>
        <div className="space-y-3">
          {[
            { key: 'title', labelKey: 'fm.colTitle', type: 'text' },
            { key: 'orig_title', labelKey: 'fm.fieldOrigTitle', type: 'text' },
            { key: 'year', labelKey: 'media.year', type: 'number' },
            { key: 'genres', labelKey: 'media.genres', type: 'text', placeholderKey: 'fm.genresPlaceholder' },
            { key: 'rating', labelKey: 'media.rating', type: 'number' },
            { key: 'country', labelKey: 'fm.fieldCountry', type: 'text' },
            { key: 'language', labelKey: 'fm.fieldLanguage', type: 'text' },
          ].map(field => (
            <div key={field.key}>
              <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>{t(field.labelKey)}</label>
              <input type={field.type} value={editForm[field.key] as string || ''}
                onChange={e => setEditForm(prev => ({ ...prev, [field.key]: field.type === 'number' ? Number(e.target.value) : e.target.value }))}
                placeholder={field.placeholderKey ? t(field.placeholderKey) : undefined} className="input-glass w-full px-3 py-2 rounded-lg text-sm" />
            </div>
          ))}
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>{t('media.overview')}</label>
            <textarea value={editForm.overview as string || ''}
              onChange={e => setEditForm(prev => ({ ...prev, overview: e.target.value }))}
              rows={4} className="input-glass w-full px-3 py-2 rounded-lg text-sm resize-none" />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>{t('fm.mediaTypeLabel')}</label>
            <select value={editForm.media_type as string || 'movie'}
              onChange={e => setEditForm(prev => ({ ...prev, media_type: e.target.value }))}
              className="input-glass w-full px-3 py-2 rounded-lg text-sm">
              <option value="movie">{t('media.movie')}</option>
              <option value="episode">{t('media.episode')}</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-ghost px-4 py-2 rounded-lg text-sm">{t('common.cancel')}</button>
          <button onClick={handleSave} className="btn-primary px-4 py-2 rounded-lg text-sm">{t('common.save')}</button>
        </div>
      </div>
    </Modal>
  )
}

// ==================== 详情对话框 ====================
interface FileDetailModalProps {
  open: boolean
  media: Media
  videoAnalysisDescribeEnabled?: boolean
  remoteVideoEnabled?: boolean
  onClose: () => void
  onEdit: () => void
  onScrape: () => void
  onAnalyze: (force?: boolean, includeDescriptions?: boolean) => void
  onRetryAnalysis: (task: VideoAnalysisTask) => void
  onViewAnalysis: (task?: VideoAnalysisTask | null) => void
}

export function FileDetailModal({ open, media, videoAnalysisDescribeEnabled = true, remoteVideoEnabled = false, onClose, onEdit, onScrape, onAnalyze, onRetryAnalysis, onViewAnalysis }: FileDetailModalProps) {
  const toast = useToast()
  const { t } = useTranslation()
  // 海报版本戳：刮削/替换海报后自动绕过浏览器缓存
  usePosterVersion()
  const [analysisTask, setAnalysisTask] = useState<VideoAnalysisTask | null>(null)
  const [loadingAnalysis, setLoadingAnalysis] = useState(true)
  const [analysisUnavailable, setAnalysisUnavailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadingAnalysis(true)
    setAnalysisUnavailable(false)
    videoAnalysisApi.getLatestTaskByMedia(media.id)
      .then((res) => {
        if (cancelled) return
        setAnalysisTask(res.data.data || null)
      })
      .catch((err: any) => {
        if (cancelled) return
        if (err?.response?.status === 503) {
          setAnalysisUnavailable(true)
          setAnalysisTask(null)
        } else {
          toast.error(err?.response?.data?.error || t('fm.readAnalysisStatusFailed'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingAnalysis(false)
      })
    return () => { cancelled = true }
  }, [media.id, toast])

  const analysisMeta = useMemo(() => {
    if (!analysisTask) return null
    switch (analysisTask.status) {
      case 'queued':
        return { labelKey: 'common.statusQueued', tone: 'text-surface-300 bg-surface-600/30', action: 'progress' as const }
      case 'running':
        return { labelKey: 'common.statusProcessing', tone: 'text-amber-300 bg-amber-500/10', action: 'progress' as const }
      case 'succeeded':
        return { labelKey: 'common.statusCompleted', tone: 'text-emerald-300 bg-emerald-500/10', action: 'result' as const }
      case 'partial':
        return { labelKey: 'fm.analysisPartial', tone: 'text-amber-300 bg-amber-500/10', action: 'retry' as const }
      case 'failed':
        return { labelKey: 'common.statusFailed', tone: 'text-red-300 bg-red-500/10', action: 'retry' as const }
      case 'skipped':
        return { labelKey: 'common.statusSkipped', tone: 'text-surface-400 bg-surface-600/20', action: 'analyze' as const }
      default:
        return null
    }
  }, [analysisTask])

  const isRemoteVideo = storageTypeFromPath(media.file_path || '') !== 'local'
  const remoteDisabled = isRemoteVideo && !remoteVideoEnabled
  const analysisDescribeDisabled = remoteDisabled || !videoAnalysisDescribeEnabled
  let analysisDescribeTitle = ''
  if (remoteDisabled) {
    analysisDescribeTitle = t(REMOTE_ANALYSIS_DISABLED_TIP)
  } else if (!videoAnalysisDescribeEnabled) {
    analysisDescribeTitle = t('fm.descNeedEnabled')
  } else if (isRemoteVideo) {
    analysisDescribeTitle = t('fm.remoteAnalysisUrlHint')
  }

  return (
    <Modal open={open} onClose={onClose} className="max-w-2xl">
      <div className="glass-panel-strong rounded-2xl p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            <Eye className="inline-block mr-2 mb-0.5" size={20} /> {t('fm.detailTitle')}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10"><X size={18} /></button>
        </div>
        <div className="flex gap-4">
          <div className="w-32 h-48 rounded-lg overflow-hidden flex-shrink-0 bg-surface-800">
            <img
              src={streamApi.getPosterUrl(media.id)}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </div>
          <div className="flex-1 space-y-2 text-sm">
            <div><span style={{ color: 'var(--text-tertiary)' }}>{t('fm.detailTitleLabel')}</span><span style={{ color: 'var(--text-primary)' }}>{media.title}</span></div>
            {media.orig_title && <div><span style={{ color: 'var(--text-tertiary)' }}>{t('fm.detailOrigTitleLabel')}</span><span style={{ color: 'var(--text-secondary)' }}>{media.orig_title}</span></div>}
            <div><span style={{ color: 'var(--text-tertiary)' }}>{t('fm.detailYearLabel')}</span><span style={{ color: 'var(--text-secondary)' }}>{media.year || '-'}</span></div>
            <div><span style={{ color: 'var(--text-tertiary)' }}>{t('fm.detailRatingLabel')}</span>{media.rating > 0 ? <span className="text-amber-400">★ {media.rating.toFixed(1)}</span> : <span style={{ color: 'var(--text-secondary)' }}>-</span>}</div>
            <div><span style={{ color: 'var(--text-tertiary)' }}>{t('fm.detailGenresLabel')}</span><span style={{ color: 'var(--text-secondary)' }}>{media.genres || '-'}</span></div>
            <div><span style={{ color: 'var(--text-tertiary)' }}>{t('fm.detailMediaTypeLabel')}</span><span className={media.media_type === 'movie' ? 'text-purple-400' : 'text-green-400'}>{media.media_type === 'movie' ? t('media.movie') : t('media.episode')}</span></div>
            <div><span style={{ color: 'var(--text-tertiary)' }}>{t('fm.detailResolutionLabel')}</span><span style={{ color: 'var(--text-secondary)' }}>{media.resolution || '-'}</span></div>
            <div><span style={{ color: 'var(--text-tertiary)' }}>{t('fm.detailFileSizeLabel')}</span><span style={{ color: 'var(--text-secondary)' }}>{media.file_size > 0 ? formatFileSize(media.file_size) : '-'}</span></div>
            <div><span style={{ color: 'var(--text-tertiary)' }}>{t('fm.detailCountryLabel')}</span><span style={{ color: 'var(--text-secondary)' }}>{media.country || '-'}</span></div>
            <div><span style={{ color: 'var(--text-tertiary)' }}>{t('fm.detailLanguageLabel')}</span><span style={{ color: 'var(--text-secondary)' }}>{media.language || '-'}</span></div>
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--text-tertiary)' }}>TMDb ID：</span>
              <span style={{ color: 'var(--text-secondary)' }}>{media.tmdb_id || '-'}</span>
              {media.bangumi_id > 0 && <><span style={{ color: 'var(--text-tertiary)' }}>Bangumi：</span><span style={{ color: 'var(--text-secondary)' }}>{media.bangumi_id}</span></>}
            </div>
          </div>
        </div>
        {media.overview && (
          <div className="mt-4">
            <div className="text-sm mb-1" style={{ color: 'var(--text-tertiary)' }}>{t('media.overview')}</div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{media.overview}</p>
          </div>
        )}
        <div className="mt-4 p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
          <div className="text-xs flex items-center gap-1 mb-1" style={{ color: 'var(--text-tertiary)' }}>
            <HardDrive size={12} /> {t('fm.detailFilePath')}
          </div>
          <div className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>{media.file_path}</div>
        </div>
        <div className="mt-4 p-3 rounded-lg border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-default)' }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>{t('fm.detailAnalysisStatus')}</div>
              {loadingAnalysis ? (
                <div className="inline-flex items-center gap-2 text-sm text-surface-400"><ScanLine size={14} className="animate-pulse" /> {t('fm.readingAnalysisStatus')}</div>
              ) : analysisUnavailable ? (
                <div className="space-y-2">
                  <div className="text-sm text-amber-300">{t('fm.analysisDisabled')}</div>
                  <button
                    onClick={() => { window.location.href = toAppUrl(routes.admin()) }}
                    className="inline-flex items-center rounded-lg border border-amber-400/20 px-3 py-1.5 text-xs text-amber-200 transition-colors hover:bg-amber-400/10"
                  >
                    {t('fm.goSystemConfig')}
                  </button>
                </div>
              ) : analysisMeta ? (
                <div className="space-y-1">
                  <span className={clsx('inline-flex items-center rounded-md px-2 py-1 text-xs', analysisMeta.tone)}>{t(analysisMeta.labelKey)}</span>
                  <div className="text-xs text-surface-400">
                    {t('fm.analysisStage', { stage: analysisTask?.stage || '—', percent: Math.round(analysisTask?.progress || 0) })}
                  </div>
                  {analysisTask?.error_message && <div className="text-xs text-red-300 max-w-xl break-words">{analysisTask.error_message}</div>}
                </div>
              ) : (
                <div className="text-sm text-surface-400">{t('fm.noAnalysisTask')}</div>
              )}
            </div>
            {!loadingAnalysis && !analysisUnavailable && (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => onViewAnalysis(analysisTask)} className="btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm">
                  <ListTodo size={14} /> {analysisMeta?.action === 'result' ? t('fm.viewResult') : analysisMeta?.action === 'progress' ? t('fm.viewProgress') : t('fm.viewAnalysisTask')}
                </button>
                {(analysisMeta?.action === 'retry') && analysisTask && (
                  <button
                    onClick={() => onRetryAnalysis(analysisTask)}
                    className={`btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm ${remoteDisabled ? 'opacity-50 cursor-not-allowed text-surface-400' : 'text-amber-300 hover:bg-amber-400/10'}`}
                    disabled={remoteDisabled}
                    title={remoteDisabled ? t(REMOTE_ANALYSIS_DISABLED_TIP) : isRemoteVideo ? t('fm.remoteAnalysisUrlHint') : ''}
                  >
                    <ScanSearch size={14} /> {t('fm.reanalyzeBtn')}
                  </button>
                )}
                {(!analysisMeta || analysisMeta.action === 'analyze' || analysisMeta.action === 'retry') && (
                  <>
                    <button
                      onClick={() => onAnalyze()}
                      className={`btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm ${remoteDisabled ? 'opacity-50 cursor-not-allowed text-surface-400' : 'text-cyan-300 hover:bg-cyan-400/10'}`}
                      disabled={remoteDisabled}
                      title={remoteDisabled ? t(REMOTE_ANALYSIS_DISABLED_TIP) : isRemoteVideo ? t('fm.remoteAnalysisUrlHint') : ''}
                    >
                      <ScanSearch size={14} /> {t('fm.analyzeVideo')}
                    </button>
                    <button
                      onClick={() => onAnalyze(false, true)}
                      className={`btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm ${analysisDescribeDisabled ? 'opacity-50 cursor-not-allowed' : 'text-violet-300 hover:bg-violet-400/10'}`}
                      disabled={analysisDescribeDisabled}
                      title={analysisDescribeTitle}
                    >
                      <Sparkles size={14} /> {t('fm.analyzeWithDesc')}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 mt-4">
          <button onClick={onEdit} className="btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm">
            <Edit3 size={14} /> {t('common.edit')}
          </button>
          <button onClick={onScrape} className="btn-primary flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm">
            <Sparkles size={14} /> {t('fm.scrapeMetadata')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ==================== 重命名对话框 ====================
interface BatchAnalyzeModalProps {
  open: boolean
  selectedCount: number
  videoAnalysisEnabled: boolean
  videoAnalysisDescribeEnabled: boolean
  disabledReason?: string
  onClose: () => void
  onConfirm: (options: { force: boolean; includeDescriptions: boolean }) => void
}

export function BatchAnalyzeModal({ open, selectedCount, videoAnalysisEnabled, videoAnalysisDescribeEnabled, disabledReason, onClose, onConfirm }: BatchAnalyzeModalProps) {
  const { t } = useTranslation()
  const [force, setForce] = useState(false)
  const [includeDescriptions, setIncludeDescriptions] = useState(false)

  return (
    <Modal open={open} onClose={onClose} className="max-w-lg">
      <div className="glass-panel-strong rounded-2xl p-6">
        <h3 className="text-lg font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
          <ScanSearch className="inline-block mr-2 mb-0.5" size={20} /> {t('fm.batchAnalysis')}
        </h3>
        <p className="text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
          {t('fm.batchAnalyzeDesc', { count: selectedCount })}
        </p>

        <div className="mt-4 space-y-3">
          <label className="flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-secondary)' }}>
            <input
              type="checkbox"
              checked={force}
              onChange={e => setForce(e.target.checked)}
              className="mt-0.5 accent-[var(--neon-blue)]"
              disabled={!videoAnalysisEnabled}
            />
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('fm.forceReanalyze')}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                {t('fm.forceReanalyzeHint')}
              </div>
            </div>
          </label>
          <label className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${!videoAnalysisEnabled || !videoAnalysisDescribeEnabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`} style={{ borderColor: 'var(--border-default)', background: 'var(--bg-secondary)' }}>
            <input
              type="checkbox"
              checked={includeDescriptions}
              onChange={e => setIncludeDescriptions(e.target.checked)}
              className="mt-0.5 accent-[var(--neon-purple)]"
              disabled={!videoAnalysisEnabled || !videoAnalysisDescribeEnabled}
            />
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('fm.includeDesc')}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                {t('fm.includeDescHint')}
              </div>
              {!videoAnalysisEnabled && (
                <div className="text-xs mt-1 text-amber-300">{t('fm.needEnableAnalysis')}</div>
              )}
              {videoAnalysisEnabled && !videoAnalysisDescribeEnabled && (
                <div className="text-xs mt-1 text-amber-300">{t('fm.descNeedEnabled')}</div>
              )}
            </div>
          </label>
        </div>

        {!videoAnalysisEnabled && (
          <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            <div>{disabledReason || t('fm.analysisDisabled')}</div>
            <button
              onClick={() => { window.location.href = toAppUrl(routes.admin()) }}
              className="mt-3 inline-flex items-center rounded-lg border border-amber-400/20 px-3 py-1.5 text-xs text-amber-200 transition-colors hover:bg-amber-400/10"
            >
              {t('fm.goSystemConfig')}
            </button>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-ghost px-4 py-2 rounded-lg text-sm">{t('common.cancel')}</button>
          <button
            onClick={() => onConfirm({ force, includeDescriptions })}
            disabled={!videoAnalysisEnabled}
            className="btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('fm.startAnalysis')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

interface RenameModalProps {
  open: boolean
  selectedCount: number
  selectedIds: Set<string>
  onClose: () => void
  onSuccess: () => void
}

export function RenameModal({ open, selectedCount, selectedIds, onClose, onSuccess }: RenameModalProps) {
  const toast = useToast()
  const { t } = useTranslation()
  const [useAIRename, setUseAIRename] = useState(false)
  const [renameTemplate, setRenameTemplate] = useState('{title} ({year}) [{resolution}]')
  const [renamePreviews, setRenamePreviews] = useState<RenamePreview[]>([])
  const [renameTemplates, setRenameTemplates] = useState<RenameTemplate[]>([])
  const [renaming, setRenaming] = useState(false)
  const [targetLang, setTargetLang] = useState(() => localStorage.getItem('rename_target_lang') || '')
  const [previewsExpanded, setPreviewsExpanded] = useState(true)

  // 加载模板
  useState(() => {
    fileManagerApi.getRenameTemplates().then(res => setRenameTemplates(res.data.data || [])).catch(() => {})
  })

  const handleTargetLangChange = (lang: string) => {
    setTargetLang(lang)
    localStorage.setItem('rename_target_lang', lang)
    if (renamePreviews.length > 0) setRenamePreviews([])
  }

  const handlePreview = async () => {
    setRenaming(true)
    try {
      const ids = Array.from(selectedIds)
      const res = useAIRename
        ? await fileManagerApi.aiGenerateRenames(ids, targetLang || undefined)
        : await fileManagerApi.previewRename(ids, renameTemplate)
      setRenamePreviews(res.data.data || [])
      setPreviewsExpanded(true)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('fm.previewFailed'))
    } finally {
      setRenaming(false)
    }
  }

  const handleExecute = async () => {
    setRenaming(true)
    try {
      const res = await fileManagerApi.executeRename(Array.from(selectedIds), renameTemplate)
      toast.success(t('fm.renamedCount', { count: res.data.renamed }))
      onClose()
      onSuccess()
    } catch {
      toast.error(t('fm.renameFailed'))
    } finally {
      setRenaming(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} className="max-w-3xl">
      <div className="glass-panel-strong rounded-2xl p-6 max-h-[85vh] flex flex-col">
        <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          <Wand2 className="inline-block mr-2 mb-0.5" size={20} /> {t('fm.renameTitle')}
          <span className="text-xs font-normal ml-2 px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">
            {t('fm.renameSelected', { count: selectedCount })}
          </span>
        </h3>

        {/* 模式选择 */}
        <div className="flex items-center gap-4 mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={!useAIRename} onChange={() => setUseAIRename(false)} className="accent-[var(--neon-blue)]" />
            <span className={clsx('text-sm', !useAIRename ? 'text-neon font-medium' : '')} style={{ color: useAIRename ? 'var(--text-secondary)' : undefined }}>{t('fm.templateRename')}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={useAIRename} onChange={() => setUseAIRename(true)} className="accent-[var(--neon-blue)]" />
            <span className={clsx('text-sm', useAIRename ? 'text-neon font-medium' : '')} style={{ color: !useAIRename ? 'var(--text-secondary)' : undefined }}>
              <Sparkles size={12} className="inline-block mr-1 mb-0.5" />{t('fm.aiRename')}
            </span>
          </label>
        </div>

        {/* 模板选择 */}
        {!useAIRename && (
          <div className="mb-4 space-y-2">
            <label className="block text-sm" style={{ color: 'var(--text-secondary)' }}>{t('fm.renameTemplate')}</label>
            <input type="text" value={renameTemplate} onChange={e => setRenameTemplate(e.target.value)}
              className="input-glass w-full px-3 py-2 rounded-lg text-sm font-mono" />
            <div className="flex flex-wrap gap-1.5">
              {renameTemplates.map((tmpl, i) => (
                <button key={i} onClick={() => setRenameTemplate(tmpl.pattern)}
                  className={clsx('px-2 py-1 rounded text-xs border transition-all', renameTemplate === tmpl.pattern ? 'border-neon text-neon bg-neon-blue/5' : 'border-surface-700 text-surface-400 hover:border-surface-500')}
                  title={t('fm.renameExample', { example: tmpl.example })}>
                  {tmpl.pattern}
                </button>
              ))}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {t('fm.renameVars')}: {'{title}'} {'{orig_title}'} {'{year}'} {'{resolution}'} {'{media_type}'}
            </div>
          </div>
        )}

        {/* AI模式 - 语言选择器 */}
        {useAIRename && (
          <div className="mb-4 space-y-2">
            <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <Languages size={14} /> {t('fm.targetLang')}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGE_OPTIONS.map(lang => (
                <button key={lang.value} onClick={() => handleTargetLangChange(lang.value)}
                  className={clsx('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-all',
                    targetLang === lang.value
                      ? 'border-neon text-neon bg-neon-blue/10 shadow-[0_0_8px_rgba(0,170,255,0.15)]'
                      : 'border-surface-700 text-surface-400 hover:border-surface-500 hover:text-surface-300'
                  )}>
                  <span>{lang.flag}</span><span>{lang.labelKey ? t(lang.labelKey) : lang.label}</span>
                </button>
              ))}
            </div>
            {targetLang && (
              <div className="text-xs flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                <Sparkles size={10} />
                {(() => {
                  const lang = LANGUAGE_OPTIONS.find(l => l.value === targetLang)
                  const langName = lang?.labelKey ? t(lang.labelKey) : lang?.label || ''
                  return t('fm.aiRenameHint', { lang: langName })
                })()}
              </div>
            )}
          </div>
        )}

        {/* 预览按钮 */}
        <div className="flex items-center gap-3 mb-4">
          <button onClick={handlePreview} disabled={renaming}
            className="btn-ghost flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm">
            {renaming ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
            {renaming ? t('fm.generating') : t('fm.generatePreview')}
          </button>
          {renamePreviews.length > 0 && (
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('fm.previewCount', { count: renamePreviews.length })}</span>
          )}
        </div>

        {/* 预览列表 */}
        <div className="flex-1 min-h-0 flex flex-col">
          {renamePreviews.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => setPreviewsExpanded(!previewsExpanded)}
                  className="flex items-center gap-1 text-xs hover:text-neon transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                  <ChevronsUpDown size={12} />{previewsExpanded ? t('fm.collapsePreview') : t('fm.expandPreview')}
                </button>
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">{t('fm.willRename', { count: renamePreviews.length })}</span>
              </div>
              {previewsExpanded && (
                <div className="overflow-y-auto pr-1" style={{ maxHeight: 'calc(85vh - 420px)', minHeight: '120px', scrollBehavior: 'smooth', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent' }}>
                  <div className="space-y-2">
                    {renamePreviews.map((p, i) => (
                      <div key={i} className="p-3 rounded-lg transition-colors hover:ring-1 hover:ring-white/5" style={{ background: 'var(--bg-secondary)' }}>
                        <div className="flex items-start gap-3 text-sm">
                          <span className="text-xs font-mono text-surface-500 mt-0.5 flex-shrink-0 w-5 text-right">{i + 1}</span>
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-red-400/80 line-through break-all" style={{ wordBreak: 'break-word' }}>{p.old_title}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span style={{ color: 'var(--text-tertiary)' }}>↓</span>
                              <span className="text-green-400 font-medium break-all" style={{ wordBreak: 'break-word' }}>{p.new_title}</span>
                            </div>
                          </div>
                        </div>
                        {p.reason && (
                          <div className="text-xs mt-2 ml-8 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                            <Sparkles size={10} className="flex-shrink-0" />{p.reason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center py-8">
                <Wand2 size={32} className="mx-auto mb-3 text-surface-600" />
                <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                  {useAIRename ? t('fm.renameAiHint') : t('fm.renameHint2')}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-default)' }}>
          <button onClick={onClose} className="btn-ghost px-4 py-2 rounded-lg text-sm">{t('common.cancel')}</button>
          <button onClick={handleExecute} disabled={renaming || renamePreviews.length === 0}
            className="btn-primary flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm">
            {renaming ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {t('fm.executeRename')} {renamePreviews.length > 0 && `(${renamePreviews.length})`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ==================== 操作日志对话框 ====================
interface OperationLogsModalProps {
  open: boolean
  onClose: () => void
}

export function OperationLogsModal({ open, onClose }: OperationLogsModalProps) {
  const { t } = useTranslation()
  const [opLogs, setOpLogs] = useState<FileOperationLog[]>([])

  useEffect(() => {
    if (!open) return
    fileManagerApi.getOperationLogs(50).then(res => setOpLogs(res.data.data || [])).catch(() => {})
  }, [open])

  return (
    <Modal open={open} onClose={onClose} className="max-w-2xl">
      <div className="glass-panel-strong rounded-2xl p-6 max-h-[80vh] flex flex-col">
        <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          <History className="inline-block mr-2 mb-0.5" size={20} /> {t('fm.opLogs')}
        </h3>
        <div className="flex-1 overflow-y-auto min-h-0">
          {opLogs.length > 0 ? (
            <div className="space-y-2">
              {opLogs.map(log => (
                <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                  <div className={clsx('mt-0.5 p-1 rounded', {
                    'bg-green-500/10 text-green-400': log.action === 'import',
                    'bg-blue-500/10 text-blue-400': log.action === 'edit',
                    'bg-red-500/10 text-red-400': log.action === 'delete',
                    'bg-purple-500/10 text-purple-400': log.action === 'scrape',
                    'bg-amber-500/10 text-amber-400': log.action === 'rename',
                  })}>
                    {log.action === 'import' && <Upload size={14} />}
                    {log.action === 'edit' && <Edit3 size={14} />}
                    {log.action === 'delete' && <Trash2 size={14} />}
                    {log.action === 'scrape' && <Sparkles size={14} />}
                    {log.action === 'rename' && <Wand2 size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{log.detail}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{new Date(log.created_at).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-sm" style={{ color: 'var(--text-tertiary)' }}>{t('fm.noOpLogs')}</div>
          )}
        </div>
        <div className="flex justify-end mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-default)' }}>
          <button onClick={onClose} className="btn-ghost px-4 py-2 rounded-lg text-sm">{t('common.close')}</button>
        </div>
      </div>
    </Modal>
  )
}
