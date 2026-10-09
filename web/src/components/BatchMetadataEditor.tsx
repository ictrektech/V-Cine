import { useState } from 'react'
import { batchMetadataApi } from '@/api'
import type { BatchUpdateResult } from '@/types'
import { Edit3, Loader2, CheckCircle, AlertCircle, X } from 'lucide-react'
import clsx from 'clsx'
import { useTranslation } from '@/i18n'

interface BatchMetadataEditorProps {
  selectedIds: string[]
  type: 'media' | 'series'
  onClose: () => void
  onSuccess?: () => void
}

const EDITABLE_FIELDS = [
  { key: 'genres', labelKey: 'bme.genres', placeholderKey: 'bme.genresPh' },
  { key: 'year', labelKey: 'bme.year', placeholderKey: 'bme.yearPh' },
  { key: 'rating', labelKey: 'bme.rating', placeholderKey: 'bme.ratingPh' },
  { key: 'country', labelKey: 'bme.country', placeholderKey: 'bme.countryPh' },
  { key: 'language', labelKey: 'bme.language', placeholderKey: 'bme.languagePh' },
  { key: 'studio', labelKey: 'bme.studio', placeholderKey: 'bme.studioPh' },
]

export default function BatchMetadataEditor({ selectedIds, type, onClose, onSuccess }: BatchMetadataEditorProps) {
  const { t } = useTranslation()
  const [updates, setUpdates] = useState<Record<string, string>>({})
  const [enabledFields, setEnabledFields] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BatchUpdateResult | null>(null)

  const toggleField = (key: string) => {
    setEnabledFields(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
        const newUpdates = { ...updates }
        delete newUpdates[key]
        setUpdates(newUpdates)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const handleSubmit = async () => {
    const activeUpdates: Record<string, string> = {}
    for (const key of enabledFields) {
      if (updates[key] !== undefined) {
        activeUpdates[key] = updates[key]
      }
    }

    if (Object.keys(activeUpdates).length === 0) return

    setLoading(true)
    try {
      let res
      if (type === 'media') {
        res = await batchMetadataApi.batchUpdateMedia({
          media_ids: selectedIds,
          updates: activeUpdates,
        })
      } else {
        res = await batchMetadataApi.batchUpdateSeries({
          series_ids: selectedIds,
          updates: activeUpdates,
        })
      }
      setResult(res.data.data)
      onSuccess?.()
    } catch {
      setResult({ total: selectedIds.length, success: 0, failed: selectedIds.length, errors: [t('bme.updateFailed')] })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl p-6" style={{
        background: 'var(--glass-bg)',
        border: '1px solid var(--neon-blue-15)',
        backdropFilter: 'blur(20px)',
      }}>
        {/* 标题 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Edit3 className="h-5 w-5 text-neon-blue" />
            <div>
              <h3 className="font-display text-lg font-semibold text-white">{t('bme.title')}</h3>
              <p className="text-xs text-surface-400">{t('bme.selectedCount', { count: selectedIds.length, kind: type === 'media' ? t('bme.kindMedia') : t('bme.kindSeries') })}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-surface-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {result ? (
          /* 结果展示 */
          <div className="space-y-4">
            <div className={clsx(
              'rounded-xl p-4 text-center',
              result.failed === 0 ? 'bg-green-500/10 border border-green-500/20' : 'bg-yellow-500/10 border border-yellow-500/20'
            )}>
              {result.failed === 0 ? (
                <CheckCircle className="h-10 w-10 text-green-400 mx-auto mb-2" />
              ) : (
                <AlertCircle className="h-10 w-10 text-yellow-400 mx-auto mb-2" />
              )}
              <p className="text-white font-medium">
                {t('bme.success', { ok: result.success, total: result.total })}
              </p>
              {result.failed > 0 && (
                <p className="text-sm text-surface-400 mt-1">{t('bme.failedCount', { count: result.failed })}</p>
              )}
            </div>
            {result.errors.length > 0 && (
              <div className="max-h-32 overflow-y-auto rounded-lg bg-red-500/5 p-3">
                {result.errors.map((err, i) => (
                  <p key={i} className="text-xs text-red-400">{err}</p>
                ))}
              </div>
            )}
            <button onClick={onClose} className="btn-neon w-full rounded-xl py-2.5 text-sm font-medium">
              {t('common.close')}
            </button>
          </div>
        ) : (
          /* 编辑表单 */
          <div className="space-y-3">
            {EDITABLE_FIELDS.map(({ key, labelKey, placeholderKey }) => (
              <div key={key} className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer w-28 shrink-0">
                  <input
                    type="checkbox"
                    checked={enabledFields.has(key)}
                    onChange={() => toggleField(key)}
                    className="rounded border-surface-500 bg-surface-700 text-neon-blue focus:ring-neon-blue/30"
                  />
                  <span className="text-sm text-surface-300">{t(labelKey)}</span>
                </label>
                <input
                  type="text"
                  value={updates[key] || ''}
                  onChange={e => setUpdates(prev => ({ ...prev, [key]: e.target.value }))}
                  disabled={!enabledFields.has(key)}
                  placeholder={t(placeholderKey)}
                  className={clsx(
                    'input-glass flex-1 rounded-lg px-3 py-2 text-sm',
                    !enabledFields.has(key) && 'opacity-40'
                  )}
                />
              </div>
            ))}

            <div className="flex items-center gap-3 pt-3">
              <button onClick={onClose} className="btn-ghost flex-1 rounded-xl py-2.5 text-sm">
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || enabledFields.size === 0}
                className="btn-neon flex-1 rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Edit3 className="h-4 w-4" />}
                {t('bme.apply')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
