import { useI18nStore, SUPPORTED_LOCALES } from '@/i18n'
import { Globe } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export default function LanguageSwitcher() {
  const { locale, setLocale } = useI18nStore()
  const currentLang = SUPPORTED_LOCALES.find(l => l.code === locale)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title={currentLang?.name}
          aria-label={currentLang?.name}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-surface-400 transition-colors hover:text-neon hover:bg-neon-blue/5"
        >
          <Globe className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" sideOffset={8}>
        {SUPPORTED_LOCALES.map(lang => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => setLocale(lang.code)}
            className="flex items-center gap-3"
          >
            <span className="text-base">{lang.flag}</span>
            <span>{lang.name}</span>
            {locale === lang.code && <span className="ml-auto text-xs text-neon-blue">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
