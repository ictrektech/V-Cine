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
import { formatFileSize, LANGUAGE_OPTIONS, REMOTE_ANALYSIS_DISABLED_TIP } from './constants'
import { streamApi } from '@/api/stream'
import { storageTypeFromPath } from '@/lib/storageSchemes'

// ==================== 导入文件对话框 ====================
interface ImportFileModalProps {
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

export function ImportFileModal({ open = true, libraries, onClose, onSuccess }: ImportFileModalProps) {
  const toast = useToast()
  const [importPath, setImportPath] = useState('')
  const [importTitle, setImportTitle] = useState('')
  const [importMediaType, setImportMediaType] = useState('movie')
  // 目标媒体库必选（library_id 为空会被 FK 外键拒绝），默认第一个库
  const [importLibraryId, setImportLibraryId] = useState(libraries[0]?.id || '')

  // libraries 异步加载后补默认值（组件随页面常驻挂载，初始值可能取到空数组）
  useEffect(() => {
    if (open && !importLibraryId && libraries[0]?.id) setImportLibraryId(libraries[0].id)
  }, [open, libraries, importLibraryId])
  const [importing, setImporting] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)

  const handleImport = async () => {
    if (!importPath) { toast.error('请选择文件路径'); return }
    if (!importLibraryId) { toast.error('请选择目标媒体库'); return }
    setImporting(true)
    try {
      await fileManagerApi.importFile({
        file_path: importPath, title: importTitle || undefined,
        media_type: importMediaType, library_id: importLibraryId,
      })
      toast.success('文件导入成功')
      onClose()
      onSuccess()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || '导入失败')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} className="max-w-lg">
      <div className="glass-panel-strong rounded-2xl p-6">
        <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          <Plus className="inline-block mr-2 mb-0.5" size={20} /> 导入影视文件
        </h3>
        <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
          从服务器已挂载的目录中选择视频文件登记到媒体库，仅建立索引记录，不会搬移或复制文件
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm mb-1 font-medium" style={{ color: 'var(--text-primary)' }}>
              服务器文件 <span style={{ color: 'var(--text-tertiary)' }}>*</span>
            </label>
            <button onClick={() => setBrowserOpen(true)}
              className="btn-ghost w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm border border-dashed transition-colors hover:border-neon hover:bg-neon/5">
              <FolderOpen size={16} className="flex-shrink-0 text-neon" />
              <span className="flex-1 text-left truncate font-medium" style={{ color: importPath ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                {importPath || '点击选择挂载的文件'}
              </span>
              <ChevronRight size={14} className="flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} />
            </button>
          </div>
          <div>
            <label className="block text-sm mb-1 font-medium" style={{ color: 'var(--text-primary)' }}>
              标题 <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>（留空自动提取）</span>
            </label>
            <input type="text" value={importTitle} onChange={e => setImportTitle(e.target.value)}
              placeholder="自动从文件名提取" className="input-glass w-full px-3 py-2 rounded-lg text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1 font-medium" style={{ color: 'var(--text-primary)' }}>媒体类型</label>
              <Select value={importMediaType} onValueChange={v => setImportMediaType(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="选择类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="movie">电影</SelectItem>
                  <SelectItem value="episode">剧集</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm mb-1 font-medium" style={{ color: 'var(--text-primary)' }}>
                媒体库 <span style={{ color: 'var(--text-tertiary)' }}>*</span>
              </label>
              <Select value={importLibraryId} onValueChange={v => setImportLibraryId(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="选择媒体库" />
                </SelectTrigger>
                <SelectContent>
                  {libraries.map(lib => <SelectItem key={lib.id} value={lib.id}>{lib.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-ghost px-4 py-2 rounded-lg text-sm">取消</button>
          <button onClick={handleImport} disabled={importing}
            className="btn-primary flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm">
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {importing ? '导入中...' : '导入'}
          </button>
        </div>
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
    </Modal>
  )
}

// ==================== 编辑对话框 ====================
interface EditFileModalProps {
  media: Media
  onClose: () => void
  onSuccess: () => void
}

export function EditFileModal({ open = true, media, onClose, onSuccess }: EditFileModalProps) {
  const toast = useToast()
  const [editForm, setEditForm] = useState<Record<string, unknown>>({
    title: media.title, orig_title: media.orig_title, year: media.year,
    overview: media.overview, genres: media.genres, rating: media.rating,
    media_type: media.media_type, country: media.country, language: media.language,
  })

  const handleSave = async () => {
    try {
      await fileManagerApi.updateFile(media.id, editForm)
      toast.success('更新成功')
      onClose()
      onSuccess()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || '更新失败')
    }
  }

  return (
    <Modal open={open} onClose={onClose} className="max-w-lg">
      <div className="glass-panel-strong rounded-2xl p-6 max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          <Edit3 className="inline-block mr-2 mb-0.5" size={20} /> 编辑文件信息
        </h3>
        <div className="space-y-3">
          {[
            { key: 'title', label: '标题', type: 'text' },
            { key: 'orig_title', label: '原始标题', type: 'text' },
            { key: 'year', label: '年份', type: 'number' },
            { key: 'genres', label: '类型', type: 'text', placeholder: '动作,科幻,冒险' },
            { key: 'rating', label: '评分', type: 'number' },
            { key: 'country', label: '国家/地区', type: 'text' },
            { key: 'language', label: '语言', type: 'text' },
          ].map(field => (
            <div key={field.key}>
              <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>{field.label}</label>
              <input type={field.type} value={editForm[field.key] as string || ''}
                onChange={e => setEditForm(prev => ({ ...prev, [field.key]: field.type === 'number' ? Number(e.target.value) : e.target.value }))}
                placeholder={field.placeholder} className="input-glass w-full px-3 py-2 rounded-lg text-sm" />
            </div>
          ))}
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>简介</label>
            <textarea value={editForm.overview as string || ''}
              onChange={e => setEditForm(prev => ({ ...prev, overview: e.target.value }))}
              rows={4} className="input-glass w-full px-3 py-2 rounded-lg text-sm resize-none" />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>媒体类型</label>
            <select value={editForm.media_type as string || 'movie'}
              onChange={e => setEditForm(prev => ({ ...prev, media_type: e.target.value }))}
              className="input-glass w-full px-3 py-2 rounded-lg text-sm">
              <option value="movie">电影</option>
              <option value="episode">剧集</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-ghost px-4 py-2 rounded-lg text-sm">取消</button>
          <button onClick={handleSave} className="btn-primary px-4 py-2 rounded-lg text-sm">保存</button>
        </div>
      </div>
    </Modal>
  )
}

// ==================== 详情对话框 ====================
interface FileDetailModalProps {
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

export function FileDetailModal({ open = true, media, videoAnalysisDescribeEnabled = true, remoteVideoEnabled = false, onClose, onEdit, onScrape, onAnalyze, onRetryAnalysis, onViewAnalysis }: FileDetailModalProps) {
  const toast = useToast()
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
          toast.error(err?.response?.data?.error || '读取视频分析状态失败')
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
        return { label: '排队中', tone: 'text-surface-300 bg-surface-600/30', action: 'progress' as const }
      case 'running':
        return { label: '分析中', tone: 'text-amber-300 bg-amber-500/10', action: 'progress' as const }
      case 'succeeded':
        return { label: '已完成', tone: 'text-emerald-300 bg-emerald-500/10', action: 'result' as const }
      case 'partial':
        return { label: '部分完成', tone: 'text-amber-300 bg-amber-500/10', action: 'retry' as const }
      case 'failed':
        return { label: '失败', tone: 'text-red-300 bg-red-500/10', action: 'retry' as const }
      case 'skipped':
        return { label: '已跳过', tone: 'text-surface-400 bg-surface-600/20', action: 'analyze' as const }
      default:
        return null
    }
  }, [analysisTask])

  const isRemoteVideo = storageTypeFromPath(media.file_path || '') !== 'local'
  const remoteDisabled = isRemoteVideo && !remoteVideoEnabled
  const analysisDescribeDisabled = remoteDisabled || !videoAnalysisDescribeEnabled
  let analysisDescribeTitle = ''
  if (remoteDisabled) {
    analysisDescribeTitle = REMOTE_ANALYSIS_DISABLED_TIP
  } else if (!videoAnalysisDescribeEnabled) {
    analysisDescribeTitle = '需要在「视频分析」设置中开启场景描述功能'
  } else if (isRemoteVideo) {
    analysisDescribeTitle = '远程视频将通过 URL 拉流分析，速度较慢并消耗网络带宽'
  }

  return (
    <Modal open={open} onClose={onClose} className="max-w-2xl">
      <div className="glass-panel-strong rounded-2xl p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            <Eye className="inline-block mr-2 mb-0.5" size={20} /> 文件详情
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
            <div><span style={{ color: 'var(--text-tertiary)' }}>标题：</span><span style={{ color: 'var(--text-primary)' }}>{media.title}</span></div>
            {media.orig_title && <div><span style={{ color: 'var(--text-tertiary)' }}>原始标题：</span><span style={{ color: 'var(--text-secondary)' }}>{media.orig_title}</span></div>}
            <div><span style={{ color: 'var(--text-tertiary)' }}>年份：</span><span style={{ color: 'var(--text-secondary)' }}>{media.year || '-'}</span></div>
            <div><span style={{ color: 'var(--text-tertiary)' }}>评分：</span>{media.rating > 0 ? <span className="text-amber-400">★ {media.rating.toFixed(1)}</span> : <span style={{ color: 'var(--text-secondary)' }}>-</span>}</div>
            <div><span style={{ color: 'var(--text-tertiary)' }}>类型：</span><span style={{ color: 'var(--text-secondary)' }}>{media.genres || '-'}</span></div>
            <div><span style={{ color: 'var(--text-tertiary)' }}>媒体类型：</span><span className={media.media_type === 'movie' ? 'text-purple-400' : 'text-green-400'}>{media.media_type === 'movie' ? '电影' : '剧集'}</span></div>
            <div><span style={{ color: 'var(--text-tertiary)' }}>分辨率：</span><span style={{ color: 'var(--text-secondary)' }}>{media.resolution || '-'}</span></div>
            <div><span style={{ color: 'var(--text-tertiary)' }}>文件大小：</span><span style={{ color: 'var(--text-secondary)' }}>{media.file_size > 0 ? formatFileSize(media.file_size) : '-'}</span></div>
            <div><span style={{ color: 'var(--text-tertiary)' }}>国家：</span><span style={{ color: 'var(--text-secondary)' }}>{media.country || '-'}</span></div>
            <div><span style={{ color: 'var(--text-tertiary)' }}>语言：</span><span style={{ color: 'var(--text-secondary)' }}>{media.language || '-'}</span></div>
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--text-tertiary)' }}>TMDb ID：</span>
              <span style={{ color: 'var(--text-secondary)' }}>{media.tmdb_id || '-'}</span>
              {media.bangumi_id > 0 && <><span style={{ color: 'var(--text-tertiary)' }}>Bangumi：</span><span style={{ color: 'var(--text-secondary)' }}>{media.bangumi_id}</span></>}
            </div>
          </div>
        </div>
        {media.overview && (
          <div className="mt-4">
            <div className="text-sm mb-1" style={{ color: 'var(--text-tertiary)' }}>简介</div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{media.overview}</p>
          </div>
        )}
        <div className="mt-4 p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
          <div className="text-xs flex items-center gap-1 mb-1" style={{ color: 'var(--text-tertiary)' }}>
            <HardDrive size={12} /> 文件路径
          </div>
          <div className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>{media.file_path}</div>
        </div>
        <div className="mt-4 p-3 rounded-lg border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-default)' }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>视频分析状态</div>
              {loadingAnalysis ? (
                <div className="inline-flex items-center gap-2 text-sm text-surface-400"><ScanLine size={14} className="animate-pulse" /> 正在读取任务状态…</div>
              ) : analysisUnavailable ? (
                <div className="space-y-2">
                  <div className="text-sm text-amber-300">视频分析服务未启用或配置无效</div>
                  <button
                    onClick={() => { window.location.href = toAppUrl(routes.admin()) }}
                    className="inline-flex items-center rounded-lg border border-amber-400/20 px-3 py-1.5 text-xs text-amber-200 transition-colors hover:bg-amber-400/10"
                  >
                    前往系统配置
                  </button>
                </div>
              ) : analysisMeta ? (
                <div className="space-y-1">
                  <span className={clsx('inline-flex items-center rounded-md px-2 py-1 text-xs', analysisMeta.tone)}>{analysisMeta.label}</span>
                  <div className="text-xs text-surface-400">
                    当前阶段：{analysisTask?.stage || '—'} · 进度 {Math.round(analysisTask?.progress || 0)}%
                  </div>
                  {analysisTask?.error_message && <div className="text-xs text-red-300 max-w-xl break-words">{analysisTask.error_message}</div>}
                </div>
              ) : (
                <div className="text-sm text-surface-400">尚未提交视频分析任务</div>
              )}
            </div>
            {!loadingAnalysis && !analysisUnavailable && (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => onViewAnalysis(analysisTask)} className="btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm">
                  <ListTodo size={14} /> {analysisMeta?.action === 'result' ? '查看结果' : analysisMeta?.action === 'progress' ? '查看进度' : '查看分析任务'}
                </button>
                {(analysisMeta?.action === 'retry') && analysisTask && (
                  <button
                    onClick={() => onRetryAnalysis(analysisTask)}
                    className={`btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm ${remoteDisabled ? 'opacity-50 cursor-not-allowed text-surface-400' : 'text-amber-300 hover:bg-amber-400/10'}`}
                    disabled={remoteDisabled}
                    title={remoteDisabled ? REMOTE_ANALYSIS_DISABLED_TIP : isRemoteVideo ? '远程视频将通过 URL 拉流分析，速度较慢并消耗网络带宽' : ''}
                  >
                    <ScanSearch size={14} /> 重新分析
                  </button>
                )}
                {(!analysisMeta || analysisMeta.action === 'analyze' || analysisMeta.action === 'retry') && (
                  <>
                    <button
                      onClick={() => onAnalyze()}
                      className={`btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm ${remoteDisabled ? 'opacity-50 cursor-not-allowed text-surface-400' : 'text-cyan-300 hover:bg-cyan-400/10'}`}
                      disabled={remoteDisabled}
                      title={remoteDisabled ? REMOTE_ANALYSIS_DISABLED_TIP : isRemoteVideo ? '远程视频将通过 URL 拉流分析，速度较慢并消耗网络带宽' : ''}
                    >
                      <ScanSearch size={14} /> 分析视频
                    </button>
                    <button
                      onClick={() => onAnalyze(false, true)}
                      className={`btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm ${analysisDescribeDisabled ? 'opacity-50 cursor-not-allowed' : 'text-violet-300 hover:bg-violet-400/10'}`}
                      disabled={analysisDescribeDisabled}
                      title={analysisDescribeTitle}
                    >
                      <Sparkles size={14} /> 分析并生成描述
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 mt-4">
          <button onClick={onEdit} className="btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm">
            <Edit3 size={14} /> 编辑
          </button>
          <button onClick={onScrape} className="btn-primary flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm">
            <Sparkles size={14} /> 刮削元数据
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ==================== 重命名对话框 ====================
interface BatchAnalyzeModalProps {
  selectedCount: number
  videoAnalysisEnabled: boolean
  videoAnalysisDescribeEnabled: boolean
  disabledReason?: string
  onClose: () => void
  onConfirm: (options: { force: boolean; includeDescriptions: boolean }) => void
}

export function BatchAnalyzeModal({ open = true, selectedCount, videoAnalysisEnabled, videoAnalysisDescribeEnabled, disabledReason, onClose, onConfirm }: BatchAnalyzeModalProps) {
  const [force, setForce] = useState(false)
  const [includeDescriptions, setIncludeDescriptions] = useState(false)

  return (
    <Modal open={open} onClose={onClose} className="max-w-lg">
      <div className="glass-panel-strong rounded-2xl p-6">
        <h3 className="text-lg font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
          <ScanSearch className="inline-block mr-2 mb-0.5" size={20} /> 批量分析视频
        </h3>
        <p className="text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
          将为选中的 <span className="text-neon font-medium">{selectedCount}</span> 个视频提交场景检测与结构分析任务。
          已有进行中任务会自动复用，已完成且文件未变化的任务默认会跳过。
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
              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>强制重新分析</div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                即使已有成功结果，也创建新的历史任务重新执行；不会覆盖旧任务记录。
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
              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>包含场景描述（可选）</div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                在结构分析成功后继续生成场景文字描述。若描述阶段失败，结构结果仍会保留并显示为"部分完成"。
              </div>
              {!videoAnalysisEnabled && (
                <div className="text-xs mt-1 text-amber-300">需要先启用视频分析服务</div>
              )}
              {videoAnalysisEnabled && !videoAnalysisDescribeEnabled && (
                <div className="text-xs mt-1 text-amber-300">需要在「视频分析」设置中开启场景描述功能</div>
              )}
            </div>
          </label>
        </div>

        {!videoAnalysisEnabled && (
          <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            <div>{disabledReason || '视频分析服务未启用或配置无效'}</div>
            <button
              onClick={() => { window.location.href = toAppUrl(routes.admin()) }}
              className="mt-3 inline-flex items-center rounded-lg border border-amber-400/20 px-3 py-1.5 text-xs text-amber-200 transition-colors hover:bg-amber-400/10"
            >
              前往系统配置
            </button>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-ghost px-4 py-2 rounded-lg text-sm">取消</button>
          <button
            onClick={() => onConfirm({ force, includeDescriptions })}
            disabled={!videoAnalysisEnabled}
            className="btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            开始分析
          </button>
        </div>
      </div>
    </Modal>
  )
}

interface RenameModalProps {
  selectedCount: number
  selectedIds: Set<string>
  onClose: () => void
  onSuccess: () => void
}

export function RenameModal({ open = true, selectedCount, selectedIds, onClose, onSuccess }: RenameModalProps) {
  const toast = useToast()
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
      toast.error(err?.response?.data?.error || '生成预览失败')
    } finally {
      setRenaming(false)
    }
  }

  const handleExecute = async () => {
    setRenaming(true)
    try {
      const res = await fileManagerApi.executeRename(Array.from(selectedIds), renameTemplate)
      toast.success(`已重命名 ${res.data.renamed} 个文件`)
      onClose()
      onSuccess()
    } catch {
      toast.error('重命名失败')
    } finally {
      setRenaming(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} className="max-w-3xl">
      <div className="glass-panel-strong rounded-2xl p-6 max-h-[85vh] flex flex-col">
        <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          <Wand2 className="inline-block mr-2 mb-0.5" size={20} /> AI批量重命名
          <span className="text-xs font-normal ml-2 px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">
            已选 {selectedCount} 个文件
          </span>
        </h3>

        {/* 模式选择 */}
        <div className="flex items-center gap-4 mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={!useAIRename} onChange={() => setUseAIRename(false)} className="accent-[var(--neon-blue)]" />
            <span className={clsx('text-sm', !useAIRename ? 'text-neon font-medium' : '')} style={{ color: useAIRename ? 'var(--text-secondary)' : undefined }}>模板重命名</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={useAIRename} onChange={() => setUseAIRename(true)} className="accent-[var(--neon-blue)]" />
            <span className={clsx('text-sm', useAIRename ? 'text-neon font-medium' : '')} style={{ color: !useAIRename ? 'var(--text-secondary)' : undefined }}>
              <Sparkles size={12} className="inline-block mr-1 mb-0.5" />AI智能重命名
            </span>
          </label>
        </div>

        {/* 模板选择 */}
        {!useAIRename && (
          <div className="mb-4 space-y-2">
            <label className="block text-sm" style={{ color: 'var(--text-secondary)' }}>命名模板</label>
            <input type="text" value={renameTemplate} onChange={e => setRenameTemplate(e.target.value)}
              className="input-glass w-full px-3 py-2 rounded-lg text-sm font-mono" />
            <div className="flex flex-wrap gap-1.5">
              {renameTemplates.map((t, i) => (
                <button key={i} onClick={() => setRenameTemplate(t.pattern)}
                  className={clsx('px-2 py-1 rounded text-xs border transition-all', renameTemplate === t.pattern ? 'border-neon text-neon bg-neon-blue/5' : 'border-surface-700 text-surface-400 hover:border-surface-500')}
                  title={`示例: ${t.example}`}>
                  {t.pattern}
                </button>
              ))}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              可用变量: {'{title}'} {'{orig_title}'} {'{year}'} {'{resolution}'} {'{media_type}'}
            </div>
          </div>
        )}

        {/* AI模式 - 语言选择器 */}
        {useAIRename && (
          <div className="mb-4 space-y-2">
            <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <Languages size={14} /> 目标翻译语言
            </label>
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGE_OPTIONS.map(lang => (
                <button key={lang.value} onClick={() => handleTargetLangChange(lang.value)}
                  className={clsx('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-all',
                    targetLang === lang.value
                      ? 'border-neon text-neon bg-neon-blue/10 shadow-[0_0_8px_rgba(0,170,255,0.15)]'
                      : 'border-surface-700 text-surface-400 hover:border-surface-500 hover:text-surface-300'
                  )}>
                  <span>{lang.flag}</span><span>{lang.label}</span>
                </button>
              ))}
            </div>
            {targetLang && (
              <div className="text-xs flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                <Sparkles size={10} />
                AI将生成规范化标题并翻译为 {LANGUAGE_OPTIONS.find(l => l.value === targetLang)?.label}
              </div>
            )}
          </div>
        )}

        {/* 预览按钮 */}
        <div className="flex items-center gap-3 mb-4">
          <button onClick={handlePreview} disabled={renaming}
            className="btn-ghost flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm">
            {renaming ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
            {renaming ? '生成中...' : '生成预览'}
          </button>
          {renamePreviews.length > 0 && (
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>共 {renamePreviews.length} 条预览结果</span>
          )}
        </div>

        {/* 预览列表 */}
        <div className="flex-1 min-h-0 flex flex-col">
          {renamePreviews.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => setPreviewsExpanded(!previewsExpanded)}
                  className="flex items-center gap-1 text-xs hover:text-neon transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                  <ChevronsUpDown size={12} />{previewsExpanded ? '折叠预览' : '展开预览'}
                </button>
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">{renamePreviews.length} 项将被重命名</span>
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
                  {useAIRename ? '选择语言后点击"生成预览"查看AI重命名效果' : '点击"生成预览"查看重命名效果'}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-default)' }}>
          <button onClick={onClose} className="btn-ghost px-4 py-2 rounded-lg text-sm">取消</button>
          <button onClick={handleExecute} disabled={renaming || renamePreviews.length === 0}
            className="btn-primary flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm">
            {renaming ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            执行重命名 {renamePreviews.length > 0 && `(${renamePreviews.length})`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ==================== 操作日志对话框 ====================
interface OperationLogsModalProps {
  onClose: () => void
}

export function OperationLogsModal({ open = true, onClose }: OperationLogsModalProps) {
  const [opLogs, setOpLogs] = useState<FileOperationLog[]>([])

  useEffect(() => {
    if (!open) return
    fileManagerApi.getOperationLogs(50).then(res => setOpLogs(res.data.data || [])).catch(() => {})
  }, [open])

  return (
    <Modal open={open} onClose={onClose} className="max-w-2xl">
      <div className="glass-panel-strong rounded-2xl p-6 max-h-[80vh] flex flex-col">
        <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          <History className="inline-block mr-2 mb-0.5" size={20} /> 操作日志
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
            <div className="text-center py-8 text-sm" style={{ color: 'var(--text-tertiary)' }}>暂无操作记录</div>
          )}
        </div>
        <div className="flex justify-end mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-default)' }}>
          <button onClick={onClose} className="btn-ghost px-4 py-2 rounded-lg text-sm">关闭</button>
        </div>
      </div>
    </Modal>
  )
}
