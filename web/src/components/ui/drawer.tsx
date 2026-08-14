import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ==================== Drawer（右侧抽屉）====================
// 基于 shadcn Dialog 扩展：桌面右侧滑出（宽 480），移动端全屏。
// 用法与 Dialog 一致：
//   <Drawer open onOpenChange>
//     <DrawerContent title="..." description="...">
//       ...
//     </DrawerContent>
//   </Drawer>

const Drawer = DialogPrimitive.Root
const DrawerClose = DialogPrimitive.Close

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
))
DrawerOverlay.displayName = 'DrawerOverlay'

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { title?: string; description?: string }
>(({ className, children, title, description, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DrawerOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // 桌面：右侧抽屉 480px 全高；移动：全屏（w-full sm:w-[480px]）
        'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background shadow-xl duration-200 sm:w-[480px]',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
        className,
      )}
      {...props}
    >
      {/* 头部：标题 + 副标题 + 关闭 */}
      <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
        <div className="min-w-0">
          {title && <DialogPrimitive.Title className="font-display text-lg font-semibold tracking-wide">{title}</DialogPrimitive.Title>}
          {description && <DialogPrimitive.Description className="mt-0.5 text-xs">{description}</DialogPrimitive.Description>}
        </div>
        <DialogPrimitive.Close className="rounded-lg p-1.5 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring">
          <X className="h-4 w-4" />
          <span className="sr-only">关闭</span>
        </DialogPrimitive.Close>
      </div>
      {/* 内容区：滚动 */}
      <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))
DrawerContent.displayName = 'DrawerContent'

export { Drawer, DrawerClose, DrawerOverlay, DrawerContent }
