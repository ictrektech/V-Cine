import { useTranslation } from '@/i18n'
import { useEffect, useState } from 'react'
import {
  Radio,
  Globe,
  Clock,
  Zap,
  Film,
  Save,
  RotateCcw,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react'
import { strmApi, type STRMGlobalConfig } from '@/api'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'

/**
 * STRM 全局配置区块
 *
 * 可嵌入到媒体库/影视文件管理页面，用于统一管理 .strm 远程流的默认请求头与行为。
 * 核心配置：
 *  - 默认 User-Agent / Referer（当 media 自身未指定时使用）
 *  - HLS 重写开关（让分片继承媒体的鉴权头）
 *  - 远程 FFprobe 开关（扫描时获取真实时长/分辨率）
 *  - 域名级白名单（针对 115/阿里云盘等特定源自动应用 UA/Referer）
 */
export default function STRMConfigSection() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cfg, setCfg] = useState<STRMGlobalConfig | null>(null)
  const [tip, setTip] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const defaultCfg: STRMGlobalConfig = {
    default_user_agent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    default_referer: '',
    connect_timeout: 30,
    rewrite_hls: true,
    remote_probe: true,
    remote_probe_timeout: 8,
    domain_user_agents: {},
    domain_referers: {},
  }

  const load = async () => {
    setLoading(true)
    try {
      const res = await strmApi.getConfig()
      setCfg({ ...defaultCfg, ...(res.data.data || {}) })
    } catch (e: unknown) {
      setTip({ kind: 'err', msg: e instanceof Error ? e.message : t('strm.loadFailed') })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && !cfg) {
      load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const save = async () => {
    if (!cfg) return
    if (cfg.connect_timeout < 0 || cfg.connect_timeout > 600) {
      setTip({ kind: 'err', msg: t('strm.timeoutRange') })
      return
    }
    if (cfg.remote_probe_timeout < 0 || cfg.remote_probe_timeout > 120) {
      setTip({ kind: 'err', msg: t('strm.probeRange') })
      return
    }
    setSaving(true)
    try {
      const res = await strmApi.updateConfig(cfg)
      setCfg({ ...defaultCfg, ...(res.data.data || {}) })
      setTip({ kind: 'ok', msg: t('strm.saved') })
      setTimeout(() => setTip(null), 2500)
    } catch (e: unknown) {
      setTip({ kind: 'err', msg: e instanceof Error ? e.message : t('strm.saveFailed') })
    } finally {
      setSaving(false)
    }
  }

  const reset = () => setCfg({ ...defaultCfg })

  // ---- 域名表格操作 ----
  const addDomain = (target: 'ua' | 'ref') => {
    if (!cfg) return
    const key = `${t('strm.newDomain')}-${Date.now()}`
    if (target === 'ua') {
      setCfg({ ...cfg, domain_user_agents: { ...cfg.domain_user_agents, [key]: '' } })
    } else {
      setCfg({ ...cfg, domain_referers: { ...cfg.domain_referers, [key]: '' } })
    }
  }

  const removeDomain = (target: 'ua' | 'ref', domain: string) => {
    if (!cfg) return
    if (target === 'ua') {
      const next = { ...cfg.domain_user_agents }
      delete next[domain]
      setCfg({ ...cfg, domain_user_agents: next })
    } else {
      const next = { ...cfg.domain_referers }
      delete next[domain]
      setCfg({ ...cfg, domain_referers: next })
    }
  }

  const renameDomain = (target: 'ua' | 'ref', oldK: string, newK: string) => {
    if (!cfg || oldK === newK || !newK) return
    const src = target === 'ua' ? cfg.domain_user_agents : cfg.domain_referers
    if (src[newK] !== undefined) return
    const value = src[oldK] || ''
    const next = { ...src }
    delete next[oldK]
    next[newK] = value
    if (target === 'ua') setCfg({ ...cfg, domain_user_agents: next })
    else setCfg({ ...cfg, domain_referers: next })
  }

  const setDomainValue = (target: 'ua' | 'ref', domain: string, v: string) => {
    if (!cfg) return
    if (target === 'ua') {
      setCfg({ ...cfg, domain_user_agents: { ...cfg.domain_user_agents, [domain]: v } })
    } else {
      setCfg({ ...cfg, domain_referers: { ...cfg.domain_referers, [domain]: v } })
    }
  }

  // ---- 样式（复用主题变量，兼容日夜模式） ----
  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-default)',
    color: 'var(--text-primary)',
  }

  return (
    <div className="rounded-xl p-4 md:p-5" style={cardStyle}>
      {/* 头部：可折叠 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 text-left"
      >
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ background: 'var(--neon-blue-15)' }}
        >
          <Radio size={18} className="text-cyan-400" />
        </div>
        <div className="flex-1">
          <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t('strm.title')}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {t('strm.desc')}
          </div>
        </div>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {loading || !cfg ? (
            <div className="flex items-center gap-2 py-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <Loader2 size={14} className="animate-spin" />
              {t('strm.loading')}
            </div>
          ) : (
            <>
              {/* 提示条 */}
              {tip && (
                <div
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm"
                  style={{
                    background:
                      tip.kind === 'ok' ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.12)',
                    border:
                      '1px solid ' +
                      (tip.kind === 'ok' ? 'rgba(16,185,129,0.35)' : 'rgba(244,63,94,0.35)'),
                    color: tip.kind === 'ok' ? '#10b981' : '#f43f5e',
                  }}
                >
                  {tip.kind === 'ok' ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <AlertCircle size={14} />
                  )}
                  <span>{tip.msg}</span>
                </div>
              )}

              {/* 基础 Header */}
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label
                    className="mb-1 flex items-center gap-1.5 text-xs font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <Globe size={12} /> {t('strm.ua')}
                  </label>
                  <Input
                    type="text"
                    className="h-9 text-xs"
                    value={cfg.default_user_agent}
                    onChange={(e) =>
                      setCfg({ ...cfg, default_user_agent: e.target.value })
                    }
                    placeholder="Mozilla/5.0 ..."
                  />
                </div>
                <div>
                  <label
                    className="mb-1 flex items-center gap-1.5 text-xs font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <Globe size={12} /> {t('strm.referer')}
                  </label>
                  <Input
                    type="text"
                    className="h-9 text-xs"
                    value={cfg.default_referer}
                    onChange={(e) => setCfg({ ...cfg, default_referer: e.target.value })}
                    placeholder="https://example.com/"
                  />
                </div>
                <div>
                  <label
                    className="mb-1 flex items-center gap-1.5 text-xs font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <Clock size={12} /> {t('strm.connectTimeout')}
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={600}
                    className="h-9 text-xs"
                    value={cfg.connect_timeout}
                    onChange={(e) =>
                      setCfg({ ...cfg, connect_timeout: parseInt(e.target.value) || 0 })
                    }
                  />
                </div>
                <div>
                  <label
                    className="mb-1 flex items-center gap-1.5 text-xs font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <Clock size={12} /> {t('strm.probeTimeout')}
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={120}
                    className="h-9 text-xs"
                    value={cfg.remote_probe_timeout}
                    onChange={(e) =>
                      setCfg({ ...cfg, remote_probe_timeout: parseInt(e.target.value) || 0 })
                    }
                  />
                </div>
              </div>

              {/* 开关 */}
              <div className="grid gap-3 md:grid-cols-2">
                <Toggle
                  icon={<Film size={14} />}
                  label={t('strm.hlsRewrite')}
                  hint={t('strm.hlsRewriteHint')}
                  checked={cfg.rewrite_hls}
                  onChange={(v) => setCfg({ ...cfg, rewrite_hls: v })}
                />
                <Toggle
                  icon={<Zap size={14} />}
                  label={t('strm.ffprobe')}
                  hint={t('strm.ffprobeHint')}
                  checked={cfg.remote_probe}
                  onChange={(v) => setCfg({ ...cfg, remote_probe: v })}
                />
              </div>

              {/* 域名白名单 */}
              <DomainTable
                title={t('strm.uaWhitelist')}
                hint={t('strm.uaWhitelistHint')}
                rows={cfg.domain_user_agents}
                onAdd={() => addDomain('ua')}
                onRemove={(d) => removeDomain('ua', d)}
                onRename={(o, n) => renameDomain('ua', o, n)}
                onSetValue={(d, v) => setDomainValue('ua', d, v)}
                placeholder="Mozilla/5.0 ..."
              />
              <DomainTable
                title={t('strm.refererWhitelist')}
                hint={t('strm.refererWhitelistHint')}
                rows={cfg.domain_referers}
                onAdd={() => addDomain('ref')}
                onRemove={(d) => removeDomain('ref', d)}
                onRename={(o, n) => renameDomain('ref', o, n)}
                onSetValue={(d, v) => setDomainValue('ref', d, v)}
                placeholder="https://example.com/"
              />

              {/* 底部按钮 */}
              <div className="flex items-center gap-2 pt-2">
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="animate-spin" /> : <Save />}
                  {t('strm.saveBtn')}
                </Button>
                <Button size="sm" variant="outline" onClick={reset}>
                  <RotateCcw />
                  {t('strm.reset')}
                </Button>
                <span className="ml-auto text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  {t('strm.priorityHint')}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- 子组件 ----------

