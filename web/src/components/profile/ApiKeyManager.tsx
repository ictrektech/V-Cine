import { useState, useEffect, useCallback } from 'react'
import { Key, ChevronDown, ChevronUp, Plus, Loader2, Copy, Check } from 'lucide-react'
import { apiKeyApi } from '@/api/apiKey'
import { useToast } from '@/components/Toast'
import { copyToClipboard } from '@/lib/clipboard'
import ApiKeyItem from './ApiKeyItem'
import type { ApiKey } from '@/api/apiKey'
import { useTranslation } from '@/i18n'

export default function ApiKeyManager() {
  const { t } = useTranslation()
  const toast = useToast()
  const [expanded, setExpanded] = useState(false)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchKeys = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiKeyApi.list()
      setKeys(res.data.data)
    } catch {
      // 静默失败
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (expanded) fetchKeys()
  }, [expanded, fetchKeys])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) {
      toast.error(t('ak.nameRequired'))
      return
    }
    setCreating(true)
    try {
      const res = await apiKeyApi.create({ name })
      setCreatedKey(res.data.data.raw_key)
      setNewName('')
      await fetchKeys()
    } catch {
      toast.error(t('ak.createFailed'))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await apiKeyApi.delete(id)
      toast.success(t('ak.deleted'))
      await fetchKeys()
    } catch {
      toast.error(t('ak.deleteFailed'))
    }
  }

  const handleRevoke = async (id: string) => {
    try {
      await apiKeyApi.revoke(id)
      toast.success(t('ak.revoked'))
      await fetchKeys()
    } catch {
      toast.error(t('ak.revokeFailed'))
    }
  }

  const handleCopyCreated = async () => {
    if (!createdKey) return
    await copyToClipboard(createdKey)
    setCopied(true)
    toast.success(t('ak.copied'))
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCloseCreated = () => {
    setCreatedKey(null)
    setShowCreate(false)
    setCopied(false)
  }

  return (
    <section>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between rounded-xl px-4 py-3 transition-colors"
        style={{ background: 'var(--nav-hover-bg)' }}
      >
        <span className="flex items-center gap-2 font-display text-base font-semibold tracking-wide" style={{ color: 'var(--text-primary)' }}>
          <Key size={18} className="text-violet-400/60" />
          {t('ak.title')}
        </span>
        {expanded ? <ChevronUp size={16} className="text-theme-muted" /> : <ChevronDown size={16} className="text-theme-muted" />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-3 rounded-xl p-4" style={{ background: 'var(--bg-secondary)' }}>
          <p className="text-xs text-theme-muted">
            {t('ak.desc')}
          </p>

          {/* Key 列表 */}
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={16} className="animate-spin text-theme-muted" />
            </div>
          ) : keys.length === 0 ? (
            <p className="py-2 text-center text-sm text-theme-muted">{t('ak.empty')}</p>
          ) : (
            <div className="space-y-2">
              {keys.map((k) => (
                <ApiKeyItem key={k.id} item={k} onRevoke={handleRevoke} onDelete={handleDelete} />
              ))}
            </div>
          )}

          {/* 创建按钮 */}
          {!showCreate && !createdKey && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-violet-400 transition-colors hover:text-violet-300"
            >
              <Plus size={14} />
              {t('ak.createNew')}
            </button>
          )}

          {/* 创建表单 */}
          {showCreate && !createdKey && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="input flex-1 text-sm"
                placeholder={t('ak.namePlaceholder')}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="btn-primary px-4 py-2 text-sm"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : t('ak.create')}
              </button>
              <button
                onClick={() => { setShowCreate(false); setNewName('') }}
                className="btn-ghost px-3 py-2 text-sm"
              >
                {t('common.cancel')}
              </button>
            </div>
          )}

          {/* 创建成功提示 */}
          {createdKey && (
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--neon-green)', background: 'var(--bg-surface)' }}>
              <p className="mb-2 text-sm font-medium text-theme-primary">{t('ak.created')}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-black/20 px-3 py-2 font-mono text-xs text-theme-primary">
                  {createdKey}
                </code>
                <button
                  onClick={handleCopyCreated}
                  className="flex-shrink-0 rounded-lg p-2 transition-colors"
                  style={{ color: copied ? 'var(--neon-green)' : 'var(--text-muted)' }}
                  title={t('common.copy')}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <p className="mt-2 text-xs text-amber-400">
                {t('ak.onceWarning')}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={handleCopyCreated}
                  className="btn-primary px-4 py-1.5 text-xs"
                >
                  {copied ? t('ak.copied') : t('ak.copyKey')}
                </button>
                <button
                  onClick={handleCloseCreated}
                  className="btn-ghost px-4 py-1.5 text-xs"
                >
                  {t('common.close')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
