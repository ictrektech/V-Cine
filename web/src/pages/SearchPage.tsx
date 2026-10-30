import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { mediaApi, aiApi, libraryApi, videoAnalysisApi } from '@/api'
import { useToast } from '@/components/Toast'
import type { Media, SearchIntent, Library } from '@/types'
import type { SceneSearchResult } from '@/types/videoAnalysis'
import { formatVideoAnalysisSeconds } from '@/components/video-analysis/videoAnalysisResultUtils'
import { routes } from '@/lib/routes'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import SceneMoviePicker from '@/components/search/SceneMoviePicker'
import MediaGrid from '@/components/MediaGrid'
import Pagination from '@/components/Pagination'
import {
  Search as SearchIcon,
  X,
  SlidersHorizontal,
  ArrowUpDown,
  Film,
  Tv,
  Calendar,
  Star,
  Sparkles,
  Layers,
} from 'lucide-react'
import clsx from 'clsx'
import { useTranslation } from '@/i18n'

// 排序选项
const SORT_OPTIONS = [
{ value: 'relevance', labelKey: 'search.sortRelevance' },
{ value: 'rating_desc', labelKey: 'search.sortRatingDesc' },
{ value: 'year_desc', labelKey: 'search.sortYearDesc' },
{ value: 'year_asc', labelKey: 'search.sortYearAsc' },
  { value: 'title_asc', labelKey: 'search.sortTitleAsc' },
]

