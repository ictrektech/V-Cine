import { useState, useCallback, useRef, useEffect } from 'react'
import type { FolderNode } from '@/types'
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree as FolderTreeIcon,
  Home,
  Pencil,
  Trash2,
  RefreshCw,
  Copy,
  PanelLeftClose,
} from 'lucide-react'
import clsx from 'clsx'
import ContextMenu from './ContextMenu'
import type { ContextMenuItem } from './ContextMenu'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslation } from '@/i18n'

interface FolderTreeProps {
  tree: FolderNode[]
  loading: boolean
  selectedPath: string
  onSelectFolder: (path: string) => void
  onClearFolder: () => void
  onCreateFolder?: (parentPath: string) => void
  onRenameFolder?: (folderPath: string) => void
  onDeleteFolder?: (folderPath: string) => void
  onRefreshFolder?: () => void
  onCopyPath?: (path: string) => void
  onCollapse?: () => void
}

// 单个树节点
function TreeNode({
  node,
  selectedPath,
  onSelect,
  onContextMenu,
  depth = 0,
  scrollIntoView,
}: {
  node: FolderNode
  selectedPath: string
  onSelect: (path: string) => void
  onContextMenu: (e: React.MouseEvent, node: FolderNode) => void
  depth?: number
  scrollIntoView?: boolean
}) {
  const [expanded, setExpanded] = useState(depth < 1) // 默认展开第一层
  const isSelected = selectedPath === node.path
  const hasChildren = node.children && node.children.length > 0
  const nodeRef = useRef<HTMLDivElement>(null)

  // 选中节点自动滚动到可视区域
  useEffect(() => {
    if (isSelected && scrollIntoView && nodeRef.current) {
      nodeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isSelected, scrollIntoView])

  // 当选中路径是当前节点的子路径时，自动展开
  useEffect(() => {
    if (selectedPath && hasChildren && selectedPath.startsWith(node.path + '/')) {
      setExpanded(true)
    }
  }, [selectedPath, node.path, hasChildren])

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setExpanded(!expanded)
  }, [expanded])

  const handleSelect = useCallback(() => {
    onSelect(node.path)
    if (hasChildren && !expanded) {
      setExpanded(true)
    }
  }, [node.path, onSelect, hasChildren, expanded])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onSelect(node.path)
    onContextMenu(e, node)
  }, [node, onSelect, onContextMenu])

  return (
    <div>
      <div
        ref={nodeRef}
        onClick={handleSelect}
        onContextMenu={handleContextMenu}
        className={clsx(
          'relative flex h-7 items-center gap-1.5 rounded-md px-2 text-sm cursor-pointer transition-colors group',
          isSelected
            ? 'bg-accent text-accent-foreground'
            : 'text-surface-300 hover:bg-accent hover:text-accent-foreground'
        )}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        title={node.path}
      >
        {/* 选中态左侧竖条 */}
        {isSelected && (
          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-neon" />
        )}

        {/* 展开/收起箭头 */}
        {hasChildren ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 flex-shrink-0 rounded"
            onClick={handleToggle}
          >
            <ChevronRight
              size={14}
              className={clsx(
                'text-surface-400 transition-transform duration-200',
                expanded && 'rotate-90'
              )}
            />
          </Button>
        ) : (
          <span className="w-5 flex-shrink-0" />
        )}

        {/* 文件夹图标 */}
        {isSelected || expanded ? (
          <FolderOpen size={16} className={clsx('flex-shrink-0', isSelected ? 'text-neon' : 'text-amber-400/70')} />
        ) : (
          <Folder size={16} className="flex-shrink-0 text-amber-400/50 group-hover:text-amber-400/70" />
        )}

        {/* 文件夹名称 */}
        <span className="truncate flex-1 min-w-0">{node.name}</span>

        {/* 文件数量 */}
        {node.file_count > 0 && (
          <Badge
            variant="outline"
            className={clsx('flex-shrink-0 px-1.5 py-0.5 text-[10px] font-normal', isSelected && 'bg-background/50')}
          >
            {node.file_count}
          </Badge>
        )}
      </div>

      {/* 子节点 - 带展开/收起动画 */}
      {expanded && hasChildren && (
        <div className="animate-slide-down">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              depth={depth + 1}
              scrollIntoView={scrollIntoView}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FolderTree({
  tree,
  loading,
  selectedPath,
  onSelectFolder,
  onClearFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onRefreshFolder,
  onCopyPath,
  onCollapse,
}: FolderTreeProps) {
  const { t } = useTranslation()
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean; x: number; y: number; node: FolderNode | null
  }>({ visible: false, x: 0, y: 0, node: null })

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FolderNode) => {
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, node })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [])

  // 构建右键菜单项
  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    const node = contextMenu.node
    if (!node) return []
    return [
      {
        key: 'create',
        label: t('fm.contextNewFolder'),
        icon: <FolderPlus size={14} />,
        disabled: !onCreateFolder,
        onClick: () => onCreateFolder?.(node.path),
      },
      {
        key: 'rename',
        label: t('common.rename'),
        icon: <Pencil size={14} />,
        disabled: !onRenameFolder,
        onClick: () => onRenameFolder?.(node.path),
      },
      {
        key: 'refresh',
        label: t('fm.refresh'),
        icon: <RefreshCw size={14} />,
        divider: true,
        disabled: !onRefreshFolder,
        onClick: () => onRefreshFolder?.(),
      },
      {
        key: 'copy-path',
        label: t('fm.copyPath'),
        icon: <Copy size={14} />,
        onClick: () => onCopyPath?.(node.path),
      },
      {
        key: 'delete',
        label: t('fm.deleteFolder'),
        icon: <Trash2 size={14} />,
        danger: true,
        divider: true,
        disabled: !onDeleteFolder,
        onClick: () => onDeleteFolder?.(node.path),
      },
    ]
  }, [contextMenu.node, onCreateFolder, onRenameFolder, onDeleteFolder, onRefreshFolder, onCopyPath, t])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 标题栏 */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <FolderTreeIcon size={16} className="text-neon flex-shrink-0" />
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('fm.folderNav')}</span>
        {onRefreshFolder && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-7 w-7 text-surface-400 hover:text-neon"
            onClick={onRefreshFolder}
            title={t('fm.refreshFolderTree')}
            aria-label={t('fm.refreshFolderTree')}
          >
            <RefreshCw size={14} />
          </Button>
        )}
        {onCollapse && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-surface-400 hover:text-neon"
            onClick={onCollapse}
            title={t('fm.collapseFolderPanel')}
            aria-label={t('fm.collapseFolderPanel')}
          >
            <PanelLeftClose size={14} />
          </Button>
        )}
      </div>

      {/* 全部文件按钮 */}
      <div className="flex-shrink-0 px-2 pt-2">
        <Button
          variant={!selectedPath ? 'secondary' : 'ghost'}
          size="sm"
          className={clsx('w-full justify-start gap-2 px-2', !selectedPath ? 'text-neon' : 'text-surface-300 hover:text-surface-100')}
          onClick={onClearFolder}
        >
          <Home size={16} />
          <span>{t('fm.allFiles')}</span>
        </Button>
      </div>

      {/* 树形列表 - 可滚动区域 */}
      <ScrollArea className="flex-1 min-h-0 px-2 py-1">
        {loading ? (
          <div className="space-y-1 px-1 py-2">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                <Skeleton className="h-4 w-4 shrink-0 rounded" />
                <Skeleton className="h-3 flex-1 rounded" />
              </div>
            ))}
          </div>
        ) : tree.length === 0 ? (
          <div className="text-center py-8">
            <Folder size={32} className="mx-auto mb-2 text-surface-600" />
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('fm.noFolders')}</p>
          </div>
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              selectedPath={selectedPath}
              onSelect={onSelectFolder}
              onContextMenu={handleContextMenu}
              scrollIntoView
            />
          ))
        )}
      </ScrollArea>

      {/* 右键菜单 */}
      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        items={getContextMenuItems()}
        onClose={closeContextMenu}
      />
    </div>
  )
}
