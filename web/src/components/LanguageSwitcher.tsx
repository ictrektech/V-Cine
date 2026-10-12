import { useI18nStore, resolveLocale, SUPPORTED_LOCALES } from '@/i18n'
import { useTranslation } from '@/i18n'
import { Globe } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export default function LanguageSwitcher() {
  const { preference, setLocale } = useI18nStore()
  const platformLocale = useI18nStore((s) => s.platformLocale)
  const { t } = useTranslation()
  // 当前实际生效的语言（auto 时优先取 VOS 平台语言，其次浏览器语言）
  const currentLocale = resolveLocale(preference, platformLocale)
  const currentLang = SUPPORTED_LOCALES.find(l => l.code === currentLocale)
  const autoLabel = `${t('nav.languageAuto')}（${currentLang?.name ?? 'English'}）`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title={preference === 'auto' ? autoLabel : currentLang?.name}
          aria-label={preference === 'auto' ? autoLabel : currentLang?.name}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-surface-400 transition-colors hover:text-neon hover:bg-neon-blue/5"
        >
          <Globe className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" sideOffset={8}>
        {/* 自动：跟随 VOS 语言（iframe 内），独立打开时回落浏览器语言 */}
        <DropdownMenuItem
          onClick={() => setLocale('auto')}
          className="flex items-center gap-3"
        >
          <Globe className="h-4 w-4" />
          <span>{t('nav.languageAuto')}</span>
          {preference === 'auto' && <span className="ml-auto text-xs text-neon-blue">✓</span>}
        </DropdownMenuItem>
        {SUPPORTED_LOCALES.map(lang => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => setLocale(lang.code)}
            className="flex items-center gap-3"
          >
            <span className="text-base">{lang.flag}</span>
            <span>{lang.name}</span>
            {preference === lang.code && <span className="ml-auto text-xs text-neon-blue">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
