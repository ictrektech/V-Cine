import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { usePosterVersion } from '@/stores/mediaRefresh'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { collectionApi } from '@/api'
import { streamApi } from '@/api'
import { libraryApi } from '@/api'
import { usePageCache, invalidatePageCachePrefix } from '@/hooks/usePageCache'
import { useAuthStore } from '@/stores/auth'
import type { MovieCollection, Library } from '@/types'
import Pagination from '@/components/Pagination'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import MediaPickerList from '@/components/media/MediaPickerList'
import { Library as LibraryIcon, Search, Film, Loader2, X, Play, Merge, Trash2, RefreshCw, Grid3X3, LayoutList, ArrowUpDown, ChevronDown, Filter, Plus } from 'lucide-react'
import clsx from 'clsx'
import { useTranslation } from '@/i18n'

type ViewMode = 'grid' | 'list'

const SORT_OPTIONS = [
  { value: 'created_desc', labelKey: 'collections.sortCreatedDesc' },
  { value: 'created_asc', labelKey: 'collections.sortCreatedAsc' },
  { value: 'updated_desc', labelKey: 'collections.sortUpdatedDesc' },
  { value: 'updated_asc', labelKey: 'collections.sortUpdatedAsc' },
  { value: 'name_asc', labelKey: 'collections.sortNameAsc' },
  { value: 'name_desc', labelKey: 'collections.sortNameDesc' },
  { value: 'count_desc', labelKey: 'collections.sortCountDesc' },
  { value: 'count_asc', labelKey: 'collections.sortCountAsc' },
] as const

type SortValue = typeof SORT_OPTIONS[number]['value']

interface CollectionsData {
  list: MovieCollection[]
  total: number
}

