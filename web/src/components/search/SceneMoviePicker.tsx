import { useState } from 'react'
import { Film, X } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import MediaPickerList from '@/components/media/MediaPickerList'

/** 可选影片数量上限 */
const MAX_SELECTED = 500

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

  const label =
    selected.length === 0
      ? t('search.sceneScopeAllMovies')
      : t('search.sceneScopeSelectedMovies', { count: selected.length })

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) onCommit(selected)
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-lg px-3 text-xs">
          <Film size={12} />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        {open && (
          <MediaPickerList
            libraryId={libraryId}
            selected={selected}
            onChange={onChange}
            maxSelected={MAX_SELECTED}
            labels={{
              search: t('search.sceneMovieSearch'),
              empty: t('search.sceneMovieEmpty'),
              more: t('search.sceneMovieMore'),
            }}
          />
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
