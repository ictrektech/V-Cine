import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
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

function ServiceBadge({ ok, okText = '在线', failText = '离线' }: { ok: boolean | null; okText?: string; failText?: string }) {
  if (ok === null) {
    return <Badge variant="outline" className="text-muted-foreground">检查中</Badge>
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
      setError(extractErrMsg(e) || '无法获取视频分析服务状态')
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
      setError(extractErrMsg(e) || '无法读取视频分析设置')
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
      setError(extractErrMsg(e) || '保存配置失败')
    } finally {
      setSaving(false)
    }
  }

  // 总开关关闭时，依赖设置整组禁用（保持可见，便于发现要配置的内容）
  const gated = !settings || !settings.enabled

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="xl" title="视频分析" description="场景检测 / 结构分析 / 场景描述">
        <div className="space-y-5">
          {settingsLoading && !settings && (
            <div className="py-16 text-center" aria-busy="true">
              <Loader2 className="mx-auto animate-spin text-neon" />
              <p className="mt-2 text-sm text-surface-400">正在读取设置…</p>
            </div>
          )}

          {settings && (
            <>
              {/* 总开关：主视觉，第一眼焦点 */}
              <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-theme-primary">启用视频结构化分析</p>
                  <p className="text-xs text-surface-500">开启后，媒体转码完成自动提交结构与场景分析任务</p>
                </div>
                <Switch checked={settings.enabled} onCheckedChange={(checked) => setSettings({ ...settings, enabled: checked })} />
              </div>

              {/* 服务地址：状态徽章内联到分组标题 */}
              <section aria-disabled={gated} className={cn('space-y-3 transition-opacity', gated && 'pointer-events-none opacity-50')}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">服务地址</h3>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Scene 场景检测地址</span>
                      <ServiceBadge ok={sceneOk} />
                    </div>
                    <Input value={settings.scene_base_url} onChange={(e) => setSettings({ ...settings, scene_base_url: e.target.value })} disabled={gated} placeholder="http://scene-detection:8910" />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Structure 结构分析地址</span>
                      <ServiceBadge ok={structureOk} />
                    </div>
                    <Input value={settings.structure_base_url} onChange={(e) => setSettings({ ...settings, structure_base_url: e.target.value })} disabled={gated} placeholder="http://video-structure:8911" />
                  </div>
                  {health?.scene_error && (
                    <p className="break-all text-xs text-red-400">Scene：{health.scene_error}</p>
                  )}
                  {health?.structure_error && (
                    <p className="break-all text-xs text-red-400">Structure：{health.structure_error}</p>
                  )}
                </div>
              </section>

              <Separator />

              {/* 功能开关 */}
              <section aria-disabled={gated} className={cn('space-y-3 transition-opacity', gated && 'pointer-events-none opacity-50')}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">功能</h3>
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold text-theme-primary">远程视频结构化</p>
                    <p className="text-xs text-surface-500">通过 URL 拉流分析远程视频（webdav / alist / s3），会消耗网络带宽</p>
                  </div>
                  <Switch checked={settings.remote_video_enabled} onCheckedChange={(checked) => setSettings({ ...settings, remote_video_enabled: checked })} disabled={gated} />
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold text-theme-primary">场景描述</p>
                    <p className="text-xs text-surface-500">为媒体生成场景描述，需要视觉模型</p>
                  </div>
                  <Switch checked={settings.describe_enabled} onCheckedChange={(checked) => setSettings({ ...settings, describe_enabled: checked })} disabled={gated} />
                </div>
                {settings.describe_enabled && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-0.5">
                        <div className="text-xs font-medium text-muted-foreground">自定义场景描述 VLM 视觉模型</div>
                        <p className="text-xs text-surface-500">不选择默认用结构化服务的默认模型（推荐）</p>
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
                        当前没有可用的视觉模型，
                        <button type="button" onClick={onNavigateToAI} className="underline-offset-2 hover:text-neon hover:underline">
                          前往 AI 服务配置 →
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
                        <SelectTrigger className="w-full" disabled={gated}><SelectValue placeholder="请选择场景描述模型" /></SelectTrigger>
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
                {saved && <span className="text-xs text-emerald-400">已保存，所有设置已立即生效。</span>}
                <Button onClick={save} disabled={saving}>
                  <RefreshCw className={cn('h-4 w-4', saving && 'animate-spin')} />
                  保存更改
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
