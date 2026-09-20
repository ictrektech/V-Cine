import { useState, useCallback } from 'react'
import type { Media } from '@/types'
import {
  CheckSquare,
  Square,
  Film,
  Tv,
  FileVideo,
  Eye,
  Edit3,
  Sparkles,
  Trash2,
  Check,
  AlertCircle,
  FolderOpen,
  Folder,
  Loader2,
  ChevronRight,
  Play,
  Copy,
  FolderPlus,
  Pencil,
  RefreshCw,
} from 'lucide-react'
import clsx from 'clsx'
import { formatFileSize } from './constants'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { streamApi } from '@/api/stream'
import { usePosterVersion } from '@/stores/mediaRefresh'
import Pagination from '@/components/Pagination'
import ContextMenu from './ContextMenu'
import type { ContextMenuItem } from './ContextMenu'

interface FileListViewProps {
  files: Media[]
  loading: boolean
  viewMode: 'table' | 'grid'
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onViewDetail: (media: Media) => void
  onEdit: (media: Media) => void
  onScrape: (id: string) => void
  onDelete: (id: string) => void
  libraries?: { id: string; name: string }[]
  // 分页
  page: number
  totalPages: number
  total: number
  pageSize: number
  pageSizeOptions: number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  // 文件夹导航
  subFolders?: string[]
  currentFolderPath?: string
  onNavigateFolder?: (path: string) => void
  // 右键菜单回调
  onPlayFile?: (media: Media) => void
  onCopyFilePath?: (path: string) => void
  onCreateSubFolder?: (parentPath: string) => void
  onRenameSubFolder?: (folderPath: string) => void
  onDeleteSubFolder?: (folderPath: string) => void
  onRefreshSubFolder?: () => void
  onCopyFolderPath?: (path: string) => void
}

