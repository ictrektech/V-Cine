import { Play } from 'lucide-react'

/** 源离线时的禁用播放按钮：说明原因，不响应点击 */
export default function OfflinePlayButton() {
  return (
    <div
      className="inline-flex cursor-not-allowed items-center gap-2.5 rounded-2xl px-8 py-3.5 text-base font-bold opacity-60 grayscale"
      style={{ background: 'var(--neon-blue)', color: 'var(--text-on-neon)' }}
      title="远程存储连接不上，暂时无法播放"
      aria-disabled="true"
    >
      <Play size={22} fill="currentColor" />
      源离线，无法播放
    </div>
  )
}
