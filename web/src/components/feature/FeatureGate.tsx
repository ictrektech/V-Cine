import type { ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCapabilities } from '@/hooks/useCapabilities'
import { useTranslation } from '@/i18n'
import { routes } from '@/lib/routes'
import { toAppUrl } from '@/lib/appUrl'
import type { CapabilityId } from '@/types/capability'

/**
 * 功能门禁。
 *
 * 三态渲染：
 * - available / unknown → 渲染 children
 * - disabled            → 说明未开启，按钮指向开关
 * - missing_dependency  → 说明缺什么，按钮指向补齐位置
 *
 * unknown 必须放行：接口失败或组件不在 Provider 内时，基础媒体功能照常可用。
 */
interface FeatureGateProps {
  feature: CapabilityId
  children: ReactNode
  /** 不可用时直接隐藏，不渲染提示卡片。 */
  hideWhenUnavailable?: boolean
}

export default function FeatureGate({ feature, children, hideWhenUnavailable = false }: FeatureGateProps) {
  const { t } = useTranslation()
  const { get, stateOf } = useCapabilities()
  const state = stateOf(feature)

  if (state === 'available' || state === 'unknown') return <>{children}</>
  if (hideWhenUnavailable) return null

  const capability = get(feature)
  const drawer = capability?.fix?.drawer ?? ''
  const actionLabel = state === 'disabled' ? t('capability.action.enable') : t('capability.action.fix')

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-10 text-center" role="status">
      <AlertCircle className="mx-auto h-6 w-6 text-amber-400" aria-hidden="true" />
      <h3 className="mt-3 font-medium text-foreground">{t(`capability.name.${feature}`)}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
        {capability?.reason ? t(capability.reason) : t('capability.unknownReason')}
      </p>
      {drawer && (
        <div className="mt-4 flex items-center justify-center">
          <Button asChild variant="outline" size="sm">
            <a href={toAppUrl(routes.admin(drawer))}>{actionLabel}</a>
          </Button>
        </div>
      )}
    </div>
  )
}
