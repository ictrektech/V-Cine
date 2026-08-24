import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, ScanLine, Server } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { videoAnalysisApi } from '@/api'
import type { VideoAnalysisHealthInfo } from '@/types/videoAnalysis'
import { cn } from '@/lib/utils'

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

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const healthRes = await videoAnalysisApi.getHealth()
      setHealth(healthRes.data.data)
    } catch {
      setError('无法获取视频分析服务状态')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const sceneOk = health ? (health.available ? health.scene?.status === 'ok' : false) : null
  const structureOk = health ? (health.available ? health.structure?.status === 'ok' : false) : null

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="xl" title="视频分析" description="场景检测 / 结构分析 / 场景描述服务状态">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              刷新
            </Button>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Server className="h-4 w-4" />服务状态
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
        </div>
      </DrawerContent>
    </Drawer>
  )
}
