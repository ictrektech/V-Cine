import { useEffect, useState } from 'react'
import {
  Film,
  Globe,
  Sparkles,
  MonitorPlay,
  HardDrive,
  Users,
  FileText,
  ChevronRight,
  Server,
  Cpu,
  Zap,
  Activity,
  ScanLine,
} from 'lucide-react'
import { aiApi } from '@/api/ai'
import { videoAnalysisApi } from '@/api/videoAnalysis'
import type { SystemInfo, SystemSettings, Library, User, TMDbConfigStatus, DoubanConfigStatus, AIStatus } from '@/types'
import type { VideoAnalysisHealthInfo } from '@/types/videoAnalysis'
import { useStorageStatuses } from '@/hooks/useStorageStatuses'
import { useTranslation } from '@/i18n'
import { formatHwAccel } from '@/utils/format'

// ==================== 概览（配置状态聚合 + 下一步引导）====================
// 主页面 = 配置状态卡列表（按 3 层分组）+ 下一步引导条 + 运行状态摘要。
// 点击状态卡 → 打开对应 Drawer（由 AdminPage 分发）。
// 状态词统一：已配置 / 未配置 / 部分配置 / 需注意。

export type ConfigState = 'configured' | 'partial' | 'unconfigured' | 'attention'

type StatusCard = {
  id: string
  icon: React.ReactNode
  titleKey: string
  descKey: string
  state: ConfigState
  value: string
}

type Props = {
  systemInfo: SystemInfo | null
  sysSettings: SystemSettings
  libraries: Library[]
  users: User[]
  tmdbConfig: TMDbConfigStatus | null
  doubanConfig: DoubanConfigStatus | null
  onOpenDrawer: (id: string) => void
  /** AI 配置在抽屉里保存后自增，触发首页状态卡重新拉取（避免显示过期的开启状态） */
  aiStatusRefresh?: number
}

// 状态徽章样式
function StateBadge({ state, value }: { state: ConfigState; value: string }) {
  const styles: Record<ConfigState, { color: string; bg: string }> = {
    configured: { color: '#16A34A', bg: 'rgba(22,163,74,0.12)' },
    partial: { color: '#D97706', bg: 'rgba(217,119,6,0.12)' },
    unconfigured: { color: 'var(--text-tertiary)', bg: 'var(--nav-hover-bg)' },
    attention: { color: '#DC2626', bg: 'rgba(220,38,38,0.12)' },
  }
  const s = styles[state]
  return (
    <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium" style={{ color: s.color, background: s.bg, border: '1px solid transparent' }}>
      {value}
    </span>
  )
}

