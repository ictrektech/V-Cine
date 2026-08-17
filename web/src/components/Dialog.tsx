import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import clsx from 'clsx'
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  HelpCircle,
  X,
} from 'lucide-react'

// ============================================================
// 全局 Dialog 系统 — 替代浏览器原生 confirm/alert/prompt
// 风格：深空霓虹 + glassmorphism（与 Toast 同语言）
//
// 基于 Radix Dialog 实现，天然支持嵌套在 Drawer 内使用：
// - Radix Portal 渲染到 body，不受 transform 截断
// - DismissableLayer 自动处理 pointer-events
// - FocusScope 栈式接管，内层弹窗自动获得焦点优先级
// ============================================================

type Variant = 'default' | 'primary' | 'danger' | 'warning' | 'success' | 'error' | 'info'

interface BaseOptions {
  title?: string
  message?: ReactNode
  variant?: Variant
  /** 默认 true，为 false 则点击遮罩不关闭（仅按按钮） */
  dismissible?: boolean
}

interface ConfirmOptions extends BaseOptions {
  confirmText?: string
  cancelText?: string
}

interface AlertOptions extends BaseOptions {
  okText?: string
}

interface PromptOptions extends BaseOptions {
  defaultValue?: string
  placeholder?: string
  /** 输入类型：text | password | textarea */
  inputType?: 'text' | 'password' | 'textarea'
  confirmText?: string
  cancelText?: string
  /** 校验函数；返回字符串表示错误信息，返回空表示通过 */
  validator?: (value: string) => string | null | undefined
}

interface DialogContextType {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  alert: (opts: AlertOptions) => Promise<void>
  prompt: (opts: PromptOptions) => Promise<string | null>
}

const DialogContext = createContext<DialogContextType | null>(null)

export function useDialog() {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog must be used within <DialogProvider>')
  return ctx
}

// ──────────────────── 内部状态模型 ────────────────────

type DialogKind = 'confirm' | 'alert' | 'prompt'

interface DialogState {
  id: string
  kind: DialogKind
  options: ConfirmOptions | AlertOptions | PromptOptions
  resolve: (value: any) => void
}

// ──────────────────── 视觉映射 ────────────────────

const variantIconMap: Record<Variant, ReactNode> = {
  default: <HelpCircle size={22} style={{ color: 'var(--neon-blue)' }} />,
  primary: <Info size={22} style={{ color: 'var(--neon-blue)' }} />,
  info: <Info size={22} style={{ color: 'var(--neon-blue)' }} />,
  success: <CheckCircle2 size={22} style={{ color: 'var(--neon-green, #00ff88)' }} />,
  warning: <AlertTriangle size={22} className="text-yellow-400" />,
  danger: <AlertTriangle size={22} className="text-red-400" />,
  error: <XCircle size={22} className="text-red-400" />,
}

const variantBtnMap: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  info: 'bg-primary text-primary-foreground hover:bg-primary/90',
  success: 'bg-emerald-600 text-white hover:bg-emerald-500',
  warning: 'bg-amber-500 text-white hover:bg-amber-400',
  danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  error: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
}

// ──────────────────── Provider ────────────────────

export function DialogProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<DialogState[]>([])
  const idRef = useRef(0)

  const push = useCallback((d: Omit<DialogState, 'id'>) => {
    const id = `dlg-${++idRef.current}`
    setStack((prev) => [...prev, { ...d, id }])
    return id
  }, [])

  const pop = useCallback((id: string) => {
    setStack((prev) => prev.filter((d) => d.id !== id))
  }, [])

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        push({ kind: 'confirm', options, resolve })
      }),
    [push]
  )

  const alert = useCallback(
    (options: AlertOptions) =>
      new Promise<void>((resolve) => {
        push({ kind: 'alert', options, resolve: () => resolve() })
      }),
    [push]
  )

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        push({ kind: 'prompt', options, resolve })
      }),
    [push]
  )

  const value = useMemo<DialogContextType>(
    () => ({ confirm, alert, prompt }),
    [confirm, alert, prompt]
  )

  return (
    <DialogContext.Provider value={value}>
      {children}
      {/* 每个 dialog 独立 portal，Radix 自动管理 FocusScope 栈 */}
      {stack.map((d) => (
        <DialogShell
          key={d.id}
          state={d}
          onClose={(result) => {
            d.resolve(result)
            pop(d.id)
          }}
        />
      ))}
    </DialogContext.Provider>
  )
}

// ──────────────────── 弹窗主体（基于 Radix Dialog）────────────────────

