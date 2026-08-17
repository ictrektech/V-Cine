import { type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import clsx from 'clsx'

// ==================== Modal（统一弹窗容器）====================
// 基于 Radix Dialog 实现，解决嵌套在 Drawer 内时的三大问题：
// 1. transform 截断 → Radix Portal 渲染到 body
// 2. pointer-events: none → Radix DismissableLayer 自动恢复
// 3. FocusScope 焦点劫持 → 内层 Dialog 的 FocusScope 自动接管焦点
//
// API 与原 createPortal 版本保持一致，迁移无感。

interface ModalProps {
  onClose?: () => void
  children: ReactNode
  /** 弹窗面板的 class，默认 w-full，宽度由调用方控制 */
  className?: string
  /** 遮罩层追加 class，用于覆盖默认背景/模糊/z-index 等 */
  overlayClassName?: string
  /** 点击遮罩是否关闭，默认 true */
  dismissible?: boolean
}

export function Modal({
  onClose,
  children,
  className,
  overlayClassName,
  dismissible = true,
}: ModalProps) {
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose?.()
      }}
    >
      <DialogPrimitive.Portal>
        {/* 遮罩层 */}
        <DialogPrimitive.Overlay
          className={clsx(
            'fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm',
            overlayClassName,
          )}
        />
        {/* 面板 */}
        <DialogPrimitive.Content
          className={clsx(
            'fixed left-1/2 top-1/2 z-[100] w-full -translate-x-1/2 -translate-y-1/2 p-4',
            className,
          )}
          onPointerDownOutside={(e) => {
            // dismissible=false 时阻止点击外部关闭
            if (!dismissible) e.preventDefault()
          }}
          onEscapeKeyDown={(e) => {
            // dismissible=false 时阻止 ESC 关闭
            if (!dismissible) e.preventDefault()
          }}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
