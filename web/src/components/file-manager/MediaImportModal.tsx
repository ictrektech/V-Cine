import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, HardDrive, Plus, Upload } from 'lucide-react'
import type { Library } from '@/types'
import { Modal } from '@/components/ui/modal'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/i18n'
import { importTargetApi, libraryNameForLocation, type ImportLocation } from '@/api/importTargets'
import { resolvePublicDirUuid } from '@/lib/vosDirectoryMap'
import { useTransferStore, type ScanMode } from '@/stores/transfer'
import { acquireVOSAccessToken } from '@/utils/vos-oidc'
import { ImportFileForm, ImportFileModal } from './FileModals'

interface MediaImportModalProps {
  open: boolean
  libraries: Library[]
  onClose: () => void
  onSuccess: () => void
}

type Source = 'choose' | 'upload' | 'nas'

const SCAN_MODE_KEY = 'vcine.upload.scanMode'

/** 是否运行在 VOS 平台 iframe 内（拿得到 OIDC bridge 才能上传） */
function hasVOSBridge(): boolean {
  return typeof window !== 'undefined' && !!window.vos_platform?.api
}

/**
 * 「添加视频」入口：按"文件在哪"分流。
 * - 从电脑/手机上传（B 通道）：选一个**位置**（而不是抽象的"媒体库"），
 *   上传到 `<位置>/_incoming`；位置还没有库时由后端自动建库再扫描
 * - 已在 NAS 上（A 通道）：复用 ImportFileForm
 * 平台内且存在可上传位置时才显示选择步骤；否则直接进 A 通道。
 */
