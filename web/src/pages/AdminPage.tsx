import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { adminApi, libraryApi } from '@/api'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useScanProgress } from '@/hooks/useScanProgress'
import { StorageStatusesProvider } from '@/hooks/useStorageStatuses'
import type { SystemInfo, Library, User, TMDbConfigStatus, DoubanConfigStatus, SystemSettings } from '@/types'
import {
  Wifi,
  WifiOff,
} from 'lucide-react'
import MetadataScraperDrawer from '@/components/admin/MetadataScraperDrawer'
import { AIDrawer, StorageDrawer, UsersDrawer, LogsDrawer, DashboardDrawer } from '@/components/admin/SimpleDrawers'

import { useTranslation } from '@/i18n'
import AdminOverview from '@/components/admin/AdminOverview'
import PlaybackDrawer from '@/components/admin/PlaybackDrawer'
import VideoAnalysisDrawer from '@/components/admin/VideoAnalysisDrawer'

// 概览页状态卡对应的全部 Drawer
const DRAWER_IDS = ['metadata', 'playback', 'ai', 'storage', 'users', 'logs', 'dashboard', 'video-analysis'] as const
type DrawerId = (typeof DRAWER_IDS)[number]

export default function AdminPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()

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
  // 关闭 Drawer 后刷新概览数据：
  // 很多设置项（AI/视频分析/存储等）保存后只更新了自身组件状态，
  // 概览卡不会自动感知。这里统一在关闭时重新拉取，避免“保存后要手动刷新”。
  const closeDrawer = () => {
    setActiveDrawer(null)
    loadAll()
  }

  return (
    <StorageStatusesProvider>
    <div className="space-y-0">
      {/* ==================== 顶部标题栏 ==================== */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-display text-2xl font-bold tracking-wide" style={{ color: 'var(--text-primary)' }}>
            {t('admin.title')}
          </h1>
          <div className="flex items-center gap-3">
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

      {/* ==================== 配置概览（唯一落地视图） ==================== */}
      <AdminOverview
        systemInfo={systemInfo}
        sysSettings={sysSettings}
        libraries={libraries}
        users={users}
        tmdbConfig={tmdbConfig}
        doubanConfig={doubanConfig}
        onOpenDrawer={openDrawer}
      />

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
      <AIDrawer open={activeDrawer === 'ai'} onOpenChange={(open) => { if (!open) closeDrawer() }} />
      <VideoAnalysisDrawer
        open={activeDrawer === 'video-analysis'}
        onOpenChange={(open) => { if (!open) closeDrawer() }}
        onNavigateToAI={() => setActiveDrawer('ai')}
      />
      <StorageDrawer open={activeDrawer === 'storage'} onOpenChange={(open) => { if (!open) closeDrawer() }} />
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
    </StorageStatusesProvider>
  )
}
