import { useTranslation } from '@/i18n'
import { useState } from 'react'
import type { SystemInfo } from '@/types'
import type { ScanProgressData, ScrapeProgressData, TranscodeProgressData, ScanPhaseData } from '@/hooks/useWebSocket'
import {
  Server,
  Cpu,
  HardDrive,
  Zap,
  Loader2,
  Check,
  X,
  Activity,
  AlertTriangle,
  Trash2,
  ShieldAlert,
  Merge,
  ChevronRight,
} from 'lucide-react'
import { adminApi } from '@/api'
import { formatHwAccel } from '@/utils/format'
import { Modal } from '@/components/ui/modal'

const webAppVersion = import.meta.env.VITE_APP_VERSION || '0.1.0'

interface DashboardTabProps {
  systemInfo: SystemInfo | null
  scanProgress: Record<string, ScanProgressData>
  scrapeProgress: Record<string, ScrapeProgressData>
  transcodeProgress: Record<string, TranscodeProgressData>
  scanPhase: Record<string, ScanPhaseData>
  realtimeMessages: string[]
}

export default function DashboardTab({
  systemInfo,
  scanProgress,
  scrapeProgress,
  transcodeProgress,
  scanPhase,
}: DashboardTabProps) {
  const { t } = useTranslation()

  // 一键清空数据相关状态
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [clearConfirmText, setClearConfirmText] = useState('')
  const [clearLoading, setClearLoading] = useState(false)
  const [clearResult, setClearResult] = useState<{
    status: string
    message: string
    total_cleared: number
    success_count: number
    error_count: number
    details: { table: string; cleared: number; status: string; message?: string }[]
  } | null>(null)

  // 剧集合并相关状态
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergeCandidatesLoading, setMergeCandidatesLoading] = useState(false)
  const [mergeResult, setMergeResult] = useState<{
    type: 'success' | 'error' | 'info'
    message: string
    groups_processed?: number
    total_merged?: number
  } | null>(null)
  const [mergeCandidates, setMergeCandidates] = useState<{
    normalized_title: string
    count: number
    series: { id: string; title: string; season_count: number; episode_count: number }[]
  }[] | null>(null)

  const hasActiveProgress = Object.keys(scanProgress).length > 0 || Object.keys(scrapeProgress).length > 0 || Object.keys(transcodeProgress).length > 0 || Object.keys(scanPhase).length > 0

  // 阶段名称映射
  const phaseLabels: Record<string, string> = {
    scanning: t('dash.phaseScanning'),
    scraping: t('dash.phaseScraping'),
    merging: t('dash.phaseMerging'),
    matching: t('dash.phaseMatching'),
    cleaning: t('dash.phaseCleaning'),
    completed: t('dash.phaseCompleted'),
  }

  const handleClearAllData = async () => {
    if (clearConfirmText !== t('dash.clearWord')) return
    setClearLoading(true)
    setClearResult(null)
    try {
      const res = await adminApi.clearAllData('CONFIRM_CLEAR_ALL')
      setClearResult(res.data.data)
      setClearDialogOpen(false)
      setClearConfirmText('')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('dash.clearFailed')
      setClearResult({
        status: 'error',
        message: msg,
        total_cleared: 0,
        success_count: 0,
        error_count: 1,
        details: [],
      })
    } finally {
      setClearLoading(false)
    }
  }

  const handleCheckMergeCandidates = async () => {
    setMergeCandidatesLoading(true)
    setMergeCandidates(null)
    setMergeResult(null)
    try {
      const res = await adminApi.mergeCandidates()
      const data = res.data.data
      if (data && data.length > 0) {
        setMergeCandidates(data)
        setMergeResult({
          type: 'info',
          message: t('dash.mergeFound', { count: data.length }),
        })
      } else {
        setMergeCandidates([])
        setMergeResult({
          type: 'success',
          message: t('dash.mergeNone'),
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('dash.detectFailed')
      setMergeResult({ type: 'error', message: msg })
    } finally {
      setMergeCandidatesLoading(false)
    }
  }

  const handleAutoMerge = async () => {
    setMergeLoading(true)
    setMergeResult(null)
    try {
      const res = await adminApi.autoMergeSeries()
      const data = res.data.data
      setMergeResult({
        type: 'success',
        message: res.data.message,
        groups_processed: data.groups_processed,
        total_merged: data.total_merged,
      })
      // 合并完成后清空候选列表
      setMergeCandidates(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('dash.autoMergeFailed')
      setMergeResult({ type: 'error', message: msg })
    } finally {
      setMergeLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* 实时进度面板 */}
      {hasActiveProgress && (
        <section className="animate-slide-up">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            <Loader2 size={20} className="animate-spin text-neon" />
            {t('dash.realtimeTitle')}
          </h2>
          <div className="space-y-3">
            {/* 扫描阶段进度（多步骤流程） */}
            {Object.entries(scanPhase).map(([libId, data]) => (
              <div key={`phase-${libId}`} className="glass-panel-subtle rounded-xl p-4" style={{ borderColor: 'var(--neon-blue-15)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {phaseLabels[data.phase] || data.phase} {data.library_name}
                  </span>
                  <span className="text-xs font-mono text-neon">
                    {t('dash.step', { current: data.step_current, total: data.step_total })}
                  </span>
                </div>
                {/* 步骤进度条 */}
                <div className="mb-2 h-2 overflow-hidden rounded-full" style={{ background: 'var(--neon-blue-6)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      background: 'var(--neon-blue)',
                      width: `${data.step_total > 0 ? (data.step_current / data.step_total) * 100 : 0}%`,
                    }}
                  />
                </div>
                {/* 步骤圆点指示器 */}
                <div className="flex items-center gap-1.5 mb-1">
                  {Array.from({ length: data.step_total }, (_, i) => (
                    <div
                      key={i}
                      className="h-1.5 rounded-full transition-all duration-500"
                      style={{
                        width: i < data.step_current ? '16px' : '6px',
                        background: i < data.step_current ? 'var(--neon-blue)' : 'var(--neon-blue-10)',
                        opacity: i < data.step_current ? 1 : 0.4,
                      }}
                    />
                  ))}
                </div>
                <p className="text-xs text-surface-400">{data.message}</p>
              </div>
            ))}
            {/* 扫描进度 */}
            {Object.entries(scanProgress).map(([libId, data]) => (
              <div key={`scan-${libId}`} className="glass-panel-subtle rounded-xl p-4" style={{ borderColor: 'var(--neon-blue-15)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('dash.scanLine', { name: data.library_name })}</span>
                  <span className="text-xs text-neon">{t('dash.scanNew', { count: data.new_found })}</span>
                </div>
                <p className="text-xs text-surface-400">{data.message}</p>
              </div>
            ))}
            {Object.entries(scrapeProgress).map(([key, data]) => (
              <div key={`scrape-${key}`} className="glass-panel-subtle rounded-xl p-4" style={{ borderColor: 'var(--neon-purple-15)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('dash.scrapingLine')}</span>
                  <span className="text-xs" style={{ color: 'var(--neon-purple)' }}>{t('dash.scrapeProgress', { current: data.current, total: data.total, ok: data.success, failed: data.failed })}</span>
                </div>
                <div className="mb-2 h-2 overflow-hidden rounded-full" style={{ background: 'var(--neon-blue-6)' }}>
                  <div className="h-full rounded-full transition-all duration-300" style={{ background: 'var(--neon-purple)', width: `${data.total > 0 ? (data.current / data.total) * 100 : 0}%` }} />
                </div>
                <p className="text-xs text-surface-400">{data.message}</p>
              </div>
            ))}
            {Object.entries(transcodeProgress).map(([taskId, data]) => (
              <div key={`transcode-${taskId}`} className="glass-panel-subtle rounded-xl p-4" style={{ borderColor: 'rgba(245,158,11,0.15)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('dash.transcodeLine', { title: data.title, quality: data.quality })}</span>
                  <span className="text-xs" style={{ color: '#B45309' }}>{data.progress.toFixed(1)}% {data.speed && `| ${data.speed}`}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--neon-blue-6)' }}>
                  <div className="h-full rounded-full transition-all duration-300" style={{ width: `${data.progress}%`, background: '#D97706' }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 系统信息 */}
      {systemInfo && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-wide" style={{ color: 'var(--text-primary)' }}>
            <Server size={20} className="text-neon/60" />
            {t('dash.systemTitle')}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="glass-panel-subtle rounded-xl p-4">
              <div className="flex items-center gap-2 text-surface-400">
                <Cpu size={16} className="text-neon/60" />
                <span className="text-xs">{t('dash.cpuCores')}</span>
              </div>
              <p className="mt-2 font-display text-lg font-bold tracking-wide" style={{ color: 'var(--text-primary)' }}>
                {t('dash.cpuCount', { count: systemInfo.cpus })}
              </p>
            </div>
            <div className="glass-panel-subtle rounded-xl p-4">
              <div className="flex items-center gap-2 text-surface-400">
                <Activity size={16} className="text-neon/60" />
                <span className="text-xs">{t('dash.goRoutines')}</span>
              </div>
              <p className="mt-2 font-display text-lg font-bold tracking-wide" style={{ color: 'var(--text-primary)' }}>
                {systemInfo.goroutines}
              </p>
              <p className="text-xs text-surface-500">{t('dash.actGoroutine')}</p>
            </div>
            <div className="glass-panel-subtle rounded-xl p-4">
              <div className="flex items-center gap-2 text-surface-400">
                <HardDrive size={16} className="text-neon/60" />
                <span className="text-xs">{t('dash.procMemory')}</span>
              </div>
              {(() => {
                // 本进程占用内存（MB）：优先使用后端返回的 process_used_mb，回退到 sys_mb/alloc_mb
                const processMB =
                  systemInfo.memory.process_used_mb ??
                  systemInfo.memory.sys_mb ??
                  systemInfo.memory.alloc_mb
                const hostTotalMB = systemInfo.memory.system_total_mb
                // 进程内存格式化：< 1024 MB 用 MB，否则用 GB
                const fmt = (mb: number) =>
                  mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
                // 占主机物理内存的百分比
                const pct =
                  systemInfo.memory.process_used_percent ??
                  (hostTotalMB ? (processMB / hostTotalMB) * 100 : 0)
                const pctText = pct < 1 ? pct.toFixed(2) : pct.toFixed(1)
                const allocMB = systemInfo.memory.alloc_mb
                return (
                  <>
                    <p className="mt-2 font-display text-lg font-bold tracking-wide" style={{ color: 'var(--text-primary)' }}>
                      {fmt(processMB)}
                    </p>
                    {hostTotalMB ? (
                      <>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.min(Math.max(pct, 0.5), 100)}%`,
                              background: pct > 50 ? '#EF4444' : pct > 20 ? '#F59E0B' : '#22C55E',
                            }}
                          />
                        </div>
                        <p className="mt-1 text-xs text-surface-500">
                          {t('dash.hostPct', { pct: pctText, alloc: allocMB.toFixed(1) })}
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-xs text-surface-500">
                        {t('dash.heap', { alloc: allocMB.toFixed(1) })}
                      </p>
                    )}
                  </>
                )
              })()}
            </div>
            <div className="glass-panel-subtle rounded-xl p-4">
              <div className="flex items-center gap-2 text-surface-400">
                <Zap size={16} className="text-neon/60" />
                <span className="text-xs">{t('dash.hwAccel')}</span>
              </div>
              <p className="mt-2 text-lg font-bold" style={{ color: systemInfo.hw_accel !== 'none' ? '#16A34A' : '#CA8A04' }}>
                {formatHwAccel(systemInfo.hw_accel)}
              </p>
            </div>
            <div className="glass-panel-subtle rounded-xl p-4">
              <div className="flex items-center gap-2 text-surface-400">
                <Server size={16} className="text-neon/60" />
                <span className="text-xs">{t('dash.version')}</span>
              </div>
              <p className="mt-2 font-display text-lg font-bold tracking-wide" style={{ color: 'var(--text-primary)' }}>v{systemInfo.version}</p>
              <p className="text-xs text-surface-500">Web v{webAppVersion} · {systemInfo.go_version} / {systemInfo.os}_{systemInfo.arch}</p>
            </div>
          </div>
        </section>
      )}


      {/* 剧集合并管理 */}
      <section>
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-wide" style={{ color: 'var(--text-primary)' }}>
          <Merge size={20} className="text-neon/60" />
          {t('dash.mergeTitle')}
        </h2>
        <div className="glass-panel rounded-xl p-5 space-y-4">
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium select-none" style={{ color: 'var(--text-tertiary)' }}>
              {t('dash.mergeWhat')}
              <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
            </summary>
            <div className="mt-2 rounded-lg p-3 text-xs leading-relaxed" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)', color: 'var(--text-tertiary)' }}>
              {t('dash.mergeExplain1')}
              {t('dash.mergeExplain2')}
            </div>
          </details>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCheckMergeCandidates}
              disabled={mergeCandidatesLoading || mergeLoading}
              className="btn-secondary gap-1.5 px-4 py-2 text-sm"
            >
              {mergeCandidatesLoading ? (
                <><Loader2 size={14} className="animate-spin" />{t('dash.detectRunning')}</>
              ) : (
                <>{t('dash.detectBtn')}</>
              )}
            </button>
            <button
              onClick={handleAutoMerge}
              disabled={mergeLoading || mergeCandidatesLoading}
              className="btn-primary gap-1.5 px-4 py-2 text-sm"
            >
              {mergeLoading ? (
                <><Loader2 size={14} className="animate-spin" />{t('dash.mergeRunning')}</>
              ) : (
                <><Merge size={14} />{t('dash.mergeBtn')}</>
              )}
            </button>
          </div>

          {/* 合并结果提示 */}
          {mergeResult && (
            <div className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm" style={{
              background: mergeResult.type === 'success' ? 'rgba(22, 163, 74, 0.08)' : mergeResult.type === 'error' ? 'rgba(220, 38, 38, 0.08)' : 'rgba(59, 130, 246, 0.08)',
              color: mergeResult.type === 'success' ? '#16A34A' : mergeResult.type === 'error' ? '#DC2626' : '#3B82F6',
            }}>
              {mergeResult.type === 'success' ? <Check size={16} /> : mergeResult.type === 'error' ? <X size={16} /> : <Merge size={16} />}
              {mergeResult.message}
              {mergeResult.groups_processed !== undefined && (
                <span className="ml-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  ({t('dash.mergeResult', { groups: mergeResult.groups_processed ?? 0, total: mergeResult.total_merged ?? 0 })})
                </span>
              )}
            </div>
          )}

          {/* 候选列表 */}
          {mergeCandidates && mergeCandidates.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{t('dash.mergeGroups')}</h4>
              <div className="max-h-60 overflow-y-auto rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>{t('dash.colSeries')}</th>
                      <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>{t('dash.colDupCount')}</th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>{t('dash.colTitles')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mergeCandidates.map((group, idx) => (
                      <tr key={idx} style={{ borderBottom: idx < mergeCandidates.length - 1 ? '1px solid var(--border-default)' : 'none' }}>
                        <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{group.normalized_title}</td>
                        <td className="px-3 py-2 text-center" style={{ color: 'var(--neon-blue)' }}>{group.count}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--text-tertiary)' }}>
                          {group.series.map(s => s.title).join('、')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 危险区域 - 一键清空数据 */}
      <section>
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-wide" style={{ color: '#DC2626' }}>
          <ShieldAlert size={20} />
          {t('dash.dangerZone')}
        </h2>
        <div className="rounded-xl p-5 space-y-4" style={{ background: 'rgba(220, 38, 38, 0.04)', border: '1px solid rgba(220, 38, 38, 0.15)' }}>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(220, 38, 38, 0.08)', border: '1px solid rgba(220, 38, 38, 0.15)' }}>
              <Trash2 size={22} style={{ color: '#DC2626' }} />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('dash.wipeTitle')}</h4>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                {t('dash.wipeDesc1')}<strong style={{ color: '#DC2626' }}>{t('dash.wipeDesc2')}</strong>。
                {t('dash.wipeKeep1')}<strong style={{ color: '#16A34A' }}>{t('dash.wipeKeep2')}</strong>{t('dash.wipeKeep3')}
                <strong style={{ color: '#16A34A' }}>{t('dash.wipeKeep4')}</strong>。{t('dash.wipeDesc3')}
              </p>
            </div>
            <button
              onClick={() => { setClearDialogOpen(true); setClearResult(null) }}
              className="flex-shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200"
              style={{ background: 'rgba(220, 38, 38, 0.08)', border: '1px solid rgba(220, 38, 38, 0.2)', color: '#DC2626' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(220, 38, 38, 0.15)'; e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.4)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(220, 38, 38, 0.08)'; e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.2)' }}
            >
              {t('dash.wipeBtn')}
            </button>
          </div>

          {/* 清理结果展示 */}
          {clearResult && (
            <div className="rounded-lg p-4 space-y-3" style={{
              background: clearResult.status === 'success' ? 'rgba(22, 163, 74, 0.06)' : clearResult.status === 'partial' ? 'rgba(202, 138, 4, 0.06)' : 'rgba(220, 38, 38, 0.06)',
              border: `1px solid ${clearResult.status === 'success' ? 'rgba(22, 163, 74, 0.15)' : clearResult.status === 'partial' ? 'rgba(202, 138, 4, 0.15)' : 'rgba(220, 38, 38, 0.15)'}`,
            }}>
              <div className="flex items-center gap-2">
                {clearResult.status === 'success' ? (
                  <Check size={16} style={{ color: '#16A34A' }} />
                ) : clearResult.status === 'partial' ? (
                  <AlertTriangle size={16} style={{ color: '#CA8A04' }} />
                ) : (
                  <X size={16} style={{ color: '#DC2626' }} />
                )}
                <span className="text-sm font-medium" style={{
                  color: clearResult.status === 'success' ? '#16A34A' : clearResult.status === 'partial' ? '#CA8A04' : '#DC2626',
                }}>
                  {clearResult.message}
                </span>
              </div>

              {/* 详细结果表格 */}
              {clearResult.details.length > 0 && (
                <div className="max-h-60 overflow-y-auto rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>{t('dash.colDataType')}</th>
                        <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>{t('dash.colClearCount')}</th>
                        <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>{t('dash.colStatus')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clearResult.details.map((detail, idx) => (
                        <tr key={idx} style={{ borderBottom: idx < clearResult.details.length - 1 ? '1px solid var(--border-default)' : 'none' }}>
                          <td className="px-3 py-1.5" style={{ color: 'var(--text-primary)' }}>{detail.table}</td>
                          <td className="px-3 py-1.5 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{detail.cleared}</td>
                          <td className="px-3 py-1.5 text-center">
                            {detail.status === 'success' ? (
                              <span className="inline-flex items-center gap-1" style={{ color: '#16A34A' }}><Check size={12} />{t('dash.clearOk')}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1" style={{ color: '#DC2626' }} title={detail.message}><X size={12} />{t('dash.clearFail')}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 汇总 */}
              <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                <span>{t('dash.clearOkCount', { count: clearResult.success_count })}</span>
                {clearResult.error_count > 0 && (
                  <span>{t('dash.clearFailCount', { count: clearResult.error_count })}</span>
                )}
                <span>{t('dash.clearTotal', { count: clearResult.total_cleared })}</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 二次确认弹窗 */}
      <Modal
        open={clearDialogOpen}
        onClose={() => { setClearDialogOpen(false); setClearConfirmText('') }}
        dismissible={!clearLoading}
        className="max-w-md"
        >
          <div className="rounded-2xl p-6 space-y-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-elevated)' }}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: 'rgba(220, 38, 38, 0.08)' }}>
                <AlertTriangle size={20} style={{ color: '#DC2626' }} />
              </div>
              <div>
                <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{t('dash.confirmTitle')}</h3>
                <p className="text-xs" style={{ color: '#DC2626' }}>{t('dash.confirmDesc')}</p>
              </div>
            </div>

            <div className="rounded-lg p-3 text-xs leading-relaxed" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}>
              <p className="mb-2 font-medium" style={{ color: 'var(--text-secondary)' }}>{t('dash.confirmListTitle1')}<strong style={{ color: '#DC2626' }}>{t('dash.confirmListTitle2')}</strong>{t('dash.confirmListTitle3')}</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>{t('dash.wipeList1')}</li>
                <li>{t('dash.wipeList2')}</li>
                <li>{t('dash.wipeList3')}</li>
                <li>{t('dash.wipeList4')}</li>
                <li>{t('dash.wipeList5')}</li>
                <li><strong>{t('dash.wipeList6a')}</strong>{t('dash.wipeList6b')}</li>
                <li><strong>{t('dash.wipeList7a')}</strong>{t('dash.wipeList7b')}</li>
                <li><strong>{t('dash.wipeList8a')}</strong>{t('dash.wipeList8b')}</li>
                <li><strong>{t('dash.wipeList9a')}</strong>{t('dash.wipeList9b')}</li>
              </ul>
              <p className="mt-2 font-medium" style={{ color: '#16A34A' }}>{t('dash.keepOnly')}</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>{t('dash.keepFiles')}</li>
                <li>{t('dash.keepAdmin')}</li>
              </ul>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                {t('dash.typeConfirm1')} <strong style={{ color: '#DC2626' }}>{t('dash.clearWord')}</strong> {t('dash.typeConfirm2')}
              </label>
              <input
                type="text"
                value={clearConfirmText}
                onChange={(e) => setClearConfirmText(e.target.value)}
                placeholder={t('dash.clearWord')}
                className="input w-full"
                disabled={clearLoading}
                autoFocus
              />
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => { setClearDialogOpen(false); setClearConfirmText('') }}
                disabled={clearLoading}
                className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                style={{ color: 'var(--text-secondary)', background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleClearAllData}
                disabled={clearConfirmText !== t('dash.clearWord') || clearLoading}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200"
                style={{
                  background: clearConfirmText === t('dash.clearWord') && !clearLoading ? '#DC2626' : 'rgba(220, 38, 38, 0.12)',
                  color: clearConfirmText === t('dash.clearWord') && !clearLoading ? '#ffffff' : 'rgba(220, 38, 38, 0.4)',
                  cursor: clearConfirmText === t('dash.clearWord') && !clearLoading ? 'pointer' : 'not-allowed',
                }}
                onMouseEnter={(e) => { if (clearConfirmText === t('dash.clearWord') && !clearLoading) e.currentTarget.style.background = '#B91C1C' }}
                onMouseLeave={(e) => { if (clearConfirmText === t('dash.clearWord') && !clearLoading) e.currentTarget.style.background = '#DC2626' }}
              >
                {clearLoading ? (
                  <><Loader2 size={14} className="animate-spin" />{t('dash.clearing')}</>
                ) : (
                  <><Trash2 size={14} />{t('dash.wipeConfirm')}</>
                )}
              </button>
            </div>
          </div>
        </Modal>
    </div>
  )
}

// 可复用的 Toggle 按钮