function Card({ card, onClick }: { card: StatusCard; onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl p-4 text-left transition-all hover:bg-[var(--nav-hover-bg)]"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--nav-hover-bg)' }}>
        {card.icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t(card.titleKey)}</p>
        <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-tertiary)' }}>{t(card.descKey)}</p>
      </div>
      <StateBadge state={card.state} value={card.value} />
      <ChevronRight size={16} className="shrink-0 text-surface-500 transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}

export default function AdminOverview({ systemInfo, sysSettings, libraries, users, tmdbConfig, doubanConfig, onOpenDrawer, aiStatusRefresh = 0 }: Props) {
  const { t } = useTranslation()
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null)
  const [vaHealth, setVaHealth] = useState<VideoAnalysisHealthInfo | null>(null)
  const { webdavStatus, alistStatus, s3Status } = useStorageStatuses()

  // 自取 AI / 视频分析状态（只读，失败静默；存储状态由 useStorageStatuses 统一轮询）
  // aiStatusRefresh：AI 抽屉里保存后自增，触发这里重拉，避免首页状态卡显示过期状态
  useEffect(() => {
    aiApi.getStatus().then((res) => setAiStatus(res.data.data)).catch(() => {})
    videoAnalysisApi.getHealth().then((res) => setVaHealth(res.data.data)).catch(() => setVaHealth(null))
  }, [aiStatusRefresh])

  // ===== 各模块状态计算 =====
  // 元数据刮削：TMDb / 豆瓣 两个子项
  const tmdbOk = !!tmdbConfig?.configured
  const doubanOk = !!doubanConfig?.configured
  const metadataValue = tmdbOk && doubanOk ? t('admin.ovConfigured') : tmdbOk ? t('admin.ovTmdbOnly') : doubanOk ? t('admin.ovDoubanOnly') : t('admin.ovUnconfigured')
  const metadataState: ConfigState = tmdbOk && doubanOk ? 'configured' : (tmdbOk || doubanOk ? 'partial' : 'unconfigured')

  // AI 服务
  const aiOk = !!aiStatus?.api_configured
  const aiState: ConfigState = aiOk ? 'configured' : 'unconfigured'
  const aiModel = aiStatus?.active_model?.trim()
  const aiValue = aiOk
    ? (aiStatus?.enabled
        ? (aiModel ? t('admin.ovAiOnModel', { model: aiModel }) : t('admin.ovAiOnNoModel'))
        : t('admin.ovAiConfiguredOff'))
    : t('admin.ovUnconfigured')

  // 播放与转码：GPU / 直连
  const playbackValue = sysSettings.enable_gpu_transcode ? t('admin.ovGpuOn') : t('admin.ovGpuOff')
  const playbackState: ConfigState = 'configured'

  // 存储：WebDAV / Alist / S3，只统计 enabled 且 connected 的可用后端
  const storageCount = [
    webdavStatus?.enabled && webdavStatus?.connected,
    alistStatus?.enabled && alistStatus?.connected,
    s3Status?.enabled && s3Status?.connected,
  ].filter(Boolean).length
  const storageState: ConfigState = storageCount > 0 ? 'configured' : 'unconfigured'
  const storageValue = storageCount > 0 ? t('admin.ovStorageCount', { count: storageCount }) : t('admin.ovLocalOnly')

  // 用户 / 日志：状态常显
  const userValue = t('admin.ovUsersCount', { count: users.length })
  const logValue = t('admin.ovView')

  // 视频分析：Scene / Structure 服务健康（只读诊断）
  const vaSceneOk = vaHealth?.available ? vaHealth.scene?.status === 'ok' : null
  const vaStructureOk = vaHealth?.available ? vaHealth.structure?.status === 'ok' : null
  const vaUnavailable = !vaHealth?.available || !vaHealth?.enabled
  const vaState: ConfigState = !vaHealth ? 'unconfigured' : vaUnavailable ? 'unconfigured' : vaSceneOk && vaStructureOk ? 'configured' : 'attention'
  const vaValue = !vaHealth ? t('admin.ovChecking') : vaUnavailable ? t('admin.ovNotEnabled') : vaSceneOk && vaStructureOk ? t('admin.ovVaBothOk') : vaSceneOk ? t('admin.ovVaStructureBad') : vaStructureOk ? t('admin.ovVaSceneBad') : t('admin.ovVaServiceBad')

  const cards: StatusCard[] = [
    { id: 'metadata', icon: <Film size={18} className="text-neon/60" />, titleKey: 'admin.ovCardMetadata', descKey: 'admin.ovCardMetadataDesc', state: metadataState, value: metadataValue },
    { id: 'ai', icon: <Sparkles size={18} className="text-purple-400/70" />, titleKey: 'admin.ovCardAi', descKey: 'admin.ovCardAiDesc', state: aiState, value: aiValue },
    { id: 'video-analysis', icon: <ScanLine size={18} className="text-cyan-400/70" />, titleKey: 'admin.ovCardVa', descKey: 'admin.ovCardVaDesc', state: vaState, value: vaValue },
    { id: 'playback', icon: <MonitorPlay size={18} className="text-violet-400/70" />, titleKey: 'admin.ovCardPlayback', descKey: 'admin.ovCardPlaybackDesc', state: playbackState, value: playbackValue },
    { id: 'storage', icon: <HardDrive size={18} className="text-amber-400/70" />, titleKey: 'admin.ovCardStorage', descKey: 'admin.ovCardStorageDesc', state: storageState, value: storageValue },
    { id: 'strm', icon: <Globe size={18} className="text-teal-400/70" />, titleKey: 'admin.ovCardStrm', descKey: 'admin.ovCardStrmDesc', state: 'configured', value: t('admin.ovView') },
    { id: 'users', icon: <Users size={18} className="text-emerald-400/70" />, titleKey: 'admin.ovCardUsers', descKey: 'admin.ovCardUsersDesc', state: 'configured', value: userValue },
    { id: 'logs', icon: <FileText size={18} className="text-sky-400/70" />, titleKey: 'admin.ovCardLogs', descKey: 'admin.ovCardLogsDesc', state: 'configured', value: logValue },
    { id: 'dashboard', icon: <Activity size={18} className="text-cyan-400/70" />, titleKey: 'admin.ovCardDashboard', descKey: 'admin.ovCardDashboardDesc', state: 'configured', value: t('admin.ovView') },
  ]

  // 按 id 查卡片，避免下标耦合 —— 在数组中间插卡时分组自动保持正确
  const cardById = Object.fromEntries(cards.map((c) => [c.id, c]))

  // ===== 运行状态摘要 =====
  const memMB = systemInfo?.memory.process_used_mb ?? systemInfo?.memory.sys_mb ?? systemInfo?.memory.alloc_mb ?? 0
  const fmtMem = memMB >= 1024 ? (memMB / 1024).toFixed(1) + ' GB' : memMB.toFixed(0) + ' MB'

  return (
    <div className="space-y-6">
      {/* ===== 媒体设置（配置重心）===== */}
      <section>
        <h2 className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--text-tertiary)' }}>{t('admin.ovSecMedia')}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Card card={cardById.metadata} onClick={() => onOpenDrawer('metadata')} />
          <Card card={cardById.ai} onClick={() => onOpenDrawer('ai')} />
          <Card card={cardById['video-analysis']} onClick={() => onOpenDrawer('video-analysis')} />
        </div>
      </section>

      {/* ===== 播放与存储设置 ===== */}
      <section>
        <h2 className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--text-tertiary)' }}>{t('admin.ovSecPlayback')}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Card card={cardById.playback} onClick={() => onOpenDrawer('playback')} />
          <Card card={cardById.storage} onClick={() => onOpenDrawer('storage')} />
          <Card card={cardById.strm} onClick={() => onOpenDrawer('strm')} />
        </div>
      </section>

      {/* ===== 用户与系统设置 ===== */}
      <section>
        <h2 className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--text-tertiary)' }}>{t('admin.ovSecUsers')}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Card card={cardById.users} onClick={() => onOpenDrawer('users')} />
          <Card card={cardById.logs} onClick={() => onOpenDrawer('logs')} />
        </div>
      </section>

      {/* ===== 运行与维护 ===== */}
      <section>
        <h2 className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--text-tertiary)' }}>{t('admin.ovSecOps')}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Card card={cardById.dashboard} onClick={() => onOpenDrawer('dashboard')} />
        </div>
      </section>

      {/* ===== 运行状态摘要（次要，只读）===== */}
      {systemInfo && (
        <section className="rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}>
          <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em]" style={{ color: 'var(--text-tertiary)' }}>
            <Server size={13} /> {t('admin.ovRuntime')}
          </h3>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <span className="flex items-center gap-1.5"><Cpu size={14} className="text-neon/60" />{t('admin.ovCpuCores', { count: systemInfo.cpus })}</span>
            <span className="flex items-center gap-1.5"><Server size={14} className="text-neon/60" />{t('admin.ovMem', { mem: fmtMem })}</span>
            <span className="flex items-center gap-1.5"><Zap size={14} className="text-neon/60" />{formatHwAccel(systemInfo.hw_accel)}</span>
            <span className="flex items-center gap-1.5"><HardDrive size={14} className="text-neon/60" />{t('admin.ovLibCount', { count: libraries.length })}</span>
            <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>v{systemInfo.version}</span>
          </div>
        </section>
      )}
    </div>
  )
}
