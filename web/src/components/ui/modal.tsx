import { type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import clsx from 'clsx'

// ==================== Modal（统一弹窗容器）====================
// 基于 Radix Dialog 实现，解决嵌套在 Drawer 内时的三大问题：
// 1. transform 截断 → Radix Portal 渲染到 body
// 2. pointer-events: none → Radix DismissableLayer 自动恢复
// 3. FocusScope 焦点劫持 → 内层 Dialog 的 FocusScope 自动接管焦点
//
// 开关动画由 data-state 驱动（animate-dialog-*-in/out，keyframes 见 tailwind.config）。
// 组件需常驻挂载并传入受控 open —— 条件渲染（{show && <Modal>}）会跳过关闭动画。

interface ModalProps {
  /** 是否打开。推荐传入受控状态；默认 true（兼容父级条件渲染的旧用法，此时无关闭动画） */
  open?: boolean
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
  open = true,
  onClose,
  children,
  className,
  overlayClassName,
  dismissible = true,
}: ModalProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose?.()
      }}
    >
      <DialogPrimitive.Portal>
        {/* 遮罩层 */}
        <DialogPrimitive.Overlay
          className={clsx(
            'fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm data-[state=open]:animate-dialog-overlay-in data-[state=closed]:animate-dialog-overlay-out',
            overlayClassName,
          )}
        />
        {/* 居中容器：flex 定位替代 translate，slide-up+blur 动画无需位置补偿 */}
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <DialogPrimitive.Content
            className={clsx(
              'w-full rounded-lg p-4',
              // slide-up + blur（与 ui/drawer.tsx 同款，keyframes 见 tailwind.config）
              'data-[state=open]:animate-dialog-content-in data-[state=closed]:animate-dialog-content-out',
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
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
