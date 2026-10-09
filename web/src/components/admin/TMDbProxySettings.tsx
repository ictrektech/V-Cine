import { t, useTranslation } from '@/i18n'
import { useEffect, useState } from 'react'
import { Check, ChevronRight, Loader2, Trash2, Wifi, X } from 'lucide-react'
import clsx from 'clsx'
import { adminApi } from '@/api'
import type { TMDbConfigStatus } from '@/types'

type ResultItem = { ok: boolean; message: string; target: string }
type TestResult = {
  api: ResultItem
  image: ResultItem
  network: ResultItem & { configured: boolean }
}

type Props = {
  config: TMDbConfigStatus | null
  onConfigChange: (config: TMDbConfigStatus) => void
}

const validateReverseBase = (raw: string) => {
  const value = raw.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return t('prx.mustHttp')
    return url.hostname ? null : t('prx.missingHost')
  } catch {
    return t('prx.badFormat')
  }
}

const validateNetworkProxy = (raw: string) => {
  const value = raw.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol)) {
      return t('prx.schemeOnly')
    }
    if (!url.hostname) return t('prx.missingHostPort')
    if (url.pathname && url.pathname !== '/') return t('prx.noPath')
    return null
  } catch {
    return t('prx.badFormat')
  }
}

export default function TMDbProxySettings({ config, onConfigChange }: Props) {
  const { t } = useTranslation()
  const [apiBase, setApiBase] = useState('')
  const [imageBase, setImageBase] = useState('')
  const [networkProxy, setNetworkProxy] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  useEffect(() => {
    setApiBase(config?.api_proxy || '')
    setImageBase(config?.image_proxy || '')
    setNetworkProxy(config?.network_proxy || '')
  }, [config?.api_proxy, config?.image_proxy, config?.network_proxy])

  const show = (type: 'success' | 'error' | 'info', text: string) => {
    setMessage({ type, text })
    window.setTimeout(() => setMessage(null), 5000)
  }

  const validate = () => {
    const checks = [
      [t('prx.apiProxyLabel'), validateReverseBase(apiBase)],
      [t('prx.imgProxyLabel'), validateReverseBase(imageBase)],
      [t('prx.netProxyLabel'), validateNetworkProxy(networkProxy)],
    ] as const
    const failed = checks.find(([, error]) => error)
    if (failed) show('error', `${failed[0]}：${failed[1]}`)
    return !failed
  }

  const save = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const response = await adminApi.updateTMDbProxy(apiBase.trim(), imageBase.trim(), networkProxy.trim())
      const data = response.data.data
      setApiBase(data.api_proxy)
      setImageBase(data.image_proxy)
      setNetworkProxy(data.network_proxy)
      onConfigChange({
        ...(config || { configured: false, masked_key: '' }),
        api_proxy: data.api_proxy,
        image_proxy: data.image_proxy,
        network_proxy: data.network_proxy,
        network_proxy_configured: Boolean(data.network_proxy),
      })
      show('success', response.data.message || t('prx.saved'))
    } catch (error: unknown) {
      show('error', (error as { response?: { data?: { error?: string } } })?.response?.data?.error || t('prx.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    setSaving(true)
    try {
      await adminApi.clearTMDbProxy()
      setApiBase('')
      setImageBase('')
      setNetworkProxy('')
      setResult(null)
      onConfigChange({
        ...(config || { configured: false, masked_key: '' }),
        api_proxy: '',
        image_proxy: '',
        network_proxy: '',
        network_proxy_configured: false,
      })
      show('success', t('prx.restored'))
    } catch {
      show('error', t('prx.restoreFailed'))
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    if (!validate()) return
    setTesting(true)
    setResult(null)
    try {
      const response = await adminApi.testTMDbProxy(apiBase.trim(), imageBase.trim(), networkProxy.trim())
      const data = response.data.data
      setResult(data)
      if (data.api.ok && data.image.ok && data.network.ok) show('success', t('prx.testOk'))
      else if (data.api.ok || data.image.ok) show('info', t('prx.testPartial'))
      else show('error', t('prx.testFail'))
    } catch (error: unknown) {
      show('error', (error as { response?: { data?: { error?: string } } })?.response?.data?.error || t('prx.testFailed'))
    } finally {
      setTesting(false)
    }
  }

  const configured = Boolean(apiBase || imageBase || networkProxy || config?.api_proxy || config?.image_proxy || config?.network_proxy)

  return (
    <details className="group mt-5 pt-4" style={{ borderTop: '1px solid var(--border-default)' }}>
      <summary className="flex cursor-pointer items-center gap-2 select-none">
        <Wifi size={14} className="text-neon/70 shrink-0" />
        <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{t('prx.title')}</span>
        {configured && (
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'rgba(22,163,74,0.12)', color: '#16A34A' }}>
            {t('prx.configured')}
          </span>
        )}
        <ChevronRight size={14} className="ml-auto shrink-0 transition-transform group-open:rotate-90" style={{ color: 'var(--text-tertiary)' }} />
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-surface-500">{t('prx.desc')}</p>

        <div className="grid gap-2 rounded-lg p-3 text-xs sm:grid-cols-2" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)' }}>
          <div><p className="font-medium text-neon">{t('prx.reverseTitle')}</p><p className="mt-1 text-surface-500">{t('prx.reverseDesc')}</p></div>
          <div><p className="font-medium text-neon">{t('prx.outTitle')}</p><p className="mt-1 text-surface-500">{t('prx.outDesc')}</p></div>
        </div>

        {message && <div className={clsx('flex items-center gap-2 rounded-lg px-3 py-2 text-xs', message.type === 'success' && 'bg-green-500/10 text-green-400', message.type === 'error' && 'bg-red-500/10 text-red-400', message.type === 'info' && 'bg-blue-500/10 text-blue-400')}>{message.type === 'success' ? <Check size={14} /> : message.type === 'error' ? <X size={14} /> : <Wifi size={14} />}{message.text}</div>}

        <div className="space-y-3">
          <ProxyInput label={t('prx.apiBaseLabel')} hint={t('prx.apiBaseHint')} value={apiBase} onChange={setApiBase} placeholder="https://example.com/tmdbapi" />
          <ProxyInput label={t('prx.imgBaseLabel')} hint={t('prx.imgBaseHint')} value={imageBase} onChange={setImageBase} placeholder="https://example.com/tmdbimg" />
          <ProxyInput label={t('prx.netLabel')} hint={t('prx.netHint')} value={networkProxy} onChange={setNetworkProxy} placeholder={t('prx.proxyPlaceholder')} />
          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={save} disabled={saving} className="btn-primary gap-1.5 px-4 py-2 text-sm disabled:opacity-50">{saving ? <><Loader2 size={14} className="animate-spin" />{t('editLib.saving')}</> : <><Check size={14} />{t('prx.saveConfig')}</>}</button>
            {configured && <button onClick={clear} disabled={saving} className="btn-ghost gap-1.5 px-4 py-2 text-sm text-red-400 disabled:opacity-50"><Trash2 size={14} />{t('prx.restoreBtn')}</button>}
            <button onClick={test} disabled={testing} className="btn-ghost gap-1.5 px-4 py-2 text-sm disabled:opacity-50">{testing ? <><Loader2 size={14} className="animate-spin" />{t('prx.testing')}</> : <><Wifi size={14} />{t('prx.testConnect')}</>}</button>
          </div>
          {result && <div className="space-y-1.5 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}>{([['API', result.api], [t('prx.testImage'), result.image], [t('prx.testNetwork'), result.network]] as const).map(([label, item]) => <div key={label} className="flex items-start gap-2">{item.ok ? <Check size={12} className="mt-0.5 shrink-0 text-green-400" /> : <X size={12} className="mt-0.5 shrink-0 text-red-400" />}<span className="shrink-0 text-surface-500">{label}：</span><span className={item.ok ? 'break-all text-green-400' : 'break-all text-red-400'}>{item.message}</span></div>)}</div>}
        </div>
      </div>
    </details>
  )
}

function ProxyInput({ label, hint, value, onChange, placeholder }: { label: string; hint: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div><label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>{label}</label><input type="text" value={value} onChange={(event) => onChange(event.target.value)} className="input font-mono text-sm" placeholder={placeholder} /><p className="mt-1 text-xs text-surface-500">{hint}</p></div>
}
