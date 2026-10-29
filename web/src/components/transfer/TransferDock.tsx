import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronUp, RotateCw, UploadCloud, X } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { formatFileSize } from '@/components/file-manager/constants'
import { uploadErrorMessage } from '@/lib/uploadErrors'
import { useAIPanelStore } from '@/stores/aiPanel'
import { useTransferStore, type TransferItem, type TransferStatus } from '@/stores/transfer'

/**
 * 全局上传队列抽屉（右下角）
 *
 * 生命周期独立于「添加视频」弹窗：关闭弹窗 / 切换 Tab 任务继续。
 * 刷新页面会丢失未完成项（文件对象无法持久化），页脚明示该限制（PLAN D5）。
 *
 * 固定在右下角；渲染高度同步到 store；AI 助手对话面板展开时整体隐藏。
 */
export default function TransferDock() {
  const { t } = useTranslation()
  const aiPanelOpen = useAIPanelStore((s) => s.open)
  const items = useTransferStore((s) => s.items)
  const dockOpen = useTransferStore((s) => s.dockOpen)
  const concurrency = useTransferStore((s) => s.concurrency)
  const setDockOpen = useTransferStore((s) => s.setDockOpen)
  const setConcurrency = useTransferStore((s) => s.setConcurrency)
  const setDockHeight = useTransferStore((s) => s.setDockHeight)
  const retry = useTransferStore((s) => s.retry)
  const cancel = useTransferStore((s) => s.cancel)
  const clearFinished = useTransferStore((s) => s.clearFinished)
  const dockRef = useRef<HTMLDivElement>(null)

  // 抽屉高度随收起/展开变化，实时上报给 store
  useEffect(() => {
    const el = dockRef.current
    if (!el) {
      setDockHeight(0)
      return
    }
    const sync = () => setDockHeight(Math.round(el.getBoundingClientRect().height))
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [items.length, setDockHeight])

  if (items.length === 0) return null

  const done = items.filter((i) => i.status === 'done').length
  const failed = items.filter((i) => i.status === 'failed').length
  const finished = items.filter((i) => i.status === 'done' || i.status === 'failed').length
  const pending = items.length - finished

  // 全部成功后才清空并移除抽屉；有未结束或有失败的条目时只收起
  const closeDock = () => {
    if (pending > 0 || failed > 0) setDockOpen(false)
    else clearFinished()
  }

  const statusLabel = (status: TransferStatus) => {
    switch (status) {
      case 'queued':
        return t('fm.transferQueued')
      case 'uploading':
        return t('fm.transferUploading')
      case 'scanning':
        return t('fm.transferScanning')
      case 'done':
        return t('fm.transferDone')
      case 'failed':
        return t('fm.transferFailed')
    }
  }

  const renderRow = (item: TransferItem) => {
    const running = item.status === 'uploading'
    const errorText = item.status === 'failed' ? uploadErrorMessage(item.errorCode, t) : ''
    return (
      <div key={item.id} className="rounded-lg px-1 py-1.5">
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate text-xs font-medium" style={{ color: 'var(--text-primary)' }} title={item.file.name}>
            {item.file.name}
          </span>
          <span className="flex-shrink-0 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            {formatFileSize(item.file.size)}
          </span>
          {item.status === 'failed' ? (
            <button
              onClick={() => retry(item.id)}
              className="btn-ghost flex-shrink-0 rounded p-1"
              title={t('fm.transferRetry')}
            >
              <RotateCw size={12} />
            </button>
          ) : item.status === 'queued' || item.status === 'uploading' ? (
            <button
              onClick={() => cancel(item.id)}
              className="btn-ghost flex-shrink-0 rounded p-1"
              title={t('fm.transferCancel')}
            >
              <X size={12} />
            </button>
          ) : null}
        </div>

        <div className="mt-1 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-700">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${item.status === 'done' ? 100 : item.progress}%`,
                background: item.status === 'failed' ? '#f87171' : 'var(--neon, #22d3ee)',
              }}
            />
          </div>
          <span className="flex-shrink-0 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            {running ? `${item.progress}%` : statusLabel(item.status)}
          </span>
        </div>

        {errorText && <p className="mt-0.5 text-[11px] text-red-400">{errorText}</p>}
        {item.note === 'scan_failed' && (
          <p className="mt-0.5 text-[11px] text-amber-400">{t('fm.transferScanFailed')}</p>
        )}
      </div>
    )
  }

  return (
    <div
      ref={dockRef}
      className={clsx(
        'fixed bottom-4 right-4 z-40 w-[340px] max-w-[calc(100vw-2rem)] transition-all duration-200',
        aiPanelOpen ? 'invisible pointer-events-none translate-y-2 opacity-0' : 'visible translate-y-0 opacity-100'
      )}
    >
      <div className="glass-panel-strong overflow-hidden rounded-xl">
        <div className="flex w-full items-center gap-2 px-3 py-2">
          <button
            onClick={() => setDockOpen(!dockOpen)}
            className="flex flex-1 items-center gap-2 text-left"
          >
            <UploadCloud size={16} className="flex-shrink-0 text-neon" />
            <span className="flex-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {t('fm.transferTitle')}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {done}/{items.length}
            </span>
            {failed > 0 && <span className="text-xs text-red-400">{failed}</span>}
            {dockOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button
            onClick={closeDock}
            className="btn-ghost flex-shrink-0 rounded p-1"
            title={t('fm.transferClose')}
            aria-label={t('fm.transferClose')}
          >
            <X size={14} />
          </button>
        </div>

        {dockOpen && (
          <div className="border-t px-3 py-2" style={{ borderColor: 'var(--border-default)' }}>
            <div className="max-h-[45vh] space-y-1 overflow-y-auto">{items.map(renderRow)}</div>

            <div className="mt-2 flex items-center gap-2 border-t pt-2" style={{ borderColor: 'var(--border-default)' }}>
              <label className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {t('fm.transferConcurrency')}
                <select
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  className="rounded border px-1 py-0.5 text-[11px]"
                  style={{ borderColor: 'var(--border-default)', background: 'transparent' }}
                >
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <span className="flex-1" />
              {finished > 0 && (
                <button onClick={clearFinished} className="btn-ghost rounded px-2 py-0.5 text-[11px]">
                  {t('fm.transferClearDone')}
                </button>
              )}
            </div>
            <p className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
              {t('fm.transferRefreshHint')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
