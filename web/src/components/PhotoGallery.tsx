import { useState, useEffect } from 'react'
import { photoApi } from '@/api'
import type { Photo, PhotoAlbum } from '@/types'
import {

  Camera, Image, FolderOpen, Heart, Star, Search,
  Grid3X3, Loader2, X, ZoomIn, ChevronLeft, ChevronRight,
} from 'lucide-react'
import clsx from 'clsx'
import { useTranslation } from '@/i18n'

type Tab = 'photos' | 'albums'

export default function PhotoGallery() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('photos')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [albums, setAlbums] = useState<PhotoAlbum[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState(-1)

  useEffect(() => { loadData() }, [tab, page])

  const loadData = async () => {
    setLoading(true)
    try {
      if (tab === 'photos') {
        const res = await photoApi.list({ page, size: 50 })
        setPhotos(res.data.data || [])
        setTotal(res.data.total)
      } else {
        const res = await photoApi.listAlbums()
        setAlbums(res.data.data || [])
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setLoading(true)
    try {
      const res = await photoApi.search(searchQuery)
      setPhotos(res.data.data || [])
      setTab('photos')
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  const toggleFavorite = async (photoId: string) => {
    try {
      const res = await photoApi.toggleFavorite(photoId)
      setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, is_favorite: res.data.is_favorite } : p))
    } catch { /* ignore */ }
  }

  const setRating = async (photoId: string, rating: number) => {
    try {
      await photoApi.setRating(photoId, rating)
      setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, rating } : p))
    } catch { /* ignore */ }
  }

  const openLightbox = (index: number) => {
    setLightboxIndex(index)
    setSelectedPhoto(photos[index])
  }

  const closeLightbox = () => {
    setLightboxIndex(-1)
    setSelectedPhoto(null)
  }

  const navigateLightbox = (dir: -1 | 1) => {
    const newIndex = lightboxIndex + dir
    if (newIndex >= 0 && newIndex < photos.length) {
      setLightboxIndex(newIndex)
      setSelectedPhoto(photos[newIndex])
    }
  }

  return (
    <div className="space-y-6">
      {/* 标题和搜索 */}
      <div className="flex items-center gap-3">
        <Camera className="h-5 w-5 text-neon-blue" />
        <h2 className="font-display text-xl font-semibold text-white">{t('photo.title')}</h2>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder={t('photo.searchPlaceholder')} className="input-glass rounded-lg px-3 py-2 text-sm w-48" />
          <button onClick={handleSearch} className="btn-ghost rounded-lg p-2">
            <Search className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 rounded-xl bg-surface-800/50 p-1">
        {[
          { key: 'photos' as Tab, label: t('photo.allPhotos'), icon: Grid3X3 },
          { key: 'albums' as Tab, label: t('photo.albums'), icon: FolderOpen },
        ].map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => { setTab(key); setPage(1) }}
            className={clsx(
              'flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all',
              tab === key ? 'bg-neon-blue/20 text-neon-blue' : 'text-surface-400 hover:text-white'
            )}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-neon-blue" /></div>
      ) : tab === 'photos' ? (
        <>
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
            {photos.map((photo, idx) => (
              <div key={photo.id}
                className="relative aspect-square rounded-xl overflow-hidden cursor-pointer group"
                onClick={() => openLightbox(idx)}>
                <img
                  src={photo.thumb_path || photo.file_path}
                  alt={photo.file_name}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                    <button onClick={e => { e.stopPropagation(); toggleFavorite(photo.id) }}
                      className={clsx('p-1', photo.is_favorite ? 'text-red-400' : 'text-white/70')}>
                      <Heart className="h-4 w-4" fill={photo.is_favorite ? 'currentColor' : 'none'} />
                    </button>
                    <ZoomIn className="h-4 w-4 text-white/70" />
                  </div>
                </div>
                {photo.is_favorite && (
                  <Heart className="absolute top-2 right-2 h-3 w-3 text-red-400" fill="currentColor" />
                )}
              </div>
            ))}
          </div>

          {/* 分页 */}
          {total > 50 && (
            <div className="flex justify-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="btn-ghost rounded-lg px-4 py-2 text-sm">{t('pagination.prev')}</button>
              <span className="text-sm text-surface-400 py-2">{t('photo.pageInfo', { page, total: Math.ceil(total / 50) })}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={page * 50 >= total}
                className="btn-ghost rounded-lg px-4 py-2 text-sm">{t('pagination.next')}</button>
            </div>
          )}

          {photos.length === 0 && (
            <div className="text-center py-16 text-surface-500">
              <Image className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg">{t('photo.noPhotos')}</p>
            </div>
          )}
        </>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {albums.map(album => (
            <div key={album.id} className="card-glass rounded-xl overflow-hidden hover:border-neon-blue/30 transition-all cursor-pointer">
              <div className="aspect-[4/3] bg-surface-800 relative">
                {album.cover_photo_id ? (
                  <img src={`/api/photos/${album.cover_photo_id}/thumb`} alt={album.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <FolderOpen className="h-12 w-12 text-surface-600" />
                  </div>
                )}
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                  <p className="text-sm font-medium text-white">{album.name}</p>
                  <p className="text-xs text-white/60">{t('photo.photoCount', { count: album.photo_count })}</p>
                </div>
              </div>
            </div>
          ))}
          {albums.length === 0 && (
            <div className="col-span-full text-center py-16 text-surface-500">
              <FolderOpen className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p>{t('photo.noAlbums')}</p>
            </div>
          )}
        </div>
      )}

      {/* Lightbox */}
      {selectedPhoto && lightboxIndex >= 0 && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={closeLightbox}>
          <button onClick={e => { e.stopPropagation(); closeLightbox() }}
            className="absolute top-4 right-4 text-white/60 hover:text-white z-10">
            <X className="h-6 w-6" />
          </button>

          {lightboxIndex > 0 && (
            <button onClick={e => { e.stopPropagation(); navigateLightbox(-1) }}
              className="absolute left-4 text-white/60 hover:text-white z-10">
              <ChevronLeft className="h-8 w-8" />
            </button>
          )}

          {lightboxIndex < photos.length - 1 && (
            <button onClick={e => { e.stopPropagation(); navigateLightbox(1) }}
              className="absolute right-4 text-white/60 hover:text-white z-10">
              <ChevronRight className="h-8 w-8" />
            </button>
          )}

          <img src={selectedPhoto.file_path} alt={selectedPhoto.file_name}
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={e => e.stopPropagation()} />

          {/* 照片信息 */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 card-glass rounded-xl px-6 py-3 flex items-center gap-6 text-xs text-surface-300"
            onClick={e => e.stopPropagation()}>
            <span>{selectedPhoto.file_name}</span>
            <span>{selectedPhoto.width}×{selectedPhoto.height}</span>
            {selectedPhoto.camera_model && <span>{selectedPhoto.camera_model}</span>}
            {selectedPhoto.taken_at && <span>{new Date(selectedPhoto.taken_at).toLocaleDateString()}</span>}
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map(s => (
                <button key={s} onClick={() => setRating(selectedPhoto!.id, s)}>
                  <Star className={clsx('h-4 w-4', s <= selectedPhoto!.rating ? 'text-yellow-400' : 'text-surface-600')}
                    fill={s <= selectedPhoto!.rating ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>
            <button onClick={() => toggleFavorite(selectedPhoto!.id)}
              className={clsx(selectedPhoto.is_favorite ? 'text-red-400' : 'text-surface-400')}>
              <Heart className="h-4 w-4" fill={selectedPhoto.is_favorite ? 'currentColor' : 'none'} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
