import { useState } from 'react'
import { Eye, EyeOff, Copy, Trash2, Check, XCircle } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { copyToClipboard } from '@/lib/clipboard'
import type { ApiKey } from '@/api/apiKey'

interface ApiKeyItemProps {
  item: ApiKey
  onRevoke: (id: string) => void
  onDelete: (id: string) => void
}

export default function ApiKeyItem({ item, onRevoke, onDelete }: ApiKeyItemProps) {
  const toast = useToast()
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await copyToClipboard(item.key)
    setCopied(true)
    toast.success('已复制到剪贴板')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRevoke = () => {
    if (window.confirm(`确定撤销 API Key「${item.name}」？撤销后无法恢复。`)) {
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
            <span className="text-xs text-red-400 font-medium">已撤销</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <code className="break-all font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {showKey ? item.key : '••••••••••••••••••••••••••••••••••••••••••'}
          </code>
          <button
            onClick={() => setShowKey(!showKey)}
            className="flex-shrink-0 text-surface-500 hover:text-surface-300 transition-colors"
            title={showKey ? '隐藏' : '显示'}
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          {showKey && (
            <button
              onClick={handleCopy}
              className="flex-shrink-0 transition-colors"
              style={{ color: copied ? 'var(--neon-green)' : 'var(--text-muted)' }}
              title="复制"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
          {item.last_used_at && (
            <span className="flex-shrink-0 text-xs text-theme-muted">
              上次使用: {new Date(item.last_used_at).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
      <div className="ml-3 flex flex-shrink-0 items-center gap-1">
        {!item.is_revoked && (
          <button
            onClick={handleRevoke}
            className="rounded-lg p-2 text-amber-400 transition-colors hover:bg-amber-400/10"
            title="撤销"
          >
            <XCircle size={14} />
          </button>
        )}
        <button
          onClick={() => {
            if (window.confirm(`确定彻底删除 API Key「${item.name}」？此操作不可恢复。`)) {
              onDelete(item.id)
            }
          }}
          className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-400/10"
          title="删除"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}
