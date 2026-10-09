import { Play } from 'lucide-react'
import { useTranslation } from '@/i18n'

/** 源离线时的禁用播放按钮：说明原因，不响应点击 */
export default function OfflinePlayButton() {
  const { t } = useTranslation()
  return (
    <div
      className="inline-flex cursor-not-allowed items-center gap-2.5 rounded-2xl px-8 py-3.5 text-base font-bold opacity-60 grayscale"
      style={{ background: 'var(--neon-blue)', color: 'var(--text-on-neon)' }}
      title={t('pp.offlineHint')}
      aria-disabled="true"
    >
      <Play size={22} fill="currentColor" />
      {t('pp.sourceOfflineTitle')}
    </div>
  )
}
