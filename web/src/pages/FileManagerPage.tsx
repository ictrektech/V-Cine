import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Media, Library, FileManagerStats, FolderNode } from '@/types'
import type { VideoAnalysisBatchIssue, VideoAnalysisBatchResult } from '@/types/videoAnalysis'
import { aiApi, fileManagerApi, libraryApi, videoAnalysisApi } from '@/api'
import { useToast } from '@/components/Toast'
import { useDialog } from '@/components/Dialog'
import AIAssistant, { AIAssistantButton, AIAssistantPanel } from '@/components/AIAssistant'
import ScrapeManagerPage from '@/pages/ScrapeManagerPage'
import LibraryManager from '@/components/LibraryManager'
import { useScanProgress } from '@/hooks/useScanProgress'
import AdultScraperSection from '@/components/admin/AdultScraperTab'
import AdultScraperProSection from '@/components/admin/AdultScraperPro'
import STRMConfigSection from '@/components/admin/STRMConfigSection'
import VideoAnalysisTaskTab from '@/components/video-analysis/VideoAnalysisTaskTab'
import { useWebSocket } from '@/hooks/useWebSocket'
import { bumpPosterVersion } from '@/stores/mediaRefresh'
import {
  FolderOpen,
  Globe,
  RefreshCw,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldAlert,
  ScanLine,
  Library as LibraryIcon,
} from 'lucide-react'
import clsx from 'clsx'

// 导入拆分后的子组件
import {
  FileStatsBar,
  FileToolbar,
  FileListView,
  FolderTree,
  Breadcrumb,
  ImportFileModal,
  ScanDirectoryModal,
  EditFileModal,
  FileDetailModal,
  RenameModal,
  BatchAnalyzeModal,
  OperationLogsModal,
} from '@/components/file-manager'
import type { TabType, DialogType } from '@/components/file-manager'

// 文件夹操作弹窗类型
type FolderDialogType = 'none' | 'createFolder' | 'renameFolder' | 'deleteFolder'