export default function MediaImportModal({ open, libraries, onClose, onSuccess }: MediaImportModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const bridgeAvailable = hasVOSBridge()
  const enqueue = useTransferStore((s) => s.enqueue)

  const [source, setSource] = useState<Source>('choose')
  // null = 未探测/探测中（此时渲染加载面板，避免闪一下 A 通道表单）
  const [locations, setLocations] = useState<ImportLocation[] | null>(null)
  const [locationsLoading, setLocationsLoading] = useState(false)
  const [locationPath, setLocationPath] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [adapterReady, setAdapterReady] = useState<'checking' | 'ready' | 'unavailable'>('checking')
  // 上传完成后的扫描范围；记住上次选择（默认只处理本次上传）
  const [scanMode, setScanMode] = useState<ScanMode>('uploaded')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 打开时重置并探测落点（仅平台内）
  useEffect(() => {
    if (!open) return
    setSource('choose')
    setFiles([])
    // 清空上次的落点，避免把已删除/已变更的目录继续展示出来
    setLocations(null)
    setLocationsLoading(bridgeAvailable)
    try {
      setScanMode(window.localStorage.getItem(SCAN_MODE_KEY) === 'library' ? 'library' : 'uploaded')
    } catch {
      setScanMode('uploaded')
    }
    if (!bridgeAvailable) {
      setLocations([])
      return
    }
    let cancelled = false
    importTargetApi.targets()
      .then((res) => {
        if (cancelled) return
        const uploadable = (res.data?.data || []).filter((x) => x.uploadable)
        setLocations(uploadable)
        if (uploadable[0]) setLocationPath(uploadable[0].local_path)
      })
      .catch(() => {
        // 探测失败静默降级为单来源（D8）
        if (!cancelled) setLocations([])
      })
      .finally(() => {
        if (!cancelled) setLocationsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, bridgeAvailable])

  const uploadLocations = locations ?? []
  const showChooser = bridgeAvailable && uploadLocations.length > 0
  const currentLocation = uploadLocations.find((x) => x.local_path === locationPath) ?? uploadLocations[0]

  // 进入上传面板先静默预检：解析不出 adapter 说明目录没授权给该用户（Task 7）
  useEffect(() => {
    if (source !== 'upload' || !currentLocation) return
    let cancelled = false
    setAdapterReady('checking')
    ;(async () => {
      const token = await acquireVOSAccessToken().catch(() => null)
      if (cancelled) return
      if (!token) {
        setAdapterReady('unavailable')
        return
      }
      let adapter = currentLocation.adapter
      if (!adapter) {
        const { volume_uuid: volumeUUID, public_dir_name: dirName } = currentLocation
        const uuid = volumeUUID && dirName ? await resolvePublicDirUuid(volumeUUID, dirName, token) : null
        adapter = uuid ? `p_${uuid}` : undefined
      }
      if (!cancelled) setAdapterReady(adapter ? 'ready' : 'unavailable')
    })()
    return () => {
      cancelled = true
    }
  }, [source, currentLocation])

  /**
   * 位置标题：写"这是什么位置"（角色），不写容器路径。
   * 与文件管理器「快捷入口」同一套命名（主媒体库 / 公共目录）。
   */
  const locationLabel = (loc: ImportLocation) => {
    if (loc.local_path === '/media') return t('fb.mediaLibrary')
    if (!loc.library_id) {
      // 还没有库：用「角色化」的库名，与自动建库后的库名保持一致
      if (loc.kind === 'user_data') return t('fm.uploadUserLibraryLabel', { name: loc.name || loc.user || '' })
      return t('fm.uploadPublicLibraryLabel', { name: loc.name || '' })
    }
    // 已有库：用真实库名（与媒体库页一致），目录名/路径放说明行
    return loc.library_name || loc.name || loc.local_path
  }

  /** 说明行：来源 + 归属库 / 将自动建库 */
  const locationHint = (loc: ImportLocation) => {
    const parts: string[] = []
    if (loc.local_path === '/media') {
      parts.push(t('fb.mediaLibraryDesc'))
      if (loc.library_id && loc.library_name) parts.push(t('fm.uploadBelongsToLibrary', { name: loc.library_name }))
      return parts.join(' · ')
    }
    if (loc.kind === 'user_data') {
      parts.push(t('fb.userDataDesc'))
      if (loc.library_id && loc.library_name) parts.push(t('fm.uploadBelongsToLibrary', { name: loc.library_name }))
      else parts.push(t('fm.uploadWillCreateLibrary'))
      return parts.join(' · ')
    }
    if (!loc.library_id) {
      // 目录名已进入标题（公共媒体库（<目录名>）），说明行只留来源与"自动建库"
      if (loc.volume_name) parts.push(t('fb.publicDirDesc', { name: loc.volume_name }))
      parts.push(t('fm.uploadWillCreateLibrary'))
      return parts.join(' · ')
    }
    parts.push(loc.local_path)
    return parts.join(' · ')
  }

  const changeScanMode = (mode: ScanMode) => {
    setScanMode(mode)
    try {
      window.localStorage.setItem(SCAN_MODE_KEY, mode)
    } catch {
      /* 隐私模式忽略 */
    }
  }

  const handleEnqueue = () => {
    if (!currentLocation || files.length === 0) return
    const count = enqueue(files, currentLocation, libraryNameForLocation(currentLocation, t), scanMode)
    toast.success(t('fm.transferAdded', { count }))
    onSuccess()
    onClose()
  }

  // 落点探测中：先显示加载面板，避免闪一下「已在 NAS 上」的表单
  if (locationsLoading) {
    return (
      <Modal open={open} onClose={onClose} className="max-w-lg">
        <div className="glass-panel-strong rounded-2xl p-6">
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{t('common.loading')}</p>
        </div>
      </Modal>
    )
  }

  // 无平台 bridge 或无可用位置：只保留 A 通道，界面与改造前一致
  if (!showChooser) {
    return (
      <ImportFileModal open={open} libraries={libraries} onClose={onClose} onSuccess={onSuccess} />
    )
  }

  if (source === 'nas') {
    return (
      <Modal open={open} onClose={onClose} className="max-w-lg">
        <div className="glass-panel-strong rounded-2xl p-6">
          <ImportFileForm libraries={libraries} onCancel={onClose} onSuccess={onSuccess} />
        </div>
      </Modal>
    )
  }

  if (source === 'upload') {
    return (
      <Modal open={open} onClose={onClose} className="max-w-lg">
        <div className="glass-panel-strong rounded-2xl p-6">
          <button
            onClick={() => setSource('choose')}
            className="btn-ghost mb-3 flex items-center gap-1 rounded-lg px-2 py-1 text-xs"
          >
            <ChevronLeft size={14} /> {t('common.back')}
          </button>
          <h3 className="flex items-center gap-2 text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            <Upload size={20} /> {t('fm.uploadTitle')}
          </h3>
          <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>{t('fm.uploadDesc')}</p>

          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              multiple
              className="hidden"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn-ghost w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm border border-dashed transition-colors hover:border-neon hover:bg-neon/5"
            >
              <Upload size={16} className="flex-shrink-0 text-neon" />
              <span
                className="flex-1 truncate text-left font-medium"
                style={{ color: files.length ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
              >
                {files.length === 1
                  ? files[0].name
                  : files.length > 1
                    ? t('fm.uploadPickedCount', { count: files.length })
                    : t('fm.uploadPickFile')}
              </span>
            </button>

            <div>
              <label className="block text-sm mb-1 font-medium" style={{ color: 'var(--text-primary)' }}>
                {t('fm.uploadTargetLabel')}
              </label>
              <div className="space-y-1.5">
                {uploadLocations.map((loc) => {
                  const active = loc.local_path === currentLocation?.local_path
                  return (
                    <button
                      key={loc.local_path}
                      onClick={() => setLocationPath(loc.local_path)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors"
                      style={{
                        border: `1px solid ${active ? 'var(--neon)' : 'var(--border-default)'}`,
                        background: active ? 'rgba(34,211,238,0.08)' : 'transparent',
                      }}
                    >
                      <HardDrive size={14} className="flex-shrink-0 text-neon" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" style={{ color: 'var(--text-primary)' }}>
                          {locationLabel(loc)}
                        </span>
                        <span className="block truncate text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                          {locationHint(loc)}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

            <div>
              <label className="block text-sm mb-1 font-medium" style={{ color: 'var(--text-primary)' }}>
                {t('fm.uploadScanScope')}
              </label>
              <Select value={scanMode} onValueChange={(v) => changeScanMode(v as ScanMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="uploaded">{t('fm.uploadScanUploaded')}</SelectItem>
                  <SelectItem value="library">{t('fm.uploadScanLibrary')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {scanMode === 'library' ? t('fm.uploadScanLibraryDesc') : t('fm.uploadScanUploadedDesc')}
              </p>
            </div>

          {adapterReady === 'unavailable' && (
            <p className="mt-3 text-xs text-amber-400">{t('fm.uploadNoPermission')}</p>
          )}

          <div className="flex justify-end gap-2 mt-6">
            <button onClick={onClose} className="btn-ghost px-4 py-2 rounded-lg text-sm">
              {t('common.cancel')}
            </button>
            <button
              onClick={handleEnqueue}
              disabled={files.length === 0 || adapterReady !== 'ready'}
              className="btn-primary flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm disabled:opacity-40"
            >
              <Upload size={14} />
              {t('fm.uploadStart')}
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={onClose} className="max-w-lg">
      <div className="glass-panel-strong rounded-2xl p-6">
        <h3 className="flex items-center gap-2 text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
          <Plus size={20} /> {t('fm.importTitle')}
        </h3>
        <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>{t('fm.sourceTitle')}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => setSource('upload')}
            className="glass-panel rounded-xl p-4 text-left transition-colors hover:border-neon hover:bg-neon/5"
          >
            <Upload size={20} className="text-neon mb-2" />
            <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              {t('fm.sourceUploadTitle')}
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              {t('fm.sourceUploadDesc')}
            </div>
          </button>
          <button
            onClick={() => setSource('nas')}
            className="glass-panel rounded-xl p-4 text-left transition-colors hover:border-neon hover:bg-neon/5"
          >
            <HardDrive size={20} className="text-neon mb-2" />
            <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              {t('fm.sourceNasTitle')}
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              {t('fm.sourceNasDesc')}
            </div>
            <ChevronRight size={14} className="mt-2" style={{ color: 'var(--text-tertiary)' }} />
          </button>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-ghost px-4 py-2 rounded-lg text-sm">
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
