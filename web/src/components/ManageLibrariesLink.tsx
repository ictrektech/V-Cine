import { Link } from 'react-router-dom'
import { FolderPlus } from 'lucide-react'
import { routes } from '@/lib/routes'
import { useTranslation } from '@/i18n'

/** 空状态下的「去媒体库管理」入口（调用方按角色决定是否渲染） */
export default function ManageLibrariesLink() {
  const { t } = useTranslation()
  return (
    <Link
      to={routes.tasks.library}
      className="btn-primary mt-5 inline-flex items-center gap-1.5 px-5 py-2.5 text-sm"
    >
      <FolderPlus size={16} />
      {t('empty.manageLibraries')}
    </Link>
  )
}
