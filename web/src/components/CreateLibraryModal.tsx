import { useState, useRef, useEffect } from 'react'
import type { CreateLibraryRequest, LibraryAdvancedSettings, Library } from '@/types'
import { adminApi, adultScraperApi } from '@/api'
import {
  X,
  Film,
  Tv,
  Layers,
  Video,
  FolderPlus,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Loader2,
  Globe,
  Eye,
  Search,
  Plus,
  Trash2,
  Sparkles,
  Info,
  ScanLine,
  CheckCircle2,
  HardDrive,
  Cloud,
  Server,
  Database,
} from 'lucide-react'
import FileBrowser from './FileBrowser'
import { type StorageType, REMOTE_SCHEMES, joinRemotePath, pathPlaceholder } from '@/lib/storageSchemes'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { ANCHORS } from '@/lib/onboarding/anchors'
import { useTranslation, type TFunc } from '@/i18n'


// 内容类型配置（文案走 i18n）
const LIBRARY_TYPES = [
  {
    value: 'movie' as const,
    labelKey: 'createLib.typeMovie',
    descKey: 'createLib.typeMovieDesc',
    icon: Film,
    color: 'var(--neon-blue)',
    bg: 'var(--neon-blue-8)',
    border: 'var(--neon-blue-20)',
  },
  {
    value: 'tvshow' as const,
    labelKey: 'createLib.typeTvshow',
    descKey: 'createLib.typeTvshowDesc',
    icon: Tv,
    color: 'var(--neon-purple)',
    bg: 'var(--neon-purple-8)',
    border: 'var(--neon-purple-20)',
  },
  {
    value: 'mixed' as const,
    labelKey: 'createLib.typeMixed',
    descKey: 'createLib.typeMixedDesc',
    icon: Layers,
    color: '#F59E0B',
    bg: 'rgba(245, 158, 11, 0.08)',
    border: 'rgba(245, 158, 11, 0.2)',
  },
  {
    value: 'other' as const,
    labelKey: 'createLib.typeOther',
    descKey: 'createLib.typeOtherDesc',
    icon: Video,
    color: '#10B981',
    bg: 'rgba(16, 185, 129, 0.08)',
    border: 'rgba(16, 185, 129, 0.2)',
  },
]

// 存储类型配置
const STORAGE_TYPES = [
  {
    value: 'local' as const,
    labelKey: 'createLib.storageLocal',
    icon: HardDrive,
    color: '#10B981',
    bg: 'rgba(16, 185, 129, 0.08)',
    border: 'rgba(16, 185, 129, 0.2)',
  },
  {
    value: 'webdav' as const,
    label: 'WebDAV',
    icon: Cloud,
    color: 'var(--neon-blue)',
    bg: 'var(--neon-blue-8)',
    border: 'var(--neon-blue-20)',
  },
  {
    value: 'alist' as const,
    label: 'Alist',
    icon: Server,
    color: '#A855F7',
    bg: 'rgba(168, 85, 247, 0.08)',
    border: 'rgba(168, 85, 247, 0.2)',
  },
  {
    value: 's3' as const,
    label: 'S3',
    icon: Database,
    color: '#F59E0B',
    bg: 'rgba(245, 158, 11, 0.08)',
    border: 'rgba(245, 158, 11, 0.2)',
  },
]