interface ToggleProps {
  icon: React.ReactNode
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}

function Toggle({ icon, label, hint, checked, onChange }: ToggleProps) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-md p-2.5"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
    >
      <div>
        <div
          className="flex items-center gap-1.5 text-xs font-medium"
          style={{ color: 'var(--text-primary)' }}
        >
          {icon}
          {label}
        </div>
        {hint && (
          <div className="mt-0.5 text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
            {hint}
          </div>
        )}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

interface DomainTableProps {
  title: string
  hint?: string
  rows: Record<string, string>
  onAdd: () => void
  onRemove: (domain: string) => void
  onRename: (oldK: string, newK: string) => void
  onSetValue: (domain: string, v: string) => void
  placeholder?: string
}

function DomainTable({
  title,
  hint,
  rows,
  onAdd,
  onRemove,
  onRename,
  onSetValue,
  placeholder,
}: DomainTableProps) {
  const { t } = useTranslation()
  const entries = Object.entries(rows)
  return (
    <div
      className="rounded-md p-3"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
    >
      <div className="mb-2 flex items-center">
        <div>
          <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            {title}
          </div>
          {hint && (
            <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              {hint}
            </div>
          )}
        </div>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={onAdd}>
          <Plus /> {t('strm.add')}
        </Button>
      </div>
      {entries.length === 0 ? (
        <div className="py-2 text-center text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          {t('strm.noRules')}
        </div>
      ) : (
        <div className="space-y-1.5">
          {entries.map(([domain, value]) => (
            <div key={domain} className="flex items-center gap-1.5">
              <Input
                type="text"
                defaultValue={domain}
                onBlur={(e) => onRename(domain, e.target.value.trim())}
                className="h-8 w-32 flex-shrink-0 px-2 text-xs"
                placeholder="115.com"
              />
              <Input
                type="text"
                value={value}
                onChange={(e) => onSetValue(domain, e.target.value)}
                className="h-8 flex-1 px-2 text-xs"
                placeholder={placeholder}
              />
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 text-rose-400 hover:text-rose-300"
                onClick={() => onRemove(domain)}
                title={t('strm.delete')}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
