import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from '@/i18n'

/** 详情页左上角常驻返回按钮：有历史栈则后退，否则回首页（避免外链打开时按返回卡住） */
export default function BackButton() {
  const navigate = useNavigate()
  const { t } = useTranslation()

  return (
    <button
      onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
      aria-label={t('common.back')}
      title={t('common.back')}
      className="absolute left-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-full text-white backdrop-blur-md transition-all hover:scale-105"
      style={{ background: 'rgba(0,0,0,0.45)', border: '1px solid var(--neon-blue-15)' }}
    >
      <ArrowLeft size={18} />
    </button>
  )
}
