import { useState, useEffect } from 'react'
import { bookmarkApi } from '@/api'
import { useToast } from '@/components/Toast'
import type { Bookmark } from '@/types'
import { Bookmark as BookmarkIcon, Plus, Trash2, X } from 'lucide-react'
import { useTranslation } from '@/i18n'

interface BookmarkPanelProps {
  mediaId: string
  currentTime: number
  onSeek: (time: number) => void
}

export default function BookmarkPanel({ mediaId, currentTime, onSeek }: BookmarkPanelProps) {
  const { t } = useTranslation()
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(false)
  const toast = useToast()

  useEffect(() => {
    loadBookmarks()
  }, [mediaId])

  const loadBookmarks = async () => {
    try {
      const res = await bookmarkApi.listByMedia(mediaId)
      setBookmarks(res.data.data || [])
    } catch {
      toast.error(t('bmk.loadFailed'))
    }
  }

  const handleAdd = async () => {
    if (!title.trim()) return
    try {
      await bookmarkApi.create({
        media_id: mediaId,
        position: currentTime,
        title: title.trim(),
        note: note.trim(),
      })
      setTitle('')
      setNote('')
      setShowAdd(false)
      loadBookmarks()
    } catch {
      toast.error(t('bmk.addFailed'))
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await bookmarkApi.delete(id)
      loadBookmarks()
    } catch {
      toast.error(t('bmk.deleteFailed'))
    }
  }

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm backdrop-blur-md transition-all hover:text-white"
        style={{
          background: 'var(--neon-blue-6)',
          border: '1px solid var(--neon-blue-10)',
          color: 'var(--text-secondary)',
        }}
        title={t('bmk.title')}
      >
        <BookmarkIcon size={16} />
        <span className="hidden sm:inline">{t('bmk.title')}</span>
        {bookmarks.length > 0 && (
          <span className="ml-1 rounded-full px-1.5 text-xs font-bold"
            style={{ background: 'var(--bg-overlay)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            {bookmarks.length}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="absolute bottom-16 right-4 z-50 w-80 rounded-xl shadow-2xl"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--neon-blue-10)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--neon-blue-8)' }}>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <BookmarkIcon size={16} className="text-neon-blue" />
          {t('bmk.videoBookmarks')}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="rounded-lg p-1 text-surface-400 transition-colors hover:text-neon-blue hover:bg-neon-blue/5"
            title={t('bmk.addTitle')}
          >
            <Plus size={16} />
          </button>
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg p-1 text-surface-400 transition-colors hover:text-white hover:bg-white/5"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 添加表单 */}
      {showAdd && (
        <div className="p-4 space-y-2" style={{ borderBottom: '1px solid var(--neon-blue-8)' }}>
          <div className="text-xs text-surface-400">
            {t('bmk.addedAtHead')}<span className="font-display font-bold tracking-wide text-neon-blue">{formatTime(currentTime)}</span>{t('bmk.addedAtTail')}
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('bmk.namePlaceholder')}
            className="input py-2"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('bmk.notePlaceholder')}
            className="input py-2"
          />
          <button
            onClick={handleAdd}
            disabled={!title.trim()}
            className="btn-primary w-full py-2 text-sm"
          >
            {t('bmk.add')}
          </button>
        </div>
      )}

      {/* 书签列表 */}
      <div className="max-h-64 overflow-y-auto">
        {bookmarks.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-surface-500">
            {t('bmk.empty')}
          </div>
        ) : (
          bookmarks.map((bm) => (
            <div
              key={bm.id}
              className="group flex items-center gap-3 cursor-pointer px-4 py-3 transition-colors hover:bg-neon-blue/3"
              style={{ borderBottom: '1px solid var(--neon-blue-4)' }}
              onClick={() => onSeek(bm.position)}
            >
              <span className="shrink-0 rounded-md px-2 py-0.5 font-display text-xs font-bold tracking-wide"
                style={{
                  background: 'var(--neon-blue-8)',
                  color: 'var(--neon-blue)',
                  border: '1px solid var(--neon-blue-12)',
                }}
              >
                {formatTime(bm.position)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white">{bm.title}</p>
                {bm.note && <p className="truncate text-xs text-surface-500">{bm.note}</p>}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(bm.id) }}
                className="shrink-0 rounded-lg p-1 text-surface-600 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
