import { Fragment, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Copy, Loader2 } from 'lucide-react'
import { videoAnalysisApi } from '@/api'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/i18n'
import { copyToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import type { VideoAnalysisTask, VideoAnalysisWarning } from '@/types/videoAnalysis'
import {
  formatVideoAnalysisError,
  formatVideoAnalysisTime,
  videoAnalysisStageKeys,
  videoAnalysisStatusKeys,
} from './videoAnalysisResultUtils'

interface VideoAnalysisErrorDetailProps {
  task: VideoAnalysisTask
}

/**
 * 分析错误详情：默认单行摘要，展开后查看任务上下文 + 逐场景原始报错（结果 warnings），
 * 可一键复制完整信息发给开发排查。任务级 error_message 多为后端聚合文案，
 * 逐场景原始报错更能定位问题。
 */
export default function VideoAnalysisErrorDetail({ task }: VideoAnalysisErrorDetailProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  // 逐场景原始报错来自结果 warnings：仅在展开时懒加载一次
  const [warnings, setWarnings] = useState<VideoAnalysisWarning[] | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const raw = task.error_message || ''
  const summary = useMemo(() => formatVideoAnalysisError(raw, t), [raw, t])

  // 重试会复用同一条任务记录：状态/完成时间变化后丢弃缓存明细，展开时重新拉取
  const detailVersion = `${task.status}|${task.finished_at || ''}`
  useEffect(() => {
    setWarnings(null)
  }, [detailVersion])

  useEffect(() => {
    if (!open || warnings !== null) return
    let cancelled = false
    setLoadingDetail(true)
    videoAnalysisApi.getResult(task.media_id, task.id)
      .then((res) => {
        if (!cancelled) setWarnings(res.data.data?.warnings || [])
      })
      .catch(() => {
        // 结果不可读时退回展示任务错误原文
        if (!cancelled) setWarnings([])
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, warnings, task.id, task.media_id])

  if (!raw) return null

  const meta: Array<[string, string]> = [[t('vat.errorDetailTaskId'), task.id], [t('vat.errorDetailMediaId'), task.media_id]]
  const stageKey = videoAnalysisStageKeys[task.stage]
  if (stageKey) meta.push([t('vat.errorDetailStage'), t(stageKey)])
  meta.push([t('vat.errorDetailStatus'), t(videoAnalysisStatusKeys[task.status])])
  if (task.error_code) meta.push([t('vat.errorDetailErrorCode'), task.error_code])
  meta.push([t('vat.errorDetailSubmittedAt'), formatVideoAnalysisTime(task.created_at)])
  if (task.finished_at) meta.push([t('vat.errorDetailFinishedAt'), formatVideoAnalysisTime(task.finished_at)])

  // 场景级告警按 scene_index 排序，避免并发写入导致的乱序
  const failureItems = [...(warnings || [])].sort((a, b) => {
    const left = a.target_id != null && a.target_id !== '' ? Number(a.target_id) : NaN
    const right = b.target_id != null && b.target_id !== '' ? Number(b.target_id) : NaN
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right
    return 0
  })

  // 复制内容用稳定的英文键名与原文，便于开发人员直接检索排查（不受界面语言影响）
  const copyLines = [
    'Video analysis task error',
    `task_id: ${task.id}`,
    `media_id: ${task.media_id}`,
    `status: ${task.status}`,
    `stage: ${task.stage}`,
    task.error_code ? `error_code: ${task.error_code}` : '',
    `created_at: ${task.created_at}`,
    task.finished_at ? `finished_at: ${task.finished_at}` : '',
  ].filter(Boolean)
  if (failureItems.length > 0) {
    copyLines.push('', 'failures:')
    failureItems.forEach((item) => {
      copyLines.push(`- [${item.code || 'WARNING'}] ${item.message}`)
      if (item.detail) copyLines.push(...item.detail.split('\n').map((line) => `  ${line}`))
    })
  }
  copyLines.push('', 'error_message:', raw)

  const handleCopy = async () => {
    // 统一走 lib/clipboard：HTTP / 内网访问时 navigator.clipboard 不存在，由它回退 execCommand。
    await copyToClipboard(copyLines.join('\n'))
    setCopied(true)
    toast.success(t('vat.errorDetailCopied'))
    window.setTimeout(() => setCopied(false), 2000)
  }

  const copyButton = (
    <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px]" onClick={handleCopy}>
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {t('common.copy')}
    </Button>
  )

  return (
    <div className="mt-1">
      <div className="flex items-start gap-2">
        {/* 摘要行面向用户，始终保持单行简短；完整信息在展开明细里 */}
        <p className="min-w-0 flex-1 truncate text-xs text-red-400" title={summary}>
          {summary}
        </p>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? t('vat.errorDetailCollapse') : t('vat.errorDetailExpand')}
          <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {open && (
        <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/5 p-2.5">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]">
            {meta.map(([label, value]) => (
              <Fragment key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="break-all font-mono text-foreground/80">{value}</dd>
              </Fragment>
            ))}
          </dl>

          {loadingDetail ? (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              {t('vat.errorDetailLoading')}
            </div>
          ) : failureItems.length > 0 ? (
            <>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">{t('vat.errorDetailFailures', { count: failureItems.length })}</span>
                {copyButton}
              </div>
              <ul className="mt-1 max-h-48 space-y-1 overflow-auto pr-0.5">
                {failureItems.map((item, index) => (
                  <li key={`${item.code || 'warning'}-${item.target_id || index}`} className="rounded-md bg-background/70 px-2 py-1.5">
                    <div>
                      {item.code && (
                        <span className="mr-1.5 rounded bg-red-500/10 px-1 py-0.5 font-mono text-[10px] text-red-400">{item.code}</span>
                      )}
                      <span className="text-[11px] leading-relaxed text-foreground [overflow-wrap:anywhere]">{item.message}</span>
                    </div>
                    {item.detail && (
                      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-red-500/5 p-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                        {item.detail}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">{t('vat.errorDetailRaw')}</span>
                {copyButton}
              </div>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/70 p-2 font-mono text-[11px] leading-relaxed text-foreground [overflow-wrap:anywhere]">
                {raw}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
