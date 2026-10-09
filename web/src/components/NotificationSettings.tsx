import { useTranslation } from '@/i18n'
import { useState, useEffect } from 'react'
import { notificationApi } from '@/api'
import type { NotificationConfig, WebhookNotifyConfig } from '@/types'
import { Bell, Mail, Send, Globe, Plus, Trash2, TestTube, Save, Loader2 } from 'lucide-react'
import clsx from 'clsx'

export default function NotificationSettings() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<NotificationConfig>({
    enabled: false,
    webhooks: [],
    email: {
      enabled: false,
      smtp_host: '',
      smtp_port: 587,
      username: '',
      password: '',
      from_addr: '',
      from_name: 'V-Cine',
      recipients: [],
      use_tls: true,
    },
    telegram: {
      enabled: false,
      bot_token: '',
      chat_id: '',
    },
    events: {
      media_added: true,
      scan_complete: true,
      scrape_complete: false,
      transcode_complete: true,
      user_login: false,
      system_error: true,
    },
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [recipientInput, setRecipientInput] = useState('')

  useEffect(() => {
    notificationApi.getConfig().then(res => {
      if (res.data.data) setConfig(res.data.data)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await notificationApi.updateConfig(config)
      setMessage({ type: 'success', text: t('nt.saved') })
    } catch {
      setMessage({ type: 'error', text: t('nt.saveFailed') })
    } finally {
      setSaving(false)
      setTimeout(() => setMessage(null), 3000)
    }
  }

  const handleTest = async (channel: 'email' | 'telegram' | 'webhook') => {
    setTesting(channel)
    try {
      await notificationApi.test(channel)
      setMessage({ type: 'success', text: t('nt.testSent', { channel }) })
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || t('nt.testFailed') })
    } finally {
      setTesting(null)
      setTimeout(() => setMessage(null), 3000)
    }
  }

  const addWebhook = () => {
    setConfig(prev => ({
      ...prev,
      webhooks: [...prev.webhooks, {
        id: Date.now().toString(),
        name: `Webhook ${prev.webhooks.length + 1}`,
        url: '',
        enabled: true,
      }],
    }))
  }

  const removeWebhook = (id: string) => {
    setConfig(prev => ({
      ...prev,
      webhooks: prev.webhooks.filter(w => w.id !== id),
    }))
  }

  const updateWebhook = (id: string, updates: Partial<WebhookNotifyConfig>) => {
    setConfig(prev => ({
      ...prev,
      webhooks: prev.webhooks.map(w => w.id === id ? { ...w, ...updates } : w),
    }))
  }

  const addRecipient = () => {
    if (recipientInput && !config.email.recipients.includes(recipientInput)) {
      setConfig(prev => ({
        ...prev,
        email: { ...prev.email, recipients: [...prev.email.recipients, recipientInput] },
      }))
      setRecipientInput('')
    }
  }

  const removeRecipient = (email: string) => {
    setConfig(prev => ({
      ...prev,
      email: { ...prev.email, recipients: prev.email.recipients.filter(r => r !== email) },
    }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-neon-blue" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 消息提示 */}
      {message && (
        <div className={clsx(
          'rounded-xl px-4 py-3 text-sm font-medium',
          message.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
        )}>
          {message.text}
        </div>
      )}

      {/* 全局开关 */}
      <div className="card-glass rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="h-5 w-5 text-neon-blue" />
            <div>
              <h3 className="font-display text-lg font-semibold text-white">{t('nt.title')}</h3>
              <p className="text-sm text-surface-400">{t('nt.desc')}</p>
            </div>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={e => setConfig(prev => ({ ...prev, enabled: e.target.checked }))}
              className="peer sr-only"
            />
            <div className="peer h-6 w-11 rounded-full bg-surface-600 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-neon-blue peer-checked:after:translate-x-full" />
          </label>
        </div>
      </div>

      {/* 事件订阅 */}
      <div className="card-glass rounded-2xl p-6">
        <h3 className="font-display text-base font-semibold text-white mb-4">{t('nt.eventsTitle')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { key: 'media_added', labelKey: 'nt.evMediaAdded' },
            { key: 'scan_complete', labelKey: 'nt.evScanComplete' },
            { key: 'scrape_complete', labelKey: 'nt.evScrapeComplete' },
            { key: 'transcode_complete', labelKey: 'nt.evTranscodeComplete' },
            { key: 'user_login', labelKey: 'nt.evUserLogin' },
            { key: 'system_error', labelKey: 'nt.evSystemError' },
          ].map(({ key, labelKey }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer rounded-xl px-3 py-2 hover:bg-white/5">
              <input
                type="checkbox"
                checked={config.events[key as keyof typeof config.events]}
                onChange={e => setConfig(prev => ({
                  ...prev,
                  events: { ...prev.events, [key]: e.target.checked },
                }))}
                className="rounded border-surface-500 bg-surface-700 text-neon-blue focus:ring-neon-blue/30"
              />
              <span className="text-sm text-surface-300">{t(labelKey)}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Webhook 配置 */}
      <div className="card-glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-neon-purple" />
            <h3 className="font-display text-base font-semibold text-white">Webhook</h3>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => handleTest('webhook')} disabled={testing === 'webhook'}
              className="btn-ghost rounded-lg px-3 py-1.5 text-xs">
              {testing === 'webhook' ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube className="h-3 w-3" />}
              <span className="ml-1">{t('nt.test')}</span>
            </button>
            <button onClick={addWebhook} className="btn-ghost rounded-lg px-3 py-1.5 text-xs">
              <Plus className="h-3 w-3" />
              <span className="ml-1">{t('nt.add')}</span>
            </button>
          </div>
        </div>
        <div className="space-y-3">
          {config.webhooks.map(hook => (
            <div key={hook.id} className="flex items-center gap-3 rounded-xl bg-surface-800/50 p-3">
              <input
                type="text"
                value={hook.name}
                onChange={e => updateWebhook(hook.id, { name: e.target.value })}
                placeholder={t('nt.namePlaceholder')}
                className="input-glass w-28 rounded-lg px-3 py-1.5 text-sm"
              />
              <input
                type="url"
                value={hook.url}
                onChange={e => updateWebhook(hook.id, { url: e.target.value })}
                placeholder="https://..."
                className="input-glass flex-1 rounded-lg px-3 py-1.5 text-sm"
              />
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={hook.enabled}
                  onChange={e => updateWebhook(hook.id, { enabled: e.target.checked })}
                  className="peer sr-only"
                />
                <div className="peer h-5 w-9 rounded-full bg-surface-600 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-neon-blue peer-checked:after:translate-x-full" />
              </label>
              <button onClick={() => removeWebhook(hook.id)} className="text-red-400 hover:text-red-300">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {config.webhooks.length === 0 && (
            <p className="text-center text-sm text-surface-500 py-4">{t('nt.noWebhooks')}</p>
          )}
        </div>
      </div>

      {/* 邮件配置 */}
      <div className="card-glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-neon-blue" />
            <h3 className="font-display text-base font-semibold text-white">{t('nt.emailTitle')}</h3>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => handleTest('email')} disabled={testing === 'email'}
              className="btn-ghost rounded-lg px-3 py-1.5 text-xs">
              {testing === 'email' ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube className="h-3 w-3" />}
              <span className="ml-1">{t('nt.test')}</span>
            </button>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={config.email.enabled}
                onChange={e => setConfig(prev => ({ ...prev, email: { ...prev.email, enabled: e.target.checked } }))}
                className="peer sr-only"
              />
              <div className="peer h-5 w-9 rounded-full bg-surface-600 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-neon-blue peer-checked:after:translate-x-full" />
            </label>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-surface-400">{t('nt.smtpServer')}</label>
            <input type="text" value={config.email.smtp_host}
              onChange={e => setConfig(prev => ({ ...prev, email: { ...prev.email, smtp_host: e.target.value } }))}
              placeholder="smtp.example.com" className="input-glass mt-1 w-full rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-surface-400">{t('nt.port')}</label>
            <input type="number" value={config.email.smtp_port}
              onChange={e => setConfig(prev => ({ ...prev, email: { ...prev.email, smtp_port: parseInt(e.target.value) || 587 } }))}
              className="input-glass mt-1 w-full rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-surface-400">{t('nt.username')}</label>
            <input type="text" value={config.email.username}
              onChange={e => setConfig(prev => ({ ...prev, email: { ...prev.email, username: e.target.value } }))}
              className="input-glass mt-1 w-full rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-surface-400">{t('nt.password')}</label>
            <input type="password" value={config.email.password}
              onChange={e => setConfig(prev => ({ ...prev, email: { ...prev.email, password: e.target.value } }))}
              className="input-glass mt-1 w-full rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-surface-400">{t('nt.fromAddr')}</label>
            <input type="email" value={config.email.from_addr}
              onChange={e => setConfig(prev => ({ ...prev, email: { ...prev.email, from_addr: e.target.value } }))}
              className="input-glass mt-1 w-full rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-surface-400">{t('nt.fromName')}</label>
            <input type="text" value={config.email.from_name}
              onChange={e => setConfig(prev => ({ ...prev, email: { ...prev.email, from_name: e.target.value } }))}
              className="input-glass mt-1 w-full rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="mt-3">
          <label className="text-xs text-surface-400">{t('nt.recipients')}</label>
          <div className="flex items-center gap-2 mt-1">
            <input type="email" value={recipientInput}
              onChange={e => setRecipientInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addRecipient()}
              placeholder={t('nt.recipientPlaceholder')} className="input-glass flex-1 rounded-lg px-3 py-2 text-sm" />
            <button onClick={addRecipient} className="btn-ghost rounded-lg px-3 py-2 text-sm">{t('nt.add')}</button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {config.email.recipients.map(email => (
              <span key={email} className="inline-flex items-center gap-1 rounded-full bg-neon-blue/10 px-3 py-1 text-xs text-neon-blue">
                {email}
                <button onClick={() => removeRecipient(email)} className="hover:text-red-400">×</button>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Telegram 配置 */}
      <div className="card-glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4 text-blue-400" />
            <h3 className="font-display text-base font-semibold text-white">Telegram</h3>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => handleTest('telegram')} disabled={testing === 'telegram'}
              className="btn-ghost rounded-lg px-3 py-1.5 text-xs">
              {testing === 'telegram' ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube className="h-3 w-3" />}
              <span className="ml-1">{t('nt.test')}</span>
            </button>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={config.telegram.enabled}
                onChange={e => setConfig(prev => ({ ...prev, telegram: { ...prev.telegram, enabled: e.target.checked } }))}
                className="peer sr-only"
              />
              <div className="peer h-5 w-9 rounded-full bg-surface-600 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-neon-blue peer-checked:after:translate-x-full" />
            </label>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-surface-400">Bot Token</label>
            <input type="password" value={config.telegram.bot_token}
              onChange={e => setConfig(prev => ({ ...prev, telegram: { ...prev.telegram, bot_token: e.target.value } }))}
              placeholder="123456:ABC-DEF..." className="input-glass mt-1 w-full rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-surface-400">Chat ID</label>
            <input type="text" value={config.telegram.chat_id}
              onChange={e => setConfig(prev => ({ ...prev, telegram: { ...prev.telegram, chat_id: e.target.value } }))}
              placeholder="-1001234567890" className="input-glass mt-1 w-full rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      {/* 保存按钮 */}
      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving}
          className="btn-neon rounded-xl px-6 py-2.5 text-sm font-medium flex items-center gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t('nt.saveBtn')}
        </button>
      </div>
    </div>
  )
}
