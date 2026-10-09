import { useState } from 'react'
import { useTranslation } from '@/i18n'
import { Check, X, Loader2, Zap, Scan, Play, Save, ChevronDown, ChevronUp } from 'lucide-react'
import { adminApi } from '@/api'
import type { SystemSettings } from '@/types'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { ToggleButton } from '@/components/admin/ToggleButton'

// ==================== 播放与转码 Drawer ====================
// 系统全局播放/转码/缓存设置。核心项（GPU 加速转码）默认展示，
// 低频项（回退/自动预处理/自动转码）折叠为「高级设置」。

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  sysSettings: SystemSettings
  setSysSettings: React.Dispatch<React.SetStateAction<SystemSettings>>
}

export default function PlaybackDrawer({ open, onOpenChange, sysSettings, setSysSettings }: Props) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    setMsg(null)
    try {
      await adminApi.updateSystemSettings(sysSettings)
      setMsg({ type: 'success', text: t('pb.saved') })
      setTimeout(() => setMsg(null), 4000)
    } catch {
      setMsg({ type: 'error', text: t('pb.saveFailed') })
    } finally {
      setSaving(false)
    }
  }

  const S = (key: keyof SystemSettings) => (v: boolean) => setSysSettings((s) => ({ ...s, [key]: v }))

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={t('pb.title')} description={t('pb.desc')}>
        <div className="space-y-6">
          {/* 提示 */}
          <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)', color: 'var(--text-tertiary)' }}>
            {t('pb.hint')}
          </div>

          {/* 核心：GPU 加速转码 */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Zap size={16} style={{ color: 'var(--neon-blue)' }} />
                <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('pb.gpuTitle')}</h4>
              </div>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>{t('pb.gpuDesc')}</p>
            </div>
            <ToggleButton checked={sysSettings.enable_gpu_transcode} onChange={S('enable_gpu_transcode')} />
          </div>

          {/* ===== 高级设置（折叠）===== */}
          <div style={{ borderTop: '1px solid var(--border-default)' }} />
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex w-full items-center justify-between text-sm font-medium transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span>{t('createLib.advanced')}</span>
            {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {showAdvanced && (
            <div className="space-y-5">
              {/* 扫描后自动预处理 */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Scan size={16} style={{ color: '#06B6D4' }} />
                    <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('pb.autoPreprocess')}</h4>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>{t('pb.autoPreprocessDesc')}</p>
                </div>
                <ToggleButton checked={sysSettings.auto_preprocess_on_scan} onChange={S('auto_preprocess_on_scan')} />
              </div>

              {/* 播放时自动转码 */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Play size={16} style={{ color: '#EC4899' }} />
                    <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('pb.autoTranscode')}</h4>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>{t('pb.autoTranscodeDesc')}</p>
                </div>
                <ToggleButton checked={sysSettings.auto_transcode_on_play} onChange={S('auto_transcode_on_play')} />
              </div>
            </div>
          )}

          {/* 保存 */}
          <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: '1rem' }}>
            {msg && (
              <div className="mb-3 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm" style={{
                background: msg.type === 'success' ? 'rgba(22, 163, 74, 0.08)' : 'rgba(220, 38, 38, 0.08)',
                color: msg.type === 'success' ? '#16A34A' : '#DC2626',
              }}>
                {msg.type === 'success' ? <Check size={16} /> : <X size={16} />} {msg.text}
              </div>
            )}
            <button onClick={handleSave} disabled={saving} className="btn-primary gap-1.5 px-5 py-2.5 text-sm">
              {saving ? (<><Loader2 size={14} className="animate-spin" />{t('editLib.saving')}</>) : (<><Save size={14} />{t('pb.saveBtn')}</>)}
            </button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
