import { useEffect, useState } from 'react'
import {
  Film,
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
import { formatHwAccel } from '@/utils/format'

// ==================== 概览（配置状态聚合 + 下一步引导）====================
// 主页面 = 配置状态卡列表（按 3 层分组）+ 下一步引导条 + 运行状态摘要。
// 点击状态卡 → 打开对应 Drawer（由 AdminPage 分发）。
// 状态词统一：已配置 / 未配置 / 部分配置 / 需注意。

export type ConfigState = 'configured' | 'partial' | 'unconfigured' | 'attention'

type StatusCard = {
  id: string
  icon: React.ReactNode
  title: string
  desc: string
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
  /** 配置进度上报：由宿主页（AdminPage）渲染到标题栏的紧凑 chip */
  onSetupStatusChange?: (status: { complete: boolean; short?: string; target?: string }) => void
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
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{card.title}</p>
        <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-tertiary)' }}>{card.desc}</p>
      </div>
      <StateBadge state={card.state} value={card.value} />
      <ChevronRight size={16} className="shrink-0 text-surface-500 transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}

export default function AdminOverview({ systemInfo, sysSettings, libraries, users, tmdbConfig, doubanConfig, onOpenDrawer, onSetupStatusChange, aiStatusRefresh = 0 }: Props) {
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
  const metadataValue = tmdbOk && doubanOk ? '已配置' : tmdbOk ? 'TMDb✓ 豆瓣○' : doubanOk ? 'TMDb○ 豆瓣✓' : '未配置'
  const metadataState: ConfigState = tmdbOk && doubanOk ? 'configured' : (tmdbOk || doubanOk ? 'partial' : 'unconfigured')

  // AI 服务
  const aiOk = !!aiStatus?.api_configured
  const aiState: ConfigState = aiOk ? 'configured' : 'unconfigured'
  const aiModel = aiStatus?.active_model?.trim()
  const aiValue = aiOk
    ? (aiStatus?.enabled
        ? (aiModel ? '已启用 · ' + aiModel : '已启用 · 未选择模型，请到 AI 设置中拉取')
        : '已配置 · 未启用')
    : '未配置'

  // 播放与转码：GPU / 直连
  const playbackValue = sysSettings.enable_gpu_transcode ? 'GPU·开' : 'GPU·关'
  const playbackState: ConfigState = 'configured'

  // 存储：WebDAV / Alist / S3，只统计 enabled 且 connected 的可用后端
  const storageCount = [
    webdavStatus?.enabled && webdavStatus?.connected,
    alistStatus?.enabled && alistStatus?.connected,
    s3Status?.enabled && s3Status?.connected,
  ].filter(Boolean).length
  const storageState: ConfigState = storageCount > 0 ? 'configured' : 'unconfigured'
  const storageValue = storageCount > 0 ? storageCount + ' 个可用' : '本地存储'

  // 用户 / 日志：状态常显
  const userValue = users.length + ' 用户'
  const logValue = '查看'

  // 视频分析：Scene / Structure 服务健康（只读诊断）
  const vaSceneOk = vaHealth?.available ? vaHealth.scene?.status === 'ok' : null
  const vaStructureOk = vaHealth?.available ? vaHealth.structure?.status === 'ok' : null
  const vaUnavailable = !vaHealth?.available || !vaHealth?.enabled
  const vaState: ConfigState = !vaHealth ? 'unconfigured' : vaUnavailable ? 'unconfigured' : vaSceneOk && vaStructureOk ? 'configured' : 'attention'
  const vaValue = !vaHealth ? '检查中' : vaUnavailable ? '未启用' : vaSceneOk && vaStructureOk ? '场景✓ 结构✓' : vaSceneOk ? '结构异常' : vaStructureOk ? '场景异常' : '服务异常'

  const cards: StatusCard[] = [
    { id: 'metadata', icon: <Film size={18} className="text-neon/60" />, title: '元数据刮削', desc: 'TMDb 与豆瓣识别，自动获取海报简介评分', state: metadataState, value: metadataValue },
    { id: 'ai', icon: <Sparkles size={18} className="text-purple-400/70" />, title: 'AI 服务', desc: 'AI 识别、归类、搜索、推荐、元数据增强', state: aiState, value: aiValue },
    { id: 'video-analysis', icon: <ScanLine size={18} className="text-cyan-400/70" />, title: '视频分析', desc: 'Scene 场景检测 / Structure 结构分析 / 场景描述', state: vaState, value: vaValue },
    { id: 'playback', icon: <MonitorPlay size={18} className="text-violet-400/70" />, title: '播放与转码', desc: 'GPU 转码、直连播放、缓存行为', state: playbackState, value: playbackValue },
    { id: 'storage', icon: <HardDrive size={18} className="text-amber-400/70" />, title: '存储', desc: 'WebDAV / Alist / S3 远程存储挂载', state: storageState, value: storageValue },
    { id: 'users', icon: <Users size={18} className="text-emerald-400/70" />, title: '用户管理', desc: '账号、角色与权限', state: 'configured', value: userValue },
    { id: 'logs', icon: <FileText size={18} className="text-sky-400/70" />, title: '日志', desc: '系统运行与访问日志', state: 'configured', value: logValue },
    { id: 'dashboard', icon: <Activity size={18} className="text-cyan-400/70" />, title: '运行仪表盘', desc: '实时进度、系统状态、数据维护', state: 'configured', value: '查看' },
  ]

  // ===== 下一步引导 =====
  const nextStep = !tmdbOk && !doubanOk
    ? { short: '元数据刮削', target: 'metadata' }
    : (!aiOk ? { short: 'AI 服务', target: 'ai' } : null)

  // 配置进度上报给宿主页标题栏（完成 → 绿色"配置就绪"；否则 → "待配置 · xx"）
  const setupComplete = !nextStep
  useEffect(() => {
    onSetupStatusChange?.({
      complete: setupComplete,
      short: nextStep?.short,
      target: nextStep?.target,
    })
  }, [setupComplete, nextStep?.short, nextStep?.target, onSetupStatusChange])

  // ===== 运行状态摘要 =====
  const memMB = systemInfo?.memory.process_used_mb ?? systemInfo?.memory.sys_mb ?? systemInfo?.memory.alloc_mb ?? 0
  const fmtMem = memMB >= 1024 ? (memMB / 1024).toFixed(1) + ' GB' : memMB.toFixed(0) + ' MB'

  return (
    <div className="space-y-6">
      {/* ===== 媒体设置（配置重心）===== */}
      <section>
        <h2 className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--text-tertiary)' }}>媒体设置</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Card card={cards[0]} onClick={() => onOpenDrawer('metadata')} />
          <Card card={cards[1]} onClick={() => onOpenDrawer('ai')} />
          <Card card={cards[2]} onClick={() => onOpenDrawer('video-analysis')} />
        </div>
      </section>

      {/* ===== 播放与存储设置 ===== */}
      <section>
        <h2 className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--text-tertiary)' }}>播放与存储设置</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Card card={cards[3]} onClick={() => onOpenDrawer('playback')} />
          <Card card={cards[4]} onClick={() => onOpenDrawer('storage')} />
        </div>
      </section>

      {/* ===== 用户与系统设置 ===== */}
      <section>
        <h2 className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--text-tertiary)' }}>用户与系统设置</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Card card={cards[5]} onClick={() => onOpenDrawer('users')} />
          <Card card={cards[6]} onClick={() => onOpenDrawer('logs')} />
        </div>
      </section>

      {/* ===== 运行与维护 ===== */}
      <section>
        <h2 className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--text-tertiary)' }}>运行与维护</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Card card={cards[7]} onClick={() => onOpenDrawer('dashboard')} />
        </div>
      </section>

      {/* ===== 运行状态摘要（次要，只读）===== */}
      {systemInfo && (
        <section className="rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}>
          <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em]" style={{ color: 'var(--text-tertiary)' }}>
            <Server size={13} /> 运行状态
          </h3>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <span className="flex items-center gap-1.5"><Cpu size={14} className="text-neon/60" />{systemInfo.cpus} 核</span>
            <span className="flex items-center gap-1.5"><Server size={14} className="text-neon/60" />内存 {fmtMem}</span>
            <span className="flex items-center gap-1.5"><Zap size={14} className="text-neon/60" />{formatHwAccel(systemInfo.hw_accel)}</span>
            <span className="flex items-center gap-1.5"><HardDrive size={14} className="text-neon/60" />{libraries.length} 个媒体库</span>
            <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>v{systemInfo.version}</span>
          </div>
        </section>
      )}
    </div>
  )
}
