import { useMemo, useState } from 'react'
import { usePosterVersion } from '@/stores/mediaRefresh'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { collectionApi } from '@/api'
import { streamApi } from '@/api'
import { usePageCache, invalidatePageCachePrefix } from '@/hooks/usePageCache'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/components/Toast'
import { usePagination } from '@/hooks/usePagination'
import Pagination from '@/components/Pagination'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import MediaPickerList from '@/components/media/MediaPickerList'
import type { CollectionWithMedia } from '@/types'
import { groupByMovie, versionLabel, type GroupedMovieItem } from '@/utils/collectionGroup'
import {
  Layers,
  Film,
  Star,
  Calendar,
  Clock,
  Loader2,
  Play,
  ArrowLeft,
  Grid3X3,
  LayoutList,
  ArrowUpDown,
  Copy,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useTranslation } from '@/i18n'

type SortOption = 'premiered_asc' | 'premiered_desc' | 'title_asc' | 'rating_desc'

const SORT_OPTIONS: { value: SortOption; labelKey: string }[] = [
  { value: 'premiered_asc', labelKey: 'collections.sortPremieredAsc' },
  { value: 'premiered_desc', labelKey: 'collections.sortPremieredDesc' },
  { value: 'title_asc', labelKey: 'collections.sortTypeTitleAsc' },
  { value: 'rating_desc', labelKey: 'collections.sortRatingDesc' },
]

