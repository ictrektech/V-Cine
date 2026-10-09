/**
 * AIDispatcherPanel - 切换审计日志面板
 *
 * 仅展示 AI Provider 切换的历史记录。
 * "当前调度状态"和"用量趋势"已整合进 AITab 的使用统计区块。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from '@/i18n'
import { aiApi } from '@/api/ai'
import { useToast } from '@/components/Toast'
import type { AIFailoverLog } from '@/types'

interface AIDispatcherPanelProps {
  onConfigChanged?: () => void
}

export default function AIDispatcherPanel(_props: AIDispatcherPanelProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const [logs, setLogs] = useState<AIFailoverLog[]>([])
  const [loading, setLoading] = useState(true)

  const loadLogs = async () => {
    try {
      const res = await aiApi.listFailoverLogs(50)
      setLogs(res.data.data ?? [])
    } catch (err: any) {
      toast.error(t('aid.loadFailed') + (err?.response?.data?.error || err?.message || ''))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <div className="glass-panel rounded-xl p-6 text-sm text-theme-muted">
        {t('aid.loading')}
      </div>
    )
  }

  return (
    <div className="glass-panel rounded-xl p-5">
      <div className="mb-3 font-display text-lg font-semibold tracking-wide text-theme-primary flex items-center gap-2">
        <span className="text-neon">🛟</span> {t('aid.title')}
      </div>
      {logs.length === 0 ? (
        <div className="py-4 text-center text-sm text-theme-muted">{t('aid.empty')}</div>
      ) : (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 text-theme-muted" style={{ background: 'var(--bg-surface)' }}>
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('aid.colTime')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('aid.colFrom')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('aid.colTo')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('aid.colReason')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('aid.colActor')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td className="px-3 py-2 text-theme-secondary">{new Date(l.occurred_at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-theme-secondary">{l.from_provider}</td>
                  <td className="px-3 py-2 font-medium text-theme-primary">{l.to_provider}</td>
                  <td className="px-3 py-2 text-theme-secondary">{l.reason}</td>
                  <td className="px-3 py-2 text-theme-muted">{l.operator}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
