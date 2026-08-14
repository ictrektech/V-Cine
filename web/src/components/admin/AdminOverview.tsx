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
  ArrowRight,
} from 'lucide-react'
import { aiApi } from '@/api/ai'
import { storageApi } from '@/api/storage'
import type { SystemInfo, SystemSettings, Library, User, TMDbConfigStatus, DoubanConfigStatus, AIStatus } from '@/types'
import type { StorageStatus } from '@/api/storage'
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

export default function AdminOverview({ systemInfo, sysSettings, libraries, users, tmdbConfig, doubanConfig, onOpenDrawer }: Props) {
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null)
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null)

  // 自取 AI / 存储状态（只读，失败静默）
  useEffect(() => {
    aiApi.getStatus().then((res) => setAiStatus(res.data.data)).catch(() => {})
    storageApi.getStorageStatus().then((res) => setStorageStatus(res.data.data)).catch(() => {})
  }, [])

  // ===== 各模块状态计算 =====
  // 元数据刮削：TMDb / 豆瓣 两个子项
  const tmdbOk = !!tmdbConfig?.configured
  const doubanOk = !!doubanConfig?.configured
  const metadataValue = tmdbOk && doubanOk ? '已配置' : tmdbOk ? 'TMDb✓ 豆瓣○' : doubanOk ? 'TMDb○ 豆瓣✓' : '未配置'
  const metadataState: ConfigState = tmdbOk && doubanOk ? 'configured' : (tmdbOk || doubanOk ? 'partial' : 'unconfigured')

  // AI 服务
  const aiOk = !!aiStatus?.api_configured
  const aiState: ConfigState = aiOk ? 'configured' : 'unconfigured'
  const aiValue = aiOk ? (aiStatus?.enabled ? '已启用 · ' + (aiStatus.model || '') : '已配置 · 未启用') : '未配置'

  // 播放与转码：GPU / 直连
  const playbackValue = sysSettings.enable_gpu_transcode ? 'GPU·开' : 'GPU·关'
  const playbackState: ConfigState = 'configured'

  // 存储：WebDAV / Alist / S3
  const storageEnabled = [storageStatus?.webdav?.enabled, storageStatus?.alist?.enabled, storageStatus?.s3?.enabled]
  const storageCount = storageEnabled.filter(Boolean).length
  const storageState: ConfigState = storageCount > 0 ? 'configured' : 'unconfigured'
  const storageValue = storageCount > 0 ? storageCount + ' 个已启用' : '本地存储'

  // 用户 / 日志：状态常显
  const userValue = users.length + ' 用户'
  const logValue = '查看'

  const cards: StatusCard[] = [
    { id: 'metadata', icon: <Film size={18} className="text-neon/60" />, title: '元数据刮削', desc: 'TMDb 与豆瓣识别，自动获取海报简介评分', state: metadataState, value: metadataValue },
    { id: 'ai', icon: <Sparkles size={18} className="text-purple-400/70" />, title: 'AI 服务', desc: 'AI 识别、归类、搜索、推荐、元数据增强', state: aiState, value: aiValue },
    { id: 'playback', icon: <MonitorPlay size={18} className="text-violet-400/70" />, title: '播放与转码', desc: 'GPU 转码、直连播放、缓存行为', state: playbackState, value: playbackValue },
    { id: 'storage', icon: <HardDrive size={18} className="text-amber-400/70" />, title: '存储', desc: 'WebDAV / Alist / S3 远程存储挂载', state: storageState, value: storageValue },
    { id: 'users', icon: <Users size={18} className="text-emerald-400/70" />, title: '用户管理', desc: '账号、角色与权限', state: 'configured', value: userValue },
    { id: 'logs', icon: <FileText size={18} className="text-sky-400/70" />, title: '日志', desc: '系统运行与访问日志', state: 'configured', value: logValue },
  ]

  // ===== 下一步引导 =====
  const nextStep = !tmdbOk && !doubanOk
    ? { text: '配置 TMDb API Key，自动获取海报、简介、评分', target: 'metadata' }
    : (!aiOk ? { text: '配置 AI 服务，开启智能识别与搜索', target: 'ai' } : null)

  // ===== 运行状态摘要 =====
  const memMB = systemInfo?.memory.process_used_mb ?? systemInfo?.memory.sys_mb ?? systemInfo?.memory.alloc_mb ?? 0
  const fmtMem = memMB >= 1024 ? (memMB / 1024).toFixed(1) + ' GB' : memMB.toFixed(0) + ' MB'

  return (
    <div className="space-y-6">
      {/* ===== 下一步引导条 ===== */}
      {nextStep ? (
        <button
          onClick={() => onOpenDrawer(nextStep.target)}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all hover:brightness-105"
          style={{ background: 'linear-gradient(135deg, var(--neon-blue-15, rgba(56,189,248,0.15)), transparent 70%)', border: '1px solid rgba(56,189,248,0.3)' }}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neon/10">
            <ArrowRight size={16} className="text-neon" />
          </span>
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            下一步：{nextStep.text}
          </span>
          <ChevronRight size={16} className="ml-auto shrink-0 text-neon/50" />
        </button>
      ) : (
        <div className="flex w-full items-center gap-3 rounded-xl px-4 py-3" style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.3)' }}>
          <span className="text-sm font-medium" style={{ color: '#16A34A' }}>✓ 核心配置已完成，可开始使用</span>
        </div>
      )}

      {/* ===== 媒体设置（配置重心）===== */}
      <section>
        <h2 className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--text-tertiary)' }}>媒体设置</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Card card={cards[0]} onClick={() => onOpenDrawer('metadata')} />
          <Card card={cards[1]} onClick={() => onOpenDrawer('ai')} />
        </div>
      </section>

      {/* ===== 播放与存储设置 ===== */}
      <section>
        <h2 className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--text-tertiary)' }}>播放与存储设置</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Card card={cards[2]} onClick={() => onOpenDrawer('playback')} />
          <Card card={cards[3]} onClick={() => onOpenDrawer('storage')} />
        </div>
      </section>

      {/* ===== 用户与系统设置 ===== */}
      <section>
        <h2 className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--text-tertiary)' }}>用户与系统设置</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Card card={cards[4]} onClick={() => onOpenDrawer('users')} />
          <Card card={cards[5]} onClick={() => onOpenDrawer('logs')} />
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
