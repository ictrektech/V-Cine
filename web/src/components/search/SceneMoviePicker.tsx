import { useCallback, useEffect, useState } from 'react'
import { Film, Search as SearchIcon, X } from 'lucide-react'
import { mediaApi } from '@/api'
import type { Media } from '@/types'
import { useTranslation } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'

/** 可选影片数量上限 */
const MAX_SELECTED = 500
/** 按库列表每页条数 */
const LIST_PAGE_SIZE = 100
/** 关键词搜索结果每页条数 */
const SEARCH_PAGE_SIZE = 30

interface SceneMoviePickerProps {
  /** 当前选中的媒体库；空字符串表示全部库 */
  libraryId: string
  selected: string[]
  onChange: (ids: string[]) => void
  /** 弹层关闭后回调 */
  onCommit: (ids: string[]) => void
}

export default function SceneMoviePicker({ libraryId, selected, onChange, onCommit }: SceneMoviePickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [movies, setMovies] = useState<Media[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  const fetchPage = useCallback(
    (targetPage: number) => {
      const q = keyword.trim()
      return q
        ? mediaApi.search(q, targetPage, SEARCH_PAGE_SIZE)
        : mediaApi.list({ page: targetPage, size: LIST_PAGE_SIZE, library_id: libraryId || undefined })
    },
    [keyword, libraryId],
  )

  // 打开弹层或改搜索词时重置到第一页；输入时防抖
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const pageSize = keyword.trim() ? SEARCH_PAGE_SIZE : LIST_PAGE_SIZE
    const timer = window.setTimeout(() => {
      setLoading(true)
      fetchPage(1)
        .then((res) => {
          if (cancelled) return
          const list = res.data.data || []
          setMovies(list)
          setPage(1)
          setHasMore(list.length >= pageSize)
        })
        .catch(() => {
          if (cancelled) return
          setMovies([])
          setHasMore(false)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, keyword.trim() ? 250 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, fetchPage, keyword])

  const loadMore = () => {
    const next = page + 1
    const pageSize = keyword.trim() ? SEARCH_PAGE_SIZE : LIST_PAGE_SIZE
    setLoadingMore(true)
    fetchPage(next)
      .then((res) => {
        const list = res.data.data || []
        setMovies((prev) => {
          const seen = new Set(prev.map((item) => item.id))
          return [...prev, ...list.filter((item) => !seen.has(item.id))]
        })
        setPage(next)
        setHasMore(list.length >= pageSize)
      })
      .catch(() => setHasMore(false))
      .finally(() => setLoadingMore(false))
  }

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((item) => item !== id))
      return
    }
    if (selected.length >= MAX_SELECTED) return
    onChange([...selected, id])
  }

  const label =
    selected.length === 0
      ? t('search.sceneScopeAllMovies')
      : t('search.sceneScopeSelectedMovies', { count: selected.length })

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setKeyword('')
          onCommit(selected)
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-lg px-3 text-xs">
          <Film size={12} />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="relative mb-2">
          <SearchIcon
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-tertiary)' }}
          />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t('search.sceneMovieSearch')}
            className="h-9 pl-8 text-xs"
          />
        </div>
        <ScrollArea className="h-64">
          {loading && (
            <p className="px-1 py-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {t('search.sceneMovieLoading')}
            </p>
          )}
          {!loading && movies.length === 0 && (
            <p className="px-1 py-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {t('search.sceneMovieEmpty')}
            </p>
          )}
          {!loading &&
            movies.map((movie) => (
              <label
                key={movie.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-xs hover:bg-[var(--nav-hover-bg)]"
              >
                <Checkbox checked={selected.includes(movie.id)} onCheckedChange={() => toggle(movie.id)} />
                <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                  {movie.title}
                </span>
              </label>
            ))}
        </ScrollArea>
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full text-xs"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? t('search.sceneMovieLoading') : t('search.sceneMovieMore')}
          </Button>
        )}
        {selected.length > 0 && (
          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {label}
            </span>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onChange([])}>
              <X size={12} />
              {t('search.sceneScopeClear')}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
