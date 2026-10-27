import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Layers, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { useTranslation } from '@/i18n'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { aiApi, videoAnalysisApi } from '@/api'
import type { AIStatus } from '@/types'
import type { VideoAnalysisHealthInfo, VideoAnalysisSettings } from '@/types/videoAnalysis'
import { cn } from '@/lib/utils'
import { extractErrMsg } from '@/utils/error'

interface VideoAnalysisDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigateToAI: () => void
}

// embeddingModeLabel 后端类型 → 显示名
const embeddingModeLabel = (mode: string): string => {
  const labels: Record<string, string> = { vscheduler: 'V-Scheduler' }
  return labels[mode] ?? mode
}

function ServiceBadge({ ok, okText, failText }: { ok: boolean | null; okText?: string; failText?: string }) {
  const { t } = useTranslation()
  if (ok === null) {
    return <Badge variant="outline" className="text-muted-foreground">{t('va.checking')}</Badge>
  }
  return ok ? (
    <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-400">✓ {okText}</Badge>
  ) : (
    <Badge className="border-red-500/20 bg-red-500/10 text-red-400">
      <AlertTriangle className="mr-1 h-3 w-3" />{failText}
    </Badge>
  )
}

export default function VideoAnalysisDrawer({ open, onOpenChange, onNavigateToAI }: VideoAnalysisDrawerProps) {
  const { t } = useTranslation()
  const [health, setHealth] = useState<VideoAnalysisHealthInfo | null>(null)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<VideoAnalysisSettings | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null)
  const [describeProviderID, setDescribeProviderID] = useState('')
  const [describeModel, setDescribeModel] = useState('')
  // 场景描述自定义模型开关：开启 = 注入 base_url/api_key/model_name，用自选视觉模型；
  // 关闭（默认）= 请求不带模型参数，结构化服务用自己的默认模型直接调上游（成本更低）。
  const [useCustomModel, setUseCustomModel] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const healthRes = await videoAnalysisApi.getHealth()
      setHealth(healthRes.data.data)
    } catch (e) {
      setError(extractErrMsg(e) || t('va.loadStatusFailed'))
    }
  }, [])

  const loadSettings = useCallback(async () => {
    setError('')
    setSaved(false)
    setSettingsLoading(true)
    try {
      const res = await videoAnalysisApi.getSettings()
      setSettings(res.data.data)
    } catch (e) {
      setError(extractErrMsg(e) || t('va.loadSettingsFailed'))
    } finally {
      setSettingsLoading(false)
    }
  }, [])

  const loadAIModels = useCallback(async () => {
    try {
      const res = await aiApi.getStatus()
      setAiStatus(res.data.data)
      const sc = res.data.data.scene_describe_ai
      setDescribeProviderID(sc?.provider_id || '')
      setDescribeModel(sc?.model || '')
      setUseCustomModel(!!sc?.provider_id && !!sc?.model)
    } catch {
      // AI 服务不可用时模型选择保持为空
    }
  }, [])

  useEffect(() => {
    if (open) {
      load()
      loadSettings()
      loadAIModels()
    }
  }, [open, load, loadSettings, loadAIModels])

  const sceneOk = health ? (health.available ? health.scene?.status === 'ok' : false) : null
  const structureOk = health ? (health.available ? health.structure?.status === 'ok' : false) : null
  const embeddingOk = health ? (health.available ? health.embedding_available === true : false) : null
  const visionModels = (aiStatus?.providers || []).flatMap(p =>
    p.models.filter(m => m.is_vision).map(m => ({ providerID: p.id, providerName: p.name, model: m.name }))
  )

  const save = async () => {
    if (!settings) return
    setSaving(true)
    setError('')
    try {
      await videoAnalysisApi.updateSettings(settings)
      // 开启且选了模型才写入；关闭时清空 —— 后端 ensureDescribeJob 按
      // scene_describe_ai.model 非空注入模型，不清空则关闭不生效。
      if (useCustomModel && describeProviderID && describeModel) {
        await aiApi.updateConfig({ scene_describe_ai: { provider_id: describeProviderID, model: describeModel } })
      } else if (!useCustomModel) {
        await aiApi.updateConfig({ scene_describe_ai: { provider_id: '', model: '' } })
      }
      setSaved(true)
      await load()
      await loadAIModels()
    } catch (e) {
      setError(extractErrMsg(e) || t('va.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  // 总开关关闭时，依赖设置整组禁用（保持可见，便于发现要配置的内容）
  const gated = !settings || !settings.enabled

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="xl" title={t('va.title')} description={t('admin.ovCardVaDesc')}>
        <div className="space-y-5">
          {settingsLoading && !settings && (
            <div className="py-16 text-center" aria-busy="true">
              <Loader2 className="mx-auto animate-spin text-neon" />
              <p className="mt-2 text-sm text-surface-400">{t('va.loading')}</p>
            </div>
          )}

          {settings && (
            <>
              {/* 总开关：主视觉，第一眼焦点 */}
              <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-theme-primary">{t('va.enableTitle')}</p>
                  <p className="text-xs text-surface-500">{t('va.enableDesc')}</p>
                </div>
                <Switch checked={settings.enabled} onCheckedChange={(checked) => setSettings({ ...settings, enabled: checked })} />
              </div>

              {/* 服务地址 + V-Scheduler 视觉嵌入：分组卡片，简洁 shadcn 样式 */}
              <section aria-disabled={gated} className={cn('space-y-3 transition-opacity', gated && 'pointer-events-none opacity-50')}>
                <div className="rounded-lg border p-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{t('va.serviceAddr')}</h3>
                  <div className="mt-3 space-y-3">
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">{t('va.sceneAddr')}</span>
                        <ServiceBadge ok={sceneOk} />
                      </div>
                      <Input value={settings.scene_base_url} onChange={(e) => setSettings({ ...settings, scene_base_url: e.target.value })} disabled={gated} placeholder="http://scene-detection:8910" />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">{t('va.structureAddr')}</span>
                        <ServiceBadge ok={structureOk} />
                      </div>
                      <Input value={settings.structure_base_url} onChange={(e) => setSettings({ ...settings, structure_base_url: e.target.value })} disabled={gated} placeholder="http://structure:8911" />
                    </div>
                    {health?.scene_error && (
                      <p className="break-all text-xs text-red-400">Scene：{health.scene_error}</p>
                    )}
                    {health?.structure_error && (
                      <p className="break-all text-xs text-red-400">Structure：{health.structure_error}</p>
                    )}
                  </div>
                </div>

                {/* V-Scheduler 视觉嵌入：突出模型标识，仅表明探测可达性 */}
                <div className="rounded-lg border bg-muted/40 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <p className="text-sm font-medium text-foreground">{t('va.embedModel')}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <code className="rounded bg-muted px-2 py-0.5 font-mono text-sm text-foreground">
                          {health?.embedding_model || '-'}
                        </code>
                        {health?.embedding_mode && (
                          <span className="inline-flex items-center rounded-md border bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {t('va.embedLine', { mode: embeddingModeLabel(health.embedding_mode) })}
                          </span>
                        )}
                      </div>
                      <p className="max-w-xl pt-1 text-xs leading-relaxed text-muted-foreground">
                        {t('va.embedDesc')}
                      </p>
                    </div>
                    <ServiceBadge ok={embeddingOk} okText={t('va.available')} failText={t('va.unavailable')} />
                  </div>
                  {health?.embedding_error && !embeddingOk && (
                    <p className="mt-2 flex items-start gap-1.5 break-all text-xs text-red-400">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      {health.embedding_error}
                    </p>
                  )}
                </div>
              </section>

              <Separator />

              {/* 功能开关 */}
              <section aria-disabled={gated} className={cn('space-y-3 transition-opacity', gated && 'pointer-events-none opacity-50')}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{t('va.featuresTitle')}</h3>
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold text-theme-primary">{t('va.remoteTitle')}</p>
                    <p className="text-xs text-surface-500">{t('va.remoteDesc')}</p>
                  </div>
                  <Switch checked={settings.remote_video_enabled} onCheckedChange={(checked) => setSettings({ ...settings, remote_video_enabled: checked })} disabled={gated} />
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold text-theme-primary">{t('va.sceneDescTitle')}</p>
                    <p className="text-xs text-surface-500">{t('va.sceneDescDesc')}</p>
                  </div>
                  <Switch checked={settings.describe_enabled} onCheckedChange={(checked) => setSettings({ ...settings, describe_enabled: checked })} disabled={gated} />
                </div>
                {settings.describe_enabled && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-0.5">
                        <div className="text-xs font-medium text-muted-foreground">{t('va.customVlm')}</div>
                        <p className="text-xs text-surface-500">{t('va.customVlmHint')}</p>
                      </div>
                      {/* shadcn/ui Checkbox：小号，区别于上层 section 级 Switch，视觉上表达从属关系 */}
                      <Checkbox
                        checked={useCustomModel}
                        onCheckedChange={(v) => setUseCustomModel(v === true)}
                        disabled={gated}
                      />
                    </div>
                    {!useCustomModel ? null : visionModels.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {t('va.noVlmModel')}
                        <button type="button" onClick={onNavigateToAI} className="underline-offset-2 hover:text-neon hover:underline">
                          {t('va.goAiConfig')}
                        </button>
                      </p>
                    ) : (
                      <Select
                        value={describeProviderID && describeModel ? `${describeProviderID}::${describeModel}` : ''}
                        onValueChange={(val) => {
                          if (val) {
                            const [pid, ...rest] = val.split('::')
                            setDescribeProviderID(pid)
                            setDescribeModel(rest.join('::'))
                          }
                        }}
                      >
                        <SelectTrigger className="w-full" disabled={gated}><SelectValue placeholder={t('va.pickDescModel')} /></SelectTrigger>
                        <SelectContent>
                          {visionModels.map((m, idx) => (
                            <SelectItem key={idx} value={`${m.providerID}::${m.model}`}>{m.model} ({m.providerName})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
              </section>

              {/* 保存 */}
              <div className="flex items-center justify-end gap-3">
                {saved && <span className="text-xs text-emerald-400">{t('va.savedHint')}</span>}
                <Button onClick={save} disabled={saving}>
                  <RefreshCw className={cn('h-4 w-4', saving && 'animate-spin')} />
                  {t('va.saveBtn')}
                </Button>
              </div>
            </>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
