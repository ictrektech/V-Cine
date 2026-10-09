import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { useDialog } from './Dialog'
import {
  smartRenameApi,
  parseRelatedFiles,
  parseSafety,
  type RenamePlan,
  type RenamePlanItem,
  type NamingStyle,
  type RenameItemStatus,
} from '@/api/smart_rename'
import { fadeInVariants } from '@/lib/motion'
import { useTranslation } from '@/i18n'

// =============================================================
// SmartRenamePanel — 智能扫描重命名核心交互面板
// =============================================================
// 设计要点：
// - 从原 SmartRenamePage 抽出"扫描配置 + 规划详情 + 落盘确认子弹窗"。
// - 历史规划表在外层根据需要单独挂载，本组件不内嵌历史。
// - 通过 props 接收默认扫描路径（媒体库行操作场景下由媒体库注入）。
// - 所有颜色走 CSS 变量 + 语义色双主题（参见 index.css）。

export interface SmartRenamePanelProps {
  /** 初始扫描根目录；为空则用户手填 */
  defaultPath?: string
  /** 多路径候选（媒体库可能有多个 paths），提供时面板可在下拉中切换 */
  candidatePaths?: string[]
  /** 是否在头部显示标题区（独立页显示，抽屉里由抽屉头部承担故可关闭） */
  showHeader?: boolean
  /** 扫描完成 / 落盘完成 / 回滚完成时回调，用于外部刷新历史 */
  onPlanChange?: (plan: RenamePlan | null) => void
  /** 紧凑模式（抽屉里启用，缩减内边距） */
  compact?: boolean
}

const statusColor: Record<RenameItemStatus, string> = {
  pending: 'text-cyan-600 dark:text-cyan-300 border-cyan-500/40 bg-cyan-500/10',
  skipped: 'text-zinc-500 dark:text-zinc-400 border-zinc-500/40 bg-zinc-500/10',
  unsafe: 'text-amber-700 dark:text-amber-300 border-amber-500/50 bg-amber-500/10',
  executed: 'text-emerald-700 dark:text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  failed: 'text-rose-700 dark:text-rose-300 border-rose-500/40 bg-rose-500/10',
  reverted: 'text-purple-700 dark:text-purple-300 border-purple-500/40 bg-purple-500/10',
}

const statusLabelKeys: Record<RenameItemStatus, string> = {
  pending: 'sr.statusPending',
  skipped: 'sr.statusSkipped',
  unsafe: 'sr.statusUnsafe',
  executed: 'sr.statusExecuted',
  failed: 'sr.statusFailed',
  reverted: 'sr.statusReverted',
}

const cardClass = 'rounded-xl'
const cardStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  boxShadow: 'var(--shadow-card)',
}
const inputClass =
  'w-full rounded-md px-3 py-2 text-sm outline-none transition-colors placeholder:text-[var(--text-tertiary)]'
const inputStyle: React.CSSProperties = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border-default)',
  color: 'var(--text-primary)',
}

