import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ==================== Drawer（居中弹窗）====================
// 基于 shadcn Dialog 扩展：桌面居中弹窗（宽度按 size 分级，高度 90vh 内滚动），
// 移动端近全屏。API 与 Dialog 一致：
//   <Drawer open onOpenChange>
//     <DrawerContent title="..." description="...">
//       ...
//     </DrawerContent>
//   </Drawer>

const Drawer = DialogPrimitive.Root
const DrawerClose = DialogPrimitive.Close

// 抽屉宽度分级：按内容密度选择。内容稀疏的用 sm/md，表单/网格多的用 xl/2xl。
const DRAWER_SIZES: Record<string, string> = {
  sm: 'max-w-sm',      // 384px
  md: 'max-w-md',      // 448px
  lg: 'max-w-3xl',     // 768px（默认）
  xl: 'max-w-4xl',     // 896px
  '2xl': 'max-w-5xl',  // 1024px
  full: 'max-w-[calc(100vw-2rem)]',
}

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
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { title?: string; description?: string; size?: keyof typeof DRAWER_SIZES }
>(({ className, children, title, description, size = 'lg', ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DrawerOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // 桌面：居中弹窗（宽度按 size 分级），高度 90vh 内滚动；移动：近全屏
        'fixed left-[50%] top-[50%] z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] translate-x-[-50%] translate-y-[-50%] flex-col border bg-background shadow-xl duration-200 sm:w-full',
        DRAWER_SIZES[size],
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
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
      {/* 内容区：滚动；overflow-x-hidden 防止内容横向溢出被裁切 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-5">{children}</div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))
DrawerContent.displayName = 'DrawerContent'

export { Drawer, DrawerClose, DrawerOverlay, DrawerContent }
