import { useState, useEffect } from 'react'
import { pluginApi } from '@/api'
import type { PluginInfo, PluginManifest } from '@/types'
import {
  Puzzle, Power, PowerOff, Trash2, Settings, RefreshCw,
  Loader2, ExternalLink, Shield, Code, Palette, Music, Bell,
} from 'lucide-react'
import clsx from 'clsx'
import { useDialog } from '@/components/Dialog'
import { useTranslation } from '@/i18n'

export default function PluginManager() {
  const { t } = useTranslation()
  const dialog = useDialog()
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [_selectedPlugin, setSelectedPlugin] = useState<{ info: PluginInfo; manifest: PluginManifest } | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadPlugins = async () => {
    try {
      const res = await pluginApi.list()
      setPlugins(res.data.data || [])
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadPlugins() }, [])

  const handleScan = async () => {
    setScanning(true)
    try {
      const res = await pluginApi.scan()
      setMessage({ type: 'success', text: t('pm.found', { count: res.data.data?.length || 0 }) })
      loadPlugins()
    } catch {
      setMessage({ type: 'error', text: t('pm.scanFailed') })
    } finally {
      setScanning(false)
      setTimeout(() => setMessage(null), 3000)
    }
  }

  const handleToggle = async (plugin: PluginInfo) => {
    try {
      if (plugin.enabled) {
        await pluginApi.disable(plugin.id)
      } else {
        await pluginApi.enable(plugin.id)
      }
      loadPlugins()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || t('pm.operationFailed') })
      setTimeout(() => setMessage(null), 3000)
    }
  }

  const handleUninstall = async (id: string) => {
    const ok = await dialog.confirm({
      title: t('pm.uninstallTitle'),
      message: t('pm.uninstallMsg'),
      confirmText: t('pm.uninstallConfirm'),
      variant: 'danger',
    })
    if (!ok) return
    try {
      await pluginApi.uninstall(id)
      setMessage({ type: 'success', text: t('pm.uninstalled') })
      loadPlugins()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || t('pm.uninstallFailed') })
    }
    setTimeout(() => setMessage(null), 3000)
  }

  const handleViewDetail = async (plugin: PluginInfo) => {
    try {
      const res = await pluginApi.get(plugin.id)
      setSelectedPlugin({ info: res.data.data, manifest: res.data.manifest })
    } catch { /* ignore */ }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'media_source': return <Code className="h-4 w-4" />
      case 'theme': return <Palette className="h-4 w-4" />
      case 'player': return <Music className="h-4 w-4" />
      case 'metadata': return <Shield className="h-4 w-4" />
      case 'notification': return <Bell className="h-4 w-4" />
      default: return <Puzzle className="h-4 w-4" />
    }
  }

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      media_source: t('pm.catMediaSource'), theme: t('pm.catTheme'), player: t('pm.catPlayer'),
      metadata: t('pm.catMetadata'), notification: t('pm.catNotification'),
    }
    return labels[type] || type
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        {/* 标题区骨架 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="skeleton h-5 w-5 rounded" />
            <div className="skeleton h-6 w-28 rounded-lg" />
            <div className="skeleton h-4 w-12 rounded" />
          </div>
          <div className="skeleton h-9 w-24 rounded-xl" />
        </div>
        {/* 插件卡片骨架 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <div className="flex items-start gap-3 mb-3">
                <div className="skeleton h-10 w-10 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-1/3 rounded" />
                  <div className="skeleton h-3 w-2/3 rounded" />
                </div>
              </div>
              <div className="skeleton h-3 w-full rounded mb-1" />
              <div className="skeleton h-3 w-3/4 rounded mb-4" />
              <div className="flex items-center gap-2 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <div className="skeleton h-8 flex-1 rounded-lg" />
                <div className="skeleton h-8 w-10 rounded-lg" />
                <div className="skeleton h-8 w-10 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className={clsx(
          'rounded-xl px-4 py-3 text-sm font-medium',
          message.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
        )}>{message.text}</div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Puzzle className="h-5 w-5 text-neon-purple" />
          <h2 className="font-display text-xl font-semibold text-white">{t('pm.title')}</h2>
          <span className="text-xs text-surface-400">{t('pm.count', { count: plugins.length })}</span>
        </div>
        <button onClick={handleScan} disabled={scanning}
          className="btn-ghost rounded-xl px-4 py-2 text-sm flex items-center gap-2">
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t('pm.scan')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {plugins.map(plugin => (
          <div key={plugin.id} className={clsx(
            'card-glass rounded-2xl p-5 transition-all',
            plugin.enabled ? 'border-neon-blue/20' : 'opacity-60'
          )}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={clsx(
                  'w-10 h-10 rounded-xl flex items-center justify-center',
                  plugin.enabled ? 'bg-neon-blue/20 text-neon-blue' : 'bg-surface-800 text-surface-500'
                )}>
                  {getTypeIcon(plugin.type)}
                </div>
                <div>
                  <h3 className="font-display text-sm font-semibold text-white">{plugin.name}</h3>
                  <div className="flex items-center gap-2 text-xs text-surface-400">
                    <span>v{plugin.version}</span>
                    <span>·</span>
                    <span>{plugin.author}</span>
                    <span className="rounded-full bg-surface-800 px-2 py-0.5">{getTypeLabel(plugin.type)}</span>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-xs text-surface-400 line-clamp-2 mb-4">{plugin.description}</p>

            <div className="flex items-center gap-2 pt-3 border-t border-white/5">
              <button onClick={() => handleToggle(plugin)}
                className={clsx(
                  'flex-1 rounded-lg py-2 text-xs flex items-center justify-center gap-1 transition-all',
                  plugin.enabled ? 'btn-ghost text-yellow-400' : 'btn-ghost text-green-400'
                )}>
                {plugin.enabled ? <><PowerOff className="h-3 w-3" /> {t('pm.disable')}</> : <><Power className="h-3 w-3" /> {t('pm.enable')}</>}
              </button>
              <button onClick={() => handleViewDetail(plugin)}
                className="btn-ghost rounded-lg px-3 py-2 text-xs">
                <Settings className="h-3 w-3" />
              </button>
              {plugin.homepage && (
                <a href={plugin.homepage} target="_blank" rel="noopener noreferrer"
                  className="btn-ghost rounded-lg px-3 py-2 text-xs">
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <button onClick={() => handleUninstall(plugin.id)}
                className="text-red-400 hover:text-red-300 rounded-lg px-3 py-2 text-xs">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {plugins.length === 0 && (
        <div className="text-center py-16 text-surface-500">
          <Puzzle className="h-16 w-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg">{t('pm.empty')}</p>
          <p className="text-sm mt-1">{t('pm.emptyHint')}</p>
        </div>
      )}
    </div>
  )
}