export default function SmartRenamePanel({
  defaultPath = '',
  candidatePaths,
  showHeader = true,
  onPlanChange,
  compact = false,
}: SmartRenamePanelProps) {
  const { t } = useTranslation()
  const dialog = useDialog()
  const [rootPath, setRootPath] = useState(defaultPath)
  const [style, setStyle] = useState<NamingStyle>('jellyfin')
  const [enableAI, setEnableAI] = useState(true)
  const [threshold, setThreshold] = useState(0.7)
  const [scanning, setScanning] = useState(false)

  // 扫描进度（前端模拟）
  // 后端 /scan 是单次同步请求，没有进度回调；这里用「分段平滑逼近上限 + 阶段提示」
  // 让用户感知到进度，避免长时间无反馈以为卡死。
  const [scanProgress, setScanProgress] = useState(0) // 0~100
  const [scanPhase, setScanPhase] = useState<string>('') // 阶段文案
  const [scanElapsed, setScanElapsed] = useState(0) // 秒

  const [plan, setPlan] = useState<RenamePlan | null>(null)
  const [filter, setFilter] = useState<'all' | 'pending' | 'unsafe' | 'skipped' | 'executed' | 'failed'>('all')
  const [confirmModal, setConfirmModal] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)

  // 当 defaultPath 在外部变化（例如切换媒体库行）时同步重置状态，
  // 避免上一次的规划残留到新库。
  useEffect(() => {
    setRootPath(defaultPath)
    setPlan(null)
    setFilter('all')
  }, [defaultPath])

  function emitPlan(p: RenamePlan | null) {
    setPlan(p)
    onPlanChange?.(p)
  }

  async function onScan() {
    if (!rootPath.trim()) {
      toast.error(t('sr.needRootPath'))
      return
    }
    setScanning(true)
    setScanProgress(0)
    setScanPhase(t('sr.connecting'))
    setScanElapsed(0)

    // 启动「分段平滑逼近」进度模拟
    // 阶段划分（启用 AI 时整体上限稍慢，停在 92%；不启用 AI 停在 95%）
    const startedAt = Date.now()
    const ceiling = enableAI ? 92 : 95
    const tickMs = 250
    const elapsedTimer = window.setInterval(() => {
      setScanElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    const progressTimer = window.setInterval(() => {
      setScanProgress((p) => {
        if (p >= ceiling) return p
        // 平滑逼近：剩余距离的 ~3% 一步，越接近上限越慢
        const remain = ceiling - p
        const step = Math.max(0.3, remain * 0.03)
        const next = Math.min(ceiling, p + step)
        // 阶段文案根据进度切换
        if (next < 25) setScanPhase(t('sr.phase1'))
        else if (next < 55) setScanPhase(t('sr.phase2'))
        else if (next < 80) setScanPhase(enableAI ? t('sr.phase3a') : t('sr.phase3b'))
        else setScanPhase(t('sr.phase4'))
        return next
      })
    }, tickMs)

    try {
      const resp = await smartRenameApi.scan({
        root_path: rootPath.trim(),
        naming_style: style,
        enable_ai_fallback: enableAI,
        ai_confidence_threshold: threshold,
      })
      // 请求成功 → 推到 100%
      setScanProgress(100)
      setScanPhase(t('sr.scanDone'))
      emitPlan(resp.data.data)
      toast.success(t('sr.scanDoneToast', { count: resp.data.data.total_items, need: resp.data.data.need_rename }))
    } catch (e: any) {
      setScanPhase(t('sr.scanFailedPhase'))
      toast.error(t('sr.scanFailedToast', { detail: e?.response?.data?.error || e.message || t('sr.unknownError') }))
    } finally {
      window.clearInterval(progressTimer)
      window.clearInterval(elapsedTimer)
      // 进度条短暂保留，让用户看到 100% 后再隐藏
      window.setTimeout(() => {
        setScanning(false)
        setScanProgress(0)
        setScanPhase('')
        setScanElapsed(0)
      }, 800)
    }
  }

  async function onDryRun() {
    if (!plan) return
    setExecuting(true)
    try {
      const resp = await smartRenameApi.execute({ plan_id: plan.id, confirm: false })
      toast.success(t('sr.dryRunPassed'))
      emitPlan(resp.data.data)
    } catch (e: any) {
      toast.error(t('sr.dryRunFailed', { detail: e?.response?.data?.error || e.message }))
    } finally {
      setExecuting(false)
    }
  }

  async function onConfirmExecute(ignoreSafety: boolean) {
    if (!plan) return
    setExecuting(true)
    setConfirmModal(false)
    try {
      const resp = await smartRenameApi.execute({
        plan_id: plan.id,
        confirm: true,
        ignore_safety: ignoreSafety,
      })
      toast.success(
        t('sr.applyDone', { ok: resp.data.data.executed_items, failed: resp.data.data.failed_items }),
      )
      emitPlan(resp.data.data)
    } catch (e: any) {
      toast.error(t('sr.applyFailed', { detail: e?.response?.data?.error || e.message }))
    } finally {
      setExecuting(false)
    }
  }

  async function onRollback() {
    if (!plan) return
    const ok = await dialog.confirm({
      title: t('sr.rollbackTitle'),
      message: t('sr.rollbackMsg'),
      confirmText: t('sr.rollbackConfirm'),
      variant: 'warning',
    })
    if (!ok) return
    setRollingBack(true)
    try {
      const resp = await smartRenameApi.rollback(plan.id)
      toast.success(t('sr.rollbackDone'))
      emitPlan(resp.data.data)
    } catch (e: any) {
      toast.error(t('sr.rollbackFailed', { detail: e?.response?.data?.error || e.message }))
    } finally {
      setRollingBack(false)
    }
  }

  async function onUpdateItem(item: RenamePlanItem, patch: { override_name?: string; excluded?: boolean }) {
    try {
      const resp = await smartRenameApi.updateItem(item.id, patch)
      setPlan((p) => {
        if (!p || !p.items) return p
        return {
          ...p,
          items: p.items.map((it) => (it.id === item.id ? resp.data.data : it)),
        }
      })
    } catch (e: any) {
      toast.error(t('sr.saveFailed', { detail: e?.response?.data?.error || e.message }))
    }
  }

  const filteredItems = useMemo(() => {
    if (!plan?.items) return []
    if (filter === 'all') return plan.items
    return plan.items.filter((it) => it.status === filter)
  }, [plan, filter])

  const pad = compact ? 'p-4' : 'p-5'

  return (
    <div style={{ color: 'var(--text-primary)' }} className="w-full">
      {showHeader && (
        <header className="mb-5">
          <h1 className="text-2xl font-semibold flex items-center gap-3" style={{ color: 'var(--text-primary)' }}>
            <span style={{ color: 'var(--neon-blue)' }}>⚙</span> {t('sr.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {t('sr.desc')}
            <span className="ml-1" style={{ color: 'var(--neon-blue)' }}>{t('sr.defaultDryRun')}</span>{t('sr.mustConfirm')}
          </p>
        </header>
      )}

      {/* ============ 扫描配置区 ============ */}
      <section className={`mb-5 ${cardClass} ${pad}`} style={cardStyle}>
        <h2 className="mb-3 text-sm font-medium" style={{ color: 'var(--neon-blue)' }}>{t('sr.step1')}</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {t('sr.rootPathLabel')}
            </label>
            {candidatePaths && candidatePaths.length > 1 ? (
              <div className="flex gap-2">
                <select
                  value={rootPath}
                  onChange={(e) => setRootPath(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                >
                  {candidatePaths.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <input
                value={rootPath}
                onChange={(e) => setRootPath(e.target.value)}
                placeholder={t('sr.rootPathPlaceholder')}
                className={inputClass}
                style={inputStyle}
              />
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{t('sr.namingStyle')}</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as NamingStyle)}
              className={inputClass}
              style={inputStyle}
            >
              <option value="jellyfin">Jellyfin/Emby - [tmdbid-12345]</option>
              <option value="plex">Plex - {`{tmdb-12345}`}</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {t('sr.aiThreshold', { threshold })}
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              className="w-full"
              style={{ accentColor: 'var(--neon-blue)' }}
            />
          </div>
          <div className="md:col-span-2 flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={enableAI}
                onChange={(e) => setEnableAI(e.target.checked)}
                style={{ accentColor: 'var(--neon-blue)' }}
              />
              {t('sr.enableAI')}
            </label>
            <button
              onClick={onScan}
              disabled={scanning}
              className="ml-auto rounded-md px-5 py-2 text-sm font-medium transition disabled:opacity-50"
              style={{
                background: 'var(--neon-blue)',
                color: 'var(--text-on-neon)',
                boxShadow: 'var(--shadow-neon)',
              }}
            >
              {scanning ? t('sr.scanning') : t('sr.startScan')}
            </button>
          </div>

          {/* 扫描进度条：仅在 scanning 时显示 */}
          {scanning && (
            <div className="md:col-span-2 mt-2">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span style={{ color: 'var(--text-secondary)' }}>{scanPhase || t('sr.preparing')}</span>
                <span style={{ color: 'var(--text-tertiary)' }}>
                  {t('sr.elapsed', { percent: scanProgress.toFixed(0), elapsed: formatElapsed(scanElapsed) })}
                </span>
              </div>
              <div
                className="relative h-2 w-full overflow-hidden rounded-full"
                style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
              >
                {/* 实进度（平滑过渡） */}
                <div
                  className="h-full rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: `${scanProgress}%`,
                    background: 'var(--neon-blue)',
                  }}
                />
                {/* 顶层流光：未到 100% 时附加 indeterminate 闪光，强化「进行中」感知 */}
                {scanProgress < 100 && (
                  <div
                    className="pointer-events-none absolute inset-y-0 w-1/3 rounded-full opacity-60"
                    style={{
                      background:
                        'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)',
                      animation: 'smartRenameShimmer 1.4s linear infinite',
                    }}
                  />
                )}
              </div>
              {/* 内联 keyframes（避免污染全局样式表） */}
              <style>{`@keyframes smartRenameShimmer { 0% { transform: translateX(-100%);} 100% { transform: translateX(400%);} }`}</style>
              <div className="mt-1.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {t('sr.bigDirHint')}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ============ 规划详情区 ============ */}
      {plan && (
        <motion.section
          variants={fadeInVariants}
          initial="hidden"
          animate="visible"
          className={`mb-5 ${cardClass} ${pad}`}
          style={cardStyle}
        >
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-medium" style={{ color: 'var(--neon-blue)' }}>{t('sr.step2')}</h2>
            <span
              className={`rounded-md border px-2 py-0.5 text-xs ${
                statusColor[plan.status as RenameItemStatus] || ''
              }`}
              style={
                !statusColor[plan.status as RenameItemStatus]
                  ? { border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }
                  : undefined
              }
            >
              {t('sr.statusPrefix')}{plan.status}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {t('sr.planId', { id: plan.id.slice(0, 8) })}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {t('sr.rootDirPrefix')}{plan.root_path}
            </span>
          </div>

          {/* 统计卡片 */}
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
            <Stat label={t('sr.statTotal')} value={plan.total_items} />
            <Stat label={t('sr.statNeedRename')} value={plan.need_rename} accent="text-cyan-600 dark:text-cyan-300" />
            <Stat label={t('sr.statAlreadyTarget')} value={plan.skipped_items} />
            <Stat label={t('sr.statBlocked')} value={plan.unsafe_items} accent="text-amber-700 dark:text-amber-300" />
            <Stat label={t('sr.statApplied')} value={plan.executed_items} accent="text-emerald-700 dark:text-emerald-300" />
            <Stat label={t('sr.statFailed')} value={plan.failed_items} accent="text-rose-700 dark:text-rose-300" />
          </div>

          {/* 操作按钮 */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              onClick={onDryRun}
              disabled={executing || plan.status !== 'draft'}
              className="rounded-md px-3 py-1.5 text-xs transition disabled:opacity-40"
              style={{
                border: '1px solid var(--border-strong)',
                color: 'var(--neon-blue)',
                background: 'transparent',
              }}
            >
              {t('sr.dryRun')}
            </button>
            <button
              onClick={() => setConfirmModal(true)}
              disabled={executing || (plan.status !== 'draft' && plan.status !== 'failed')}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #f43f5e, #f97316)',
                boxShadow: '0 4px 12px rgba(244, 63, 94, 0.25)',
              }}
            >
              {t('sr.confirmApply')}
            </button>
            <button
              onClick={onRollback}
              disabled={rollingBack || (plan.status !== 'completed' && plan.status !== 'failed')}
              className="rounded-md px-3 py-1.5 text-xs transition disabled:opacity-40 text-purple-700 dark:text-purple-300"
              style={{ border: '1px solid rgba(168, 85, 247, 0.4)', background: 'transparent' }}
            >
              {t('sr.rollback')}
            </button>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('sr.filter')}</span>
              {(['all', 'pending', 'unsafe', 'skipped', 'executed', 'failed'] as const).map((f) => {
                const active = filter === f
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className="rounded px-2 py-0.5 text-xs transition"
                    style={{
                      background: active ? 'var(--neon-blue-15)' : 'transparent',
                      color: active ? 'var(--neon-blue)' : 'var(--text-tertiary)',
                    }}
                  >
                    {f === 'all' ? t('common.all') : t(statusLabelKeys[f as RenameItemStatus]) || f}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 条目列表 */}
          <div className="space-y-2">
            <AnimatePresence>
              {filteredItems.map((it) => (
                <ItemCard key={it.id} item={it} onUpdate={onUpdateItem} planEditable={plan.status === 'draft'} />
              ))}
            </AnimatePresence>
            {filteredItems.length === 0 && (
              <div
                className="rounded-md border border-dashed p-6 text-center text-sm"
                style={{ borderColor: 'var(--border-default)', color: 'var(--text-tertiary)' }}
              >
                {t('sr.noMatch')}
              </div>
            )}
          </div>
        </motion.section>
      )}

      {/* ============ 确认落盘子弹窗 ============ */}
      <AnimatePresence>
        {confirmModal && plan && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center backdrop-blur-sm"
            style={{ background: 'var(--bg-overlay)' }}
            onClick={() => setConfirmModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-xl p-6"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid rgba(244, 63, 94, 0.3)',
                boxShadow: 'var(--shadow-elevated)',
              }}
            >
              <h3 className="mb-2 text-lg font-semibold text-rose-700 dark:text-rose-300">{t('sr.confirmTitle')}</h3>
              <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t('sr.confirmMsgHead')}<span style={{ color: 'var(--neon-blue)' }}>{plan.need_rename}</span>{t('sr.confirmMsgTail')}
              </p>
              <p className="mb-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {t('sr.blockedCount', { count: plan.unsafe_items })}
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => onConfirmExecute(false)}
                  className="rounded-md px-4 py-2 text-sm font-medium text-white"
                  style={{ background: '#10b981' }}
                >
                  {t('sr.confirmExec')}
                </button>
                {plan.unsafe_items > 0 && (
                  <button
                    onClick={() => onConfirmExecute(true)}
                    className="rounded-md px-4 py-2 text-sm text-rose-700 dark:text-rose-300"
                    style={{ border: '1px solid rgba(244, 63, 94, 0.4)', background: 'transparent' }}
                  >
                    {t('sr.forceExec', { count: plan.unsafe_items })}
                  </button>
                )}
                <button
                  onClick={() => setConfirmModal(false)}
                  className="rounded-md px-4 py-2 text-sm"
                  style={{
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                    background: 'transparent',
                  }}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ===== 小组件 =====

// 把秒数格式化为 mm:ss
function formatElapsed(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div
      className="rounded-md px-3 py-2"
      style={{
        background: 'var(--bg-subtle)',
        border: '1px solid var(--border-default)',
      }}
    >
      <div className="text-[10px] uppercase" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div
        className={`mt-0.5 text-xl font-semibold ${accent || ''}`}
        style={accent ? undefined : { color: 'var(--text-primary)' }}
      >
        {value}
      </div>
    </div>
  )
}

interface ItemCardProps {
  item: RenamePlanItem
  onUpdate: (item: RenamePlanItem, patch: { override_name?: string; excluded?: boolean }) => void
  planEditable: boolean
}

function ItemCard({ item, onUpdate, planEditable }: ItemCardProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(item.target_name)
  const related = parseRelatedFiles(item)
  const safety = parseSafety(item)

  useEffect(() => {
    setDraftName(item.target_name)
  }, [item.target_name])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className={`rounded-md p-3 transition ${item.excluded ? 'opacity-50' : ''}`}
      style={{
        background: 'var(--bg-subtle)',
        border: '1px solid var(--border-default)',
      }}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded border px-1.5 py-0.5 ${statusColor[item.status]}`}>
              {t(statusLabelKeys[item.status]) || item.status}
            </span>
            <span style={{ color: 'var(--text-tertiary)' }}>{t('sr.confidence')}</span>
            <span className={confColor(item.confidence)}>{(item.confidence * 100).toFixed(0)}%</span>
            {item.ai_invoked && (
              <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-purple-700 dark:text-purple-300">
                AI
              </span>
            )}
            {item.media_type === 'episode' && item.season_num > 0 && (
              <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-blue-700 dark:text-blue-300">
                S{String(item.season_num).padStart(2, '0')}E{String(item.episode_num).padStart(2, '0')}
              </span>
            )}
            {item.parsed_tmdb_id > 0 && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">
                TMDb {item.parsed_tmdb_id}
              </span>
            )}
            {item.parsed_year > 0 && (
              <span style={{ color: 'var(--text-secondary)' }}>{item.parsed_year}</span>
            )}
          </div>
          <div
            className="mt-1.5 font-mono text-xs break-all"
            style={{ color: 'var(--text-secondary)' }}
          >
            {item.source_path}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span style={{ color: 'var(--text-tertiary)' }}>→</span>
            {editing && planEditable ? (
              <>
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="flex-1 rounded px-2 py-1 text-xs font-mono outline-none"
                  style={{
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-strong)',
                    color: 'var(--neon-blue)',
                  }}
                />
                <button
                  onClick={() => {
                    onUpdate(item, { override_name: draftName })
                    setEditing(false)
                  }}
                  className="hover:underline"
                  style={{ color: 'var(--neon-blue)' }}
                >
                  {t('sr.save')}
                </button>
                <button
                  onClick={() => {
                    setDraftName(item.target_name)
                    setEditing(false)
                  }}
                  className="hover:underline"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {t('common.cancel')}
                </button>
              </>
            ) : (
              <>
                <span
                  className="font-mono break-all"
                  style={{ color: 'var(--neon-blue)' }}
                >
                  {item.target_name}
                </span>
                {planEditable && (
                  <button
                    onClick={() => setEditing(true)}
                    className="hover:underline"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {t('sr.edit')}
                  </button>
                )}
              </>
            )}
          </div>
          {related.length > 0 && (
            <div className="mt-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{t('sr.related')}</span>
              {related.map((r, i) => (
                <span
                  key={i}
                  className="ml-1 rounded px-1.5 py-0.5 text-[10px]"
                  style={{
                    background: 'var(--bg-card)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  title={r.source + ' → ' + r.target}
                >
                  {r.kind}
                </span>
              ))}
            </div>
          )}
          {safety && (safety.issues?.length ?? 0) > 0 && (
            <div className="mt-1.5 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
              ⚠ {(safety.issues ?? []).join('; ')}
            </div>
          )}
          {item.error_msg && (
            <div className="mt-1.5 rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1 text-[11px] text-rose-700 dark:text-rose-300">
              ✕ {item.error_msg}
            </div>
          )}
        </div>
        {planEditable && (
          <div className="flex flex-col gap-1">
            <button
              onClick={() => onUpdate(item, { excluded: !item.excluded })}
              className="rounded px-2 py-1 text-[11px] transition"
              style={{
                border: '1px solid var(--border-default)',
                color: 'var(--text-secondary)',
                background: 'transparent',
              }}
            >
              {item.excluded ? t('sr.excluded') : t('sr.excludeItem')}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  )
}

function confColor(conf: number) {
  if (conf >= 0.85) return 'text-emerald-700 dark:text-emerald-300'
  if (conf >= 0.6) return 'text-cyan-700 dark:text-cyan-300'
  if (conf >= 0.4) return 'text-amber-700 dark:text-amber-300'
  return 'text-rose-700 dark:text-rose-300'
}

// 导出共享样式工具，供独立页"历史规划"复用
export function planStatusBadge(status: string) {
  switch (status) {
    case 'draft':
      return 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
    case 'executing':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
    case 'completed':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'failed':
      return 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
    case 'rolledback':
      return 'bg-purple-500/10 text-purple-700 dark:text-purple-300'
    case 'canceled':
      return 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400'
    default:
      return 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400'
  }
}