export default function FileManagerPage() {
  const toast = useToast()
  const dialog = useDialog()
  const { on, off } = useWebSocket()
  const [searchParams, setSearchParams] = useSearchParams()

  // Tab 状态（支持从URL参数读取，如 /files?tab=scrape&tab=adult）
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const tab = searchParams.get('tab')
    if (tab === 'library') return 'library'
    if (tab === 'scrape') return 'scrape'
    if (tab === 'analysis') return 'analysis'
    if (tab === 'adult') return 'adult'
    return 'files'
  })

  // 切换Tab时同步URL参数
  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab)
    if (tab === 'files') {
      searchParams.delete('tab')
    } else {
      searchParams.set('tab', tab)
    }
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams])

  // 数据状态
  const [files, setFiles] = useState<Media[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<FileManagerStats | null>(null)
  const [libraries, setLibraries] = useState<Library[]>([])

  // 筛选
  const [keyword, setKeyword] = useState('')
  const [filterLibrary, setFilterLibrary] = useState('')
  const [filterMediaType, setFilterMediaType] = useState('')
  const [filterScraped, setFilterScraped] = useState('')
  const [sortBy, setSortBy] = useState('created_at')
  const [sortOrder, setSortOrder] = useState('desc')
  const [showFilters, setShowFilters] = useState(false)

  // 选择
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // 视图模式
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table')

  // 文件夹导航
  const [folderTree, setFolderTree] = useState<FolderNode[]>([])
  const [folderTreeLoading, setFolderTreeLoading] = useState(false)
  const [currentFolderPath, setCurrentFolderPath] = useState('')
  const [subFolders, setSubFolders] = useState<string[]>([])
  const [showFolderPanel, setShowFolderPanel] = useState(true)

  // 文件夹操作弹窗状态
  const [folderDialog, setFolderDialog] = useState<FolderDialogType>('none')
  const [folderDialogTarget, setFolderDialogTarget] = useState('') // 目标文件夹路径
  const [folderInputValue, setFolderInputValue] = useState('')

  // AI 助手面板状态
  const [showAIPanel, setShowAIPanel] = useState(false)

  // 对话框状态
  const [activeDialog, setActiveDialog] = useState<DialogType>('none')

  // 编辑/详情弹窗的目标媒体
  const [editMedia, setEditMedia] = useState<Media | null>(null)
  const [detailMedia, setDetailMedia] = useState<Media | null>(null)

  // 刮削源
  const [scrapeSource, setScrapeSource] = useState('')
  const [videoAnalysisEnabled, setVideoAnalysisEnabled] = useState(true)
  const [videoAnalysisDisabledReason, setVideoAnalysisDisabledReason] = useState('')
  const [videoAnalysisDescribeEnabled, setVideoAnalysisDescribeEnabled] = useState(false)

  // ==================== 数据加载 ====================

  const fetchFiles = useCallback(async () => {
    setLoading(true)
    try {
      if (currentFolderPath) {
        // 文件夹模式：按路径查询
        const res = await fileManagerApi.listFilesByFolder({
          path: currentFolderPath,
          page, size: pageSize, library_id: filterLibrary,
          media_type: filterMediaType, keyword,
          sort_by: sortBy, sort_order: sortOrder,
          scraped: filterScraped,
        })
        setFiles(res.data.data || [])
        setTotal(res.data.total)
        setSubFolders(res.data.sub_folders || [])
      } else {
        // 全局模式：原有平铺列表
        const res = await fileManagerApi.listFiles({
          page, size: pageSize, library_id: filterLibrary,
          media_type: filterMediaType, keyword,
          sort_by: sortBy, sort_order: sortOrder,
          scraped: filterScraped,
        })
        setFiles(res.data.data || [])
        setTotal(res.data.total)
        setSubFolders([])
      }
    } catch {
      toast.error('获取文件列表失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, filterLibrary, filterMediaType, keyword, sortBy, sortOrder, filterScraped, currentFolderPath])

  const fetchStats = useCallback(async () => {
    try {
      // 作用域化：按当前筛选的媒体库/文件夹范围统计，和列表结果对齐
      const res = await fileManagerApi.getStats({
        library_id: filterLibrary || undefined,
        folder_path: currentFolderPath || undefined,
      })
      setStats(res.data.data)
    } catch { /* ignore */ }
  }, [filterLibrary, currentFolderPath])

  const fetchLibraries = useCallback(async () => {
    try {
      const res = await libraryApi.list()
      setLibraries(res.data.data || [])
    } catch { /* ignore */ }
  }, [])

  // 扫描/刮削实时进度（媒体库管理页共用）
  const { scanning, setScanning, scanProgress, scrapeProgress, scanPhase } = useScanProgress(on, off, fetchLibraries)

  const fetchFolderTree = useCallback(async () => {
    setFolderTreeLoading(true)
    try {
      const res = await fileManagerApi.getFolderTree(filterLibrary || undefined)
      setFolderTree(res.data.data || [])
    } catch { /* ignore */ }
    finally { setFolderTreeLoading(false) }
  }, [filterLibrary])

  const checkVideoAnalysisAvailability = useCallback(async () => {
    try {
      await videoAnalysisApi.statistics()
      setVideoAnalysisEnabled(true)
      setVideoAnalysisDisabledReason('')
      // 获取配置信息（独立错误处理，不影响主功能）
      // 优先从视频分析服务读取，失败时从 AI 状态读取（用户可能在管理页刚更新）
      try {
        const configRes = await videoAnalysisApi.getConfig()
        setVideoAnalysisDescribeEnabled(configRes.data.data.describe_enabled)
      } catch {
        try {
          const statusRes = await aiApi.getStatus()
          setVideoAnalysisDescribeEnabled(statusRes.data.data.describe_enabled ?? false)
        } catch { /* 保持默认值 false */ }
      }
    } catch (err: any) {
      if (err?.response?.status === 503) {
        setVideoAnalysisEnabled(false)
        setVideoAnalysisDisabledReason(err?.response?.data?.error || '视频分析服务未启用或配置无效')
        return
      }
      setVideoAnalysisEnabled(true)
      setVideoAnalysisDisabledReason('')
    }
  }, [])

  useEffect(() => { fetchFiles() }, [fetchFiles])
  useEffect(() => { fetchStats(); fetchLibraries(); checkVideoAnalysisAvailability() }, [fetchStats, fetchLibraries, checkVideoAnalysisAvailability])
  useEffect(() => { fetchFolderTree() }, [fetchFolderTree])

  // 页面可见性变化时重新检查视频分析配置（用户从管理页切回后自动刷新）
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkVideoAnalysisAvailability()
      }
    }
    const handleFocus = () => checkVideoAnalysisAvailability()
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleFocus)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleFocus)
    }
  }, [checkVideoAnalysisAvailability])

  // WebSocket 实时更新
  useEffect(() => {
    // 基础刷新：重拉列表 + 统计
    const handleUpdate = () => { fetchFiles(); fetchStats() }
    // 全局刷新：刷文件列表 + 统计 + 文件夹树
    const handleGlobalUpdate = () => { fetchFiles(); fetchStats(); fetchFolderTree() }
    // 刮削完成：刷全局海报版本（触发所有 MediaCard 重新取图）+ 重拉列表
    const handleScrapeCompleted = () => {
      bumpPosterVersion()
      fetchFiles()
      fetchStats()
    }

    on('file_imported', handleUpdate)
    on('file_deleted', handleUpdate)
    on('batch_rename_complete', handleUpdate)
    on('file_scrape_progress', handleUpdate)
    // 新增的关键事件订阅：扫描/刮削/媒体库/批量刮削
    on('scan_completed', handleGlobalUpdate)
    on('scan_phase', handleUpdate)
    on('scrape_completed', handleScrapeCompleted)
    on('library_updated', handleGlobalUpdate)
    on('adult_batch_completed', handleGlobalUpdate)
    on('folder_renamed', handleGlobalUpdate)
    on('folder_deleted', handleGlobalUpdate)

    return () => {
      off('file_imported', handleUpdate)
      off('file_deleted', handleUpdate)
      off('batch_rename_complete', handleUpdate)
      off('file_scrape_progress', handleUpdate)
      off('scan_completed', handleGlobalUpdate)
      off('scan_phase', handleUpdate)
      off('scrape_completed', handleScrapeCompleted)
      off('library_updated', handleGlobalUpdate)
      off('adult_batch_completed', handleGlobalUpdate)
      off('folder_renamed', handleGlobalUpdate)
      off('folder_deleted', handleGlobalUpdate)
    }
  }, [on, off, fetchFiles, fetchStats, fetchFolderTree])

  // ==================== 选择操作 ====================

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds(prev => prev.size === files.length ? new Set() : new Set(files.map(f => f.id)))
  }

  // ==================== 操作 ====================

  const handleDeleteFile = async (id: string) => {
    const ok = await dialog.confirm({
      title: '删除文件记录',
      message: '确定要删除此文件记录吗？（原始文件不会被删除）',
      confirmText: '删除',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await fileManagerApi.deleteFile(id)
      toast.success('文件记录已删除')
      setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n })
      fetchFiles(); fetchStats()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || '删除失败')
    }
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    const ok = await dialog.confirm({
      title: '批量删除文件记录',
      message: `确定要删除选中的 ${selectedIds.size} 个文件记录吗？（原始文件不会被删除）`,
      confirmText: '删除',
      variant: 'danger',
    })
    if (!ok) return
    try {
      const res = await fileManagerApi.batchDeleteFiles(Array.from(selectedIds))
      toast.success(`已删除 ${res.data.deleted} 个文件记录`)
      setSelectedIds(new Set())
      fetchFiles(); fetchStats()
    } catch { toast.error('批量删除失败') }
  }

  const handleScrapeFile = async (id: string) => {
    try {
      await fileManagerApi.scrapeFile(id, scrapeSource || undefined)
      toast.success('刮削已启动')
      // 乐观预热海报版本（刮削完成 WS 到达时也会再刷一次）
    } catch (err: any) {
      toast.error(err?.response?.data?.error || '刮削失败')
    }
  }

  const handleBatchScrape = async () => {
    if (selectedIds.size === 0) return
    try {
      const res = await fileManagerApi.batchScrapeFiles(Array.from(selectedIds), scrapeSource || undefined)
      toast.success(`已启动 ${res.data.started} 个刮削任务`)
    } catch { toast.error('批量刮削失败') }
  }

  const showVideoAnalysisBatchIssues = useCallback(async (title: string, issues: VideoAnalysisBatchIssue[], variant: 'warning' | 'error') => {
    if (issues.length === 0) return
    const grouped = issues.reduce<Record<string, number>>((acc, issue) => {
      const key = issue.kind || issue.message || 'unknown'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    const kindLabel = (kind?: string) => {
      switch (kind) {
        case 'unsupported_strm': return 'STRM / 远程流媒体'
        case 'unreadable_file': return '文件不可读'
        case 'path_mapping_failed': return '路径映射失败'
        case 'invalid_input': return '请求参数无效'
        case 'submit_failed': return '提交失败'
        default: return '其他原因'
      }
    }
    const summaryItems = Object.entries(grouped)
      .slice(0, 5)
      .map(([kind, count]) => <li key={kind}>{kindLabel(kind)}：{count} 个</li>)
    const detailItems = issues.slice(0, 8).map((issue, index) => (
      <li key={`${issue.media_id || 'unknown'}-${index}`} className="break-all">
        <span className="font-medium">{issue.media_id || '未知媒体'}</span>
        <span className="text-surface-400"> · {issue.message}</span>
      </li>
    ))
    let message: ReactNode = <div className="space-y-3 text-sm">
      <div>
        <div className="font-medium mb-1">原因汇总</div>
        <ul className="list-disc space-y-1 pl-5 text-surface-300">{summaryItems}</ul>
      </div>
      <div>
        <div className="font-medium mb-1">示例明细{issues.length > 8 ? `（前 8 条，共 ${issues.length} 条）` : ''}</div>
        <ul className="list-disc space-y-1 pl-5 text-surface-300">{detailItems}</ul>
      </div>
    </div>
    await dialog.alert({ title, message, variant })
  }, [dialog])

  const showVideoAnalysisResultToast = useCallback(async (result: VideoAnalysisBatchResult) => {
    const parts: string[] = []
    const skippedReasonCount = result.skipped_errors?.length || 0
    if (result.created) parts.push(`新建 ${result.created}`)
    if (result.reused) parts.push(`复用 ${result.reused}`)
    if (result.skipped) parts.push(`跳过 ${result.skipped}`)
    if (skippedReasonCount) parts.push(`含原因 ${skippedReasonCount}`)
    if (result.errors.length) parts.push(`失败 ${result.errors.length}`)
    if (parts.length === 0) {
      toast.info('没有可提交的视频分析任务')
      return
    }
    const summary = `视频分析：${parts.join('，')}`
    if (result.created > 0 || result.reused > 0) toast.success(summary)
    else if (result.errors.length > 0 || skippedReasonCount > 0) toast.warning(summary)
    else toast.info(summary)

    if (result.skipped_errors?.length) {
      await showVideoAnalysisBatchIssues('部分视频已跳过', result.skipped_errors, 'warning')
    }
    if (result.errors.length) {
      await showVideoAnalysisBatchIssues('部分视频分析提交失败', result.errors, 'error')
    }
  }, [dialog, showVideoAnalysisBatchIssues, toast])

  const submitBatchAnalyze = useCallback(async (force = false, includeDescriptions = false) => {
    try {
      const res = await videoAnalysisApi.batchSubmit({ media_ids: Array.from(selectedIds), force, include_descriptions: includeDescriptions })
      const result = res.data.data
      await showVideoAnalysisResultToast(result)
      if (result.created > 0 || result.reused > 0) {
        setActiveTab('analysis')
        const nextParams = new URLSearchParams(searchParams)
        nextParams.set('tab', 'analysis')
        if ((result.skipped_errors?.length || 0) > 0) {
          const skippedSummary = result.skipped_errors!
            .slice(0, 3)
            .map(issue => issue.message)
            .filter(Boolean)
            .join('；')
          nextParams.set('analysisLastSkipped', skippedSummary || `本次有 ${result.skipped_errors!.length} 个视频被自动跳过`)
        } else {
          nextParams.delete('analysisLastSkipped')
        }
        setSearchParams(nextParams, { replace: true })
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || '批量视频分析提交失败')
    }
  }, [selectedIds, showVideoAnalysisResultToast, searchParams, setSearchParams, toast])

  const handleBatchAnalyze = useCallback(async () => {
    if (selectedIds.size === 0) return
    if (!videoAnalysisEnabled) {
      toast.warning(videoAnalysisDisabledReason || '视频分析服务未启用或配置无效')
      return
    }
    setActiveDialog('batchAnalyze')
  }, [selectedIds, toast, videoAnalysisDisabledReason, videoAnalysisEnabled])

  const handleAnalyzeFile = useCallback(async (media: Media, force = false, includeDescriptions = false) => {
    if (!videoAnalysisEnabled) {
      toast.warning(videoAnalysisDisabledReason || '视频分析服务未启用或配置无效')
      return
    }
    if (force) {
      const ok = await dialog.confirm({
        title: '重新分析视频',
        message: '将创建一个新的历史分析任务重新执行，不会覆盖原有任务记录。确定继续吗？',
        confirmText: '重新分析',
        variant: 'warning',
      })
      if (!ok) return
    }
    try {
      const res = await videoAnalysisApi.submit({ media_id: media.id, force, include_descriptions: includeDescriptions })
      if (res.data.reused) toast.success('已复用现有视频分析任务')
      else if (includeDescriptions) toast.success(force ? '已重新提交“分析并生成描述”任务' : '已提交“分析并生成描述”任务')
      else toast.success(force ? '已重新提交视频分析任务' : '视频分析任务已提交')
      setActiveTab('analysis')
      const nextParams = new URLSearchParams(searchParams)
      nextParams.set('tab', 'analysis')
      setSearchParams(nextParams, { replace: true })
    } catch (err: any) {
      toast.error(err?.response?.data?.error || '视频分析提交失败')
    }
  }, [dialog, searchParams, setSearchParams, toast, videoAnalysisDisabledReason, videoAnalysisEnabled])

  const handleRetryAnalysisTask = useCallback(async (taskId: string) => {
    try {
      await videoAnalysisApi.retryTask(taskId)
      toast.success('已从失败阶段重新排队视频分析任务')
      setActiveTab('analysis')
      const nextParams = new URLSearchParams(searchParams)
      nextParams.set('tab', 'analysis')
      nextParams.set('analysisTaskId', taskId)
      setSearchParams(nextParams, { replace: true })
    } catch (err: any) {
      toast.error(err?.response?.data?.error || '重新分析失败')
    }
  }, [searchParams, setSearchParams, toast])

  const refreshData = () => { fetchFiles(); fetchStats(); fetchFolderTree() }

  const totalPages = Math.ceil(total / pageSize)

  // 每页数量可选项
  const pageSizeOptions = [20, 50, 100, 200]

  // 切换每页数量时重置到第一页
  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size)
    setPage(1)
  }, [])

  // 文件夹导航操作
  const handleSelectFolder = useCallback((path: string) => {
    setCurrentFolderPath(path)
    setPage(1)
    setSelectedIds(new Set())
  }, [])

  const handleClearFolder = useCallback(() => {
    setCurrentFolderPath('')
    setPage(1)
    setSelectedIds(new Set())
    setSubFolders([])
  }, [])

  // ==================== 文件夹右键操作 ====================

  const handleCreateFolder = useCallback((parentPath: string) => {
    setFolderDialogTarget(parentPath)
    setFolderInputValue('')
    setFolderDialog('createFolder')
  }, [])

  const handleRenameFolder = useCallback((folderPath: string) => {
    setFolderDialogTarget(folderPath)
    // 默认填充当前文件夹名
    const name = folderPath.replace(/\\/g, '/').split('/').pop() || ''
    setFolderInputValue(name)
    setFolderDialog('renameFolder')
  }, [])

  const handleDeleteFolder = useCallback((folderPath: string) => {
    setFolderDialogTarget(folderPath)
    setFolderDialog('deleteFolder')
  }, [])

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).then(() => {
      toast.success('路径已复制到剪贴板')
    }).catch(() => {
      toast.error('复制失败')
    })
  }, [toast])

  const handlePlayFile = useCallback((media: Media) => {
    // 打开新窗口播放
    window.open(`/play/${media.id}`, '_blank')
  }, [])

  const executeCreateFolder = useCallback(async () => {
    if (!folderInputValue.trim()) { toast.error('文件夹名不能为空'); return }
    try {
      await fileManagerApi.createFolder(folderDialogTarget, folderInputValue.trim())
      toast.success('文件夹创建成功')
      setFolderDialog('none')
      fetchFolderTree()
      fetchFiles()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || '创建文件夹失败')
    }
  }, [folderDialogTarget, folderInputValue, toast, fetchFolderTree, fetchFiles])

  const executeRenameFolder = useCallback(async () => {
    if (!folderInputValue.trim()) { toast.error('文件夹名不能为空'); return }
    try {
      await fileManagerApi.renameFolder(folderDialogTarget, folderInputValue.trim())
      toast.success('文件夹重命名成功')
      setFolderDialog('none')
      // 如果当前选中的文件夹被重命名，更新路径
      if (currentFolderPath === folderDialogTarget) {
        const parentDir = folderDialogTarget.replace(/\\/g, '/').replace(/\/[^\/]+$/, '')
        setCurrentFolderPath(parentDir + '/' + folderInputValue.trim())
      }
      fetchFolderTree()
      fetchFiles()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || '重命名失败')
    }
  }, [folderDialogTarget, folderInputValue, currentFolderPath, toast, fetchFolderTree, fetchFiles])

  const executeDeleteFolder = useCallback(async (force: boolean) => {
    try {
      await fileManagerApi.deleteFolder(folderDialogTarget, force)
      toast.success('文件夹删除成功')
      setFolderDialog('none')
      // 如果当前选中的文件夹被删除，回到上级
      if (currentFolderPath === folderDialogTarget || currentFolderPath.startsWith(folderDialogTarget + '/')) {
        handleClearFolder()
      }
      fetchFolderTree()
      fetchFiles()
      fetchStats()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || '删除失败')
    }
  }, [folderDialogTarget, currentFolderPath, toast, handleClearFolder, fetchFolderTree, fetchFiles, fetchStats])

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTab !== 'files') return
      if (activeDialog !== 'none' || folderDialog !== 'none') return
      if (e.key === 'Delete' && selectedIds.size > 0) {
        e.preventDefault()
        handleBatchDelete()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTab, activeDialog, folderDialog, selectedIds, handleBatchDelete])

  // ==================== 渲染 ====================

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            <FolderOpen className="inline-block mr-2 mb-1" size={24} />
            媒体库管理
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
            管理媒体库与影视文件、智能刮削元数据、AI批量重命名
          </p>
        </div>
        {activeTab === 'files' && (
          <div className="flex items-center gap-2">
            <button onClick={() => setActiveDialog('logs')} className="btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm">
              <History size={16} /> 操作日志
            </button>
            <button onClick={refreshData} className="btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm">
              <RefreshCw size={16} /> 刷新
            </button>
          </div>
        )}
      </div>

      {/* Tab 切换栏 */}
      <div className="flex items-center gap-1 p-1 rounded-xl glass-panel" style={{ width: 'fit-content' }}>
        <button
          onClick={() => handleTabChange('library')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
            activeTab === 'library'
              ? 'bg-neon-blue/10 text-neon shadow-sm'
              : 'text-surface-400 hover:text-surface-200 hover:bg-white/5'
          )}
        >
          <LibraryIcon size={16} />
          媒体库
        </button>
        <button
          onClick={() => handleTabChange('files')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
            activeTab === 'files'
              ? 'bg-neon-blue/10 text-neon shadow-sm'
              : 'text-surface-400 hover:text-surface-200 hover:bg-white/5'
          )}
        >
          <FolderOpen size={16} />
          文件列表
        </button>
        <button
          onClick={() => handleTabChange('scrape')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
            activeTab === 'scrape'
              ? 'bg-neon-blue/10 text-neon shadow-sm'
              : 'text-surface-400 hover:text-surface-200 hover:bg-white/5'
          )}
        >
          <Globe size={16} />
          刮削任务
        </button>
        <button
          onClick={() => handleTabChange('analysis')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
            activeTab === 'analysis'
              ? 'bg-neon-blue/10 text-neon shadow-sm'
              : 'text-surface-400 hover:text-surface-200 hover:bg-white/5'
          )}
        >
          <ScanLine size={16} />
          视频分析
        </button>
        <button
          onClick={() => handleTabChange('adult')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
            activeTab === 'adult'
              ? 'bg-neon-blue/10 text-neon shadow-sm'
              : 'text-surface-400 hover:text-surface-200 hover:bg-white/5'
          )}
        >
          <ShieldAlert size={16} />
          成人刮削
        </button>
      </div>

      {/* ==================== 媒体库管理 Tab ==================== */}
      {activeTab === 'library' && (
        <LibraryManager
          libraries={libraries}
          setLibraries={setLibraries}
          scanning={scanning}
          setScanning={setScanning}
          scanProgress={scanProgress}
          scrapeProgress={scrapeProgress}
          scanPhase={scanPhase}
        />
      )}

      {/* ==================== 刮削任务 Tab ==================== */}
      {activeTab === 'scrape' && (
        <div className="space-y-5">
          {/* STRM 远程流全局配置（.strm 云盘/CDN 流的默认 UA/Referer、HLS 重写、远程探测、域名白名单）*/}
          <STRMConfigSection />
          <ScrapeManagerPage embedded />
        </div>
      )}

      {/* ==================== 视频分析任务 Tab ==================== */}
      {activeTab === 'analysis' && (
        <VideoAnalysisTaskTab
          disabled={!videoAnalysisEnabled}
          disabledReason={videoAnalysisDisabledReason}
        />
      )}

      {/* ==================== 成人刮削 Tab ==================== */}
      {activeTab === 'adult' && (
        <div className="space-y-5">
          {/* 番号刮削配置（数据源、API Key、映射表、架构可视化）*/}
          <AdultScraperSection />
          {/* 运营中心（批量刮削 / 镜像管理 / 缓存 / 定时调度 / 分析报表）*/}
          <AdultScraperProSection />
        </div>
      )}

      {/* ==================== 文件列表 Tab ==================== */}
      {activeTab === 'files' && (<>
        {/* 统计卡片 */}
        {stats && <FileStatsBar stats={stats} />}

        {/* 工具栏 */}
        <FileToolbar
          keyword={keyword}
          onKeywordChange={(val) => { setKeyword(val); setPage(1) }}
          showFilters={showFilters}
          onToggleFilters={() => setShowFilters(!showFilters)}
          filterLibrary={filterLibrary}
          onFilterLibraryChange={(val) => { setFilterLibrary(val); setPage(1); setCurrentFolderPath('') }}
          filterMediaType={filterMediaType}
          onFilterMediaTypeChange={(val) => { setFilterMediaType(val); setPage(1) }}
          filterScraped={filterScraped}
          onFilterScrapedChange={(val) => { setFilterScraped(val); setPage(1) }}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          sortOrder={sortOrder}
          onToggleSortOrder={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
          libraries={libraries}
          onImport={() => setActiveDialog('import')}
          onScanDir={() => setActiveDialog('scanDir')}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          selectedCount={selectedIds.size}
          scrapeSource={scrapeSource}
          onScrapeSourceChange={setScrapeSource}
          onBatchScrape={handleBatchScrape}
          onBatchAnalyze={handleBatchAnalyze}
          videoAnalysisEnabled={videoAnalysisEnabled}
          videoAnalysisDisabledReason={videoAnalysisDisabledReason}
          onBatchRename={() => setActiveDialog('rename')}
          onBatchDelete={handleBatchDelete}
          onClearSelection={() => setSelectedIds(new Set())}
        >
          {/* AI助手按钮 — 嵌入在列表/网格切换按钮右侧 */}
          <AIAssistantButton
            isOpen={showAIPanel}
            onToggle={() => setShowAIPanel(!showAIPanel)}
            selectedCount={selectedIds.size}
          />
        </FileToolbar>

        {/* 面包屑导航 */}
        {currentFolderPath && (
          <div className="flex items-center gap-2">
            <Breadcrumb
              folderPath={currentFolderPath}
              onNavigate={handleSelectFolder}
              onGoHome={handleClearFolder}
            />
          </div>
        )}

        {/* 左侧文件夹树 + 中间文件列表 + 右侧AI助手面板 */}
        <div className="flex gap-4">
          {/* 左侧文件夹树面板 — 使用 CSS 过渡动画而非条件渲染 */}
          <div
            className={clsx(
              'flex-shrink-0 hidden lg:block overflow-hidden transition-all duration-300 ease-out',
              showFolderPanel ? 'w-64 opacity-100' : 'w-0 opacity-0'
            )}
            style={{
              height: showFolderPanel ? 'calc(100vh - 280px)' : 0,
              maxHeight: showFolderPanel ? 'calc(100vh - 280px)' : 0,
            }}
          >
            <div className="w-64 h-full">
              <FolderTree
                tree={folderTree}
                loading={folderTreeLoading}
                selectedPath={currentFolderPath}
                onSelectFolder={handleSelectFolder}
                onClearFolder={handleClearFolder}
                onCreateFolder={handleCreateFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
                onRefreshFolder={fetchFolderTree}
                onCopyPath={handleCopyPath}
              />
            </div>
          </div>

          {/* 右侧文件列表 */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* 文件夹面板切换按钮 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFolderPanel(!showFolderPanel)}
                className="btn-ghost hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
                title={showFolderPanel ? '收起文件夹面板' : '展开文件夹面板'}
              >
                {showFolderPanel ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
                {showFolderPanel ? '收起导航' : '展开导航'}
              </button>
              {currentFolderPath && (
                <span className="text-xs px-2 py-1 rounded-md bg-neon-blue/10 text-neon">
                  当前目录: {currentFolderPath.replace(/\\/g, '/').split('/').pop()}
                </span>
              )}
            </div>

            <FileListView
              files={files}
              loading={loading}
              viewMode={viewMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              onViewDetail={(media) => { setDetailMedia(media); setActiveDialog('detail') }}
              onEdit={(media) => { setEditMedia(media); setActiveDialog('edit') }}
              onScrape={handleScrapeFile}
              onDelete={handleDeleteFile}
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              pageSizeOptions={pageSizeOptions}
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
              subFolders={subFolders}
              currentFolderPath={currentFolderPath}
              onNavigateFolder={handleSelectFolder}
              onPlayFile={handlePlayFile}
              onCopyFilePath={handleCopyPath}
              onCreateSubFolder={handleCreateFolder}
              onRenameSubFolder={handleRenameFolder}
              onDeleteSubFolder={handleDeleteFolder}
              onRefreshSubFolder={fetchFolderTree}
              onCopyFolderPath={handleCopyPath}
            />
          </div>

          {/* 右侧 AI 助手面板 — 使用 CSS 过渡动画 */}
          <AIAssistantPanel isOpen={showAIPanel}>
            <AIAssistant
              selectedMediaIds={Array.from(selectedIds)}
              libraryId={filterLibrary || undefined}
              onOperationComplete={fetchFiles}
              isOpen={showAIPanel}
              onToggle={() => setShowAIPanel(!showAIPanel)}
            />
          </AIAssistantPanel>
        </div>
      </>)}

      {/* ==================== 对话框 ==================== */}

      {activeDialog === 'import' && (
        <ImportFileModal
          libraries={libraries}
          onClose={() => setActiveDialog('none')}
          onSuccess={refreshData}
        />
      )}

      {activeDialog === 'scanDir' && (
        <ScanDirectoryModal
          libraries={libraries}
          onClose={() => setActiveDialog('none')}
          onSuccess={refreshData}
        />
      )}

      {activeDialog === 'edit' && editMedia && (
        <EditFileModal
          media={editMedia}
          onClose={() => setActiveDialog('none')}
          onSuccess={() => { fetchFiles() }}
        />
      )}

      {activeDialog === 'detail' && detailMedia && (
        <FileDetailModal
          media={detailMedia}
          videoAnalysisDescribeEnabled={videoAnalysisDescribeEnabled}
          onClose={() => setActiveDialog('none')}
          onEdit={() => { setEditMedia(detailMedia); setActiveDialog('edit') }}
          onScrape={() => { handleScrapeFile(detailMedia.id); setActiveDialog('none') }}
          onAnalyze={(force, includeDescriptions) => {
            void handleAnalyzeFile(detailMedia, Boolean(force), Boolean(includeDescriptions))
            setActiveDialog('none')
          }}
          onRetryAnalysis={(task) => {
            void handleRetryAnalysisTask(task.id)
            setActiveDialog('none')
          }}
          onViewAnalysis={(task) => {
            const nextParams = new URLSearchParams(searchParams)
            nextParams.set('tab', 'analysis')
            nextParams.set('analysisKeyword', detailMedia.title || '')
            nextParams.delete('analysisPage')
            if (task?.id) {
              nextParams.set('analysisTaskId', task.id)
              if (task.status === 'succeeded' || task.status === 'partial') nextParams.set('analysisResultTaskId', task.id)
              else nextParams.delete('analysisResultTaskId')
            } else {
              nextParams.delete('analysisTaskId')
              nextParams.delete('analysisResultTaskId')
            }
            setSearchParams(nextParams, { replace: true })
            setActiveTab('analysis')
            setActiveDialog('none')
          }}
        />
      )}

      {activeDialog === 'batchAnalyze' && (
        <BatchAnalyzeModal
          selectedCount={selectedIds.size}
          videoAnalysisEnabled={videoAnalysisEnabled}
          videoAnalysisDescribeEnabled={videoAnalysisDescribeEnabled}
          disabledReason={videoAnalysisDisabledReason}
          onClose={() => setActiveDialog('none')}
          onConfirm={({ force, includeDescriptions }) => {
            void submitBatchAnalyze(force, includeDescriptions)
            setActiveDialog('none')
          }}
        />
      )}

      {activeDialog === 'rename' && (
        <RenameModal
          selectedCount={selectedIds.size}
          selectedIds={selectedIds}
          onClose={() => setActiveDialog('none')}
          onSuccess={() => { fetchFiles(); setActiveDialog('none') }}
        />
      )}

      {activeDialog === 'logs' && (
        <OperationLogsModal onClose={() => setActiveDialog('none')} />
      )}

      {/* ==================== 文件夹操作弹窗 ==================== */}

      {/* 新建文件夹弹窗 */}
      {folderDialog === 'createFolder' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setFolderDialog('none')}>
          <div className="glass-panel rounded-2xl p-6 w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>新建文件夹</h3>
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              在 <code className="px-1.5 py-0.5 rounded bg-surface-700/50 text-xs">{folderDialogTarget.replace(/\\/g, '/').split('/').pop()}</code> 下创建子文件夹
            </p>
            <input
              type="text"
              value={folderInputValue}
              onChange={e => setFolderInputValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') executeCreateFolder() }}
              placeholder="输入文件夹名称"
              className="w-full px-3 py-2 rounded-lg text-sm border bg-transparent focus:outline-none focus:ring-1 focus:ring-neon"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setFolderDialog('none')} className="btn-ghost px-4 py-2 rounded-lg text-sm">取消</button>
              <button onClick={executeCreateFolder} className="btn-primary px-4 py-2 rounded-lg text-sm">创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 重命名文件夹弹窗 */}
      {folderDialog === 'renameFolder' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setFolderDialog('none')}>
          <div className="glass-panel rounded-2xl p-6 w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>重命名文件夹</h3>
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              重命名 <code className="px-1.5 py-0.5 rounded bg-surface-700/50 text-xs">{folderDialogTarget.replace(/\\/g, '/').split('/').pop()}</code>
            </p>
            <input
              type="text"
              value={folderInputValue}
              onChange={e => setFolderInputValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') executeRenameFolder() }}
              placeholder="输入新名称"
              className="w-full px-3 py-2 rounded-lg text-sm border bg-transparent focus:outline-none focus:ring-1 focus:ring-neon"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setFolderDialog('none')} className="btn-ghost px-4 py-2 rounded-lg text-sm">取消</button>
              <button onClick={executeRenameFolder} className="btn-primary px-4 py-2 rounded-lg text-sm">确认重命名</button>
            </div>
          </div>
        </div>
      )}

      {/* 删除文件夹确认弹窗 */}
      {folderDialog === 'deleteFolder' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setFolderDialog('none')}>
          <div className="glass-panel rounded-2xl p-6 w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-red-400">删除文件夹</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              确定要删除文件夹 <code className="px-1.5 py-0.5 rounded bg-surface-700/50 text-xs font-bold">{folderDialogTarget.replace(/\\/g, '/').split('/').pop()}</code> 吗？
            </p>
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-xs text-red-400">
                ⚠️ 此操作将删除文件夹及其中的所有文件，且不可恢复。数据库中对应的文件记录也将被清除。
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setFolderDialog('none')} className="btn-ghost px-4 py-2 rounded-lg text-sm">取消</button>
              <button
                onClick={() => executeDeleteFolder(false)}
                className="px-4 py-2 rounded-lg text-sm bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 transition-colors"
              >
                仅删除空文件夹
              </button>
              <button
                onClick={() => executeDeleteFolder(true)}
                className="px-4 py-2 rounded-lg text-sm bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
              >
              强制删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
