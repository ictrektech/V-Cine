import { type ReactNode, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/components/Toast'
import { t } from '@/i18n'

/**
 * 管理员路由守卫：非管理员访问后台页面时回首页并提示。
 * 后端管理接口另有 AdminOnly 中间件兜底，这里主要避免"页面壳可进、数据却 403"的错觉。
 * 角色未知（持久化状态里只有登录标记、没带 user）时同样按无权处理，不放行也不留白屏。
 */
export default function AdminRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const toast = useToast()
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    if (user && !isAdmin) toast.error(t('admin.noAccess'))
  }, [user, isAdmin, toast])

  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}
