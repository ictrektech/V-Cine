import { Component, type ReactNode } from 'react'
import { AlertTriangle, Home } from 'lucide-react'
import { t } from '@/i18n'
import { getBasePath } from '@/lib/basePath'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * 顶层错误边界：包住应用壳与路由树（含通知中心、通知弹窗等全局组件），
 * 兜住子树的渲染期异常，避免整页白屏。
 * 函数式组件无法捕获子树的渲染错误，因此这里必须是类组件。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[ErrorBoundary] 渲染异常:', error)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const basePath = getBasePath()
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center"
        style={{ background: 'var(--bg-base)' }}
      >
        <AlertTriangle size={36} className="text-amber-400" />
        <h1 className="font-display text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {t('errorBoundary.title')}
        </h1>
        <p className="max-w-md text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('errorBoundary.hint')}
        </p>
        <button
          className="btn-primary mt-3 inline-flex items-center gap-1.5 px-5 py-2.5 text-sm"
          onClick={() => window.location.replace(basePath ? `${basePath}/` : '/')}
        >
          <Home size={16} />
          {t('errorBoundary.home')}
        </button>
      </div>
    )
  }
}
