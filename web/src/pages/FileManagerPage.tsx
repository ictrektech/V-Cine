import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import type { Media, Library, FileManagerStats, FolderNode } from '@/types'
import type { VideoAnalysisBatchIssue } from '@/types/videoAnalysis'
import { aiApi, adultScraperApi, fileManagerApi, libraryApi, videoAnalysisApi } from '@/api'
import { extractErrMsg } from '@/utils/error'
import { invalidateMediaListCaches } from '@/utils/invalidateMediaCaches'
import { toAppUrl } from '@/lib/appUrl'
import { routes } from '@/lib/routes'
import { storageTypeFromPath } from '@/lib/storageSchemes'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/i18n'
import { useNotificationCenterStore } from '@/stores/notificationCenter'
import { useDialog } from '@/components/Dialog'
import AIAssistant, { AIAssistantButton, AIAssistantPanel } from '@/components/AIAssistant'
import PreprocessPage from '@/pages/PreprocessPage'
import SubtitlePreprocessPage from '@/pages/SubtitlePreprocessPage'
import LibraryManager from '@/components/LibraryManager'
import { useScanProgress } from '@/hooks/useScanProgress'
import { isSmallScreen, useIsSmallScreen } from '@/hooks/useSmallScreen'
import AdultScraperSection from '@/components/admin/AdultScraperTab'
import AdultScraperProSection from '@/components/admin/AdultScraperPro'
import VideoAnalysisTaskTab from '@/components/video-analysis/VideoAnalysisTaskTab'
import SegmentedTabs from '@/components/ui/segmented-tabs'
import { useWebSocket } from '@/hooks/useWebSocket'
import { bumpPoster, bumpPosterVersion } from '@/stores/mediaRefresh'
import {
  FolderOpen,
  RefreshCw,
  History,
  PanelLeftOpen,
  ShieldAlert,
  ScanLine,
  ArrowUpLeft,
  Zap,
  Subtitles,
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
  MediaImportModal,
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
  const { t } = useTranslation()
  const toast = useToast()
  const dialog = useDialog()
  const { on, off } = useWebSocket()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  // 当前激活 Tab，由 URL 的 tab 参数决定
  const activeTab: TabType = (() => {
    const tab = searchParams.get('tab')
    if (tab === 'library') return 'library'
    if (tab === 'analysis') return 'analysis'
    if (tab === 'adult') return 'adult'
    if (tab === 'preprocess') return 'preprocess'
    return 'files'
  })()

  // 预处理子 Tab：视频 / 字幕（URL 参数 pre=subtitle，兼容旧 /preprocess/subtitle 深链）
  const [preSub, setPreSub] = useState<'video' | 'subtitle'>(() =>
    searchParams.get('pre') === 'subtitle' ? 'subtitle' : 'video'
  )

  // 切换Tab时同步URL参数
  const handleTabChange = useCallback((tab: TabType) => {
    if (tab === 'files') {
      searchParams.delete('tab')
    } else {
      searchParams.set('tab', tab)
    }
    // 离开预处理 Tab 时清理其子 Tab 参数
    if (tab !== 'preprocess') {
      searchParams.delete('pre')
    }
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams])

  // 切换预处理子 Tab 并同步 URL
  const handlePreSubChange = useCallback((sub: 'video' | 'subtitle') => {
    setPreSub(sub)
    if (sub === 'subtitle') {
      searchParams.set('pre', 'subtitle')
    } else {
      searchParams.delete('pre')
    }
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams])

  // 数据状态
  const [files, setFiles] = useState<Media[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<FileManagerStats | null>(null)
  const [libraries, setLibraries] = useState<Library[]>([])
  const [nsfwEnabled, setNsfwEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    adultScraperApi.getConfig()
      .then(res => setNsfwEnabled(res.data.data.nsfw_enabled !== false))
      .catch(() => setNsfwEnabled(false))
  }, [])

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
  // 已见文件的远程标记（跨页保留，用于批量分析按钮禁用判断）
  const [remoteFlags, setRemoteFlags] = useState<Record<string, boolean>>({})
  useEffect(() => {
    setRemoteFlags(prev => {
      const next = { ...prev }
      let changed = false
      for (const f of files) {
        const remote = storageTypeFromPath(f.file_path || '') !== 'local'
        if (next[f.id] !== remote) {
          next[f.id] = remote
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [files])

  // 视图模式（小屏默认网格：表格固定列在窄屏下会互相重叠）
  const [viewMode, setViewMode] = useState<'table' | 'grid'>(() => (isSmallScreen() ? 'grid' : 'table'))
  // 进入小屏时自动切到网格；手动切回表格后不强切，直到再次跨越断点
  const smallScreen = useIsSmallScreen()
  useEffect(() => {
    if (smallScreen) setViewMode('grid')
  }, [smallScreen])

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
  const [scrapeSource, setScrapeSource] = useState('auto')
  const [videoAnalysisEnabled, setVideoAnalysisEnabled] = useState(true)
  const [videoAnalysisDisabledReason, setVideoAnalysisDisabledReason] = useState('')
  const [videoAnalysisDescribeEnabled, setVideoAnalysisDescribeEnabled] = useState(false)
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState(false)

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
      toast.error(t('fm.loadFailed'))
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
        setRemoteVideoEnabled(configRes.data.data.remote_video_enabled ?? false)
      } catch {
        try {
          const statusRes = await aiApi.getStatus()
          setVideoAnalysisDescribeEnabled(statusRes.data.data.describe_enabled ?? false)
        } catch { /* 保持默认值 false */ }
      }
    } catch (err: any) {
      if (err?.response?.status === 503) {
        setVideoAnalysisEnabled(false)
        setVideoAnalysisDisabledReason(err?.response?.data?.error || t('fm.analysisDisabled'))
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
    // 派生封面生成完成：只刷新对应条目的海报
    const handlePosterReady = (data: { media_id?: string }) => {
      if (data?.media_id) bumpPoster(data.media_id)
    }

    on('file_imported', handleUpdate)
    on('file_deleted', handleUpdate)
    on('batch_rename_complete', handleUpdate)
    on('file_scrape_progress', handleUpdate)
    // 新增的关键事件订阅：扫描/刮削/媒体库/批量刮削
    on('scan_completed', handleGlobalUpdate)
    on('scan_phase', handleUpdate)
    on('scrape_completed', handleScrapeCompleted)
    on('poster_ready', handlePosterReady)
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
      off('poster_ready', handlePosterReady)
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
      title: t('fm.deleteFileTitle'),
      message: t('fm.deleteFileConfirm'),
      confirmText: t('common.delete'),
      variant: 'danger',
    })
    if (!ok) return
    try {
      await fileManagerApi.deleteFile(id)
      toast.success(t('fm.deletedRecord'))
      setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n })
      invalidateMediaListCaches()
      fetchFiles(); fetchStats()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('fm.deleteFailed'))
    }
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    const ok = await dialog.confirm({
      title: t('fm.batchDeleteTitle'),
      message: t('fm.batchDeleteConfirm', { count: selectedIds.size }),
      confirmText: t('common.delete'),
      variant: 'danger',
    })
    if (!ok) return
    try {
      const res = await fileManagerApi.batchDeleteFiles(Array.from(selectedIds))
      toast.success(t('fm.batchDeleted', { count: res.data.deleted }))
      setSelectedIds(new Set())
      invalidateMediaListCaches()
      fetchFiles(); fetchStats()
    } catch { toast.error(t('fm.batchDeleteFailed')) }
  }

  // 乐观推送刮削进行中通知（与 WS scrape_chain 同 id，事件到达后原地更新）
  const pushScrapeRunning = (id: string) => {
    useNotificationCenterStore.getState().push({
      id: `scrape:${id}`,
      type: 'scrape',
      title: files.find((f) => f.id === id)?.title || t('fm.scrapeTask'),
      message: t('fm.scrapeRunning'),
      status: 'running',
      link: routes.tasks.files,
    }, { restart: true })
  }

  const handleScrapeFile = async (id: string) => {
    pushScrapeRunning(id)
    try {
      await fileManagerApi.scrapeFile(id, scrapeSource === 'auto' ? undefined : scrapeSource)
      // 乐观预热海报版本（刮削完成 WS 到达时也会再刷一次）
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('fm.scrapeFailed'))
    }
  }

  const handleBatchScrape = async () => {
    if (selectedIds.size === 0) return
    // 乐观推送：每个文件一条进行中通知，完成/失败后转为终态
    Array.from(selectedIds).forEach(pushScrapeRunning)
    try {
      await fileManagerApi.batchScrapeFiles(Array.from(selectedIds), scrapeSource === 'auto' ? undefined : scrapeSource)
    } catch { toast.error(t('fm.batchScrapeFailed')) }
  }

  const showVideoAnalysisBatchIssues = useCallback(async (title: string, issues: VideoAnalysisBatchIssue[], variant: 'warning' | 'error') => {
    if (issues.length === 0) return
    const isRemoteDisabled = (issue: VideoAnalysisBatchIssue) => issue.kind === 'remote_video_disabled' || issue.message.includes('远程视频结构化未开启')
    const remoteDisabledIssues = issues.filter(isRemoteDisabled)
    const otherIssues = issues.filter((issue) => !isRemoteDisabled(issue))

    const kindLabel = (kind?: string) => {
      switch (kind) {
        case 'unsupported_strm': return t('fm.issueStrm')
        case 'remote_video_disabled': return t('fm.issueRemoteDisabled')
        case 'unreadable_file': return t('fm.issueUnreadable')
        case 'path_mapping_failed': return t('fm.issuePathMappingFailed')
        case 'invalid_input': return t('fm.issueInvalidInput')
        case 'submit_failed': return t('fm.issueSubmitFailed')
        default: return t('fm.issueOther')
      }
    }
    const remoteLink = (
      <a
        href={toAppUrl(routes.admin('video-analysis'))}
        className="inline-flex rounded-lg px-3 py-1.5 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-400/10"
      >
        {t('fm.goEnableRemote')}
      </a>
    )

    if (remoteDisabledIssues.length > 0 && otherIssues.length === 0) {
      const message: ReactNode = (
        <div className="space-y-3 text-sm">
          <p>{t('fm.analysisLocalHint')}</p>
          <p>{t('fm.analysisRemoteSkip')}</p>
          {remoteLink}
        </div>
      )
      await dialog.alert({ title: t('fm.analysisStarted'), message, variant: 'success' })
      return
    }

    const grouped = otherIssues.reduce<Record<string, number>>((acc, issue) => {
      const key = issue.kind || issue.message || 'unknown'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    const summaryItems = Object.entries(grouped)
      .slice(0, 5)
      .map(([kind, count]) => <li key={kind}>{t('fm.issueKindCount', { kind: kindLabel(kind), count })}</li>)
    const detailItems = otherIssues.slice(0, 8).map((issue, index) => (
      <li key={`${issue.media_id || 'unknown'}-${index}`} className="break-all">
        <span className="font-medium">{issue.media_id || t('fm.unknownMedia')}</span>
        <span className="text-surface-400"> · {issue.message}</span>
      </li>
    ))
    const message: ReactNode = <div className="space-y-3 text-sm">
      <div>
        <div className="font-medium mb-1">{t('fm.reasonSummary')}</div>
        <ul className="list-disc space-y-1 pl-5 text-surface-300">
          {summaryItems}
          {remoteDisabledIssues.length > 0 && <li>{t('fm.issueKindCount', { kind: kindLabel('remote_video_disabled'), count: remoteDisabledIssues.length })}</li>}
        </ul>
      </div>
      {detailItems.length > 0 && (
        <div>
          <div className="font-medium mb-1">{otherIssues.length > 8 ? t('fm.sampleDetailExtra', { count: otherIssues.length }) : t('fm.sampleDetail')}</div>
          <ul className="list-disc space-y-1 pl-5 text-surface-300">{detailItems}</ul>
        </div>
      )}
      {remoteDisabledIssues.length > 0 && (
        <div>{remoteLink}</div>
      )}
    </div>
    await dialog.alert({ title, message, variant })
  }, [dialog])

  const checkVideoAnalysisHealth = useCallback(async (includeDescriptions: boolean): Promise<string | null> => {
    try {
      const h = (await videoAnalysisApi.getHealth()).data.data
      if (!h.available) {
        return videoAnalysisDisabledReason || t('fm.analysisUnavailable')
      }
      if (!h.scene || h.scene.status !== 'ok') {
        return t('fm.sceneUnavailable', { url: h.scene_base_url ? `（${h.scene_base_url}）` : '' })
      }
      if (!h.structure || h.structure.status !== 'ok') {
        return t('fm.structureUnavailable', { url: h.structure_base_url ? `（${h.structure_base_url}）` : '' })
      }
      if (includeDescriptions && !h.describe_enabled) {
        return t('fm.sceneDescDisabled')
      }
      return null
    } catch (e) {
      return extractErrMsg(e) || t('fm.healthError')
    }
  }, [videoAnalysisDisabledReason])

  const showHealthWarning = useCallback(async (message?: string) => {
    if (await dialog.confirm({
      title: t('fm.analysisDialogTitle'),
      message: message || t('fm.analysisDialogMessage'),
      confirmText: t('fm.goSettings'),
      variant: 'warning',
    })) window.location.href = toAppUrl(routes.admin())
  }, [dialog])

  const submitBatchAnalyze = useCallback(async (force = false, includeDescriptions = false) => {
    const message = await checkVideoAnalysisHealth(includeDescriptions)
    if (message) {
      await showHealthWarning(message)
      return
    }
    try {
      const res = await videoAnalysisApi.batchSubmit({ media_ids: Array.from(selectedIds), force, include_descriptions: includeDescriptions })
      const result = res.data.data
      const skippedReasonCount = result.skipped_errors?.length || 0
      if (result.created === 0 && result.reused === 0 && result.skipped === 0 && result.errors.length === 0) {
        toast.info(t('fm.noAnalysisTasks'))
      } else {
        const parts: string[] = []
        if (result.created) parts.push(t('fm.created', { count: result.created }))
        if (result.reused) parts.push(t('fm.reused', { count: result.reused }))
        if (result.skipped) parts.push(t('fm.skipped', { count: result.skipped }))
        if (skippedReasonCount) parts.push(t('fm.withReason', { count: skippedReasonCount }))
        if (result.errors.length) parts.push(t('fm.failedCount', { count: result.errors.length }))
        useNotificationCenterStore.getState().push({
          id: 'batch:analysis',
          type: 'analysis',
          title: t('fm.batchAnalysis'),
          message: parts.join('，'),
          status: result.errors.length > 0 || skippedReasonCount > 0 ? 'partial' : 'success',
          link: routes.tasks.analysis(),
        })
      }
      if (result.skipped_errors?.length) {
        await showVideoAnalysisBatchIssues(t('fm.partialSkipped'), result.skipped_errors, 'warning')
      }
      if (result.errors.length) {
        await showVideoAnalysisBatchIssues(t('fm.partialSubmitFailed'), result.errors, 'error')
      }
      if (result.created > 0 || result.reused > 0) {
        const nextParams = new URLSearchParams(searchParams)
        nextParams.set('tab', 'analysis')
        if ((result.skipped_errors?.length || 0) > 0) {
          const skippedSummary = result.skipped_errors!
            .slice(0, 3)
            .map(issue => issue.message)
            .filter(Boolean)
            .join('；')
          nextParams.set('analysisLastSkipped', skippedSummary || t('fm.autoSkipped', { count: result.skipped_errors!.length }))
        } else {
          nextParams.delete('analysisLastSkipped')
        }
        setSearchParams(nextParams, { replace: true })
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('fm.batchAnalysisFailed'))
    }
  }, [checkVideoAnalysisHealth, selectedIds, showHealthWarning, showVideoAnalysisBatchIssues, searchParams, setSearchParams, toast])

  const handleBatchAnalyze = useCallback(async () => {
    if (selectedIds.size === 0) return
    if (!videoAnalysisEnabled) {
      toast.warning(videoAnalysisDisabledReason || t('fm.analysisDisabled'))
      return
    }
    setActiveDialog('batchAnalyze')
  }, [selectedIds, toast, videoAnalysisDisabledReason, videoAnalysisEnabled])

  const handleAnalyzeFile = useCallback(async (media: Media, force = false, includeDescriptions = false) => {
    if (!videoAnalysisEnabled) {
      toast.warning(videoAnalysisDisabledReason || t('fm.analysisDisabled'))
      return
    }
    const message = await checkVideoAnalysisHealth(includeDescriptions)
    if (message) {
      await showHealthWarning(message)
      return
    }
    if (force) {
      const ok = await dialog.confirm({
        title: t('fm.reanalyzeTitle'),
        message: t('fm.reanalyzeConfirm'),
        confirmText: t('fm.reanalyzeBtn'),
        variant: 'warning',
      })
      if (!ok) return
    }
    try {
      const res = await videoAnalysisApi.submit({ media_id: media.id, force, include_descriptions: includeDescriptions })
      if (res.data.reused) toast.success(t('fm.reusedTask'))
      else if (includeDescriptions) toast.success(force ? t('fm.resubmittedWithDesc') : t('fm.submittedWithDesc'))
      else toast.success(force ? t('fm.resubmittedAnalysis') : t('fm.submittedAnalysis'))
      const nextParams = new URLSearchParams(searchParams)
      nextParams.set('tab', 'analysis')
      setSearchParams(nextParams, { replace: true })
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('fm.analysisSubmitFailed'))
    }
  }, [checkVideoAnalysisHealth, dialog, searchParams, setSearchParams, showHealthWarning, toast, videoAnalysisDisabledReason, videoAnalysisEnabled])

  const handleRetryAnalysisTask = useCallback(async (taskId: string) => {
    try {
      await videoAnalysisApi.retryTask(taskId)
      const nextParams = new URLSearchParams(searchParams)
      nextParams.set('tab', 'analysis')
      nextParams.set('analysisTaskId', taskId)
      setSearchParams(nextParams, { replace: true })
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('fm.reanalyzeFailed'))
    }
  }, [searchParams, setSearchParams, toast])

  const refreshData = () => { fetchFiles(); fetchStats(); fetchFolderTree() }

  const totalPages = Math.ceil(total / pageSize)

  const selectedAllRemote = selectedIds.size > 0 && Array.from(selectedIds).every(id => remoteFlags[id] !== false)

  // 每页数量可选项
  const pageSizeOptions = [10, 20, 50, 100, 200]
  const visibleLibraries = nsfwEnabled === false
    ? libraries.filter(l => !l.allow_adult_content)
    : libraries

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

  const handleGoUpFolder = useCallback(() => {
    const normalized = currentFolderPath.replace(/\\/g, '/').replace(/\/+$/, '')
    const schemeIdx = normalized.indexOf('://')
    if (schemeIdx >= 0) {
      const afterScheme = normalized.slice(schemeIdx + 3)
      const lastSlash = afterScheme.lastIndexOf('/')
      if (lastSlash <= 0) {
        handleClearFolder()
        return
      }
      handleSelectFolder(normalized.slice(0, schemeIdx + 3 + lastSlash))
      return
    }
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash <= 0) {
      handleClearFolder()
      return
    }
    handleSelectFolder(normalized.slice(0, lastSlash))
  }, [currentFolderPath, handleClearFolder, handleSelectFolder])

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
      toast.success(t('fm.pathCopied'))
    }).catch(() => {
      toast.error(t('fm.copyFailed'))
    })
  }, [toast])

  const executeCreateFolder = useCallback(async () => {
    if (!folderInputValue.trim()) { toast.error(t('fm.folderNameEmpty')); return }
    try {
      await fileManagerApi.createFolder(folderDialogTarget, folderInputValue.trim())
      toast.success(t('fm.folderCreated'))
      setFolderDialog('none')
      fetchFolderTree()
      fetchFiles()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('fm.folderCreateFailed'))
    }
  }, [folderDialogTarget, folderInputValue, toast, fetchFolderTree, fetchFiles])

  const executeRenameFolder = useCallback(async () => {
    if (!folderInputValue.trim()) { toast.error(t('fm.folderNameEmpty')); return }
    try {
      await fileManagerApi.renameFolder(folderDialogTarget, folderInputValue.trim())
      toast.success(t('fm.folderRenamed'))
      setFolderDialog('none')
      // 如果当前选中的文件夹被重命名，更新路径
      if (currentFolderPath === folderDialogTarget) {
        const parentDir = folderDialogTarget.replace(/\\/g, '/').replace(/\/[^\/]+$/, '')
        setCurrentFolderPath(parentDir + '/' + folderInputValue.trim())
      }
      fetchFolderTree()
      fetchFiles()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('fm.renameFailed'))
    }
  }, [folderDialogTarget, folderInputValue, currentFolderPath, toast, fetchFolderTree, fetchFiles])

  const executeDeleteFolder = useCallback(async (force: boolean) => {
    try {
      await fileManagerApi.deleteFolder(folderDialogTarget, force)
      toast.success(t('fm.folderDeleted'))
      setFolderDialog('none')
      // 如果当前选中的文件夹被删除，回到上级
      if (currentFolderPath === folderDialogTarget || currentFolderPath.startsWith(folderDialogTarget + '/')) {
        handleClearFolder()
      }
      fetchFolderTree()
      fetchFiles()
      fetchStats()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('fm.deleteFailed'))
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
            {t('fm.pageTitle')}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {t('fm.pageSubtitle')}
          </p>
        </div>
        {activeTab === 'files' && (
          <div className="flex items-center gap-2">
            <button onClick={() => setActiveDialog('logs')} className="btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm">
              <History size={16} /> {t('fm.opLogs')}
            </button>
            <button onClick={refreshData} className="btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm">
              <RefreshCw size={16} /> {t('fm.refresh')}
            </button>
          </div>
        )}
      </div>

      {/* Tab 切换栏 */}
      <SegmentedTabs
        tabs={[
          { key: 'library', label: t('fm.tabLibrary'), icon: LibraryIcon },
          { key: 'files', label: t('fm.tabFiles'), icon: FolderOpen },
          { key: 'analysis', label: t('fm.tabAnalysis'), icon: ScanLine },
          { key: 'preprocess', label: t('fm.tabPreprocess'), icon: Zap },
          { key: 'adult', label: t('fm.tabAdult'), icon: ShieldAlert, hidden: nsfwEnabled !== true },
        ]}
        active={activeTab}
        onChange={(key) => handleTabChange(key as TabType)}
      />

      {/* ==================== 媒体库管理 Tab ==================== */}
      {activeTab === 'library' && (
        <LibraryManager
          libraries={visibleLibraries}
          setLibraries={setLibraries}
          scanning={scanning}
          setScanning={setScanning}
          scanProgress={scanProgress}
          scrapeProgress={scrapeProgress}
          scanPhase={scanPhase}
        />
      )}

      {/* ==================== 视频分析任务 Tab ==================== */}
      {activeTab === 'analysis' && (
        <VideoAnalysisTaskTab
          disabled={!videoAnalysisEnabled}
          disabledReason={videoAnalysisDisabledReason}
        />
      )}

      {/* ==================== 预处理 Tab（视频 / 字幕二级切换） ==================== */}
      {activeTab === 'preprocess' && (
        <div className="space-y-3">
          <SegmentedTabs
            tabs={[
              { key: 'video', label: t('fm.tabVideo'), icon: Zap },
              { key: 'subtitle', label: t('fm.tabSubtitle'), icon: Subtitles },
            ]}
            active={preSub}
            onChange={(key) => handlePreSubChange(key as 'video' | 'subtitle')}
          />

          {/* 按子 Tab 条件挂载，避免两个大组件同屏 */}
          {preSub === 'video' ? <PreprocessPage /> : <SubtitlePreprocessPage />}
        </div>
      )}

      {/* ==================== 成人刮削 Tab ==================== */}
      {activeTab === 'adult' && nsfwEnabled === true && (
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
          libraries={visibleLibraries}
          onImport={() => setActiveDialog('import')}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          selectedCount={selectedIds.size}
          scrapeSource={scrapeSource}
          onScrapeSourceChange={setScrapeSource}
          onBatchScrape={handleBatchScrape}
          onBatchAnalyze={handleBatchAnalyze}
          videoAnalysisEnabled={videoAnalysisEnabled}
          videoAnalysisDisabledReason={videoAnalysisDisabledReason}
          remoteVideoEnabled={remoteVideoEnabled}
          selectedAllRemote={selectedAllRemote}
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

        {/* 面包屑 + 左侧文件夹树 + 文件列表，整体一个框 */}
        <div className="flex items-start">
          <div
            className="glass-panel rounded-xl overflow-hidden border flex-1 min-w-0"
            style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}
          >
            {currentFolderPath && (
              <div className="flex items-center gap-2 px-3 py-2 border-b overflow-x-auto" style={{ borderColor: 'var(--border-default)' }}>
                <Breadcrumb
                  folderPath={currentFolderPath}
                  onNavigate={handleSelectFolder}
                  onGoHome={handleClearFolder}
                />
              </div>
            )}

            <div className="flex">
              {/* 左侧文件夹树面板 */}
              <div
                className={clsx(
                  'flex-shrink-0 hidden lg:block overflow-hidden transition-all duration-300 ease-out',
                  showFolderPanel ? 'w-52 xl:w-60 border-r opacity-100' : 'w-0 opacity-0'
                )}
              >
                <div className="w-52 xl:w-60 h-full">
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
                    onCollapse={() => setShowFolderPanel(false)}
                  />
                </div>
              </div>

              {/* 右侧文件列表 */}
              <div className="flex-1 min-w-0 flex flex-col">
                {(showFolderPanel ? !!currentFolderPath : true) && (
                  <div className="hidden sm:flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'var(--border-default)' }}>
                    {!showFolderPanel && (
                      <button
                        onClick={() => setShowFolderPanel(true)}
                        className="btn-ghost hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
                        title={t('fm.expandNavTitle')}
                      >
                        <PanelLeftOpen size={14} /> {t('fm.expandNav')}
                      </button>
                    )}
                    {currentFolderPath && (
                      <button
                        onClick={handleGoUpFolder}
                        className="btn-ghost hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
                        title={t('fm.goUpTitle')}
                      >
                        <ArrowUpLeft size={14} /> {t('fm.goUp')}
                      </button>
                    )}
                  </div>
                )}

                <div className="flex-1 min-w-0 px-2 pb-2 pt-0 sm:px-3 sm:pb-3">
                  <FileListView
                    files={files}
                    loading={loading}
                    viewMode={viewMode}
                    selectedIds={selectedIds}
                    onToggleSelect={toggleSelect}
                    onToggleSelectAll={toggleSelectAll}
                    onViewDetail={(media) => { setDetailMedia(media); setActiveDialog('detail') }}
                    onEdit={(media) => setEditMedia(media)}
                    onScrape={handleScrapeFile}
                    onDelete={handleDeleteFile}
                    libraries={visibleLibraries}
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
                    onPlayFile={(media) => navigate(routes.player(media.id))}
                    onCopyFilePath={handleCopyPath}
                    onCreateSubFolder={handleCreateFolder}
                    onRenameSubFolder={handleRenameFolder}
                    onDeleteSubFolder={handleDeleteFolder}
                    onRefreshSubFolder={fetchFolderTree}
                    onCopyFolderPath={handleCopyPath}
                  />
                </div>
              </div>
            </div>
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

      <MediaImportModal
        open={activeDialog === 'import'}
        libraries={visibleLibraries}
        onClose={() => setActiveDialog('none')}
        onSuccess={refreshData}
      />

      {detailMedia && (
        <FileDetailModal
          key={detailMedia.id}
          open={activeDialog === 'detail'}
          media={detailMedia}
          videoAnalysisDescribeEnabled={videoAnalysisDescribeEnabled}
          remoteVideoEnabled={remoteVideoEnabled}
          onClose={() => setActiveDialog('none')}
          onEdit={() => setEditMedia(detailMedia)}
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
            setActiveDialog('none')
          }}
      />
      )}

      {/* 编辑弹窗叠加在详情弹窗之上（详情保持打开，关闭编辑后回到详情） */}
      {editMedia && (
        <EditFileModal
          key={'edit-' + editMedia.id}
          media={editMedia}
          onClose={() => setEditMedia(null)}
          onSuccess={(updated) => {
            setEditMedia(null)
            setDetailMedia(updated)
            fetchFiles()
          }}
        />
      )}

      <BatchAnalyzeModal
        open={activeDialog === 'batchAnalyze'}
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

      <RenameModal
        open={activeDialog === 'rename'}
        selectedCount={selectedIds.size}
          selectedIds={selectedIds}
          onClose={() => setActiveDialog('none')}
          onSuccess={() => { fetchFiles(); setActiveDialog('none') }}
      />

      <OperationLogsModal open={activeDialog === 'logs'} onClose={() => setActiveDialog('none')} />

      {/* ==================== 文件夹操作弹窗 ==================== */}

      {/* 新建文件夹弹窗 */}
      {folderDialog === 'createFolder' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setFolderDialog('none')}>
          <div className="glass-panel rounded-2xl p-6 w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{t('fm.newFolderTitle')}</h3>
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              {t('fm.newFolderHint', { path: folderDialogTarget.replace(/\\/g, '/').split('/').pop() ?? '' })}
            </p>
            <input
              type="text"
              value={folderInputValue}
              onChange={e => setFolderInputValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') executeCreateFolder() }}
              placeholder={t('fm.folderNamePlaceholder')}
              className="w-full px-3 py-2 rounded-lg text-sm border bg-transparent focus:outline-none focus:ring-1 focus:ring-neon"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setFolderDialog('none')} className="btn-ghost px-4 py-2 rounded-lg text-sm">{t('common.cancel')}</button>
              <button onClick={executeCreateFolder} className="btn-primary px-4 py-2 rounded-lg text-sm">{t('fm.create')}</button>
            </div>
          </div>
        </div>
      )}

      {/* 重命名文件夹弹窗 */}
      {folderDialog === 'renameFolder' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setFolderDialog('none')}>
          <div className="glass-panel rounded-2xl p-6 w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{t('fm.renameFolderTitle')}</h3>
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              {t('fm.renameHint', { path: folderDialogTarget.replace(/\\/g, '/').split('/').pop() ?? '' })}
            </p>
            <input
              type="text"
              value={folderInputValue}
              onChange={e => setFolderInputValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') executeRenameFolder() }}
              placeholder={t('fm.newNamePlaceholder')}
              className="w-full px-3 py-2 rounded-lg text-sm border bg-transparent focus:outline-none focus:ring-1 focus:ring-neon"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setFolderDialog('none')} className="btn-ghost px-4 py-2 rounded-lg text-sm">{t('common.cancel')}</button>
              <button onClick={executeRenameFolder} className="btn-primary px-4 py-2 rounded-lg text-sm">{t('fm.confirmRename')}</button>
            </div>
          </div>
        </div>
      )}

      {/* 删除文件夹确认弹窗 */}
      {folderDialog === 'deleteFolder' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setFolderDialog('none')}>
          <div className="glass-panel rounded-2xl p-6 w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-red-400">{t('fm.deleteFolderTitle')}</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {t('fm.deleteFolderConfirm', { path: folderDialogTarget.replace(/\\/g, '/').split('/').pop() ?? '' })}
            </p>
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-xs text-red-400">
                {t('fm.deleteFolderWarning')}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setFolderDialog('none')} className="btn-ghost px-4 py-2 rounded-lg text-sm">{t('common.cancel')}</button>
              <button
                onClick={() => executeDeleteFolder(false)}
                className="px-4 py-2 rounded-lg text-sm bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 transition-colors"
              >
                {t('fm.deleteEmptyOnly')}
              </button>
              <button
                onClick={() => executeDeleteFolder(true)}
                className="px-4 py-2 rounded-lg text-sm bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
              >
              {t('fm.forceDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