export default function CollectionsPage() {
  const { t } = useTranslation()
  // 新建合集走 admin 接口，仅管理员显示入口
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  // 订阅海报版本戳：刮削/替换海报后触发重渲染，图片 URL 自动带上新版本号
  usePosterVersion()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const sortRef = useRef<HTMLDivElement>(null)
  const page = Number(searchParams.get('page')) || 1
  const pageSize = Number(searchParams.get('size')) || 24
  const viewMode = (searchParams.get('view') as ViewMode) || 'grid'
  const sortValue = (searchParams.get('sort') as SortValue) || 'created_desc'
  const filterAuto = searchParams.get('auto') || '' // '' | 'true' | 'false'
  const filterLibrary = searchParams.get('library_id') || ''
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchResults, setSearchResults] = useState<MovieCollection[] | null>(null)
  const [operating, setOperating] = useState(false)
  const [operationMsg, setOperationMsg] = useState('')
  const [showSortDropdown, setShowSortDropdown] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [libraries, setLibraries] = useState<Library[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createMediaIds, setCreateMediaIds] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const pageSizeOptions = [12, 24, 36, 48]

  // 加载媒体库列表
  useEffect(() => {
    libraryApi.list().then(res => {
      setLibraries(res.data.data || [])
    }).catch(() => {})
  }, [])

  // 点击外部关闭排序下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setShowSortDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // 加载合集列表（排序和筛选全部下沉到后端，保证分页和总数一致）
  // 使用 usePageCache：按"分页/排序/筛选"组合的 key 分桶缓存，跨导航命中时零 loading
  const { data, loading, refetch } = usePageCache<CollectionsData>(
    `collections:list:page=${page}:size=${pageSize}:sort=${sortValue}:auto=${filterAuto}:lib=${filterLibrary}`,
    async () => {
      const res = await collectionApi.list({
        page,
        size: pageSize,
        sort: sortValue,
        auto: filterAuto || undefined,
        library_id: filterLibrary || undefined,
      })
      return { list: res.data.data || [], total: res.data.total || 0 }
    },
    { ttl: 20_000 },
  )
  const collections = data?.list ?? []
  const total = data?.total ?? 0

  // 搜索合集
  const handleSearch = useCallback(async () => {
    if (!searchKeyword.trim()) {
      setSearchResults(null)
      return
    }
    try {
      const res = await collectionApi.search(searchKeyword.trim(), 20)
      setSearchResults(res.data.data || [])
    } catch {
      setSearchResults([])
    }
  }, [searchKeyword])

  // 合并同名重复合集
  const handleMergeDuplicates = useCallback(async () => {
    if (operating) return
    setOperating(true)
    setOperationMsg('')
    try {
      const res = await collectionApi.mergeDuplicates()
      setOperationMsg(res.data.message || t('collections.merged', { count: res.data.merged }))
      invalidatePageCachePrefix('collections:')
      refetch(true)
    } catch {
      setOperationMsg(t('collections.mergeFailed'))
    } finally {
      setOperating(false)
    }
  }, [operating, refetch])

  // 清理空壳合集
  const handleCleanupEmpty = useCallback(async () => {
    if (operating) return
    setOperating(true)
    setOperationMsg('')
    try {
      const res = await collectionApi.cleanupEmpty()
      setOperationMsg(res.data.message || t('collections.cleaned', { count: res.data.cleaned }))
      invalidatePageCachePrefix('collections:')
      refetch(true)
    } catch {
      setOperationMsg(t('collections.cleanupFailed'))
    } finally {
      setOperating(false)
    }
  }, [operating, refetch])

  // 重新匹配合集
  const handleRematch = useCallback(async () => {
    if (operating) return
    setOperating(true)
    setOperationMsg('')
    try {
      const res = await collectionApi.rematch()
      setOperationMsg(res.data.message || t('collections.rematchDone', { count: res.data.created }))
      setSearchParams(prev => { prev.set('page', '1'); return prev })
      invalidatePageCachePrefix('collections:')
      refetch(true)
    } catch {
      setOperationMsg(t('collections.rematchFailed'))
    } finally {
      setOperating(false)
    }
  }, [operating, refetch, setSearchParams])

  // 手动创建合集
  const handleCreate = useCallback(async () => {
    const name = createName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      await collectionApi.create({ name, media_ids: createMediaIds })
      setShowCreate(false)
      setCreateName('')
      setCreateMediaIds([])
      setOperationMsg(t('collections.createDone', { name }))
      invalidatePageCachePrefix('collections:')
      refetch(true)
    } catch {
      setOperationMsg(t('collections.createFailed'))
    } finally {
      setCreating(false)
    }
  }, [createName, createMediaIds, creating, refetch, t])

  // ===== 显示列表 =====
  // 正常浏览模式下，后端已经完成排序和筛选，直接使用 collections
  // 搜索模式下，对搜索结果做客户端筛选（搜索 API 目前未下沉 auto 筛选）
  const displayList = useMemo(() => {
    if (searchResults === null) return collections
    let items = [...searchResults]
    if (filterAuto !== '') {
      const isAuto = filterAuto === 'true'
      items = items.filter(c => c.auto_matched === isAuto)
    }
    return items
  }, [collections, searchResults, filterAuto])

  // 分页总页数：搜索结果按搜索结果数量计算；浏览模式按后端 total 计算（已按筛选条件过滤）
  const totalPages = searchResults === null
    ? Math.ceil(total / pageSize)
    : Math.ceil(displayList.length / pageSize)
  const currentSortLabel = t(SORT_OPTIONS.find(o => o.value === sortValue)?.labelKey || 'collections.sort')
  const hasActiveFilter = filterAuto !== '' || filterLibrary !== ''
  const activeFilterCount = (filterAuto !== '' ? 1 : 0) + (filterLibrary !== '' ? 1 : 0)

  // 切换分页时同步 URL
  const handlePageChange = useCallback((p: number) => {
    setSearchParams(prev => {
      if (p <= 1) prev.delete('page'); else prev.set('page', String(p))
      return prev
    })
  }, [setSearchParams])

  // 切换每页数量时重置到第一页
  const handlePageSizeChange = useCallback((size: number) => {
    setSearchParams(prev => {
      prev.delete('page')
      prev.set('size', String(size))
      return prev
    })
  }, [setSearchParams])

  // 切换视图模式
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setSearchParams(prev => {
      if (mode === 'grid') prev.delete('view'); else prev.set('view', mode)
      return prev
    })
  }, [setSearchParams])

  // 切换排序
  const handleSortChange = useCallback((value: SortValue) => {
    setSearchParams(prev => {
      if (value === 'created_desc') prev.delete('sort'); else prev.set('sort', value)
      return prev
    })
    setShowSortDropdown(false)
  }, [setSearchParams])

  // 切换筛选
  const handleFilterAuto = useCallback((value: string) => {
    setSearchParams(prev => {
      if (value === '') prev.delete('auto'); else prev.set('auto', value)
      prev.delete('page')
      return prev
    })
  }, [setSearchParams])

  // 切换媒体库筛选
  const handleFilterLibrary = useCallback((value: string) => {
    setSearchParams(prev => {
      if (value === '') prev.delete('library_id'); else prev.set('library_id', value)
      prev.delete('page')
      return prev
    })
  }, [setSearchParams])

  // 媒体库筛选选项：`全部` 走 i18n，其余直接展示库名
  const libraryFilterOptions: { value: string; labelKey?: string; label?: string }[] = [
    { value: '', labelKey: 'common.all' },
    ...libraries.map(lib => ({ value: lib.id, label: lib.name })),
  ]

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LibraryIcon size={24} className="text-neon" />
          <h1 className="font-display text-2xl font-bold tracking-wide" style={{ color: 'var(--text-primary)' }}>
            {t('collections.pageTitle')}
          </h1>
          <span className="rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ background: 'var(--neon-blue-10)', color: 'var(--neon-blue)' }}>
            {t('collections.totalCount', { count: total })}
          </span>
        </div>
      </div>

      {/* 搜索栏 + 管理操作 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={t('collections.searchPlaceholder')}
            className="input w-full pl-9 pr-8"
          />
          {searchKeyword && (
            <button
              onClick={() => { setSearchKeyword(''); setSearchResults(null) }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-300"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button onClick={handleSearch} className="btn-primary px-4 py-2 text-sm">
          {t('common.search')}
        </button>
        {/* 筛选按钮 */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={clsx('flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-all')}
          style={{
            border: `1px solid ${hasActiveFilter ? 'var(--border-hover)' : 'var(--border-default)'}`,
            color: hasActiveFilter ? 'var(--neon-blue)' : 'var(--text-secondary)',
            background: hasActiveFilter ? 'var(--nav-active-bg)' : 'transparent',
          }}
        >
          <Filter size={14} />
          {t('search.filter')}
          {hasActiveFilter && (
            <span
              className="ml-1 rounded-full px-1.5 text-[10px] font-bold"
              style={{
                background: 'var(--neon-blue)',
                color: 'var(--text-on-neon)',
              }}
            >
              {activeFilterCount}
            </span>
          )}
        </button>
        {/* 排序 */}
        <div className="relative" ref={sortRef}>
          <button
            onClick={() => setShowSortDropdown(!showSortDropdown)}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-all"
            style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
          >
            <ArrowUpDown size={14} />
            {currentSortLabel}
            <ChevronDown size={12} />
          </button>
          {showSortDropdown && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowSortDropdown(false)} />
              <div
                className="absolute right-0 top-full z-40 mt-1 w-40 overflow-hidden rounded-xl py-1 animate-slide-up"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-strong)',
                  boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
                }}
              >
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleSortChange(opt.value)}
                    className={clsx(
                      'w-full px-3 py-2 text-left text-sm transition-colors',
                      sortValue === opt.value
                        ? 'text-neon bg-[var(--nav-active-bg)]'
                        : 'hover:bg-[var(--nav-hover-bg)]',
                    )}
                    style={{ color: sortValue === opt.value ? 'var(--neon-blue)' : 'var(--text-secondary)' }}
                  >
                    {t(opt.labelKey)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* 视图切换 */}
        <div className="flex items-center rounded-lg" style={{ border: '1px solid var(--border-default)' }}>
          <button
            onClick={() => handleViewModeChange('grid')}
            className="p-2 transition-all"
            style={{
              background: viewMode === 'grid' ? 'var(--nav-active-bg)' : 'transparent',
              color: viewMode === 'grid' ? 'var(--neon-blue)' : 'var(--text-tertiary)',
            }}
            title={t('collections.gridView')}
          >
            <Grid3X3 size={16} />
          </button>
          <button
            onClick={() => handleViewModeChange('list')}
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
        <div className="flex gap-2 ml-auto">
          {isAdmin && (
            <button
              onClick={() => setShowCreate(true)}
              className="btn-primary flex items-center gap-1.5 px-3 py-2 text-xs"
            >
              <Plus size={14} />
              {t('collections.newCollection')}
            </button>
          )}
          <button
            onClick={handleRematch}
            disabled={operating}
            className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs"
            title={t('collections.rematchHint')}
          >
            {operating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {t('collections.rematch')}
          </button>
          <button
            onClick={handleMergeDuplicates}
            disabled={operating}
            className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs"
            title={t('collections.mergeDuplicatesHint')}
          >
            {operating ? <Loader2 size={14} className="animate-spin" /> : <Merge size={14} />}
            {t('collections.mergeDuplicates')}
          </button>
          <button
            onClick={handleCleanupEmpty}
            disabled={operating}
            className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs"
            title={t('collections.cleanupEmptyHint')}
          >
            {operating ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {t('collections.cleanupEmpty')}
          </button>
        </div>
      </div>

      {/* 筛选面板 */}
      {showFilters && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl p-3 animate-slide-up"
          style={{
            background: 'var(--nav-hover-bg)',
            border: '1px solid var(--border-default)',
          }}
        >
          <span className="text-xs font-medium mr-1" style={{ color: 'var(--text-tertiary)' }}>{t('collections.source')}</span>
          {[
            { value: '', labelKey: 'collections.autoAll' },
            { value: 'true', labelKey: 'collections.autoMatched' },
            { value: 'false', labelKey: 'collections.manual' },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => handleFilterAuto(opt.value)}
              className={clsx('rounded-lg px-3 py-1.5 text-xs font-medium transition-all')}
              style={{
                background: filterAuto === opt.value ? 'var(--nav-active-bg)' : 'transparent',
                border: `1px solid ${filterAuto === opt.value ? 'var(--border-hover)' : 'var(--border-default)'}`,
                color: filterAuto === opt.value ? 'var(--neon-blue)' : 'var(--text-secondary)',
              }}
            >
              {t(opt.labelKey)}
            </button>
          ))}
          {hasActiveFilter && (
            <button
              onClick={() => { handleFilterAuto(''); handleFilterLibrary('') }}
              className="ml-2 flex items-center gap-1 text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <X size={12} />
              {t('common.clear')}
            </button>
          )}
          {libraries.length > 0 && (
            <>
              <span className="text-xs font-medium ml-3 mr-1" style={{ color: 'var(--text-tertiary)' }}>{t('collections.library')}</span>
              {libraryFilterOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleFilterLibrary(opt.value)}
                  className={clsx('rounded-lg px-3 py-1.5 text-xs font-medium transition-all')}
                  style={{
                    background: filterLibrary === opt.value ? 'var(--nav-active-bg)' : 'transparent',
                    border: `1px solid ${filterLibrary === opt.value ? 'var(--border-hover)' : 'var(--border-default)'}`,
                    color: filterLibrary === opt.value ? 'var(--neon-blue)' : 'var(--text-secondary)',
                  }}
                >
                  {opt.labelKey ? t(opt.labelKey) : opt.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* 操作结果提示 */}
      {operationMsg && (
        <div className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm"
          style={{ background: 'var(--neon-blue-10)', color: 'var(--neon-blue)', border: '1px solid var(--neon-blue-20)' }}>
          <span>{operationMsg}</span>
          <button onClick={() => setOperationMsg('')} className="ml-auto">
            <X size={14} />
          </button>
        </div>
      )}

      {/* 合集内容 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-neon" />
        </div>
      ) : displayList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <LibraryIcon size={48} className="mb-4 text-surface-600" />
          <p className="text-lg font-medium" style={{ color: 'var(--text-secondary)' }}>
            {searchResults !== null ? t('collections.noSearchResults') : hasActiveFilter ? t('collections.noMatchFiltered') : t('collections.empty')}
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {searchResults !== null ? t('collections.searchHint') : hasActiveFilter ? t('collections.filterHint') : t('collections.emptyHint')}
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {displayList.map((coll) => (
            <CollectionCard
              key={coll.id}
              collection={coll}
              onClick={() => navigate(`/collections/${coll.id}`)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {displayList.map((coll) => (
            <CollectionListItem key={coll.id} collection={coll} />
          ))}
        </div>
      )}

      {/* 分页 */}
      {searchResults === null && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
        />
      )}

      {/* 新建合集 */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} className="max-w-lg">
        <div className="glass-panel-strong rounded-2xl p-6">
          <h3 className="font-display text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {t('collections.newCollection')}
          </h3>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {t('collections.createHint')}
          </p>
          <Input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder={t('collections.namePlaceholder')}
            className="mt-4"
            style={{
              background: 'var(--bg-input)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          />
          <div className="mt-3">
            {showCreate && <MediaPickerList selected={createMediaIds} onChange={setCreateMediaIds} />}
          </div>
          <div className="mt-5 flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {t('collections.selectedCount', { count: createMediaIds.length })}
            </span>
            <div className="flex gap-2">
              <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setShowCreate(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary px-4 py-2 text-sm"
                onClick={handleCreate}
                disabled={creating || !createName.trim()}
              >
                {creating ? t('collections.creating') : t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/** 合集卡片 — 点击跳转到合集详情页 */
function CollectionCard({ collection: coll, onClick }: { collection: MovieCollection; onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      className="media-card group cursor-pointer overflow-hidden rounded-xl transition-all duration-300 hover:scale-[1.02]"
      style={{ border: '1px solid var(--border-default)' }}
      onClick={onClick}
    >
      {/* 海报 */}
      <div className="relative aspect-[2/3] overflow-hidden" style={{ background: 'var(--bg-surface)' }}>
        <img
          src={streamApi.getCollectionPosterUrl(coll.id)}
          alt={coll.name}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        <div className="absolute inset-0 -z-10 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
          <Film size={32} />
        </div>

        {/* 数量标签：角标主显「N 部电影」，右下再叠一行「N 文件」帮助识别多版本合集 */}
        <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1">
          <div className="rounded-md px-2 py-0.5 text-xs font-bold backdrop-blur-md"
            style={{ background: 'rgba(0,0,0,0.7)', color: 'var(--neon-blue)' }}>
            {t('collections.mediaCount', { count: coll.media_count })}
          </div>
          {coll.file_count != null && coll.file_count > coll.media_count && (
            <div className="rounded-md px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-md"
              style={{ background: 'rgba(0,0,0,0.6)', color: 'var(--text-tertiary)' }}>
              {t('collections.fileCount', { count: coll.file_count })}
            </div>
          )}
        </div>

        {/* 来源标签 */}
        {coll.auto_matched && (
          <div className="absolute top-2 left-2 rounded-md px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-md"
            style={{ background: 'rgba(0,0,0,0.6)', color: 'var(--text-tertiary)' }}>
            {t('collections.auto')}
          </div>
        )}

        {/* 悬停遮罩 */}
        <div className="gradient-overlay opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <div className="absolute bottom-2 left-2">
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
        <h3 className="truncate text-sm font-semibold transition-colors group-hover:text-neon"
          style={{ color: 'var(--text-primary)' }}>
          {coll.name}
        </h3>
        <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {coll.year_range && <span>{coll.year_range}</span>}
          {coll.year_range && <span style={{ color: 'var(--text-muted)' }}>·</span>}
          <span>
            {t('collections.mediaCount', { count: coll.media_count })}
            {coll.file_count != null && coll.file_count > coll.media_count && (
              <span className="ml-1 opacity-70">{t('collections.fileCountSuffix', { count: coll.file_count })}</span>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

/** 合集列表项 — 列表视图 */
function CollectionListItem({ collection: coll }: { collection: MovieCollection }) {
  const { t } = useTranslation()
  return (
    <Link
      to={`/collections/${coll.id}`}
      className="group flex items-center gap-4 rounded-xl p-3 transition-all duration-300"
      style={{ border: '1px solid var(--border-default)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--nav-hover-bg)'; e.currentTarget.style.borderColor = 'var(--border-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--border-default)' }}
    >
      {/* 缩略图 */}
      <div
        className="h-16 w-12 flex-shrink-0 overflow-hidden rounded-lg"
        style={{ background: 'var(--bg-surface)' }}
      >
        <img
          src={streamApi.getCollectionPosterUrl(coll.id)}
          alt={coll.name}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      </div>

      {/* 信息 */}
      <div className="min-w-0 flex-1">
        <h3
          className="truncate text-sm font-medium transition-colors group-hover:text-neon"
          style={{ color: 'var(--text-primary)' }}
        >
          {coll.name}
        </h3>
        <div className="mt-0.5 flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {coll.year_range && <span>{coll.year_range}</span>}
          {coll.year_range && <span style={{ color: 'var(--text-muted)' }}>·</span>}
          <span className="rounded px-1 py-0.5 text-[10px]" style={{ background: 'var(--nav-hover-bg)' }}>
            {coll.auto_matched ? t('collections.autoMatched') : t('collections.manual')}
          </span>
        </div>
      </div>

      {/* 数量 */}
      <div className="flex items-center gap-1.5 text-xs font-medium flex-shrink-0"
        style={{ color: 'var(--text-secondary)' }}>
        <Film size={14} />
        <span>
          {t('collections.mediaCount', { count: coll.media_count })}
          {coll.file_count != null && coll.file_count > coll.media_count && (
            <span className="ml-1 opacity-60">{t('collections.fileCountSuffix', { count: coll.file_count })}</span>
          )}
        </span>
      </div>
    </Link>
  )
}
