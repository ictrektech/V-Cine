import { useCallback, useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { mediaApi } from '@/api'
import type { Media } from '@/types'
import { useTranslation } from '@/i18n'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'

/** 每次拉取的影片条数 */
const PAGE_SIZE = 50

interface MediaPickerListProps {
  selected: string[]
  onChange: (ids: string[]) => void
  /** 不参与勾选的影片，例如已在合集中的条目 */
  exclude?: string[]
  /** 只列该媒体库的影片；空值表示全部库 */
  libraryId?: string
  /** 最多可选数量，默认不限 */
  maxSelected?: number
  /** 覆盖默认文案 */
  labels?: { search: string; empty: string; more: string }
}

/** 影片多选列表：输入关键词搜索，勾选后回传 id 集合。 */
export default function MediaPickerList({
  selected,
  onChange,
  exclude = [],
  libraryId = '',
  maxSelected,
  labels,
}: MediaPickerListProps) {
  const { t } = useTranslation()
  const [keyword, setKeyword] = useState('')
  const [items, setItems] = useState<Media[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  // 最新关键词：分页请求返回时用它判断结果是否已过期
  const keywordRef = useRef(keyword)
  useEffect(() => {
    keywordRef.current = keyword
  }, [keyword])

  const fetchPage = useCallback(
    (targetPage: number) => {
      const q = keyword.trim()
      return q
        ? mediaApi.search(q, targetPage, PAGE_SIZE)
        : mediaApi.list({ page: targetPage, size: PAGE_SIZE, library_id: libraryId || undefined })
    },
    [keyword, libraryId],
  )

  // 关键词变化时重置到第一页
  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      fetchPage(1)
        .then((res) => {
          if (cancelled) return
          const list = res.data.data || []
          setItems(list)
          setPage(1)
          setHasMore(list.length >= PAGE_SIZE)
        })
        .catch(() => {
          if (cancelled) return
          setItems([])
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
  }, [fetchPage, keyword])

  const loadMore = () => {
    const next = page + 1
    const snapshot = keyword.trim()
    setLoadingMore(true)
    fetchPage(next)
      .then((res) => {
        if (keywordRef.current.trim() !== snapshot) return
        const list = res.data.data || []
        setItems((prev) => {
          const seen = new Set(prev.map((item) => item.id))
          return [...prev, ...list.filter((item) => !seen.has(item.id))]
        })
        setPage(next)
        setHasMore(list.length >= PAGE_SIZE)
      })
      .catch(() => {
        if (keywordRef.current.trim() !== snapshot) return
        setHasMore(false)
      })
      .finally(() => setLoadingMore(false))
  }

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((item) => item !== id))
      return
    }
    if (maxSelected !== undefined && selected.length >= maxSelected) return
    onChange([...selected, id])
  }

  const visible = items.filter((item) => !exclude.includes(item.id))

  return (
    <div>
      <div className="relative">
        <Search
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--text-tertiary)' }}
        />
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={labels?.search ?? t('collections.pickerSearch')}
          className="h-9 pl-8 text-xs"
          style={{
            background: 'var(--bg-input)',
            borderColor: 'var(--border-default)',
            color: 'var(--text-primary)',
          }}
        />
      </div>

      <ScrollArea className="mt-2 h-64">
        {loading && (
          <p className="px-1 py-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {t('common.loading')}
          </p>
        )}
        {!loading && visible.length === 0 && (
          <p className="px-1 py-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {labels?.empty ?? t('collections.pickerEmpty')}
          </p>
        )}
        {!loading &&
          visible.map((item) => (
            <label
              key={item.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-xs hover:bg-[var(--nav-hover-bg)]"
            >
              <Checkbox checked={selected.includes(item.id)} onCheckedChange={() => toggle(item.id)} />
              <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                {item.title}
              </span>
              {item.year > 0 && (
                <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                  {item.year}
                </span>
              )}
            </label>
          ))}
      </ScrollArea>

      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="btn-ghost mt-1 w-full rounded-lg py-1.5 text-xs"
        >
          {loadingMore ? t('common.loading') : labels?.more ?? t('collections.pickerMore')}
        </button>
      )}
    </div>
  )
}