// 元数据语言选项（含中文文案的条目走 i18n，语言本名不翻译）
const METADATA_LANG_OPTIONS: { value: string; label?: string; labelKey?: string }[] = [
  { value: 'zh-CN', labelKey: 'createLib.metadataLangZhCN' },
  { value: 'zh-TW', labelKey: 'createLib.metadataLangZhTW' },
  { value: 'en-US', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
]

// 默认高级设置（媒体库级别）
const DEFAULT_ADVANCED: LibraryAdvancedSettings = {
  prefer_local_nfo: true,
  enable_file_filter: true,
  min_file_size: 3,
  metadata_lang: 'zh-CN',
  allow_adult_content: false,
  auto_download_sub: false,
  auto_scrape_metadata: true,
  auto_analyze_video: false,
  auto_organize_mode: 'ai_assisted',
  organize_output_dir: '',
  enable_file_watch: false,
}

function buildDefaultMetadataSourceTooltip(t: TFunc): string {
  return [
    t('createLib.metaSourceHeader'),
    t('createLib.metaSourceTmdbApi', { url: 'https://api.themoviedb.org' }),
    t('createLib.metaSourceTmdbImage', { url: 'https://image.tmdb.org' }),
    t('createLib.metaSourceAdultDefault'),
    t('createLib.metaSourceNote'),
  ].join('\n')
}

function buildMetadataSourceTooltip(t: TFunc, tmdbApiURL: string, tmdbImageURL: string, adultSourceLines: string[], adultEnabled: boolean) {
  const lines = [
    t('createLib.metaSourceHeader'),
    t('createLib.metaSourceTmdbApi', { url: tmdbApiURL }),
    t('createLib.metaSourceTmdbImage', { url: tmdbImageURL }),
  ]
  if (adultEnabled && adultSourceLines.length > 0) {
    lines.push(t('createLib.metaSourceAdultHeader'))
    adultSourceLines.forEach((line) => lines.push(`  - ${line}`))
  } else {
    lines.push(t('createLib.metaSourceAdultDisabled'))
  }
  lines.push(t('createLib.metaSourceNote'))
  return lines.join('\n')
}

interface CreateLibraryModalProps {
  open: boolean
  onClose: () => void
  onCreate: (data: CreateLibraryRequest) => Promise<Library | null>
  /** 创建成功面板中「立即扫描入库」回调（由父组件触发扫描并维护进度状态） */
  onScan: (lib: Library) => Promise<void>
}

// ===== 可复用的 Toggle 开关组件 =====
function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-300 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        background: checked
          ? 'var(--neon-blue)'
          : 'var(--border-default)',
        boxShadow: checked ? 'var(--neon-glow-shadow-md)' : 'none',
      }}
    >
      <span
        className="pointer-events-none inline-block h-5 w-5 rounded-full shadow-lg transition-transform duration-300"
        style={{
          transform: checked ? 'translateX(20px) translateY(2px)' : 'translateX(2px) translateY(2px)',
          background: checked ? '#fff' : 'var(--text-muted)',
        }}
      />
    </button>
  )
}