export default function CollectionDetailPage() {
  const { t } = useTranslation()
  const toast = useToast()
  // 维护操作走 admin 接口，仅管理员显示入口
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  // 订阅海报版本戳：刮削/替换海报后触发重渲染，图片 URL 自动带上新版本号
  usePosterVersion()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const viewMode = (searchParams.get('view') || 'grid') as 'grid' | 'list'
  const sortOption = (searchParams.get('sort') || 'premiered_asc') as SortOption
  const [headerGenresExpanded, setHeaderGenresExpanded] = useState(false)

  // 按 id 分键缓存：跨页面返回时命中缓存，零 loading
  const { data, loading, error, refetch } = usePageCache<CollectionWithMedia>(
    id ? `collection:detail:${id}` : null,
    async () => {
      const res = await collectionApi.getDetail(id!)
      return res.data.data
    },
    { ttl: 60_000 },
  )

  const sortedMedia = useMemo(() => {
    if (!data?.media) return []
    // ★ 方案 C 核心：先按"同一部电影"折叠多版本（以主版本来做后续排序/展示）
    const grouped: GroupedMovieItem[] = groupByMovie(data.media)
    // 排序时使用代表版本（primary）的字段
    const sorted = [...grouped]
    const byPremiered = (dir: 'asc' | 'desc') => (ga: GroupedMovieItem, gb: GroupedMovieItem) => {
      const a = ga.primary, b = gb.primary
      const da = a.premiered || '', db = b.premiered || ''
      if (da && db) {
        const cmp = dir === 'asc' ? da.localeCompare(db) : db.localeCompare(da)
        return cmp || a.title.localeCompare(b.title)
      }
      if (da) return -1
      if (db) return 1
      const ya = a.year || (dir === 'asc' ? 9999 : 0)
      const yb = b.year || (dir === 'asc' ? 9999 : 0)
      const ycmp = dir === 'asc' ? ya - yb : yb - ya
      return ycmp || a.title.localeCompare(b.title)
    }
    switch (sortOption) {
      case 'premiered_asc':
        sorted.sort(byPremiered('asc'))
        break
      case 'premiered_desc':
        sorted.sort(byPremiered('desc'))
        break
      case 'title_asc':
        sorted.sort((a, b) => a.primary.title.localeCompare(b.primary.title))
        break
      case 'rating_desc':
        sorted.sort((a, b) => b.primary.rating - a.primary.rating || a.primary.title.localeCompare(b.primary.title))
        break
    }
    return sorted
  }, [data?.media, sortOption])

  // 分页（前端分页，合集规模一般不大）
  const { page, size, setPage, setSize, totalPages } = usePagination({
    initialSize: 24,
    syncToUrl: true,
  })

  const pagedMedia = useMemo(() => {
    const start = (page - 1) * size
    return sortedMedia.slice(start, start + size)
  }, [sortedMedia, page, size])

  // 统计折叠后的电影总数 & 原始文件总数，用于展示标签
  const movieCount = sortedMedia.length
  const fileCount = data?.media?.length || 0

  // ===== 手动维护合集 =====
  const [showEdit, setShowEdit] = useState(false)
  const [editName, setEditName] = useState('')
  const [editOverview, setEditOverview] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addIds, setAddIds] = useState<string[]>([])
  const [showDelete, setShowDelete] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<GroupedMovieItem | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSaveEdit = async () => {
    const name = editName.trim()
    if (!id || !name || busy) return
    setBusy(true)
    try {
      await collectionApi.update(id, { name, overview: editOverview.trim() })
      setShowEdit(false)
      invalidatePageCachePrefix('collections:')
      refetch(true)
    } catch {
      toast.error(t('collections.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleAddMovies = async () => {
    if (!id || busy || addIds.length === 0) return
    setBusy(true)
    try {
      for (const mediaId of addIds) {
        await collectionApi.addMedia(id, mediaId)
      }
      setShowAdd(false)
      setAddIds([])
      invalidatePageCachePrefix('collections:')
      refetch(true)
    } catch {
      toast.error(t('collections.addFailed'))
    } finally {
      setBusy(false)
    }
  }

  // 移除前先确认，避免误删整部电影的全部版本
  const handleRemoveMovie = async () => {
    const group = removeTarget
    if (!id || !group || busy) return
    setBusy(true)
    try {
      for (const version of group.versions) {
        await collectionApi.removeMedia(id, version.id)
      }
      setRemoveTarget(null)
      invalidatePageCachePrefix('collections:')
      refetch(true)
    } catch {
      toast.error(t('collections.removeFailed'))
    } finally {
      setBusy(false)
    }
  }

  const existingMediaIds = useMemo(() => (data?.media || []).map((item) => item.id), [data?.media])

  const handleDelete = async () => {
    if (!id || busy) return
    setBusy(true)
    try {
      await collectionApi.remove(id)
      invalidatePageCachePrefix('collections:')
      navigate('/collections')
    } catch {
      toast.error(t('collections.deleteFailed'))
    } finally {
      setBusy(false)
    }
  }

  // 只在"首次加载且无任何数据"时才显示全屏 loader，避免返回时闪屏
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={32} className="animate-spin text-neon" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Layers size={48} className="text-surface-600" />
        <p className="text-lg font-medium" style={{ color: 'var(--text-secondary)' }}>
          {error ? t('collections.loadFailed') : t('collections.notFound')}
        </p>
        <button onClick={() => navigate('/collections')} className="btn-ghost text-sm">
          {t('collections.backToList')}
        </button>
      </div>
    )
  }

  const { collection, media } = data

  return (
    <div className="min-h-screen">
      {/* 顶部背景区域 */}
      <div className="relative overflow-hidden" style={{ minHeight: '360px' }}>
        {/* 背景图 */}
        <div className="absolute inset-0">
          <img
            src={streamApi.getCollectionPosterUrl(collection.id)}
            alt=""
            className="h-full w-full object-cover"
            style={{ filter: 'blur(40px) brightness(0.3) saturate(1.5)', transform: 'scale(1.2)' }}
          />
          {/* 多层渐变遮罩，确保日间/夜间模式下内容都清晰可读 */}
          <div
            className="absolute inset-0"
            style={{
              background: 'var(--bg-base)',
              opacity: 0.55,
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(to bottom, transparent 0%, var(--bg-base) 100%)',
            }}
          />
        </div>

        {/* 内容 */}
        <div className="relative z-10 mx-auto max-w-7xl px-4 pt-6 pb-8 sm:px-6 lg:px-8">
          {/* 返回按钮 */}
          <button
            onClick={() => navigate(-1)}
            className="mb-6 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all"
            style={{
              color: 'var(--text-primary)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-elevated)'
              e.currentTarget.style.borderColor = 'var(--border-hover)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-surface)'
              e.currentTarget.style.borderColor = 'var(--border-default)'
            }}
          >
            <ArrowLeft size={16} />
            {t('common.back')}
          </button>

          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            {/* 合集海报 */}
            <div className="flex-shrink-0">
              <div className="relative h-56 w-40 overflow-hidden rounded-xl shadow-2xl sm:h-64 sm:w-44"
                style={{ border: '1px solid var(--border-default)' }}>
                <img
                  src={streamApi.getCollectionPosterUrl(collection.id)}
                  alt={collection.name}
                  className="h-full w-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
                <div className="absolute inset-0 -z-10 flex h-full w-full items-center justify-center"
                  style={{ background: 'var(--bg-elevated)' }}>
                  <Layers size={40} className="text-surface-600" />
                </div>
              </div>
            </div>

            {/* 合集信息 */}
            <div className="flex-1 min-w-0 pb-2">
              <div className="flex items-center gap-2 mb-2">
                <Layers size={16} className="text-neon/60" />
                <span className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--neon-blue)' }}>
                  {t('collections.overviewBadge')}
                </span>
              </div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h1 className="font-display text-3xl font-bold tracking-wide sm:text-4xl"
                  style={{ color: 'var(--text-primary)' }}>
                  {collection.name}
                </h1>
                {isAdmin && (
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      onClick={() => {
                        setEditName(collection.name)
                        setEditOverview(collection.overview || '')
                        setShowEdit(true)
                      }}
                      className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs"
                    >
                      <Pencil size={13} />
                      {t('collections.edit')}
                    </button>
                    <button
                      onClick={() => setShowAdd(true)}
                      className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs"
                    >
                      <Plus size={13} />
                      {t('collections.addMovie')}
                    </button>
                    <button
                      onClick={() => setShowDelete(true)}
                      className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs"
                      style={{ color: '#f87171' }}
                    >
                      <Trash2 size={13} />
                      {t('common.delete')}
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center gap-4">
                <span className="rounded-full px-3 py-1 text-sm font-medium"
                  style={{
                    background: 'var(--neon-blue-10)',
                    color: 'var(--neon-blue)',
                    border: '1px solid var(--neon-blue-20)',
                  }}>
                  {t('collections.movieCount', { count: movieCount })}
                  {fileCount > movieCount && (
                    <span className="ml-1 opacity-70">{t('collections.fileCountDot', { count: fileCount })}</span>
                  )}
                </span>
                {media.length > 0 && (
                  <>
                    {/* 年份范围 */}
                    {(() => {
                      const years = media.filter(m => m.year > 0).map(m => m.year)
                      if (years.length === 0) return null
                      const minYear = Math.min(...years)
                      const maxYear = Math.max(...years)
                      return (
                        <span className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          <Calendar size={14} />
                          {minYear === maxYear ? minYear : `${minYear} - ${maxYear}`}
                        </span>
                      )
                    })()}
                    {/* 平均评分 */}
                    {(() => {
                      const ratings = media.filter(m => m.rating > 0).map(m => m.rating)
                      if (ratings.length === 0) return null
                      const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length
                      return (
                        <span className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          <Star size={14} className="text-yellow-400" />
                          {t('collections.avgRating', { rating: avg.toFixed(1) })}
                        </span>
                      )
                    })()}
                  </>
                )}
              </div>
              {/* 合集类型标签（从所有电影中提取去重） */}
              {(() => {
                const genreSet = new Set<string>()
                media.forEach(m => {
                  if (m.genres) m.genres.split(',').forEach(g => { const t = g.trim(); if (t) genreSet.add(t) })
                })
                const genres = Array.from(genreSet).sort()
                if (genres.length === 0) return null
                const COLLAPSED_COUNT = 8
                const needCollapse = genres.length > COLLAPSED_COUNT
                const visibleGenres = headerGenresExpanded ? genres : genres.slice(0, COLLAPSED_COUNT)
                return (
                  <div className="mt-3">
                    <div
                      className={`relative flex flex-wrap gap-1.5 ${!headerGenresExpanded && needCollapse ? 'max-h-[4.5rem] overflow-hidden' : ''}`}
                      style={!headerGenresExpanded && needCollapse ? {
                        WebkitMaskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)',
                        maskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)',
                      } : undefined}
                    >
                      {visibleGenres.map(g => (
                        <Link key={g} to={`/search?q=${encodeURIComponent(g)}`}
                          className="rounded-full px-2.5 py-0.5 text-xs font-medium transition-all duration-200"
                          style={{
                            background: 'var(--neon-blue-6)',
                            border: '1px solid var(--neon-blue-10)',
                            color: 'var(--text-secondary)',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = 'var(--neon-blue-15)'
                            e.currentTarget.style.borderColor = 'var(--neon-blue-25)'
                            e.currentTarget.style.color = 'var(--neon-blue)'
                            e.currentTarget.style.boxShadow = '0 0 8px var(--neon-blue-15)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'var(--neon-blue-6)'
                            e.currentTarget.style.borderColor = 'var(--neon-blue-10)'
                            e.currentTarget.style.color = 'var(--text-secondary)'
                            e.currentTarget.style.boxShadow = 'none'
                          }}
                        >
                          {g}
                        </Link>
                      ))}
                    </div>
                    {needCollapse && (
                      <button
                        onClick={() => setHeaderGenresExpanded(!headerGenresExpanded)}
                        className="mt-1.5 flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all duration-200"
                        style={{
                          background: 'linear-gradient(135deg, var(--neon-blue-6), var(--neon-purple-8))',
                          border: '1px solid var(--neon-blue-10)',
                          color: 'var(--neon-blue)',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.borderColor = 'var(--neon-blue-25)'
                          e.currentTarget.style.boxShadow = '0 0 10px var(--neon-blue-15)'
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.borderColor = 'var(--neon-blue-10)'
                          e.currentTarget.style.boxShadow = 'none'
                        }}
                      >
                        {headerGenresExpanded ? (
                          <><ChevronUp size={12} /> {t('collections.collapse')}</>
                        ) : (
                          <><ChevronDown size={12} /> {t('collections.moreGenres', { count: genres.length - COLLAPSED_COUNT })}</>
                        )}
                      </button>
                    )}
                  </div>
                )
              })()}
              {collection.overview && (
                <p className="mt-4 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                  {collection.overview}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 电影列表 */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold tracking-wide"
            style={{ color: 'var(--text-primary)' }}>
            {t('collections.moviesTitle')}
          </h2>
          <div className="flex items-center gap-3">
            {/* 排序 */}
            <div className="flex items-center gap-1.5">
              <ArrowUpDown size={14} style={{ color: 'var(--text-muted)' }} />
              <select
                value={sortOption}
                onChange={(e) => {
                  const p = new URLSearchParams(searchParams)
                  const val = e.target.value
                  if (val === 'premiered_asc') p.delete('sort')
                  else p.set('sort', val)
                  setSearchParams(p, { replace: true })
                }}
                className="rounded-lg px-2 py-1.5 text-xs outline-none transition-colors"
                style={{
                  background: 'var(--bg-surface)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-default)',
                }}
              >
                {SORT_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                ))}
              </select>
            </div>
            {/* 视图切换 */}
            <div className="flex items-center rounded-lg" style={{ border: '1px solid var(--border-default)' }}>
              <button
                onClick={() => {
                  const p = new URLSearchParams(searchParams)
                  p.delete('view')
                  setSearchParams(p, { replace: true })
                }}
                className="p-2 transition-all"
                style={{
                  background: viewMode === 'grid' ? 'var(--nav-active-bg)' : 'transparent',
                  color: viewMode === 'grid' ? 'var(--neon-blue)' : 'var(--text-tertiary)',
                }}
                title={t('collections.cardView')}
              >
                <Grid3X3 size={16} />
              </button>
              <button
                onClick={() => {
                  const p = new URLSearchParams(searchParams)
                  p.set('view', 'list')
                  setSearchParams(p, { replace: true })
                }}
                className="p-2 transition-all"
                style={{
                  background: viewMode === 'list' ? 'var(--nav-active-bg)' : 'transparent',
                  color: viewMode === 'list' ? 'var(--neon-blue)' : 'var(--text-tertiary)',
                }}
                title={t('collections.listView')}
              >
                <LayoutList size={16} />
              </button>
            </div>
          </div>
        </div>

        {viewMode === 'grid' ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {pagedMedia.map((group, idx) => {
              const globalIndex = (page - 1) * size + idx + 1
              return <CollectionMovieCard key={group.primary.id} group={group} index={globalIndex} onRemove={isAdmin ? setRemoveTarget : undefined} />
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {pagedMedia.map((group, idx) => {
              const globalIndex = (page - 1) * size + idx + 1
              return <CollectionMovieListItem key={group.primary.id} group={group} index={globalIndex} onRemove={isAdmin ? setRemoveTarget : undefined} />
            })}
          </div>
        )}

        {/* 分页 */}
        <Pagination
          page={page}
          totalPages={totalPages(sortedMedia.length)}
          total={sortedMedia.length}
          pageSize={size}
          pageSizeOptions={[12, 24, 36, 48]}
          onPageChange={setPage}
          onPageSizeChange={setSize}
        />
      </div>

      {/* 编辑合集 */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} className="max-w-md">
        <div className="glass-panel-strong rounded-2xl p-6">
          <h3 className="font-display text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {t('collections.edit')}
          </h3>
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder={t('collections.namePlaceholder')}
            className="mt-4"
            style={{
              background: 'var(--bg-input)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          />
          <textarea
            value={editOverview}
            onChange={(e) => setEditOverview(e.target.value)}
            placeholder={t('collections.overviewPlaceholder')}
            rows={4}
            className="mt-3 w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
            }}
          />
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setShowEdit(false)}>
              {t('common.cancel')}
            </button>
            <button
              className="btn-primary px-4 py-2 text-sm"
              onClick={handleSaveEdit}
              disabled={busy || !editName.trim()}
            >
              {busy ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </div>
      </Modal>

      {/* 添加影片 */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} className="max-w-lg">
        <div className="glass-panel-strong rounded-2xl p-6">
          <h3 className="font-display text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {t('collections.addMovie')}
          </h3>
          <div className="mt-4">
            {showAdd && (
              <MediaPickerList selected={addIds} onChange={setAddIds} exclude={existingMediaIds} />
            )}
          </div>
          <div className="mt-5 flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {t('collections.selectedCount', { count: addIds.length })}
            </span>
            <div className="flex gap-2">
              <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setShowAdd(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary px-4 py-2 text-sm"
                onClick={handleAddMovies}
                disabled={busy || addIds.length === 0}
              >
                {busy ? t('common.loading') : t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* 删除合集 */}
      <Modal open={showDelete} onClose={() => setShowDelete(false)} className="max-w-sm">
        <div className="glass-panel-strong rounded-2xl p-6">
          <h3 className="font-display text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {t('collections.deleteTitle')}
          </h3>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {t('collections.deleteConfirm', { name: collection.name })}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setShowDelete(false)}>
              {t('common.cancel')}
            </button>
            <button
              className="rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ background: '#dc2626' }}
              onClick={handleDelete}
              disabled={busy}
            >
              {busy ? t('common.loading') : t('common.delete')}
            </button>
          </div>
        </div>
      </Modal>

      {/* 移除影片确认 */}
      <Modal open={!!removeTarget} onClose={() => setRemoveTarget(null)} className="max-w-sm">
        <div className="glass-panel-strong rounded-2xl p-6">
          <h3 className="font-display text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {t('collections.removeTitle')}
          </h3>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {t('collections.removeConfirm', { title: removeTarget?.primary.title || '' })}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setRemoveTarget(null)}>
              {t('common.cancel')}
            </button>
            <button
              className="rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ background: '#dc2626' }}
              onClick={handleRemoveMovie}
              disabled={busy}
            >
              {busy ? t('common.loading') : t('common.confirm')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/** 合集中的电影卡片（支持同片多版本折叠展示） */
function CollectionMovieCard({ group, index, onRemove }: { group: GroupedMovieItem; index: number; onRemove?: (group: GroupedMovieItem) => void }) {
  const { t } = useTranslation()
  const item = group.primary
  const versionCount = group.versions.length
  const hasMultipleVersions = versionCount > 1
  const [showVersions, setShowVersions] = useState(false)
  const [genresExpanded, setGenresExpanded] = useState(false)
  const genreList = item.genres ? item.genres.split(',').map(g => g.trim()).filter(Boolean) : []
  const MAX_VISIBLE = 4
  const needCollapse = genreList.length > MAX_VISIBLE
  const visibleGenres = genresExpanded ? genreList : genreList.slice(0, MAX_VISIBLE)

  return (
    <div className="relative">
      <Link
        to={`/media/${item.id}`}
        className="media-card group cursor-pointer transition-all duration-300 hover:scale-[1.02] block"
      >
        {/* 海报 */}
        <div className="relative aspect-[2/3] overflow-hidden rounded-t-xl" style={{ background: 'var(--bg-surface)' }}>
          <img
            src={streamApi.getPosterUrl(item.id)}
            alt={item.title}
            className="h-full w-full object-cover transition-all duration-500 group-hover:scale-110"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <div className="absolute inset-0 -z-10 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
            <Film size={32} />
          </div>

          {/* 序号标签 */}
          <div className="absolute left-2 top-2">
            <span className="block rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-tight backdrop-blur-md"
              style={{
                background: 'rgba(0,0,0,0.7)',
                color: 'var(--text-primary)',
              }}
            >#{index}</span>
          </div>

          {/* 多版本角标 */}
          {hasMultipleVersions && (
            <div className="absolute right-2 top-2">
              <span
                className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold backdrop-blur-md"
                style={{
                  background: 'var(--bg-overlay)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.15)',
                }}
                title={`${t('collections.versionCount', { count: versionCount })}`}
              >
                <Copy size={9} />
                {t('collections.versionBadgeShort', { count: versionCount })}
              </span>
            </div>
          )}

          {/* 评分标签 */}
          {item.rating > 0 && (
            <div className="absolute left-2 bottom-2">
              <span className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold backdrop-blur-md"
                style={{ background: 'rgba(0,0,0,0.7)' }}>
                <Star size={9} className="text-yellow-400" fill="currentColor" />
                <span className="text-yellow-400">{item.rating.toFixed(1)}</span>
              </span>
            </div>
          )}

          {/* 悬停播放图标 */}
          <div className="gradient-overlay opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            <div className="absolute bottom-2 right-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full"
                style={{
                  background: 'var(--bg-overlay)',
                  boxShadow: 'none',
                }}
              >
                <Play size={14} className="ml-0.5 text-white" fill="white" />
              </div>
            </div>
          </div>
        </div>

        {/* 信息 */}
        <div className="p-3">
          <div className="flex items-start gap-1">
            <h4 className="min-w-0 flex-1 truncate text-sm font-medium transition-colors group-hover:text-neon"
              style={{ color: 'var(--text-primary)' }} title={item.title}>
              {item.title}
            </h4>
            {onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onRemove(group)
                }}
                className="shrink-0 rounded p-0.5 opacity-60 transition-opacity group-hover:opacity-100"
                style={{ color: 'var(--text-tertiary)' }}
                title={t('collections.removeMovie')}
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {item.year > 0 && (
              <span className="flex items-center gap-0.5">
                <Calendar size={10} /> {item.year}
              </span>
            )}
            {item.runtime > 0 && (
              <span className="flex items-center gap-0.5">
                <Clock size={10} /> {t('media.durationMin', { minutes: item.runtime })}
              </span>
            )}
          </div>
          {genreList.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {visibleGenres.map(g => (
                <Link key={g} to={`/search?q=${encodeURIComponent(g)}`}
                  onClick={e => { e.preventDefault(); e.stopPropagation() }}
                  className="rounded-full px-1.5 py-0.5 text-[10px] transition-all duration-200"
                  style={{ background: 'var(--neon-blue-6)', border: '1px solid var(--neon-blue-10)', color: 'var(--text-muted)' }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'var(--neon-blue-15)'
                    e.currentTarget.style.borderColor = 'var(--neon-blue-25)'
                    e.currentTarget.style.color = 'var(--neon-blue)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'var(--neon-blue-6)'
                    e.currentTarget.style.borderColor = 'var(--neon-blue-10)'
                    e.currentTarget.style.color = 'var(--text-muted)'
                  }}
                >
                  {g}
                </Link>
              ))}
              {needCollapse && (
                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); setGenresExpanded(!genresExpanded) }}
                  className="rounded-full p-0.5 text-[10px] transition-all duration-200"
                  style={{ color: 'var(--neon-blue)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--neon-blue-10)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  {genresExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                </button>
              )}
            </div>
          )}
        </div>
      </Link>

      {/* 多版本切换按钮（只在 hover 时显示，避免与卡片悬停效果冲突） */}
      {hasMultipleVersions && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setShowVersions((v) => !v)
          }}
          className="absolute bottom-16 right-2 rounded-full p-1 text-[10px] transition-all"
          style={{
            background: showVersions ? 'var(--neon-blue)' : 'rgba(0,0,0,0.6)',
            color: '#fff',
          }}
          title={t('collections.viewVersions')}
        >
          <ChevronDown size={12} className={showVersions ? 'rotate-180' : ''} />
        </button>
      )}

      {/* 版本下拉列表 */}
      {hasMultipleVersions && showVersions && (
        <div
          className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg p-2 shadow-2xl"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
          }}
        >
          <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}>
            {t('collections.versionCountLabel', { count: versionCount })}
          </div>
          {group.versions.map((v) => {
            const label = versionLabel(v) || v.title
            return (
              <Link
                key={v.id}
                to={`/media/${v.id}`}
                className="block rounded px-2 py-1.5 text-[11px] transition-colors"
                style={{
                  color: v.id === item.id ? 'var(--neon-blue)' : 'var(--text-secondary)',
                  background: v.id === item.id ? 'var(--neon-blue-10)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (v.id !== item.id) e.currentTarget.style.background = 'var(--bg-surface)'
                }}
                onMouseLeave={(e) => {
                  if (v.id !== item.id) e.currentTarget.style.background = 'transparent'
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{label}</span>
                  {v.id === item.id && (
                    <span className="flex-shrink-0 text-[9px] font-bold">{t('collections.current')}</span>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 合集中的电影列表项（支持同片多版本展示） */
function CollectionMovieListItem({ group, index, onRemove }: { group: GroupedMovieItem; index: number; onRemove?: (group: GroupedMovieItem) => void }) {
  const { t } = useTranslation()
  const item = group.primary
  const versionCount = group.versions.length
  const hasMultipleVersions = versionCount > 1
  const [showVersions, setShowVersions] = useState(false)
  const [genresExpanded, setGenresExpanded] = useState(false)
  const genreList = item.genres ? item.genres.split(',').map(g => g.trim()).filter(Boolean) : []
  const LIST_MAX_VISIBLE = 3
  const listNeedCollapse = genreList.length > LIST_MAX_VISIBLE
  const listVisibleGenres = genresExpanded ? genreList : genreList.slice(0, LIST_MAX_VISIBLE)

  const formatDuration = (seconds: number) => {
    if (!seconds) return ''
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  return (
    <div
      className="rounded-xl"
      style={{ border: '1px solid var(--border-default)' }}
    >
      <Link
        to={`/media/${item.id}`}
        className="group flex items-center gap-4 p-3 transition-all duration-300"
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--nav-hover-bg)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {/* 序号 */}
        <span className="w-6 text-center text-xs font-bold flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
          {index}
        </span>

        {/* 缩略图 */}
        <div className="h-20 w-14 flex-shrink-0 overflow-hidden rounded-lg" style={{ background: 'var(--bg-surface)' }}>
          <img
            src={streamApi.getPosterUrl(item.id)}
            alt={item.title}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </div>

        {/* 信息 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="min-w-0 flex-1 truncate text-sm font-medium transition-colors group-hover:text-neon"
              style={{ color: 'var(--text-primary)' }} title={item.title}>
              {item.title}
            </h4>
            {onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onRemove(group)
                }}
                className="shrink-0 rounded p-0.5 opacity-60 transition-opacity group-hover:opacity-100"
                style={{ color: 'var(--text-tertiary)' }}
                title={t('collections.removeMovie')}
              >
                <X size={12} />
              </button>
            )}
            {hasMultipleVersions && (
              <span
                className="flex-shrink-0 inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                style={{
                  background: 'var(--bg-overlay)',
                  color: '#fff',
                }}
                title={`${t('collections.versionCount', { count: versionCount })}`}
              >
                <Copy size={9} />
                {t('collections.versionCountLabel2', { count: versionCount })}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {item.year > 0 && <span>{item.year}</span>}
            {item.runtime > 0 && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>·</span>
                <span>{formatDuration(item.runtime)}</span>
              </>
            )}
          </div>
          {genreList.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {listVisibleGenres.map(g => (
                <Link key={g} to={`/search?q=${encodeURIComponent(g)}`}
                  onClick={e => { e.preventDefault(); e.stopPropagation() }}
                  className="rounded-full px-1.5 py-0.5 text-[10px] transition-all duration-200"
                  style={{ background: 'var(--neon-blue-6)', border: '1px solid var(--neon-blue-10)', color: 'var(--text-muted)' }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'var(--neon-blue-15)'
                    e.currentTarget.style.borderColor = 'var(--neon-blue-25)'
                    e.currentTarget.style.color = 'var(--neon-blue)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'var(--neon-blue-6)'
                    e.currentTarget.style.borderColor = 'var(--neon-blue-10)'
                    e.currentTarget.style.color = 'var(--text-muted)'
                  }}
                >
                  {g}
                </Link>
              ))}
              {listNeedCollapse && (
                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); setGenresExpanded(!genresExpanded) }}
                  className="rounded-full px-1.5 py-0.5 text-[10px] transition-all duration-200"
                  style={{ color: 'var(--neon-blue)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--neon-blue-10)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  {genresExpanded ? t('collections.collapse') : `+${genreList.length - LIST_MAX_VISIBLE}`}
                </button>
              )}
            </div>
          )}
        </div>

        {/* 评分 */}
        {item.rating > 0 && (
          <div className="flex items-center gap-1 text-sm flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
            <Star size={14} className="text-yellow-400" fill="currentColor" />
            <span className="font-semibold">{item.rating.toFixed(1)}</span>
          </div>
        )}

        {/* 展开版本按钮 */}
        {hasMultipleVersions && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setShowVersions((v) => !v)
            }}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors"
            style={{
              background: showVersions ? 'var(--neon-blue-10)' : 'var(--bg-elevated)',
              color: showVersions ? 'var(--neon-blue)' : 'var(--text-muted)',
            }}
            title={showVersions ? t('collections.collapseVersions') : t('collections.expandVersions')}
          >
            <ChevronDown size={14} className={showVersions ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>
        )}

        {/* 播放按钮 */}
        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{
              background: 'var(--bg-overlay)',
              boxShadow: 'none',
            }}>
            <Play size={12} className="ml-0.5 text-white" fill="white" />
          </div>
        </div>
      </Link>

      {/* 展开的版本列表 */}
      {hasMultipleVersions && showVersions && (
        <div className="px-3 pb-3" style={{ borderTop: '1px dashed var(--border-default)' }}>
          <div className="mt-2 space-y-1">
            {group.versions.map((v) => {
              const label = versionLabel(v) || t('collections.defaultVersion')
              return (
                <Link
                  key={v.id}
                  to={`/media/${v.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs transition-colors"
                  style={{
                    background: v.id === item.id ? 'var(--neon-blue-10)' : 'var(--bg-surface)',
                    color: v.id === item.id ? 'var(--neon-blue)' : 'var(--text-secondary)',
                  }}
                >
                  <span className="truncate">{label}</span>
                  {v.id === item.id && (
                    <span className="flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold"
                      style={{
                        background: 'var(--bg-overlay)',
                        color: '#fff',
                      }}>{t('collections.current')}</span>
                  )}
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