function DialogShell({
  state,
  onClose,
}: {
  state: DialogState
  onClose: (result: any) => void
}) {
  const { kind, options } = state
  const variant: Variant = options.variant ?? (kind === 'confirm' ? 'default' : 'info')
  const dismissible = options.dismissible !== false

  const handleDismiss = useCallback(() => {
    if (kind === 'confirm') onClose(false)
    else if (kind === 'prompt') onClose(null)
    else onClose(undefined)
  }, [kind, onClose])

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open && dismissible) handleDismiss()
      }}
    >
      <DialogPrimitive.Portal>
        {/* 遮罩层 */}
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[1000] animate-in fade-in-0"
          style={{
            background: 'rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(6px)',
          }}
        />
        {/* 面板 */}
        <DialogPrimitive.Content
          className={clsx(
            'fixed left-1/2 top-1/2 z-[1000] w-full max-w-md -translate-x-1/2 -translate-y-1/2',
            'rounded-2xl shadow-2xl outline-none',
            'animate-in fade-in-0 zoom-in-95',
          )}
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid hsl(var(--border))',
            backdropFilter: 'blur(24px)',
          }}
          onPointerDownOutside={(e) => {
            if (!dismissible) e.preventDefault()
          }}
          onEscapeKeyDown={(e) => {
            if (!dismissible) e.preventDefault()
          }}
        >
          {/* 关闭按钮（右上角） */}
          {dismissible && (
            <button
              type="button"
              aria-label="关闭"
              onClick={handleDismiss}
              className="absolute right-3 top-3 rounded-lg p-1.5 text-surface-500 transition-colors hover:bg-white/5 hover:text-white"
            >
              <X size={16} />
            </button>
          )}

          {kind === 'confirm' && (
            <ConfirmBody
              options={options as ConfirmOptions}
              variant={variant}
              onClose={onClose}
            />
          )}
          {kind === 'alert' && (
            <AlertBody
              options={options as AlertOptions}
              variant={variant}
              onClose={onClose}
            />
          )}
          {kind === 'prompt' && (
            <PromptBody
              options={options as PromptOptions}
              variant={variant}
              onClose={onClose}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// ──────────────────── ConfirmBody ────────────────────

function ConfirmBody({
  options,
  variant,
  onClose,
}: {
  options: ConfirmOptions
  variant: Variant
  onClose: (result: boolean) => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    confirmRef.current?.focus()
  }, [])

  return (
    <div className="px-6 pb-6 pt-7">
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">{variantIconMap[variant]}</div>
        <div className="flex-1 min-w-0">
          {options.title && (
            <h3
              className="text-base font-semibold leading-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              {options.title}
            </h3>
          )}
          {options.message && (
            <div
              className={`text-sm leading-relaxed ${options.title ? 'mt-2' : ''}`}
              style={{ color: 'var(--text-secondary)' }}
            >
              {options.message}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onClose(false)}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-white/5"
          style={{
            color: 'var(--text-secondary)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {options.cancelText ?? '取消'}
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={() => onClose(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onClose(true)
          }}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${variantBtnMap[variant]}`}
        >
          {options.confirmText ?? '确定'}
        </button>
      </div>
    </div>
  )
}

// ──────────────────── AlertBody ────────────────────

function AlertBody({
  options,
  variant,
  onClose,
}: {
  options: AlertOptions
  variant: Variant
  onClose: (result: undefined) => void
}) {
  const okRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    okRef.current?.focus()
  }, [])

  return (
    <div className="px-6 pb-6 pt-7">
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">{variantIconMap[variant]}</div>
        <div className="flex-1 min-w-0">
          {options.title && (
            <h3
              className="text-base font-semibold leading-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              {options.title}
            </h3>
          )}
          {options.message && (
            <div
              className={`text-sm leading-relaxed ${options.title ? 'mt-2' : ''}`}
              style={{ color: 'var(--text-secondary)' }}
            >
              {options.message}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end">
        <button
          ref={okRef}
          type="button"
          onClick={() => onClose(undefined)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onClose(undefined)
          }}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${variantBtnMap[variant]}`}
        >
          {options.okText ?? '知道了'}
        </button>
      </div>
    </div>
  )
}

// ──────────────────── PromptBody ────────────────────

function PromptBody({
  options,
  variant,
  onClose,
}: {
  options: PromptOptions
  variant: Variant
  onClose: (result: string | null) => void
}) {
  const [value, setValue] = useState(options.defaultValue ?? '')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select?.()
  }, [])

  const submit = useCallback(() => {
    if (options.validator) {
      const err = options.validator(value)
      if (err) {
        setError(err)
        return
      }
    }
    onClose(value)
  }, [value, options, onClose])

  const inputType = options.inputType ?? 'text'

  return (
    <div className="px-6 pb-6 pt-7">
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">{variantIconMap[variant]}</div>
        <div className="flex-1 min-w-0">
          {options.title && (
            <h3
              className="text-base font-semibold leading-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              {options.title}
            </h3>
          )}
          {options.message && (
            <div
              className={`text-sm leading-relaxed ${options.title ? 'mt-2' : ''}`}
              style={{ color: 'var(--text-secondary)' }}
            >
              {options.message}
            </div>
          )}

          <div className="mt-4">
            {inputType === 'textarea' ? (
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value)
                  if (error) setError(null)
                }}
                placeholder={options.placeholder}
                rows={4}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors resize-y"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: 'var(--text-primary)',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
                }}
              />
            ) : (
              <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                type={inputType}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value)
                  if (error) setError(null)
                }}
                placeholder={options.placeholder}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: 'var(--text-primary)',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                }}
              />
            )}
            {error && (
              <p className="mt-2 text-xs text-red-400">{error}</p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onClose(null)}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-white/5"
          style={{
            color: 'var(--text-secondary)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {options.cancelText ?? '取消'}
        </button>
        <button
          type="button"
          onClick={submit}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${variantBtnMap[variant]}`}
        >
          {options.confirmText ?? '确定'}
        </button>
      </div>
    </div>
  )
}

export default DialogProvider
