import { useState, useEffect } from 'react'
import { musicApi } from '@/api'
import type { MusicTrack, MusicAlbum, MusicPlaylist } from '@/types'
import {
  Music, Disc3, ListMusic, Heart, Search, Play, Pause,
  SkipForward, SkipBack, Volume2, Loader2,
} from 'lucide-react'
import clsx from 'clsx'
import { useTranslation } from '@/i18n'

type Tab = 'tracks' | 'albums' | 'playlists'

export default function MusicPlayer() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('tracks')
  const [tracks, setTracks] = useState<MusicTrack[]>([])
  const [albums, setAlbums] = useState<MusicAlbum[]>([])
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [lyrics, setLyrics] = useState('')

  useEffect(() => {
    loadData()
  }, [tab])

  const loadData = async () => {
    setLoading(true)
    try {
      switch (tab) {
        case 'tracks': {
          const res = await musicApi.listTracks({ page: 1, size: 50 })
          setTracks(res.data.data || [])
          break
        }
        case 'albums': {
          const res = await musicApi.listAlbums({ page: 1, size: 30 })
          setAlbums(res.data.data || [])
          break
        }
        case 'playlists': {
          const res = await musicApi.listPlaylists()
          setPlaylists(res.data.data || [])
          break
        }
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setLoading(true)
    try {
      const res = await musicApi.search(searchQuery)
      setTracks(res.data.data || [])
      setTab('tracks')
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  const playTrack = async (track: MusicTrack) => {
    setCurrentTrack(track)
    setIsPlaying(true)
    // 加载歌词
    try {
      const res = await musicApi.getLyrics(track.id)
      setLyrics(res.data.data || '')
    } catch {
      setLyrics('')
    }
  }

  const toggleLove = async (trackId: string) => {
    try {
      await musicApi.toggleLove(trackId)
      setTracks(prev => prev.map(t => t.id === trackId ? { ...t, loved: !t.loved } : t))
    } catch { /* ignore */ }
  }

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="flex flex-col h-full">
      {/* 搜索栏 */}
      <div className="flex items-center gap-3 mb-6">
        <Music className="h-5 w-5 text-neon-purple" />
        <h2 className="font-display text-xl font-semibold text-white">{t('music.title')}</h2>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder={t('music.searchPlaceholder')} className="input-glass rounded-lg px-3 py-2 text-sm w-48" />
          <button onClick={handleSearch} className="btn-ghost rounded-lg p-2">
            <Search className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 rounded-xl bg-surface-800/50 p-1 mb-6">
        {[
          { key: 'tracks' as Tab, label: t('music.tracks'), icon: Music },
          { key: 'albums' as Tab, label: t('music.albums'), icon: Disc3 },
          { key: 'playlists' as Tab, label: t('music.playlists'), icon: ListMusic },
        ].map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={clsx(
              'flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all',
              tab === key ? 'bg-neon-purple/20 text-neon-purple' : 'text-surface-400 hover:text-white'
            )}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-neon-purple" /></div>
        ) : tab === 'tracks' ? (
          <div className="space-y-1">
            {tracks.map((track, idx) => (
              <div key={track.id}
                className={clsx(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/5 transition-colors cursor-pointer group',
                  currentTrack?.id === track.id && 'bg-neon-purple/10'
                )}
                onClick={() => playTrack(track)}>
                <span className="w-8 text-center text-xs text-surface-500 group-hover:hidden">{idx + 1}</span>
                <Play className="w-8 h-4 text-neon-purple hidden group-hover:block" />
                {track.cover_path && (
                  <img src={track.cover_path} alt="" className="w-10 h-10 rounded-lg object-cover" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{track.title}</p>
                  <p className="text-xs text-surface-400 truncate">{track.artist} · {track.album}</p>
                </div>
                <button onClick={e => { e.stopPropagation(); toggleLove(track.id) }}
                  className={clsx('p-1', track.loved ? 'text-red-400' : 'text-surface-500 hover:text-red-400')}>
                  <Heart className="h-4 w-4" fill={track.loved ? 'currentColor' : 'none'} />
                </button>
                <span className="text-xs text-surface-500 w-12 text-right">{formatDuration(track.duration)}</span>
              </div>
            ))}
            {tracks.length === 0 && (
              <div className="text-center py-16 text-surface-500">
                <Music className="h-16 w-16 mx-auto mb-4 opacity-20" />
                <p>{t('music.noTracks')}</p>
              </div>
            )}
          </div>
        ) : tab === 'albums' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {albums.map(album => (
              <div key={album.id} className="card-glass rounded-xl overflow-hidden hover:border-neon-purple/30 transition-all cursor-pointer group">
                <div className="aspect-square bg-surface-800 relative">
                  {album.cover_path ? (
                    <img src={album.cover_path} alt={album.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Disc3 className="h-12 w-12 text-surface-600" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Play className="h-10 w-10 text-white" />
                  </div>
                </div>
                <div className="p-3">
                  <p className="text-sm font-medium text-white truncate">{album.title}</p>
                  <p className="text-xs text-surface-400 truncate">{album.artist} · {album.year}</p>
                  <p className="text-xs text-surface-500 mt-1">{t('music.trackCount', { count: album.track_count })}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {playlists.map(playlist => (
              <div key={playlist.id} className="card-glass rounded-xl p-4 flex items-center gap-4 hover:border-neon-purple/30 transition-all cursor-pointer">
                <div className="w-14 h-14 rounded-xl bg-surface-800 flex items-center justify-center shrink-0">
                  <ListMusic className="h-6 w-6 text-surface-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{playlist.name}</p>
                  <p className="text-xs text-surface-400">{t('music.playlistTrackCount', { count: playlist.items?.length || 0 })}</p>
                </div>
              </div>
            ))}
            {playlists.length === 0 && (
              <div className="text-center py-16 text-surface-500">
                <ListMusic className="h-16 w-16 mx-auto mb-4 opacity-20" />
                <p>{t('music.noPlaylists')}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部播放器 */}
      {currentTrack && (
        <div className="mt-4 card-glass rounded-2xl p-4">
          <div className="flex items-center gap-4">
            {currentTrack.cover_path && (
              <img src={currentTrack.cover_path} alt="" className="w-12 h-12 rounded-xl object-cover" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{currentTrack.title}</p>
              <p className="text-xs text-surface-400 truncate">{currentTrack.artist}</p>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-ghost rounded-full p-2"><SkipBack className="h-4 w-4" /></button>
              <button onClick={() => setIsPlaying(!isPlaying)}
                className="btn-neon rounded-full p-3">
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </button>
              <button className="btn-ghost rounded-full p-2"><SkipForward className="h-4 w-4" /></button>
            </div>
            <Volume2 className="h-4 w-4 text-surface-400" />
          </div>

          {/* 歌词显示 */}
          {lyrics && (
            <div className="mt-3 pt-3 border-t border-white/5 max-h-20 overflow-y-auto">
              <p className="text-xs text-surface-400 text-center whitespace-pre-line">{lyrics}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
