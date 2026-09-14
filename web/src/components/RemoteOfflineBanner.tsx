import { WifiOff } from 'lucide-react'
import { STORAGE_TYPE_LABELS, type StorageType } from '@/lib/storageSchemes'

interface RemoteOfflineBannerProps {
  /** 当前范围内已断连的远程存储类型集合 */
  types: Set<StorageType>
}

/** 远程存储断连提示条：一条消息解释当前范围内所有「源离线」媒体 */
export default function RemoteOfflineBanner({ types }: RemoteOfflineBannerProps) {
  if (types.size === 0) return null
  const labels = [...types].map((t) => STORAGE_TYPE_LABELS[t]).join('、')
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
      style={{
        background: 'rgba(245, 158, 11, 0.08)',
        border: '1px solid rgba(245, 158, 11, 0.25)',
        color: 'rgb(251, 191, 36)',
      }}
    >
      <WifiOff size={14} className="flex-shrink-0" />
      <span>
        远程存储 {labels} 连接不上，来自这些存储的内容暂时无法播放，恢复后自动恢复
      </span>
    </div>
  )
}
