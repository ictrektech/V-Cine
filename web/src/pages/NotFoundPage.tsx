import { Link } from 'react-router-dom'
import { Home } from 'lucide-react'
import { useTranslation } from '@/i18n'

/** 未知路由的兜底页面（渲染在 Layout 内，保留侧栏导航） */
export default function NotFoundPage() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="font-display text-5xl font-bold text-neon text-neon-glow">404</div>
      <h1 className="font-display text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
        {t('notFound.title')}
      </h1>
      <p className="max-w-md text-sm" style={{ color: 'var(--text-secondary)' }}>
        {t('notFound.hint')}
      </p>
      <Link to="/" className="btn-primary mt-3 inline-flex items-center gap-1.5 px-5 py-2.5 text-sm">
        <Home size={16} />
        {t('notFound.home')}
      </Link>
    </div>
  )
}
