import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw, ScanLine, Server } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { videoAnalysisApi } from '@/api'
import type { VideoAnalysisHealthInfo, VideoAnalysisSettings } from '@/types/videoAnalysis'
import { cn } from '@/lib/utils'
import { extractErrMsg } from '@/utils/error'

interface VideoAnalysisDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
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

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className={cn('break-all text-right text-sm text-foreground', mono && 'font-mono text-xs')}>{value || '—'}</span>
    </div>
  )
}

export default function VideoAnalysisDrawer({ open, onOpenChange }: VideoAnalysisDrawerProps) {
  const [health, setHealth] = useState<VideoAnalysisHealthInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [settings, setSettings] = useState<VideoAnalysisSettings | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const healthRes = await videoAnalysisApi.getHealth()
      setHealth(healthRes.data.data)
    } catch (e) {
      setError(extractErrMsg(e) || '无法获取视频分析服务状态')
    } finally {
      setLoading(false)
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
      setEditing(false)
    } finally {
      setSettingsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      load()
      if (editing) loadSettings()
    }
  }, [open, editing, load, loadSettings])

  const sceneOk = health ? (health.available ? health.scene?.status === 'ok' : false) : null
  const structureOk = health ? (health.available ? health.structure?.status === 'ok' : false) : null

  const save = async () => {
    if (!settings) return
    setSaving(true)
    setError('')
    try {
      await videoAnalysisApi.updateSettings(settings)
      setSaved(true)
      setEditing(false)
      await load()
    } catch (e) {
      setError(extractErrMsg(e) || '保存配置失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="xl" title="视频分析" description="场景检测 / 结构分析 / 场景描述服务状态">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {editing ? '服务地址保存后立即生效，其他设置需重启后生效。' : '以下为当前运行中的服务状态。'}
            </p>
            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => { setEditing(false); setError('') }}>取消</Button>
                  <Button size="sm" onClick={save} disabled={saving || !settings}>
                    <RefreshCw className={cn('h-4 w-4', saving && 'animate-spin')} />
                    保存
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>编辑配置</Button>
                  <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                    <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                    刷新
                  </Button>
                </>
              )}
            </div>
          </div>

          {saved && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
              已保存，服务地址已立即生效；其他设置将在重启后生效。
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {editing && settingsLoading && (
            <div className="py-16 text-center" aria-busy="true">
              <Loader2 className="mx-auto animate-spin text-neon" />
              <p className="mt-2 text-sm text-surface-400">正在读取设置…</p>
            </div>
          )}

          {editing && !settingsLoading && settings && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base"><Server className="h-4 w-4" />基础配置</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <label className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">启用视频分析</span>
                  <Switch checked={settings.enabled} onCheckedChange={(checked) => setSettings({ ...settings, enabled: checked })} />
                </label>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Scene 场景检测地址</div>
                  <Input value={settings.scene_base_url} onChange={(e) => setSettings({ ...settings, scene_base_url: e.target.value })} placeholder="http://scene-detection:8910" />
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Structure 结构分析地址</div>
                  <Input value={settings.structure_base_url} onChange={(e) => setSettings({ ...settings, structure_base_url: e.target.value })} placeholder="http://video-structure:8911" />
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">产物目录</div>
                  <Input value={settings.asset_dir} disabled />
                </div>
                <label className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">场景描述</span>
                  <Switch checked={settings.describe_enabled} onCheckedChange={(checked) => setSettings({ ...settings, describe_enabled: checked })} />
                </label>
              </CardContent>
            </Card>
          )}
          {!editing && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Server className="h-4 w-4" />当前运行状态
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">视频分析服务</span>
                    {!health ? (
                      <Badge variant="outline" className="text-muted-foreground">读取中</Badge>
                    ) : health.available && health.enabled ? (
                      <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-400">已启用</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">未启用 / 不可用</Badge>
                    )}
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Scene 场景检测</span>
                    <ServiceBadge ok={sceneOk} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Structure 结构分析</span>
                    <ServiceBadge ok={structureOk} />
                  </div>

                  {health?.scene_error && (
                    <p className="break-all text-xs text-red-400">Scene：{health.scene_error}</p>
                  )}
                  {health?.structure_error && (
                    <p className="break-all text-xs text-red-400">Structure：{health.structure_error}</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ScanLine className="h-4 w-4" />配置摘要
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <InfoRow label="服务启用" value={health ? (health.enabled ? '是' : '否') : '—'} />
                  <InfoRow label="场景描述" value={health ? (health.describe_enabled ? '开启' : '关闭') : '—'} />
                  <InfoRow label="Scene 地址" value={health?.scene_base_url || '—'} mono />
                  <InfoRow label="Structure 地址" value={health?.structure_base_url || '—'} mono />
                  <InfoRow label="产物目录" value={health?.asset_dir || '—'} mono />
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
