import type { CSSProperties } from 'react'
import { Check, ListPlus } from 'lucide-react'
import { useTranslation } from '@/i18n'
import type { Playlist } from '@/types'

interface PlaylistMenuProps {
  playlists: Playlist[]
  /** 判断某个播放列表是否已包含该媒体 */
  mediaId: string
  open: boolean
  /** 打开/关闭：调用方借此同时收起其它菜单 */
  onOpenChange: (open: boolean) => void
  onAdd: (playlistId: string) => void
  /** 触发按钮的类名与内联样式（各详情页操作区的按钮样式不同） */
  className: string
  style?: CSSProperties
}

/** 「加入列表」图标按钮 + 下拉菜单（电影 / 剧集详情页操作区共用） */
export default function PlaylistMenu({
  playlists,
  mediaId,
  open,
  onOpenChange,
  onAdd,
  className,
  style,
}: PlaylistMenuProps) {
  const { t } = useTranslation()

  return (
    <div className="relative">
      <button
        onClick={() => onOpenChange(!open)}
        className={className}
        style={style}
        title={t('hero.addToPlaylist')}
        aria-label={t('hero.addToPlaylist')}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <ListPlus size={20} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-20 mt-2 min-w-[220px] rounded-xl py-1 shadow-2xl animate-scale-in"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--glass-border)',
            backdropFilter: 'blur(20px)',
          }}
          role="menu"
          aria-label={t('hero.playlists')}
        >
          <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{t('hero.playlists')}</div>
          {playlists.length === 0 ? (
            <div className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>{t('hero.noPlaylists')}</div>
          ) : (
            playlists.map((pl) => (
              <button
                key={pl.id}
                onClick={() => onAdd(pl.id)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-neon-blue/5"
                style={{ color: 'var(--text-secondary)' }}
              >
                <ListPlus size={14} />
                {pl.name}
                {pl.items?.some((item) => item.media_id === mediaId) && (
                  <Check size={14} className="ml-auto text-neon" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