export default function FileListView({
  files, loading, viewMode, selectedIds,
  onToggleSelect, onToggleSelectAll,
  onViewDetail, onEdit, onScrape, onDelete,
  libraries,
  page, totalPages, total, pageSize, pageSizeOptions, onPageChange, onPageSizeChange,
  subFolders, currentFolderPath, onNavigateFolder,
  onPlayFile, onCopyFilePath,
  onCreateSubFolder, onRenameSubFolder, onDeleteSubFolder, onRefreshSubFolder, onCopyFolderPath,
}: FileListViewProps) {
  // 海报版本戳：刮削/替换海报后自动绕过浏览器缓存
  usePosterVersion()
  // 右键菜单状态
  const [ctxMenu, setCtxMenu] = useState<{
    visible: boolean; x: number; y: number;
    type: 'file' | 'folder'; media?: Media; folderPath?: string
  }>({ visible: false, x: 0, y: 0, type: 'file' })

  const closeCtxMenu = useCallback(() => {
    setCtxMenu(prev => ({ ...prev, visible: false }))
  }, [])

  // 来源显示：媒体库名
  const sourceLabel = (file: Media): string => {
    const lib = libraries?.find(l => l.id === file.library_id)
    return lib ? lib.name : '未知'
  }

  // 表格横向滚动时显示固定列（标题/操作）分隔线
  const [tableScrolled, setTableScrolled] = useState(false)
  const handleTableScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setTableScrolled(e.currentTarget.scrollLeft > 0)
  }, [])

  const handleFileContextMenu = useCallback((e: React.MouseEvent, file: Media) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'file', media: file })
  }, [])

  const handleFolderContextMenu = useCallback((e: React.MouseEvent, folderFullPath: string) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'folder', folderPath: folderFullPath })
  }, [])

  // 构建文件右键菜单项
  const getFileMenuItems = useCallback((): ContextMenuItem[] => {
    const file = ctxMenu.media
    if (!file) return []
    return [
      {
        key: 'play',
        label: '播放/预览',
        icon: <Play size={14} />,
        onClick: () => onPlayFile?.(file) || onViewDetail(file),
      },
      {
        key: 'detail',
        label: '查看详情',
        icon: <Eye size={14} />,
        onClick: () => onViewDetail(file),
      },
      {
        key: 'edit',
        label: '编辑信息',
        icon: <Edit3 size={14} />,
        divider: true,
        onClick: () => onEdit(file),
      },
      {
        key: 'scrape',
        label: '重新刮削',
        icon: <Sparkles size={14} />,
        onClick: () => onScrape(file.id),
      },
      {
        key: 'copy-path',
        label: '复制文件路径',
        icon: <Copy size={14} />,
        divider: true,
        onClick: () => onCopyFilePath?.(file.file_path),
      },
      {
        key: 'delete',
        label: '删除文件',
        icon: <Trash2 size={14} />,
        danger: true,
        divider: true,
        onClick: () => onDelete(file.id),
      },
    ]
  }, [ctxMenu.media, onPlayFile, onViewDetail, onEdit, onScrape, onDelete, onCopyFilePath])

  // 构建子文件夹右键菜单项
  const getFolderMenuItems = useCallback((): ContextMenuItem[] => {
    const fp = ctxMenu.folderPath
    if (!fp) return []
    return [
      {
        key: 'open',
        label: '打开文件夹',
        icon: <FolderOpen size={14} />,
        onClick: () => onNavigateFolder?.(fp),
      },
      {
        key: 'create',
        label: '新建子文件夹',
        icon: <FolderPlus size={14} />,
        divider: true,
        disabled: !onCreateSubFolder,
        onClick: () => onCreateSubFolder?.(fp),
      },
      {
        key: 'rename',
        label: '重命名',
        icon: <Pencil size={14} />,
        disabled: !onRenameSubFolder,
        onClick: () => onRenameSubFolder?.(fp),
      },
      {
        key: 'refresh',
        label: '刷新',
        icon: <RefreshCw size={14} />,
        divider: true,
        disabled: !onRefreshSubFolder,
        onClick: () => onRefreshSubFolder?.(),
      },
      {
        key: 'copy-path',
        label: '复制路径',
        icon: <Copy size={14} />,
        onClick: () => onCopyFolderPath?.(fp),
      },
      {
        key: 'delete',
        label: '删除文件夹',
        icon: <Trash2 size={14} />,
        danger: true,
        divider: true,
        disabled: !onDeleteSubFolder,
        onClick: () => onDeleteSubFolder?.(fp),
      },
    ]
  }, [ctxMenu.folderPath, onNavigateFolder, onCreateSubFolder, onRenameSubFolder, onDeleteSubFolder, onRefreshSubFolder, onCopyFolderPath])
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-neon" />
      </div>
    )
  }

  const hasSubFolders = subFolders && subFolders.length > 0

  if (files.length === 0 && !hasSubFolders) {
    return (
      <div className="p-12 text-center">
        <FolderOpen size={48} className="mx-auto mb-4 text-surface-500" />
        <p className="text-lg font-medium" style={{ color: 'var(--text-secondary)' }}>暂无影视文件</p>
        <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>点击"导入文件"开始添加，或为媒体库添加路径后扫描</p>
      </div>
    )
  }

  const isScraped = (file: Media) => {
    const st = file.scrape_status
    if (st === 'scraped' || st === 'partial' || st === 'manual') return true
    // 兼容旧数据（旧版记录无 scrape_status）：任一ID存在也视为已刮削
    if (!st) return file.tmdb_id > 0 || file.bangumi_id > 0 || (file.douban_id && file.douban_id !== '')
    return false
  }

  // 渲染刮削状态徽章（三态：已刮削 / 部分 / 失败 / 未刮削）
  const renderScrapeBadge = (file: Media, size: 'sm' | 'md' = 'md') => {
    const st = file.scrape_status
    const cls = size === 'sm'
      ? 'text-[10px] px-1.5 py-0.5 rounded border-transparent text-white'
      : 'gap-1 text-xs border-transparent'
    if (st === 'partial') {
      return <Badge variant="outline" className={clsx(cls, size === 'sm' ? 'bg-orange-500/80' : 'bg-orange-500/10 text-orange-400')}>
        {size === 'sm' ? '部分刮削' : <><AlertCircle size={12} /> 部分刮削</>}
      </Badge>
    }
    if (st === 'failed') {
      return <Badge variant="outline" className={clsx(cls, size === 'sm' ? 'bg-red-500/80' : 'bg-red-500/10 text-red-400')}>
        {size === 'sm' ? '刮削失败' : <><AlertCircle size={12} /> 刮削失败</>}
      </Badge>
    }
    if (st === 'manual') {
      return <Badge variant="outline" className={clsx(cls, size === 'sm' ? 'bg-blue-500/80' : 'bg-blue-500/10 text-blue-400')}>
        {size === 'sm' ? '手动锁定' : <><Check size={12} /> 手动锁定</>}
      </Badge>
    }
    if (isScraped(file)) {
      return <Badge variant="outline" className={clsx(cls, size === 'sm' ? 'bg-green-500/80' : 'bg-green-500/10 text-green-400')}>
        {size === 'sm' ? '已刮削' : <><Check size={12} /> 已刮削</>}
      </Badge>
    }
    return <Badge variant="outline" className={clsx(cls, size === 'sm' ? 'bg-amber-500/80' : 'bg-amber-500/10 text-amber-400')}>
      {size === 'sm' ? '未刮削' : <><AlertCircle size={12} /> 未刮削</>}
    </Badge>
  }

  // 子文件夹卡片区域
  const SubFolderCards = () => {
    if (!hasSubFolders || !onNavigateFolder || !currentFolderPath) return null
    const normalizedCurrent = currentFolderPath.replace(/\\/g, '/')
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2 mb-4">
        {subFolders!.map(folder => (
          <button
            key={folder}
            onClick={() => {
              const sep = normalizedCurrent.endsWith('/') ? '' : '/'
              onNavigateFolder(normalizedCurrent + sep + folder)
            }}
            onContextMenu={(e) => {
              const sep = normalizedCurrent.endsWith('/') ? '' : '/'
              handleFolderContextMenu(e, normalizedCurrent + sep + folder)
            }}
            className="glass-panel rounded-lg p-3 flex items-center gap-2 hover:bg-white/[0.04] transition-colors text-left group"
          >
            <Folder size={20} className="text-amber-400/70 flex-shrink-0 group-hover:text-amber-400" />
            <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{folder}</span>
            <ChevronRight size={14} className="text-surface-500 flex-shrink-0 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>
    )
  }

  return (
    <>
      {/* 子文件夹 */}
      <SubFolderCards />

      {files.length === 0 ? (
        /* 当前文件夹下无直接文件（但有子文件夹） */
        <div className="p-8 text-center">
          <FolderOpen size={36} className="mx-auto mb-3 text-surface-500" />
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>当前文件夹下无直接文件，请浏览子文件夹</p>
        </div>
      ) : viewMode === 'table' ? (
        /* 表格视图。无强制 min-width：列宽由内容撑起，操作列 sticky right，小屏不产生滚动空白；
           @container 阈值 660 = 固定列 ~456 + 中间最小 ~200，低于只留两端（档位见 tailwind.config.js） */
        <div className="@container overflow-x-auto" onScroll={handleTableScroll}>
          <table className="w-full text-sm whitespace-nowrap">
            <TableHeader>
              <TableRow className="border-b" style={{ borderColor: 'var(--border-default)' }}>
                <TableHead className="sticky left-0 top-0 z-30 w-10 px-2.5 py-2 text-left" style={{ background: 'var(--bg-surface)' }}>
                  <button onClick={onToggleSelectAll}>
                    {selectedIds.size === files.length ? <CheckSquare size={16} className="text-neon" /> : <Square size={16} className="text-surface-500" />}
                  </button>
                </TableHead>
                <TableHead className="sticky left-10 top-0 z-30 px-2.5 py-2 text-left" style={{ color: 'var(--text-secondary)', background: 'var(--bg-surface)', boxShadow: tableScrolled ? 'inset -1px 0 0 var(--border-strong)' : 'none' }}>标题</TableHead>
                <TableHead className="sticky top-0 z-20 hidden px-2.5 py-2 text-left @660:table-cell" style={{ color: 'var(--text-secondary)', background: 'var(--bg-surface)' }}>类型</TableHead>
                <TableHead className="sticky top-0 z-20 hidden px-2.5 py-2 text-left @660:table-cell" style={{ color: 'var(--text-secondary)', background: 'var(--bg-surface)' }}>年份</TableHead>
                <TableHead className="sticky top-0 z-20 hidden px-2.5 py-2 text-left @660:table-cell" style={{ color: 'var(--text-secondary)', background: 'var(--bg-surface)' }}>评分</TableHead>
                <TableHead className="sticky top-0 z-20 hidden px-2.5 py-2 text-left @660:table-cell" style={{ color: 'var(--text-secondary)', background: 'var(--bg-surface)' }}>大小</TableHead>
                <TableHead className="sticky top-0 z-20 hidden px-2.5 py-2 text-left @660:table-cell" style={{ color: 'var(--text-secondary)', background: 'var(--bg-surface)' }}>来源</TableHead>
                <TableHead className="sticky top-0 z-20 hidden px-2.5 py-2 text-left @660:table-cell" style={{ color: 'var(--text-secondary)', background: 'var(--bg-surface)' }}>状态</TableHead>
                <TableHead className="sticky top-0 right-0 z-30 px-2.5 py-2 text-right" style={{ color: 'var(--text-secondary)', background: 'var(--bg-surface)', boxShadow: tableScrolled ? 'inset 1px 0 0 var(--border-strong)' : 'none' }}>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map(file => (
                <TableRow
                  key={file.id}
                  className="border-b hover:bg-white/[0.02]"
                  style={{ borderColor: 'var(--border-default)' }}
                  onContextMenu={(e) => handleFileContextMenu(e, file)}
                >
                  <TableCell className="sticky left-0 z-10 px-2.5 py-2" style={{ background: 'var(--bg-surface)' }}>
                    <button onClick={() => onToggleSelect(file.id)}>
                      {selectedIds.has(file.id) ? <CheckSquare size={16} className="text-neon" /> : <Square size={16} className="text-surface-500" />}
                    </button>
                  </TableCell>
                  <TableCell className="sticky left-10 z-10 max-w-[160px] md:max-w-[280px] px-2.5 py-2" style={{ background: 'var(--bg-surface)', boxShadow: tableScrolled ? 'inset -1px 0 0 var(--border-strong)' : 'none' }}>
                    <div className="flex items-center gap-3">
                      <img
                        src={streamApi.getPosterUrl(file.id)}
                        alt=""
                        className="w-8 h-12 rounded object-cover flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden') }}
                      />
                      <div className="w-8 h-12 rounded bg-surface-800 items-center justify-center flex-shrink-0 hidden">
                        <FileVideo size={16} className="text-surface-500" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate" style={{ color: 'var(--text-primary)' }} title={file.title}>
                            {file.title}
                          </span>
                          {file.media_type === 'episode' && file.episode_num > 0 && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-neon-blue/10 text-neon-blue">
                              {file.season_num > 0 ? `S${String(file.season_num).padStart(2, '0')}E${String(file.episode_num).padStart(2, '0')}` : `EP${String(file.episode_num).padStart(2, '0')}`}
                            </span>
                          )}
                        </div>
                        {file.media_type === 'episode' && file.episode_title ? (
                          <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>{file.episode_title}</div>
                        ) : file.orig_title && file.orig_title !== file.title ? (
                          <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{file.orig_title}</div>
                        ) : null}
                        <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {file.file_path.split(/[\\/]/).pop()}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden px-2.5 py-2 @660:table-cell">
                    <Badge variant="outline" className={clsx('gap-1 rounded-full border-transparent text-xs',
                      file.media_type === 'movie' ? 'bg-purple-500/10 text-purple-400' : 'bg-green-500/10 text-green-400'
                    )}>
                      {file.media_type === 'movie' ? <Film size={12} /> : <Tv size={12} />}
                      {file.media_type === 'movie' ? '电影' : '剧集'}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden px-2.5 py-2 @660:table-cell" style={{ color: 'var(--text-secondary)' }}>
                    {file.year || '-'}
                  </TableCell>
                  <TableCell className="hidden px-2.5 py-2 @660:table-cell">
                    {file.rating > 0 ? (
                      <span className="text-amber-400">★ {file.rating.toFixed(1)}</span>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)' }}>-</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden px-2.5 py-2 @660:table-cell" style={{ color: 'var(--text-secondary)' }}>
                    {file.file_size > 0 ? formatFileSize(file.file_size) : '-'}
                  </TableCell>
                  <TableCell className="hidden px-2.5 py-2 @660:table-cell">
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{sourceLabel(file)}</span>
                  </TableCell>
                  <TableCell className="hidden px-2.5 py-2 @660:table-cell">
                    {renderScrapeBadge(file, 'md')}
                  </TableCell>
                  <TableCell className="sticky right-0 z-10 px-2.5 py-2 text-right" style={{ background: 'var(--bg-surface)', boxShadow: tableScrolled ? 'inset 1px 0 0 var(--border-strong)' : 'none' }}>
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => onViewDetail(file)}
                        className="p-1.5 rounded hover:bg-white/5 text-surface-400 hover:text-blue-400" title="查看详情">
                        <Eye size={14} />
                      </button>
                      <button onClick={() => onEdit(file)}
                        className="hidden md:inline-flex p-1.5 rounded hover:bg-white/5 text-surface-400 hover:text-amber-400" title="编辑">
                        <Edit3 size={14} />
                      </button>
                      <button onClick={() => onScrape(file.id)}
                        className="hidden md:inline-flex p-1.5 rounded hover:bg-white/5 text-surface-400 hover:text-purple-400" title="刮削">
                        <Sparkles size={14} />
                      </button>
                      <button onClick={() => onDelete(file.id)}
                        className="p-1.5 rounded hover:bg-white/5 text-surface-400 hover:text-red-400" title="删除">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      ) : (
        /* 网格视图 */
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {files.map(file => (
            <Card key={file.id} className="group relative cursor-pointer overflow-hidden"
              onClick={() => onViewDetail(file)}
              onContextMenu={(e) => handleFileContextMenu(e, file)}
            >
              {/* 选择框 */}
              <button className="absolute top-2 left-2 z-10" onClick={e => { e.stopPropagation(); onToggleSelect(file.id) }}>
                {selectedIds.has(file.id) ? <CheckSquare size={18} className="text-neon" /> : <Square size={18} className="text-white/50 group-hover:text-white/80" />}
              </button>
              {/* 海报 */}
              <div className="aspect-[2/3] bg-surface-800 relative">
                <img
                  src={streamApi.getPosterUrl(file.id)}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
                {/* 状态标签 */}
                <div className="absolute top-2 right-2">
                  {renderScrapeBadge(file, 'sm')}
                </div>
                {/* 悬浮操作 */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button onClick={e => { e.stopPropagation(); onEdit(file) }}
                    className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white" title="编辑">
                    <Edit3 size={16} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); onScrape(file.id) }}
                    className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white" title="刮削">
                    <Sparkles size={16} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); onDelete(file.id) }}
                    className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white" title="删除">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {/* 信息 */}
              <CardContent className="p-2.5">
                <div className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                  {file.title}
                  {file.media_type === 'episode' && file.episode_num > 0 && (
                    <span className="ml-1 text-[10px] font-medium text-neon-blue">
                      {file.season_num > 0 ? `S${String(file.season_num).padStart(2, '0')}E${String(file.episode_num).padStart(2, '0')}` : `EP${String(file.episode_num).padStart(2, '0')}`}
                    </span>
                  )}
                </div>
                {file.media_type === 'episode' && file.episode_title && (
                  <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>{file.episode_title}</div>
                )}
                <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  <span>{file.year || '-'}</span>
                  {file.rating > 0 && <span className="text-amber-400">★ {file.rating.toFixed(1)}</span>}
                  <span className={file.media_type === 'movie' ? 'text-purple-400' : 'text-green-400'}>
                    {file.media_type === 'movie' ? '电影' : '剧集'}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 分页 */}
      {files.length > 0 && (
        <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        pageSizeOptions={pageSizeOptions}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        showTotal
        showJumper
      />
      )}

      {/* 右键菜单 */}
      <ContextMenu
        visible={ctxMenu.visible}
        x={ctxMenu.x}
        y={ctxMenu.y}
        items={ctxMenu.type === 'file' ? getFileMenuItems() : getFolderMenuItems()}
        onClose={closeCtxMenu}
      />
    </>
  )
}