// 年份范围快捷选项
const YEAR_RANGES = [
  { labelKey: 'search.yearAll', min: 0, max: 0 },
  { labelKey: '', min: 2024, max: 2026 },
  { labelKey: '', min: 2020, max: 2023 },
  { labelKey: '', min: 2010, max: 2019 },
  { labelKey: '', min: 2000, max: 2009 },
  { labelKey: 'search.yearEarlier', min: 0, max: 1999 },
]

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [results, setResults] = useState<Media[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const toast = useToast()
  const { t } = useTranslation()

  // 搜索模式：媒体（标题/筛选）/ 场景（向量检索，图片路）
  const [searchMode, setSearchMode] = useState<'media' | 'scene'>('media')
  const [sceneResults, setSceneResults] = useState<SceneSearchResult[]>([])
  const [sceneLoading, setSceneLoading] = useState(false)
  const [sceneFailed, setSceneFailed] = useState(false)
  const [sceneSearched, setSceneSearched] = useState(false)
  const [sceneLimit, setSceneLimit] = useState(30)
  const [libraries, setLibraries] = useState<Library[]>([])
  // 场景检索范围：库为空串表示全库，影片为空数组表示不限
  const [sceneLibraryId, setSceneLibraryId] = useState('')
  const [sceneMovieIds, setSceneMovieIds] = useState<string[]>([])
  // 上次提交检索的影片选择
  const sceneMovieCommitRef = useRef('')
  // 场景检索请求序号：丢弃过期响应
  const sceneRequestIdRef = useRef(0)

  // 从 URL 参数读取分页状态
  const page = parseInt(searchParams.get('page') || '1', 10) || 1
  const size = parseInt(searchParams.get('size') || '30', 10) || 30

  // 分页变化时同步到 URL
  const setPage = useCallback((newPage: number) => {
    const params = new URLSearchParams(searchParams)
    if (newPage <= 1) {
      params.delete('page')
    } else {
      params.set('page', String(newPage))
    }
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

  // 每页数量变化时同步到 URL，并重置到第一页
  const setSize = useCallback((newSize: number) => {
    const params = new URLSearchParams(searchParams)
    if (newSize === 30) {
      params.delete('size')
    } else {
      params.set('size', String(newSize))
    }
    params.delete('page')
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

// 筛选状态
  const [showFilters, setShowFilters] = useState(false)
  const [filterType, setFilterType] = useState<'' | 'movie' | 'episode'>('')
  const [sortBy, setSortBy] = useState('relevance')
  const [yearRange, setYearRange] = useState<{ min: number; max: number }>({ min: 0, max: 0 })
  const [minRating, setMinRating] = useState(0)
  const [aiParsed, setAiParsed] = useState<SearchIntent | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const aiAbortRef = useRef<AbortController | null>(null)

  const doSearch = useCallback(async (q: string, p: number, aiIntent?: SearchIntent | null) => {
    if (!q.trim()) return
    setLoading(true)
    setSearched(true)
    try {
      // 如果有 AI 解析结果，使用 AI 解析的参数
      const intent = aiIntent || aiParsed
      const searchQuery = intent?.parsed ? intent.query : q.trim()
      const searchType = intent?.parsed && intent.media_type ? intent.media_type : (filterType || undefined)
      const searchGenre = intent?.parsed && intent.genre ? intent.genre : undefined
      const searchYearMin = intent?.parsed && intent.year_min ? intent.year_min : (yearRange.min || undefined)
      const searchYearMax = intent?.parsed && intent.year_max ? intent.year_max : (yearRange.max || undefined)
      const searchMinRating = intent?.parsed && intent.min_rating ? intent.min_rating : (minRating || undefined)
      const searchSortBy = intent?.parsed && intent.sort_by && intent.sort_by !== 'relevance' ? intent.sort_by : sortBy

// 使用服务端高级搜索API，所有筛选和排序都在服务端完成
      let sort_by = 'created_at'
      let sort_order = 'desc'
      if (searchSortBy === 'rating_desc') {
        sort_by = 'rating'
        sort_order = 'desc'
      } else if (searchSortBy === 'year_desc') {
        sort_by = 'year'
        sort_order = 'desc'
      } else if (searchSortBy === 'year_asc') {
        sort_by = 'year'
        sort_order = 'asc'
      } else if (searchSortBy === 'title_asc') {
        sort_by = 'title'
        sort_order = 'asc'
      }

      const res = await mediaApi.searchAdvanced({
        q: searchQuery,
        type: searchType || undefined,
        genre: searchGenre,
        year_min: searchYearMin,
        year_max: searchYearMax,
        min_rating: searchMinRating,
        sort_by,
        sort_order,
        page: p,
        size,
      })

      setResults(res.data.data || [])
      setTotal(res.data.total)
    } catch {
      toast.error(t('search.searchFailed'))
    } finally {
      setLoading(false)
    }
  }, [filterType, sortBy, yearRange, minRating, size])

  // 输入清空时清空结果
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setTotal(0)
      setSearched(false)
    }
  }, [query])

  // 媒体搜索：点击按钮/回车触发（含 AI 智能搜索：先解析意图再检索）
  const runMediaSearch = useCallback(() => {
    const q = query.trim()
    if (!q) return
    setSearched(true)
    const params = new URLSearchParams(searchParams)
    params.set('q', q)
    params.delete('page')
    setSearchParams(params, { replace: true })

    if (q.length > 4) {
      aiAbortRef.current?.abort()
      const controller = new AbortController()
      aiAbortRef.current = controller
      setAiLoading(true)
      aiApi.smartSearch(q)
        .then((res) => {
          if (!controller.signal.aborted) {
            const intent = res.data.data
            if (intent.parsed) {
              setAiParsed(intent)
              doSearch(q, 1, intent)
            } else {
              setAiParsed(null)
              doSearch(q, 1)
            }
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setAiParsed(null)
            doSearch(q, 1)
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setAiLoading(false)
        })
    } else {
      setAiParsed(null)
      doSearch(q, 1)
    }
  }, [query, searchParams, setSearchParams, doSearch])

  // 首次挂载：URL 带 q 时自动搜一次（保持链接可分享）
  useEffect(() => {
    const q = searchParams.get('q')
    if (q) {
      setSearched(true)
      doSearch(q, 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

// 翻页时搜索
  useEffect(() => {
    if (searchMode === 'media' && page > 1 && query.trim()) {
      doSearch(query, page)
    }
  }, [page, query, doSearch])

// 筛选/排序/每页数量变化时重新搜索（回到第 1 页）
  useEffect(() => {
    if (searchMode === 'media' && query.trim() && searched) {
      doSearch(query, 1)
    }
  }, [filterType, sortBy, yearRange, minRating, size])

  // 媒体库列表：场景检索的范围选项
  useEffect(() => {
    libraryApi.list()
      .then((res) => setLibraries(res.data.data || []))
      .catch(() => setLibraries([]))
  }, [])

  // 场景搜索：点击按钮/回车触发（每次 query 都要跑一次 SigLIP2 文本编码，
  // 不随输入自动搜，避免无效推理带来的 CPU 压力）
  const runSceneSearch = useCallback((scope?: { limit?: number; libraryId?: string; mediaIds?: string[] }) => {
    const q = query.trim()
    if (!q) return
    const limit = scope?.limit ?? sceneLimit
    const libraryId = scope?.libraryId ?? sceneLibraryId
    const mediaIds = scope?.mediaIds ?? sceneMovieIds
    const requestId = ++sceneRequestIdRef.current
    setSceneLoading(true)
    setSceneFailed(false)
    setSceneSearched(true)
    const params = new URLSearchParams(searchParams)
    params.set('q', q)
    setSearchParams(params, { replace: true })
    // 有影片选择时不下发媒体库条件
    const scopedLibraryId = mediaIds.length > 0 ? undefined : libraryId || undefined
    videoAnalysisApi.searchScenes(q, 'image', limit, { libraryId: scopedLibraryId, mediaIds })
      .then((res) => {
        // 只采用最后一次请求的结果
        if (requestId !== sceneRequestIdRef.current) return
        setSceneResults(res.data.data || [])
        setSceneFailed(false)
      })
      .catch(() => {
        if (requestId !== sceneRequestIdRef.current) return
        setSceneFailed(true)
      })
      .finally(() => {
        if (requestId !== sceneRequestIdRef.current) return
        setSceneLoading(false)
      })
  }, [query, searchParams, setSearchParams, sceneLimit, sceneLibraryId, sceneMovieIds])

  // 输入清空或切出场景模式时清空结果
  useEffect(() => {
    if (searchMode !== 'scene' || !query.trim()) {
      setSceneResults([])
      setSceneFailed(false)
      setSceneSearched(false)
    }
  }, [searchMode, query])

  const totalPages = Math.ceil(total / size)
  const hasActiveFilters = filterType !== '' || sortBy !== 'relevance' || yearRange.min > 0 || yearRange.max > 0 || minRating > 0

  const clearFilters = () => {
    setFilterType('')
    setSortBy('relevance')
    setYearRange({ min: 0, max: 0 })
    setMinRating(0)
  }

  return (
    <div>
      {/* 搜索模式切换：媒体 / 场景 */}
      <div className="mb-3 flex items-center gap-2">
        {[
          { value: 'media', label: t('search.tabMedia') },
          { value: 'scene', label: t('search.tabScene') },
        ].map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setSearchMode(tab.value as 'media' | 'scene')
              // 切到场景模式且已有输入时自动搜一次（单次显式动作）
              if (tab.value === 'scene' && query.trim()) runSceneSearch()
            }}
            className={clsx(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-all',
              searchMode === tab.value
                ? 'bg-neon-blue/15 text-neon border border-neon-blue/30'
                : 'text-surface-400 hover:text-surface-300'
            )}
            style={searchMode !== tab.value ? { border: '1px solid var(--border-default)' } : {}}
          >
            {tab.label}
          </button>
        ))}
      </div>

{/* 搜索栏 - 霓虹风格 */}
      <div className="relative mb-4">
        <SearchIcon
          size={20}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-neon/40"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (searchMode === 'scene' ? runSceneSearch() : runMediaSearch())
          }}
          className="input pl-12 pr-24 py-3.5 text-base"
          placeholder={searchMode === 'scene' ? t('search.sceneInputPlaceholder') : t('search.searchPlaceholder')}
          autoFocus
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {query && (
            <button
              onClick={() => setQuery('')}
              className="rounded-lg p-1.5 text-surface-500 transition-colors hover:text-neon"
            >
              <X size={16} />
            </button>
          )}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'rounded-lg p-1.5 transition-colors',
              showFilters || hasActiveFilters ? 'text-neon' : 'text-surface-500 hover:text-neon'
            )}
            title={t('search.filterAndSort')}
          >
            <SlidersHorizontal size={16} />
          </button>
          <button
            onClick={() => (searchMode === 'scene' ? runSceneSearch() : runMediaSearch())}
            className="rounded-lg p-1.5 text-surface-500 transition-colors hover:text-neon"
            title={t('search.searchButton')}
          >
            <SearchIcon size={16} />
          </button>
        </div>
      </div>

      {/* 筛选/配置栏（媒体：类型/年份/评分/排序；场景：相似场景数） */}
      {showFilters && (
        <div className="animate-slide-up mb-6 glass-panel rounded-xl p-4 space-y-4">
          {searchMode === 'media' ? (
            <>
{/* 类型筛选 */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              <Film size={12} /> {t('search.type')}:
            </span>
            {[
              { value: '', label: t('search.typeAll'), icon: null },
              { value: 'movie', label: t('search.typeMovie'), icon: Film },
              { value: 'episode', label: t('search.typeEpisode'), icon: Tv },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilterType(opt.value as '' | 'movie' | 'episode')}
                className={clsx(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                  filterType === opt.value
                    ? 'bg-neon-blue/15 text-neon border border-neon-blue/30'
                    : 'text-surface-400 hover:text-surface-300'
                )}
                style={filterType !== opt.value ? { border: '1px solid var(--border-default)' } : {}}
              >
                {opt.label}
              </button>
            ))}
          </div>

{/* 年份筛选 */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              <Calendar size={12} /> {t('search.year')}:
            </span>
            {YEAR_RANGES.map((yr) => (
              <button
                key={yr.labelKey || `${yr.min}-${yr.max}`}
                onClick={() => setYearRange({ min: yr.min, max: yr.max })}
                className={clsx(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                  yearRange.min === yr.min && yearRange.max === yr.max
                    ? 'bg-neon-blue/15 text-neon border border-neon-blue/30'
                    : 'text-surface-400 hover:text-surface-300'
                )}
                style={!(yearRange.min === yr.min && yearRange.max === yr.max) ? { border: '1px solid var(--border-default)' } : {}}
              >
                {yr.labelKey ? t(yr.labelKey) : `${yr.min}-${yr.max}`}
              </button>
            ))}
          </div>

{/* 评分筛选 */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              <Star size={12} /> {t('search.minRating')}:
            </span>
            {[0, 6, 7, 8, 9].map((r) => (
              <button
                key={r}
                onClick={() => setMinRating(r)}
                className={clsx(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                  minRating === r
                    ? 'bg-neon-blue/15 text-neon border border-neon-blue/30'
                    : 'text-surface-400 hover:text-surface-300'
                )}
                style={minRating !== r ? { border: '1px solid var(--border-default)' } : {}}
              >
                {r === 0 ? t('search.ratingAll') : t('search.ratingAbove', { score: r })}
              </button>
            ))}
          </div>

          {/* 排序 */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              <ArrowUpDown size={12} /> {t('search.sort')}:
            </span>
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSortBy(opt.value)}
                className={clsx(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                  sortBy === opt.value
                    ? 'bg-neon-blue/15 text-neon border border-neon-blue/30'
                    : 'text-surface-400 hover:text-surface-300'
                )}
                style={sortBy !== opt.value ? { border: '1px solid var(--border-default)' } : {}}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>

          {/* 清除筛选 */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              ✕ {t('search.clearFilters')}
            </button>
          )}
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                <Layers size={12} /> {t('search.sceneScope')}
              </span>
              <Select
                value={sceneLibraryId || 'all'}
                onValueChange={(value) => {
                  const libraryId = value === 'all' ? '' : value
                  setSceneLibraryId(libraryId)
                  // 换库时清空影片选择
                  setSceneMovieIds([])
                  sceneMovieCommitRef.current = ''
                  if (sceneSearched) runSceneSearch({ libraryId, mediaIds: [] })
                }}
              >
                <SelectTrigger className="h-9 w-auto rounded-lg px-3 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('search.sceneScopeAll')}</SelectItem>
                  {libraries.map((lib) => (
                    <SelectItem key={lib.id} value={lib.id}>
                      {lib.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SceneMoviePicker
                libraryId={sceneLibraryId}
                selected={sceneMovieIds}
                onChange={setSceneMovieIds}
                onCommit={(ids) => {
                  const key = ids.join(',')
                  if (key === sceneMovieCommitRef.current) return
                  sceneMovieCommitRef.current = key
                  if (sceneSearched) runSceneSearch({ mediaIds: ids })
                }}
              />
              <span className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                <Film size={12} /> {t('search.sceneCountLabel')}:
              </span>
              {[30, 50, 80, 100].map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setSceneLimit(n)
                    // 已有结果时立即用新 K 重查；否则下次搜索生效
                    if (sceneSearched) runSceneSearch({ limit: n })
                  }}
                  className={clsx(
                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                    sceneLimit === n
                      ? 'bg-neon-blue/15 text-neon border border-neon-blue/30'
                      : 'text-surface-400 hover:text-surface-300'
                  )}
                  style={sceneLimit !== n ? { border: '1px solid var(--border-default)' } : {}}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 搜索结果摘要（媒体） */}
      {searched && searchMode === 'media' && (
        <div className="mb-4 flex items-center gap-3 text-sm text-surface-400">
          <span>
            {t('search.found')} <span className="font-semibold text-neon">{total}</span> {t('search.results2')}
          </span>
          {aiParsed?.parsed && (
            <span className="flex items-center gap-1 rounded-md bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-400 border border-purple-500/20">
              <Sparkles size={10} />
              {t('search.aiUnderstand')}: "{aiParsed.query}"
              {aiParsed.genre && ` · ${aiParsed.genre}`}
              {aiParsed.year_min && aiParsed.year_max ? ` · ${aiParsed.year_min}-${aiParsed.year_max}` : ''}
            </span>
          )}
          {aiLoading && (
            <span className="flex items-center gap-1 text-[10px] text-purple-400">
              <Sparkles size={10} className="animate-pulse" />
              {t('search.aiAnalyzing')}
            </span>
          )}
          {hasActiveFilters && (
            <span className="rounded-md bg-neon-blue/10 px-2 py-0.5 text-[10px] text-neon">
              {t('search.filtered')}
            </span>
          )}
        </div>
      )}

      {searchMode === 'media' ? (
        <>
          <MediaGrid items={results} loading={loading} />

      {/* 空状态 */}
      {searched && !loading && results.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div
            className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl"
            style={{
              background: 'var(--neon-blue-5)',
              border: '1px solid var(--neon-blue-8)',
            }}
          >
            <SearchIcon size={36} className="text-surface-600" />
          </div>
          <p className="font-display text-base font-semibold tracking-wide text-surface-300">{t('search.noMatch')}</p>
          <p className="mt-1 text-sm text-surface-600">
            {hasActiveFilters ? t('search.noMatchHintFiltered') : t('search.noMatchHint')}
          </p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="mt-3 text-sm text-neon hover:text-neon/80 transition-colors"
            >
              {t('search.clearFilterConditions')}
            </button>
          )}
        </div>
      )}

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={size}
            pageSizeOptions={[20, 30, 50, 100]}
            onPageChange={setPage}
            onPageSizeChange={setSize}
          />
        </>
      ) : (
        <>
          {sceneLoading && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-video rounded-xl" />
              ))}
            </div>
          )}
          {!sceneLoading && sceneFailed && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-sm text-amber-400">{t('search.sceneSearchFailed')}</p>
              <p className="mt-1 text-sm text-surface-600">{t('search.sceneUnavailable')}</p>
            </div>
          )}
          {!sceneLoading && !sceneFailed && sceneResults.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sceneResults.map((r) => (
                <SceneSearchCard key={r.id} result={r} />
              ))}
            </div>
          )}
          {!sceneLoading && !sceneFailed && sceneSearched && sceneResults.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div
                className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl"
                style={{
                  background: 'var(--neon-blue-5)',
                  border: '1px solid var(--neon-blue-8)',
                }}
              >
                <Film size={36} className="text-surface-600" />
              </div>
              <p className="font-display text-base font-semibold tracking-wide text-surface-300">{t('search.sceneNoMatch')}</p>
              <p className="mt-1 text-sm text-surface-600">{t('search.sceneNoMatchHint')}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// SceneSearchCard 场景检索结果卡片：拉取场景帧图（带鉴权 blob），点击跳转到对应时间点播放
function SceneSearchCard({ result }: { result: SceneSearchResult }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    videoAnalysisApi
      .getSceneGridBlob(result.media_id, result.scene_index, result.video_analysis_task_id)
      .then((res) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(res.data)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [result.media_id, result.scene_index, result.video_analysis_task_id])

  return (
    <button
      onClick={() => navigate(routes.player(result.media_id, Math.floor(result.start_time)))}
      title={result.description}
      className="group text-left"
    >
      <div
        className="relative aspect-video overflow-hidden rounded-xl border"
        style={{ borderColor: 'var(--border-default)' }}
      >
        {url ? (
          <img
            src={url}
            alt={result.description}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            {failed ? (
              <span className="text-xs text-surface-600">{t('search.sceneLoadFailed')}</span>
            ) : (
              <Skeleton className="h-full w-full rounded-none" />
            )}
          </div>
        )}
      </div>
      <div className="mt-2 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-surface-200 transition-colors group-hover:text-neon">
            {result.media_title || t('search.unnamedMedia')}
          </span>
          <span className="shrink-0 text-[10px] text-surface-500">
            {formatVideoAnalysisSeconds(result.start_time)} - {formatVideoAnalysisSeconds(result.end_time)}
          </span>
        </div>
      </div>
    </button>
  )
}
