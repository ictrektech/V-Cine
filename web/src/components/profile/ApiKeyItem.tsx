import { useState } from 'react'
import { Eye, EyeOff, Copy, Trash2, Check, XCircle } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { copyToClipboard } from '@/lib/clipboard'
import type { ApiKey } from '@/api/apiKey'
import { useTranslation } from '@/i18n'

interface ApiKeyItemProps {
  item: ApiKey
  onRevoke: (id: string) => void
  onDelete: (id: string) => void
}

export default function ApiKeyItem({ item, onRevoke, onDelete }: ApiKeyItemProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await copyToClipboard(item.key)
    setCopied(true)
    toast.success(t('ak.copied'))
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRevoke = () => {
    if (window.confirm(t('ak.revokeConfirm', { name: item.name }))) {
      onRevoke(item.id)
    }
  }

  return (
    <div
      className={`flex items-center justify-between rounded-lg px-4 py-3 ${
        item.is_revoked ? 'opacity-50' : ''
      }`}
      style={{ background: 'var(--nav-hover-bg)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-theme-primary">{item.name}</span>
          <code className="text-xs text-theme-muted font-mono">{item.key_prefix}...</code>
          {item.is_revoked && (
            <span className="text-xs text-red-400 font-medium">{t('ak.revokedBadge')}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <code className="break-all font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {showKey ? item.key : '••••••••••••••••••••••••••••••••••••••••••'}
          </code>
          <button
            onClick={() => setShowKey(!showKey)}
            className="flex-shrink-0 text-surface-500 hover:text-surface-300 transition-colors"
            title={showKey ? t('ac.hide') : t('ac.show')}
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          {showKey && (
            <button
              onClick={handleCopy}
              className="flex-shrink-0 transition-colors"
              style={{ color: copied ? 'var(--neon-green)' : 'var(--text-muted)' }}
              title={t('common.copy')}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
          {item.last_used_at && (
            <span className="flex-shrink-0 text-xs text-theme-muted">
              {t('ak.lastUsed', { date: new Date(item.last_used_at).toLocaleDateString() })}
            </span>
          )}
        </div>
      </div>
      <div className="ml-3 flex flex-shrink-0 items-center gap-1">
        {!item.is_revoked && (
          <button
            onClick={handleRevoke}
            className="rounded-lg p-2 text-amber-400 transition-colors hover:bg-amber-400/10"
            title={t('ak.revoke')}
          >
            <XCircle size={14} />
          </button>
        )}
        <button
          onClick={() => {
            if (window.confirm(t('ak.deleteConfirm', { name: item.name }))) {
              onDelete(item.id)
            }
          }}
          className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-400/10"
          title={t('common.delete')}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}
