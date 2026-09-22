import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { adminApi, libraryApi } from '@/api'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useScanProgress } from '@/hooks/useScanProgress'
import type { SystemInfo, Library, User, TMDbConfigStatus, DoubanConfigStatus, SystemSettings } from '@/types'
import {
  Wifi,
  WifiOff,
  Settings as SettingsIcon,
  Activity,
  ShieldCheck,
  CheckCircle2,
  CircleAlert,
} from 'lucide-react'
import PulsePage from '@/pages/PulsePage'
import SegmentedTabs from '@/components/ui/segmented-tabs'
import MetadataScraperDrawer from '@/components/admin/MetadataScraperDrawer'
import { AIDrawer, StorageDrawer, STRMDrawer, UsersDrawer, LogsDrawer, DashboardDrawer } from '@/components/admin/SimpleDrawers'

import { useTranslation } from '@/i18n'
import AdminOverview from '@/components/admin/AdminOverview'
import PlaybackDrawer from '@/components/admin/PlaybackDrawer'
import VideoAnalysisDrawer from '@/components/admin/VideoAnalysisDrawer'

// 概览页状态卡对应的全部 Drawer
const DRAWER_IDS = ['metadata', 'playback', 'ai', 'storage', 'strm', 'users', 'logs', 'dashboard', 'video-analysis'] as const
type DrawerId = (typeof DRAWER_IDS)[number]