export default function CreateLibraryModal({ open, onClose, onCreate, onScan }: CreateLibraryModalProps) {
  const { t } = useTranslation()
  const [selectedType, setSelectedType] = useState<CreateLibraryRequest['type']>('movie')
  const [storageType, setStorageType] = useState<StorageType>('local')
  const [name, setName] = useState('')
  // 多路径模式：第一个是主路径，其余是附加路径
  const [paths, setPaths] = useState<string[]>([''])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advanced, setAdvanced] = useState<LibraryAdvancedSettings>({ ...DEFAULT_ADVANCED })
  const [showLangDropdown, setShowLangDropdown] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // 创建成功后的媒体库（非空时显示「立即扫描入库」引导面板）
  const [created, setCreated] = useState<Library | null>(null)
  const [startingScan, setStartingScan] = useState(false)
  // 当前打开文件浏览器的路径索引，null 表示未打开
  const [browsingIndex, setBrowsingIndex] = useState<number | null>(null)
  const [metadataSourceTooltip, setMetadataSourceTooltip] = useState(() => buildDefaultMetadataSourceTooltip(t))
  const [nsfwEnabled, setNsfwEnabled] = useState(true)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // 打开时重置状态
  useEffect(() => {
    if (open) {
      setSelectedType('movie')
      setStorageType('local')
      setName('')
      setPaths([''])
      setShowAdvanced(false)
      setAdvanced({ ...DEFAULT_ADVANCED })
      setShowLangDropdown(false)
      setError('')
      setCreated(null)
      setStartingScan(false)
      setTimeout(() => nameInputRef.current?.focus(), 100)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false

    const loadMetadataSourceTooltip = async () => {
      const [tmdbResult, adultResult] = await Promise.allSettled([
        adminApi.getTMDbConfig(),
        adultScraperApi.getConfig(),
      ])
      if (cancelled) return

      const tmdb = tmdbResult.status === 'fulfilled' ? tmdbResult.value.data.data : null
      const adult = adultResult.status === 'fulfilled' ? adultResult.value.data.data : null
      setNsfwEnabled(adult?.nsfw_enabled !== false)
      const adultSourceLines = adult?.enabled
        ? [...(adult.sources || [])]
            .filter((source) => source.enabled && source.url)
            .sort((a, b) => a.priority - b.priority)
            .map((source) => `${source.name || source.id}：${source.url}`)
        : []

      setMetadataSourceTooltip(buildMetadataSourceTooltip(
        t,
        tmdb?.api_proxy || 'https://api.themoviedb.org',
        tmdb?.image_proxy || 'https://image.tmdb.org',
        adultSourceLines,
        Boolean(adult?.enabled),
      ))
    }

    loadMetadataSourceTooltip().catch(() => {
      if (!cancelled) setMetadataSourceTooltip(buildDefaultMetadataSourceTooltip(t))
    })
    return () => { cancelled = true }
  }, [open])

  // 更新高级设置的辅助函数
  const updateAdvanced = <K extends keyof LibraryAdvancedSettings>(
    key: K,
    value: LibraryAdvancedSettings[K]
  ) => {
    setAdvanced((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError(t('createLib.nameRequired'))
      nameInputRef.current?.focus()
      return
    }
    let cleanedPaths = paths.map((p) => p.trim()).filter((p) => p.length > 0)
    if (cleanedPaths.length === 0) {
      setError(t('createLib.pathRequired'))
      return
    }
    if (storageType !== 'local') {
      cleanedPaths = cleanedPaths.map((p) => joinRemotePath(storageType, p))
    }
    // 去重检查
    const dedup = Array.from(new Set(cleanedPaths))
    if (dedup.length !== cleanedPaths.length) {
      setError(t('createLib.duplicatePath'))
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const lib = await onCreate({
        name: name.trim(),
        paths: dedup,
        type: selectedType,
        // 高级设置
        ...advanced,
      })
      if (lib) {
        setCreated(lib)
      } else {
        onClose()
      }
    } catch (err: any) {
      const serverMsg = err?.response?.data?.error
      setError(serverMsg || t('createLib.createFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  // 「立即扫描入库」：复用父组件扫描流程（维护 scanning 状态 + WS 进度 + 失败提示）
  const handleStartScan = async () => {
    if (!created) return
    setStartingScan(true)
    setError('')
    try {
      await onScan(created)
      onClose()
    } catch {
      // 扫描启动失败：留在引导面板，允许重试
      setError(t('createLib.scanStartFailed'))
      setStartingScan(false)
    }
  }

  const selectedLangLabel = (() => {
    const l = METADATA_LANG_OPTIONS.find((l) => l.value === advanced.metadata_lang)
    return l?.labelKey ? t(l.labelKey) : (l?.label || advanced.metadata_lang)
  })()

  return (
    <Modal open={open} onClose={onClose} className="max-w-xl">
      <div
        data-onboarding={ANCHORS.createLibraryDialog}
        className="relative -m-4 rounded-2xl overflow-hidden"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow-elevated), var(--modal-panel-glow)',
          backdropFilter: 'blur(30px)',
          maxHeight: '90vh',
        }}
      >
        {/* 顶部霓虹光条 */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px] z-10"
          style={{
            background: 'linear-gradient(90deg, transparent, var(--neon-blue), var(--neon-purple), transparent)',
          }}
        />

        {/* 可滚动内容容器 */}
        <div className="overflow-y-auto" style={{ maxHeight: '90vh' }}>
          {/* 头部 */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4 sticky top-0 z-10" style={{ background: 'var(--bg-elevated)' }}>
            <h2
              className="font-display text-lg font-bold tracking-wide"
              style={{ color: 'var(--text-primary)' }}
            >
              {t('createLib.title')}
            </h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 transition-all hover:bg-[var(--nav-hover-bg)]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <X size={20} />
            </button>
          </div>

          {/* 内容区域 */}
          <div className="px-6 pb-6 space-y-5">
            {created ? (
              /* ===== 创建成功引导面板 ===== */
              <div className="flex flex-col items-center py-10 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
                  <CheckCircle2 size={28} className="text-emerald-400" />
                </div>
                <h3 className="font-display text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                  {t('createLib.createdSuccess', { name: created.name })}
                </h3>
                <p className="mt-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>
                  {t('createLib.scanNowHint')}
                </p>
                {error && (
                  <p className="mt-3 text-sm" style={{ color: '#EF4444' }}>
                    {error}
                  </p>
                )}
                <div className="mt-7 flex items-center gap-3">
                  <Button size="lg" data-onboarding={ANCHORS.scanNowButton} onClick={handleStartScan} disabled={startingScan}>
                    {startingScan ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        {t('createLib.starting')}
                      </>
                    ) : (
                      <>
                        <ScanLine size={16} />
                        {t('createLib.scanNow')}
                      </>
                    )}
                  </Button>
                  <Button variant="outline" size="lg" onClick={onClose} disabled={startingScan}>
                    {t('createLib.later')}
                  </Button>
                </div>
              </div>
            ) : (
            <>
            {/* ===== 内容类型选择 ===== */}
            <div>
              <label
                className="mb-3 block text-sm font-semibold"
                style={{ color: 'var(--text-secondary)' }}
              >
                {t('createLib.contentType')}
              </label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {LIBRARY_TYPES.map((type) => {
                  const Icon = type.icon
                  const isSelected = selectedType === type.value
                  return (
                    <button
                      key={type.value}
                      onClick={() => setSelectedType(type.value)}
                      className="group relative flex flex-col items-center gap-2 rounded-xl p-3.5 transition-all duration-300"
                      style={{
                        background: isSelected ? type.bg : 'transparent',
                        border: `1.5px solid ${isSelected ? type.border : 'var(--border-default)'}`,
                        boxShadow: isSelected ? `0 0 20px ${type.bg}` : 'none',
                      }}
                    >
                      {isSelected && (
                        <div
                          className="absolute -top-px left-1/4 right-1/4 h-[2px] rounded-b"
                          style={{ background: type.color, boxShadow: `0 0 8px ${type.color}` }}
                        />
                      )}
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-300"
                        style={{
                          background: isSelected ? `${type.bg}` : 'var(--nav-hover-bg)',
                          color: isSelected ? type.color : 'var(--text-tertiary)',
                        }}
                      >
                        <Icon size={22} />
                      </div>
                      <div className="text-center">
                        <p
                          className="text-sm font-semibold transition-colors"
                          style={{ color: isSelected ? type.color : 'var(--text-primary)' }}
                        >
                          {t(type.labelKey)}
                        </p>
                        <p
                          className="mt-0.5 text-[11px] leading-tight"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          {t(type.descKey)}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ===== 媒体库名称 ===== */}
            <div>
              <label
                className="mb-2 block text-sm font-semibold"
                style={{ color: 'var(--text-secondary)' }}
              >
                {t('createLib.name')}
              </label>
              <div className="relative">
                <input
                  ref={nameInputRef}
                  type="text"
                  value={name}
                  onChange={(e) => {
                    if (e.target.value.length <= 32) {
                      setName(e.target.value)
                      setError('')
                    }
                  }}
                  className="input pr-16"
                  placeholder={t('createLib.namePlaceholder')}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                />
                <span
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs tabular-nums"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {name.length} / 32
                </span>
              </div>
            </div>

            {/* ===== 存储类型 ===== */}
            <div>
              <label
                className="mb-3 block text-sm font-semibold"
                style={{ color: 'var(--text-secondary)' }}
              >
                {t('createLib.storageType')}
              </label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {STORAGE_TYPES.map((type) => {
                  const Icon = type.icon
                  const isSelected = storageType === type.value
                  return (
                    <button
                      key={type.value}
                      onClick={() => setStorageType(type.value)}
                      className="flex flex-col items-center gap-1.5 rounded-xl p-3 transition-all"
                      style={{
                        background: isSelected ? type.bg : 'transparent',
                        border: `1.5px solid ${isSelected ? type.border : 'var(--border-default)'}`,
                        color: isSelected ? type.color : 'var(--text-secondary)',
                      }}
                    >
                      <Icon size={20} />
                      <span className="text-xs font-medium">{type.labelKey ? t(type.labelKey) : type.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ===== 媒体文件夹 ===== */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label
                  className="text-sm font-semibold"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {t('createLib.mediaFolders')}
                </label>
                <button
                  type="button"
                  onClick={() => setPaths((prev) => [...prev, ''])}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors hover:bg-[var(--nav-hover-bg)]"
                  style={{ color: 'var(--neon-blue)' }}
                  title={t('createLib.addFolderTitle')}
                >
                  <Plus size={14} />
                  {t('createLib.addFolder')}
                </button>
              </div>
              <p
                className="mb-2.5 text-xs leading-relaxed"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {storageType === 'local' ? (
                  <>
                    {t('createLib.pathsHintLocalBegin')} <code className="rounded px-1 py-0.5 text-neon" style={{ background: 'var(--nav-hover-bg)' }}>/media/movies</code>{t('createLib.pathsHintLocalEnd')}
                  </>
                ) : (
                  <>
                    {t('createLib.pathsHintRemoteBegin')} <code className="rounded px-1 py-0.5 text-neon" style={{ background: 'var(--nav-hover-bg)' }}>media</code>{t('createLib.pathsHintRemoteMid')} <code className="rounded px-1 py-0.5 text-neon" style={{ background: 'var(--nav-hover-bg)' }}>{REMOTE_SCHEMES[storageType]}</code>{t('createLib.pathsHintRemoteEnd')}
                  </>
                )}
              </p>
              <div className="space-y-2">
                {paths.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setBrowsingIndex(idx)}
                      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-colors cursor-pointer hover:bg-[var(--nav-hover-bg)]"
                      style={{
                        border: '1.5px dashed var(--border-hover)',
                        color: 'var(--text-tertiary)',
                      }}
                      title={storageType === 'local' ? t('createLib.browseLocal') : t('createLib.browseRemote')}
                    >
                      <FolderPlus size={18} />
                    </button>
                    <input
                      type="text"
                      value={p}
                      onChange={(e) => {
                        const v = e.target.value
                        setPaths((prev) => prev.map((x, i) => (i === idx ? v : x)))
                        setError('')
                      }}
                      className="input flex-1"
                      placeholder={pathPlaceholder(storageType, idx)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    />
                    {paths.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setPaths((prev) => prev.filter((_, i) => i !== idx))
                          setError('')
                        }}
                        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-red-500/5"
                        style={{ color: 'var(--text-tertiary)' }}
                        title={t('createLib.removePath')}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ===== 高级设置（可展开） — 飞牛影视风格 ===== */}
            <div>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-sm font-semibold transition-colors"
                style={{ color: 'var(--text-secondary)' }}
              >
                {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {t('createLib.advanced')}
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-6 animate-slide-up">

                  {/* ———— 1. 优先读取本地 NFO 和图片 ———— */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h4
                        className="text-sm font-semibold"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {t('createLib.advancedPreferNfo')}
                      </h4>
                      <p
                        className="mt-1 text-xs leading-relaxed"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {t('createLib.advancedPreferNfoHint')}
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={advanced.prefer_local_nfo}
                      onChange={(v) => updateAdvanced('prefer_local_nfo', v)}
                    />
                  </div>

                  {/* 分割线 */}
                  <div style={{ borderTop: '1px solid var(--border-default)' }} />

                  {/* ———— 2. 文件过滤 ———— */}
                  <div>
                    <h4
                      className="text-sm font-semibold mb-2.5"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {t('createLib.advancedFileFilter')}
                    </h4>
                    <div className="flex items-center gap-3">
                      {/* Checkbox */}
                      <button
                        type="button"
                        onClick={() => updateAdvanced('enable_file_filter', !advanced.enable_file_filter)}
                        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-all"
                        style={{
                          background: advanced.enable_file_filter
                            ? 'var(--neon-blue)'
                            : 'transparent',
                          border: advanced.enable_file_filter
                            ? 'none'
                            : '2px solid var(--border-hover)',
                          boxShadow: advanced.enable_file_filter
                            ? '0 0 8px var(--neon-blue-25)'
                            : 'none',
                        }}
                      >
                        {advanced.enable_file_filter && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                      <span
                        className="text-sm"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {t('createLib.excludeSmaller')}
                      </span>
                      <input
                        type="number"
                        value={advanced.min_file_size}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(999, parseInt(e.target.value) || 0))
                          updateAdvanced('min_file_size', v)
                        }}
                        disabled={!advanced.enable_file_filter}
                        className="input w-20 text-center tabular-nums disabled:opacity-40"
                        min={0}
                        max={999}
                      />
                      <span
                        className="text-sm"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {t('createLib.mbVideoFile')}
                      </span>
                    </div>
                  </div>

                  {/* 分割线 */}
                  <div style={{ borderTop: '1px solid var(--border-default)' }} />

                  {/* ———— 3. 媒体元数据下载语言 ———— */}
                  <div>
                    <h4
                      className="text-sm font-semibold"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {t('createLib.advancedMetadataLang')}
                    </h4>
                    <p
                      className="mt-1 mb-3 text-xs leading-relaxed"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {t('createLib.advancedMetadataLangHint')}
                    </p>
                    {/* 下拉选择框 */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowLangDropdown(!showLangDropdown)}
                        className="input flex w-full items-center justify-between gap-2 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <Globe size={16} style={{ color: 'var(--text-muted)' }} />
                          <span style={{ color: 'var(--text-primary)' }}>{selectedLangLabel}</span>
                        </div>
                        <ChevronDown
                          size={16}
                          style={{ color: 'var(--text-muted)' }}
                          className={`transition-transform ${showLangDropdown ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {showLangDropdown && (
                        <>
                          <div className="fixed inset-0 z-30" onClick={() => setShowLangDropdown(false)} />
                          <div
                            className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-xl py-1 animate-slide-up"
                            style={{
                              background: 'var(--bg-elevated)',
                              border: '1px solid var(--border-strong)',
                              boxShadow: 'var(--shadow-elevated)',
                            }}
                          >
                            {METADATA_LANG_OPTIONS.map((lang) => (
                              <button
                                key={lang.value}
                                onClick={() => {
                                  updateAdvanced('metadata_lang', lang.value)
                                  setShowLangDropdown(false)
                                }}
                                className="w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-[var(--nav-hover-bg)]"
                                style={{
                                  color: advanced.metadata_lang === lang.value
                                    ? 'var(--neon-blue)'
                                    : 'var(--text-secondary)',
                                  background: advanced.metadata_lang === lang.value
                                    ? 'var(--nav-active-bg)'
                                    : undefined,
                                }}
                              >
                                {lang.labelKey ? t(lang.labelKey) : lang.label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* 分割线 */}
                  <div style={{ borderTop: '1px solid var(--border-default)' }} />

                  {/* ———— 4. 媒体元数据允许成人内容 ———— */}
                  {nsfwEnabled && (
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                          <h4
                            className="text-sm font-semibold"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {t('createLib.advancedAdult')}
                          </h4>
                          <button
                            type="button"
                            title={metadataSourceTooltip}
                            aria-label={t('createLib.viewSourceLinks')}
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-[var(--nav-hover-bg)]"
                            style={{ color: 'var(--text-tertiary)' }}
                          >
                            <Info size={13} />
                          </button>
                        </div>
                        <p
                          className="mt-1 text-xs leading-relaxed"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          {t('createLib.advancedAdultHint')}
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={advanced.allow_adult_content}
                        onChange={(v) => updateAdvanced('allow_adult_content', v)}
                      />
                    </div>
                  )}

                  {/* 分割线 */}
                  <div style={{ borderTop: '1px solid var(--border-default)' }} />

                  {/* ———— 5. 自动下载字幕 ———— */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h4
                        className="text-sm font-semibold"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {t('createLib.advancedAutoSub')}
                      </h4>
                      <p
                        className="mt-1 text-xs leading-relaxed"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {t('createLib.advancedAutoSubHint')}
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={advanced.auto_download_sub}
                      onChange={(v) => updateAdvanced('auto_download_sub', v)}
                    />
                  </div>

                  {/* 分割线 */}
                  <div style={{ borderTop: '1px solid var(--border-default)' }} />

                  {/* ———— 6. 扫描后自动刮削元数据 ———— */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Search size={16} style={{ color: '#06B6D4' }} />
                        <h4
                          className="text-sm font-semibold"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {t('createLib.advancedAutoScrape')}
                        </h4>
                      </div>
                      <p
                        className="mt-1 text-xs leading-relaxed"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {t('createLib.advancedAutoScrapeHint')}
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={advanced.auto_scrape_metadata}
                      onChange={(v) => updateAdvanced('auto_scrape_metadata', v)}
                    />
                  </div>

                  {/* 分割线 */}
                  <div style={{ borderTop: '1px solid var(--border-default)' }} />

                  {/* ———— 7. 扫描后自动视频分析 ———— */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Sparkles size={16} style={{ color: 'var(--neon-blue)' }} />
                        <h4
                          className="text-sm font-semibold"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {t('createLib.advancedAutoAnalyze')}
                        </h4>
                      </div>
                      <p
                        className="mt-1 text-xs leading-relaxed"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {t('createLib.advancedAutoAnalyzeHint')}
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={advanced.auto_analyze_video}
                      onChange={(v) => updateAdvanced('auto_analyze_video', v)}
                    />
                  </div>

                  {/* 分割线 */}
                  <div style={{ borderTop: '1px solid var(--border-default)' }} />

                  {/* ———— 8. AI 自动整理（扫描后处理：识别 / 归类 / 命名映射） ———— */}
                  <div className="space-y-3">
                    <div className="flex items-start gap-2">
                      <Sparkles size={16} style={{ color: 'var(--neon-purple)', marginTop: 2 }} />
                      <div className="flex-1">
                        <h4
                          className="text-sm font-semibold"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {t('createLib.aiOrganize')}
                        </h4>
                        <p
                          className="mt-1 text-xs leading-relaxed"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          {t('createLib.aiOrganizeHint1')}
                          <span className="font-medium" style={{ color: 'var(--neon-green)' }}>
                            {t('createLib.aiOrganizeHintDbOnly')}
                          </span>
                          {t('createLib.aiOrganizeHint2')}
                        </p>
                      </div>
                    </div>

                    {/* 三选一卡片 */}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {(
                        [
                          {
                            value: 'ai_assisted' as const,
                            titleKey: 'createLib.aiModeAssisted',
                            tagKey: 'createLib.aiModeAssistedTag',
                            descKey: 'createLib.aiModeAssistedDesc',
                            color: 'var(--neon-purple)',
                          },
                          {
                            value: 'rule_only' as const,
                            titleKey: 'createLib.aiModeRuleOnly',
                            tagKey: 'createLib.aiModeRuleOnlyTag',
                            descKey: 'createLib.aiModeRuleOnlyDesc',
                            color: '#06B6D4',
                          },
                          {
                            value: 'off' as const,
                            titleKey: 'createLib.aiModeOff',
                            tagKey: 'createLib.aiModeOffTag',
                            descKey: 'createLib.aiModeOffDesc',
                            color: 'var(--text-tertiary)',
                          },
                        ]
                      ).map((opt) => {
                        const active = advanced.auto_organize_mode === opt.value
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => updateAdvanced('auto_organize_mode', opt.value)}
                            className="group rounded-lg border p-3 text-left transition-all"
                            style={{
                              borderColor: active ? opt.color : 'var(--border-default)',
                              background: active ? `${opt.color}14` : 'transparent',
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span
                                className="text-sm font-semibold"
                                style={{ color: active ? opt.color : 'var(--text-primary)' }}
                              >
                                {t(opt.titleKey)}
                              </span>
                              <span
                                className="rounded px-1.5 py-0.5 text-[10px]"
                                style={{
                                  background: active ? `${opt.color}33` : 'var(--bg-secondary)',
                                  color: active ? opt.color : 'var(--text-tertiary)',
                                }}
                              >
                                {t(opt.tagKey)}
                              </span>
                            </div>
                            <p
                              className="mt-1 text-xs leading-relaxed"
                              style={{ color: 'var(--text-tertiary)' }}
                            >
                              {t(opt.descKey)}
                            </p>
                          </button>
                        )
                      })}
                    </div>

                    {/* 下文提示根据选择自适应 */}
                    {advanced.auto_organize_mode === 'off' && (
                      <p
                        className="rounded-md px-2.5 py-1.5 text-[11px]"
                        style={{
                          background: 'var(--bg-secondary)',
                          color: 'var(--text-tertiary)',
                        }}
                      >
                        {t('createLib.aiOffHint')}
                      </p>
                    )}
                    {advanced.auto_organize_mode === 'rule_only' && (
                      <p
                        className="rounded-md px-2.5 py-1.5 text-[11px]"
                        style={{
                          background: 'var(--bg-secondary)',
                          color: 'var(--text-tertiary)',
                        }}
                      >
                        {t('createLib.aiRuleHint')}
                      </p>
                    )}

                    {/* 硬链接输出目录（仅在非 off 时显示） */}
                    {advanced.auto_organize_mode !== 'off' && (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <FolderPlus size={14} style={{ color: 'var(--neon-green)' }} />
                          <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                            {t('createLib.virtualDir')}
                          </span>
                        </div>
                        <p
                          className="text-[11px] leading-relaxed"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          {t('createLib.virtualDirHint')}
                        </p>
                        <input
                          type="text"
                          value={advanced.organize_output_dir}
                          onChange={(e) => updateAdvanced('organize_output_dir', e.target.value)}
                          className="input w-full text-sm"
                          placeholder={t('createLib.virtualDirPlaceholder')}
                        />
                        {advanced.organize_output_dir && (
                          <p
                            className="rounded-md px-2.5 py-1.5 text-[11px] flex items-center gap-1.5"
                            style={{ background: 'rgba(16, 185, 129, 0.08)', color: 'var(--neon-green)' }}
                          >
                            <span>✓</span>
                            {t('createLib.virtualDirActiveHint')}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 分割线 */}
                  <div style={{ borderTop: '1px solid var(--border-default)' }} />

                  {/* ———— 8. 实时文件监控 ———— */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Eye size={16} style={{ color: 'var(--neon-purple)' }} />
                        <h4
                          className="text-sm font-semibold"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {t('createLib.fileWatch')}
                        </h4>
                      </div>
                      <p
                        className="mt-1 text-xs leading-relaxed"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {t('createLib.fileWatchHint')}
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={advanced.enable_file_watch}
                      onChange={(v) => updateAdvanced('enable_file_watch', v)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 错误提示 */}
            {error && (
              <div
                className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
                style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.15)',
                  color: '#EF4444',
                }}
              >
                <AlertCircle size={16} />
                {error}
              </div>
            )}
            </>
            )}
          </div>

          {/* 底部按钮 */}
          {!created && (
          <div
            className="flex items-center justify-end gap-3 px-6 py-4 sticky bottom-0"
            style={{
              borderTop: '1px solid var(--border-default)',
              background: 'var(--bg-elevated)',
            }}
          >
            <Button variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {t('createLib.creating')}
                </>
              ) : (
                t('createLib.confirm')
              )}
            </Button>
          </div>
          )}
        </div>
      </div>

      {/* 文件浏览器（本地 / 远程目录） */}
      <FileBrowser
        open={browsingIndex !== null}
        onClose={() => setBrowsingIndex(null)}
        storageType={storageType}
        onSelect={(selectedPath) => {
          if (browsingIndex !== null) {
            setPaths((prev) => prev.map((x, i) => (i === browsingIndex ? selectedPath : x)))
            setError('')
          }
        }}
        initialPath={storageType === 'local' ? (browsingIndex !== null ? paths[browsingIndex] : '') || '/' : '/'}
      />
    </Modal>
  )
}
