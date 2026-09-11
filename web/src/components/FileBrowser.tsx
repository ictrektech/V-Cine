import { useState, useEffect, useCallback } from 'react'
import { adminApi, storageApi } from '@/api'
import type { StorageType } from '@/lib/storageSchemes'
import { cn } from '@/lib/utils'
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronUp,
  X,
  Loader2,
  Check,
  HardDrive,
  FileVideo,
} from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { formatFileSize } from '@/components/file-manager/constants'

interface FsEntry {
  name: string
  path: string
  is_dir?: boolean
  size?: number
}

// 静态快捷入口：主媒体库
const MEDIA_ENTRY = { path: '/media', name: '主媒体库', desc: '安装时选择的媒体库目录' }

// 快捷入口条目
interface QuickEntry {
  path: string
  name: string
  desc: string
}

interface FileBrowserProps {
  open: boolean
  onClose: () => void
  onSelect: (path: string) => void
  initialPath?: string
  storageType?: StorageType
  /** 'dir'（默认，目录选择）；'file'（选择文件，文件条目可选中） */
  selectMode?: 'dir' | 'file'
  /** selectMode='file' 时按扩展名过滤（如 ['.mp4', '.mkv']），空则不过滤 */
  fileExtensions?: string[]
}

export default function FileBrowser({ open, onClose, onSelect, initialPath, storageType = 'local', selectMode = 'dir', fileExtensions }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || '/')
  const [parentPath, setParentPath] = useState('')
  const [items, setItems] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [quickEntries, setQuickEntries] = useState<QuickEntry[]>([])
  // 文件模式下选中的文件路径（空串表示未选中）
  const [selectedFile, setSelectedFile] = useState('')

  const isFileMode = selectMode === 'file'
  const extSet = fileExtensions && fileExtensions.length > 0 ? new Set(fileExtensions.map(e => e.toLowerCase())) : null

  const browse = useCallback(async (path: string) => {
    setLoading(true)
    setError('')
    try {
      const res = storageType === 'local'
        ? await adminApi.browseFS(path, isFileMode)
        : await storageApi.browseRemote(storageType, path)
      const data = res.data.data
      setCurrentPath(data.current)
      setParentPath(data.parent)
      setItems(data.items || [])
    } catch {
      setError('无法访问该目录，请检查路径是否存在及权限')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [storageType, isFileMode])

  // 构建快捷入口（仅本地模式）：/media + 枚举 /exposed/volumes/<工作区> 下的
  // public（公共目录）/ users（用户数据）子目录，探测存在性。
  // 失败静默隐藏；未指定初始路径时，自动落到第一个存在的快捷入口。
  useEffect(() => {
    if (!open) return
    if (storageType !== 'local') {
      browse(initialPath || '/')
      return
    }
    // 竞态保护：关闭/重新打开时丢弃未完成的旧请求结果
    let cancelled = false
    const probe = async (path: string): Promise<boolean> => {
      try {
        await adminApi.browseFS(path)
        return true
      } catch {
        return false
      }
    }
    ;(async () => {
      const entries: QuickEntry[] = []
      if (await probe(MEDIA_ENTRY.path)) {
        entries.push(MEDIA_ENTRY)
      }
      if (cancelled) return
      let workspaces: FsEntry[] = []
      try {
        const res = await adminApi.browseFS('/exposed/volumes')
        workspaces = res.data.data.items || []
      } catch {
        // /exposed 不存在（独立部署）→ 无工作区入口
      }
      if (cancelled) return
      // 各工作区独立并行探测；先收集到各自数组再按工作区顺序组装，保证 entries 顺序确定
      const wsEntries = await Promise.all(
        workspaces.map(async (ws) => {
          const found: QuickEntry[] = []
          if (await probe(`${ws.path}/public`)) {
            found.push({ path: `${ws.path}/public`, name: '公共目录', desc: `授权的公共目录（${ws.name}）` })
          }
          // 用户数据：<工作区>/users/<用户名>/data，枚举用户
          try {
            const usersRes = await adminApi.browseFS(`${ws.path}/users`)
            const users = usersRes.data.data.items || []
            const userEntries = await Promise.all(
              users.map(async (u) => {
                const dataPath = `${ws.path}/users/${u.name}/data`
                if (await probe(dataPath)) {
                  return { path: dataPath, name: `用户数据（${u.name}）`, desc: '授权的用户私人数据目录' }
                }
                return null
              })
            )
            for (const e of userEntries) {
              if (e) found.push(e)
            }
          } catch {
            // users 子目录不存在 → 静默隐藏
          }
          return found
        })
      )
      for (const found of wsEntries) {
        entries.push(...found)
      }
      if (cancelled) return
      setQuickEntries(entries)
      // 落点：指定了初始路径则用它，否则第一个快捷入口，再否则根目录
      const target = initialPath && initialPath !== '/'
        ? initialPath
        : entries[0]?.path || '/'
      browse(target)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storageType, initialPath])

  // ESC 关闭
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <Modal onClose={onClose} className="max-w-lg">
      <div
        className="rounded-2xl overflow-hidden animate-slide-up"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow-elevated), var(--modal-panel-glow)',
          backdropFilter: 'blur(30px)',
          maxHeight: '80vh',
        }}
      >
        {/* 顶部霓虹光条 */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px] z-10"
          style={{
            background: 'linear-gradient(90deg, transparent, var(--neon-blue), var(--neon-purple), transparent)',
          }}
        />

        {/* 头部 */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2
            className="font-display text-base font-bold tracking-wide"
            style={{ color: 'var(--text-primary)' }}
          >
            {isFileMode ? '选择服务器文件' : '选择文件夹'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition-all hover:bg-[var(--nav-hover-bg)]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* 当前路径栏 */}
        <div className="mx-5 mb-3 flex items-center gap-2 rounded-lg px-3 py-2"
          style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)' }}
        >
          <HardDrive size={14} className="flex-shrink-0 text-neon/60" />
          <span
            className="flex-1 truncate text-sm font-mono"
            style={{ color: 'var(--text-primary)' }}
          >
            {currentPath}
          </span>
        </div>

        {/* 目录列表 */}
        <div className="mx-5 overflow-y-auto" style={{ maxHeight: 'calc(80vh - 200px)' }}>
          {/* 快捷入口：/media 与授权目录（存在时显示，仅本地模式） */}
          {storageType === 'local' && quickEntries.length > 0 && (
            <div className="mb-3">
              <div className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
                快捷入口
              </div>
              <div className="space-y-1">
                {quickEntries.map((entry) => {
                  const isActive = entry.path === currentPath
                  return (
                    <button
                      key={entry.path}
                      onClick={() => browse(entry.path)}
                      className={cn(
                        'group flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                        isActive
                          ? 'border-primary bg-accent text-accent-foreground'
                          : 'border-input hover:bg-accent hover:text-accent-foreground'
                      )}
                    >
                      <FolderOpen size={16} className={cn('flex-shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{entry.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{entry.desc}</div>
                      </div>
                      <ChevronRight size={14} className={cn('flex-shrink-0 transition-opacity', isActive ? 'text-primary opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-100')} />
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 上级目录 */}
          {parentPath && (
            <button
              onClick={() => browse(parentPath)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--nav-hover-bg)]"
            >
              <ChevronUp size={16} className="text-neon/60" />
              <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                上级目录
              </span>
            </button>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-neon/40" />
            </div>
          )}

          {error && (
            <div className="rounded-lg px-4 py-3 text-sm" style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.15)',
              color: '#EF4444',
            }}>
              {error}
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="py-12 text-center">
              <Folder size={32} className="mx-auto mb-2 text-surface-600" />
              <p className="text-sm text-surface-500">此目录下没有子文件夹</p>
            </div>
          )}

          {!loading && items.map((item) => {
            const isDir = item.is_dir !== false
            if (!isDir && extSet && !extSet.has(item.name.slice(item.name.lastIndexOf('.')).toLowerCase())) {
              return null
            }
            const selected = !isDir && selectedFile === item.path
            return (
              <button
                key={item.path}
                onClick={() => {
                  if (isDir) {
                    browse(item.path)
                  } else {
                    setSelectedFile(selected ? '' : item.path)
                  }
                }}
                className={cn(
                  'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--nav-hover-bg)]',
                  selected && 'border border-primary bg-accent'
                )}
              >
                {isDir
                  ? <FolderOpen size={16} className="flex-shrink-0 text-amber-400/70 transition-colors group-hover:text-amber-400" />
                  : <FileVideo size={16} className="flex-shrink-0 text-neon/70" />}
                <span className="flex-1 truncate text-sm" style={{ color: 'var(--text-primary)' }}>
                  {item.name}
                </span>
                {!isDir && item.size != null && item.size > 0 && (
                  <span className="flex-shrink-0 text-xs text-muted-foreground">{formatFileSize(item.size)}</span>
                )}
                {isDir && <ChevronRight size={14} className="flex-shrink-0 text-surface-600 opacity-0 transition-opacity group-hover:opacity-100" />}
                {selected && <Check size={14} className="flex-shrink-0 text-primary" />}
              </button>
            )
          })}
        </div>

        {/* 底部操作栏 */}
        <div
          className="flex items-center justify-between gap-3 px-5 py-4 mt-2"
          style={{
            borderTop: '1px solid var(--border-default)',
          }}
        >
          <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
            {isFileMode
              ? (selectedFile ? `已选择: ${selectedFile}` : '未选择文件')
              : (() => {
                const hit = quickEntries.find(e => e.path === currentPath)
                return hit ? `已选择: ${hit.name}（${currentPath}）` : `已选择: ${currentPath}`
              })()}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium transition-all"
              style={{
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-default)',
              }}
            >
              取消
            </button>
            <button
              onClick={() => {
                if (isFileMode) {
                  if (selectedFile) {
                    onSelect(selectedFile)
                    onClose()
                  }
                  return
                }
                const selected = storageType === 'local' ? currentPath : currentPath.replace(/^\//, '') || '/'
                onSelect(selected)
                onClose()
              }}
              disabled={isFileMode && !selectedFile}
              className="btn-primary gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
            >
              <Check size={14} />
              {isFileMode ? '选择此文件' : '选择此文件夹'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