export default function AdminPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  // 一级 Tab：系统设置 / 数据中心（URL 参数 tab=pulse，兼容旧 /pulse 深链）
  const [activeTab, setActiveTab] = useState<'settings' | 'pulse'>(() =>
    searchParams.get('tab') === 'pulse' ? 'pulse' : 'settings'
  )
  const handleTabChange = useCallback((tab: 'settings' | 'pulse') => {
    setActiveTab(tab)
    if (tab === 'pulse') {
      searchParams.set('tab', 'pulse')
    } else {
      searchParams.delete('tab')
    }
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams])

  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [libraries, setLibraries] = useState<Library[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [sysSettings, setSysSettings] = useState<SystemSettings>({
    enable_gpu_transcode: true,
    auto_preprocess_on_scan: false,
    auto_transcode_on_play: true,
  })

  // 元数据刮削配置状态（Drawer 显示用）
  const [tmdbConfig, setTmdbConfig] = useState<TMDbConfigStatus | null>(null)
  const [doubanConfig, setDoubanConfig] = useState<DoubanConfigStatus | null>(null)
  // 当前打开的 Drawer（同一时刻最多一个）
  const [activeDrawer, setActiveDrawer] = useState<DrawerId | null>(null)
  // AI 抽屉关闭时自增：通知首页状态卡重新拉取 AI 状态（避免显示过期的开启状态）
  const [aiStatusRefresh, setAiStatusRefresh] = useState(0)

  // 支持从文件管理页跳转直达视频分析设置
  useEffect(() => {
    if (searchParams.get('drawer') === 'video-analysis') {
      setActiveDrawer('video-analysis')
    }
  }, [searchParams])

  // 扫描完成后刷新媒体库列表
  const refreshLibraries = useCallback(() => {
    libraryApi.list().then((res) => setLibraries(res.data.data || [])).catch(() => {})
  }, [])

  // WebSocket 实时进度（扫描/刮削/转码，与文件管理页共用同一逻辑）
  const { connected, on, off } = useWebSocket()
  const { scanProgress, scrapeProgress, transcodeProgress, scanPhase, realtimeMessages } = useScanProgress(on, off, refreshLibraries)

  // ==================== 加载数据 ====================
  const loadAll = useCallback(async () => {
    try {
      const [sysRes, libRes, userRes, tmdbRes, doubanRes, settingsRes] = await Promise.all([
        adminApi.systemInfo(),
        libraryApi.list(),
        adminApi.listUsers(),
        adminApi.getTMDbConfig(),
        adminApi.getDoubanConfig(),
        adminApi.getSystemSettings(),
      ])
      setSystemInfo(sysRes.data.data)
      setLibraries(libRes.data.data || [])
      setUsers(userRes.data.data || [])
      setTmdbConfig(tmdbRes.data.data)
      setDoubanConfig(doubanRes.data.data)
      if (settingsRes.data.data) setSysSettings(settingsRes.data.data)
    } catch {
      // 静默处理
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // 概览页状态卡分发：全部 → Drawer
  const openDrawer = (id: string) => {
    const matched = DRAWER_IDS.find((d) => d === id)
    if (matched) setActiveDrawer(matched)
  }

  // 配置进度（由 AdminOverview 上报）：渲染为标题栏右侧的紧凑 chip
  const [setupStatus, setSetupStatus] = useState<{ complete: boolean; short?: string; target?: string }>({ complete: false })
  // 关闭 Drawer 后刷新概览数据：
  // 很多设置项（AI/视频分析/存储等）保存后只更新了自身组件状态，
  // 概览卡不会自动感知。这里统一在关闭时重新拉取，避免“保存后要手动刷新”。
  const closeDrawer = () => {
    setActiveDrawer(null)
    loadAll()
  }

  return (
    <div className="space-y-0">
      {/* ==================== 顶部标题栏 ==================== */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-display text-2xl font-bold tracking-wide flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <ShieldCheck className="text-neon-blue animate-neon-breathe" size={24} />
            {t('admin.consoleTitle')}
          </h1>
          <div className="flex items-center gap-3">
            {/* 配置进度 chip（仅系统设置 Tab） */}
            {activeTab === 'settings' && (
              setupStatus.complete ? (
                <span
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ color: '#16A34A', background: 'rgba(22,163,74,0.12)' }}
                  title="核心配置已完成，可开始使用"
                >
                  <CheckCircle2 size={13} />
                  配置就绪
                </span>
              ) : setupStatus.short ? (
                <button
                  onClick={() => openDrawer(setupStatus.target || '')}
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all hover:brightness-110"
                  style={{ color: '#38BDF8', background: 'var(--neon-blue-15)', border: '1px solid var(--neon-blue-30)' }}
                  title={`下一步：配置${setupStatus.short}`}
                >
                  <CircleAlert size={13} />
                  待配置 · {setupStatus.short}
                </button>
              ) : null
            )}
            {/* WebSocket 状态 */}
            <div className="flex items-center gap-2 text-xs">
              {connected ? (
                <span className="flex items-center gap-1.5 text-neon">
                  <Wifi size={14} />
                  <span className="hidden sm:inline">{t('admin.connected')}</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-surface-500">
                  <WifiOff size={14} />
                  <span className="hidden sm:inline">{t('admin.disconnected')}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ==================== 一级 Tab：系统设置 / 数据中心 ==================== */}
      <SegmentedTabs
        className="mb-6"
        tabs={[
          { key: 'settings', label: t('admin.title'), icon: SettingsIcon },
          { key: 'pulse', label: t('admin.tabPulse'), icon: Activity },
        ]}
        active={activeTab}
        onChange={(key) => handleTabChange(key as 'settings' | 'pulse')}
      />

      {/* ==================== Tab 内容 ==================== */}
      {activeTab === 'pulse' ? (
        <PulsePage />
      ) : (
        <AdminOverview
          systemInfo={systemInfo}
          sysSettings={sysSettings}
          libraries={libraries}
          users={users}
          tmdbConfig={tmdbConfig}
          doubanConfig={doubanConfig}
          onOpenDrawer={openDrawer}
          onSetupStatusChange={setSetupStatus}
          aiStatusRefresh={aiStatusRefresh}
        />
      )}

      {/* ===== 元数据刮削 Drawer ===== */}
      <MetadataScraperDrawer
        open={activeDrawer === 'metadata'}
        onOpenChange={(open) => { if (!open) closeDrawer() }}
        tmdbConfig={tmdbConfig}
        setTmdbConfig={setTmdbConfig}
        doubanConfig={doubanConfig}
        setDoubanConfig={setDoubanConfig}
      />

      {/* ===== 播放与转码 Drawer ===== */}
      <PlaybackDrawer
        open={activeDrawer === 'playback'}
        onOpenChange={(open) => { if (!open) closeDrawer() }}
        sysSettings={sysSettings}
        setSysSettings={setSysSettings}
      />

      {/* ===== 其余模块 Drawer ===== */}
      <AIDrawer open={activeDrawer === 'ai'} onOpenChange={(open) => {
        if (!open) {
          closeDrawer()
          setAiStatusRefresh(k => k + 1) // 抽屉关闭 → 首页状态卡重拉
        }
      }} />
      <VideoAnalysisDrawer
        open={activeDrawer === 'video-analysis'}
        onOpenChange={(open) => {
          if (!open) {
            closeDrawer()
            setAiStatusRefresh(k => k + 1) // 抽屉关闭 → 首页状态卡重拉
          }
        }}
        onNavigateToAI={() => setActiveDrawer('ai')}
      />
      <StorageDrawer open={activeDrawer === 'storage'} onOpenChange={(open) => { if (!open) closeDrawer() }} />
      <STRMDrawer open={activeDrawer === 'strm'} onOpenChange={(open) => { if (!open) closeDrawer() }} />
      <UsersDrawer open={activeDrawer === 'users'} onOpenChange={(open) => { if (!open) closeDrawer() }} users={users} setUsers={setUsers} />
      <LogsDrawer open={activeDrawer === 'logs'} onOpenChange={(open) => { if (!open) closeDrawer() }} />
      <DashboardDrawer
        open={activeDrawer === 'dashboard'}
        onOpenChange={(open) => { if (!open) closeDrawer() }}
        systemInfo={systemInfo}
        scanProgress={scanProgress}
        scrapeProgress={scrapeProgress}
        transcodeProgress={transcodeProgress}
        scanPhase={scanPhase}
        realtimeMessages={realtimeMessages}
      />
    </div>
  )
}
