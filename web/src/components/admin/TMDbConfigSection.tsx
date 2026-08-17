import { useState } from 'react'
import {
  Film, ExternalLink, Key, Eye, EyeOff, Check, X, Loader2, Wifi, Trash2, Info, ChevronRight,
} from 'lucide-react'
import clsx from 'clsx'
import { adminApi } from '@/api'
import { useTranslation } from '@/i18n'
import { useDialog } from '@/components/Dialog'
import TMDbProxySettings from '@/components/admin/TMDbProxySettings'
import type { TMDbConfigStatus } from '@/types'

// ==================== 元数据刮削 › TMDb 配置 ====================
// API Key 配置 + 网络代理（代理为高级设置，折叠展示）。

type Props = {
  tmdbConfig: TMDbConfigStatus | null
  setTmdbConfig: (c: TMDbConfigStatus) => void
}

export default function TMDbConfigSection({ tmdbConfig, setTmdbConfig }: Props) {
  const { t } = useTranslation()
  const dialog = useDialog()
  const [keyInput, setKeyInput] = useState('')
  const [editing, setEditing] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  const showMsg = (type: 'success' | 'error' | 'info', text: string) => {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 5000)
  }

  const handleSave = async () => {
    const key = keyInput.trim()
    if (!key) return
    setSaving(true)
    try {
      const res = await adminApi.updateTMDbConfig(key)
      setTmdbConfig(res.data.data)
      setKeyInput('')
      setEditing(false)
      setShowKey(false)
      showMsg('success', t('admin.tmdbSaveSuccess'))
    } catch (err: any) {
      const m = err?.response?.data?.error || t('admin.tmdbSaveFailed')
      showMsg('error', m)
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    const ok = await dialog.confirm({
      title: t('admin.tmdbClearConfirm'),
      confirmText: t('admin.confirm') || '确定',
      variant: 'danger',
    })
    if (!ok) return
    try {
      const res = await adminApi.clearTMDbConfig()
      setTmdbConfig(res.data.data)
      setKeyInput('')
      setEditing(false)
      showMsg('success', t('admin.tmdbClearSuccess'))
    } catch {
      showMsg('error', t('admin.tmdbClearFailed'))
    }
  }

  const handleTest = async () => {
    const inputKey = keyInput.trim()
    const useInput = editing && inputKey.length > 0
    if (!useInput && !tmdbConfig?.configured) {
      showMsg('error', t('admin.tmdbTestNoKey'))
      return
    }
    setTesting(true)
    showMsg('info', t('admin.tmdbTesting'))
    try {
      const res = useInput
        ? await adminApi.testTMDbKey(inputKey)
        : await adminApi.validateTMDbConfig()
      const { valid, message } = res.data.data
      showMsg(valid ? 'success' : 'error', message || (valid ? t('admin.tmdbTestOK') : t('admin.tmdbTestFailed')))
    } catch (err: any) {
      const m = err?.response?.data?.error || t('admin.tmdbTestFailed')
      showMsg('error', m)
    } finally {
      setTesting(false)
    }
  }

  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-wide" style={{ color: 'var(--text-primary)' }}>
        <Film size={20} className="text-neon/60" />
        {t('admin.metadataConfig')}
      </h2>
      <div className="glass-panel rounded-xl p-5">
        {/* 说明信息（折叠，避免长文抢占视觉重点） */}
        <details className="group mb-5">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium select-none" style={{ color: 'var(--text-tertiary)' }}>
            <Info size={13} />
            关于 TMDb
            <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
          </summary>
          <div className="mt-3 rounded-lg p-4" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)' }}>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {t('admin.metadataConfigDesc').split('TMDb')[0]}
              <span className="font-medium text-neon">TMDb（The Movie Database）</span>
              {t('admin.metadataConfigDesc').split('TMDb（The Movie Database）')[1] || t('admin.metadataConfigDesc').split('TMDb (The Movie Database)')[1]}
            </p>
            <a
              href="https://www.themoviedb.org/settings/api"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-neon hover:text-neon-blue transition-colors"
            >
              <ExternalLink size={14} />
              {t('admin.applyTMDbKey')}
            </a>
          </div>
        </details>

        {/* 当前状态 */}
        <div className="mb-4 flex items-center gap-3">
          <div className={clsx(
            'flex h-10 w-10 items-center justify-center rounded-lg',
            tmdbConfig?.configured ? 'bg-green-500/10' : ''
          )}
            style={!tmdbConfig?.configured ? { background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)' } : undefined}
          >
            <Key size={18} className={tmdbConfig?.configured ? 'text-green-400' : 'text-surface-500'} />
          </div>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {tmdbConfig?.configured ? t('admin.tmdbConfigured') : t('admin.tmdbNotConfigured')}
            </p>
            {tmdbConfig?.configured && tmdbConfig.masked_key && (
              <p className="mt-0.5 flex items-center gap-2 text-xs text-surface-400 font-mono">
                {showKey ? tmdbConfig.masked_key : '••••••••••••••••••••'}
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="text-surface-500 hover:text-surface-300 transition-colors"
                  title={showKey ? t('admin.tmdbHideKey') : t('admin.tmdbShowKey')}
                >
                  {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </p>
            )}
          </div>
        </div>

        {/* 操作提示消息 */}
        {msg && (
          <div className={clsx(
            'mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm',
            msg.type === 'success' && 'bg-green-500/10 text-green-400',
            msg.type === 'error' && 'bg-red-500/10 text-red-400',
            msg.type === 'info' && 'bg-blue-500/10 text-blue-400'
          )}>
            {msg.type === 'success' ? <Check size={16} /> : msg.type === 'error' ? <X size={16} /> : <Loader2 size={16} className="animate-spin" />}
            {msg.text}
          </div>
        )}

        {/* 编辑表单 */}
        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                {t('admin.tmdbInputLabel')}
              </label>
              <input
                type="text"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                className="input font-mono"
                placeholder={t('admin.tmdbInputPlaceholder')}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              />
              <p className="mt-1.5 text-xs text-surface-500">
                {t('admin.tmdbInputHint')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={handleSave} disabled={!keyInput.trim() || saving || testing} className="btn-primary gap-1.5 px-4 py-2 text-sm disabled:opacity-50">
                {saving ? (<><Loader2 size={14} className="animate-spin" />{t('admin.saving')}</>) : (<><Check size={14} />{t('common.save')}</>)}
              </button>
              <button onClick={handleTest} disabled={!keyInput.trim() || testing || saving} className="btn-ghost gap-1.5 px-4 py-2 text-sm disabled:opacity-50" title={t('admin.tmdbTestInputHint')}>
                {testing ? (<><Loader2 size={14} className="animate-spin" />{t('admin.tmdbTesting')}</>) : (<><Wifi size={14} />{t('admin.tmdbTestBtn')}</>)}
              </button>
              <button onClick={() => { setEditing(false); setKeyInput('') }} className="btn-ghost px-4 py-2 text-sm">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setEditing(true)} className="btn-primary gap-1.5 px-4 py-2 text-sm">
              <Key size={14} />
              {tmdbConfig?.configured ? t('admin.modifyApiKey') : t('admin.configApiKey')}
            </button>
            {tmdbConfig?.configured && (
              <button onClick={handleTest} disabled={testing} className="btn-ghost gap-1.5 px-4 py-2 text-sm disabled:opacity-50" title={t('admin.tmdbTestSavedHint')}>
                {testing ? (<><Loader2 size={14} className="animate-spin" />{t('admin.tmdbTesting')}</>) : (<><Wifi size={14} />{t('admin.tmdbTestConnection')}</>)}
              </button>
            )}
            {tmdbConfig?.configured && (
              <button onClick={handleClear} className="btn-ghost gap-1.5 px-4 py-2 text-sm text-red-400 hover:text-red-300">
                <Trash2 size={14} />
                {t('admin.clearKey')}
              </button>
            )}
          </div>
        )}

        {/* 高级：网络连接与代理（折叠） */}
        <TMDbProxySettings config={tmdbConfig} onConfigChange={setTmdbConfig} />

        {/* 功能说明 */}
        <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border-default)' }}>
          <p className="text-xs font-medium text-surface-400 mb-2">{t('admin.configFeatures')}</p>
          <ul className="space-y-1.5 text-xs text-surface-500">
            {[
              t('admin.feature1'),
              t('admin.feature2'),
              t('admin.feature3'),
            ].map((f, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className={clsx(
                  'inline-block h-1.5 w-1.5 rounded-full',
                  tmdbConfig?.configured ? 'bg-green-400' : ''
                )}
                style={!tmdbConfig?.configured ? { background: 'var(--text-muted)' } : undefined}
                />
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
