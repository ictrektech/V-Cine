import { Drawer, DrawerContent } from '@/components/ui/drawer'
import type { ComponentProps, ReactNode } from 'react'
import DashboardTab from '@/components/admin/DashboardTab'
import UsersTab from '@/components/admin/UsersTab'
import LogsTab from '@/components/admin/LogsTab'
import AITab from '@/components/admin/AITab'
import StorageTab from '@/components/admin/StorageTab'
import type { SystemInfo, User } from '@/types'
import type { ScanProgressData, ScrapeProgressData, TranscodeProgressData, ScanPhaseData } from '@/hooks/useWebSocket'

// ==================== 各配置模块 Drawer 壳 ====================
// 将既有整页组件（AI/存储/用户/日志/仪表盘）原样嵌入 Drawer，
// 行为零改动。后续迭代可逐步把内部字段折叠化。

type CommonProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function DrawerShell({ open, onOpenChange, title, description, size, children }: CommonProps & {
  title: string
  description: string
  size?: ComponentProps<typeof DrawerContent>['size']
  children: ReactNode
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size={size} title={title} description={description}>
        {children}
      </DrawerContent>
    </Drawer>
  )
}

export function AIDrawer({ open, onOpenChange }: CommonProps) {
  return (
    <DrawerShell open={open} onOpenChange={onOpenChange} size="xl" title="AI 服务" description="AI 识别、归类、搜索、推荐、元数据增强">
      <AITab />
    </DrawerShell>
  )
}

export function StorageDrawer({ open, onOpenChange }: CommonProps) {
  return (
    <DrawerShell open={open} onOpenChange={onOpenChange} size="2xl" title="存储" description="WebDAV / Alist / S3 远程存储挂载">
      <StorageTab />
    </DrawerShell>
  )
}

export function UsersDrawer({ open, onOpenChange, users, setUsers }: CommonProps & { users: User[]; setUsers: React.Dispatch<React.SetStateAction<User[]>> }) {
  return (
    <DrawerShell open={open} onOpenChange={onOpenChange} title="用户管理" description="账号、角色与权限">
      <UsersTab users={users} setUsers={setUsers} />
    </DrawerShell>
  )
}

export function LogsDrawer({ open, onOpenChange }: CommonProps) {
  return (
    <DrawerShell open={open} onOpenChange={onOpenChange} size="xl" title="日志" description="系统运行与访问日志">
      <LogsTab />
    </DrawerShell>
  )
}

export function DashboardDrawer({ open, onOpenChange, systemInfo, scanProgress, scrapeProgress, transcodeProgress, scanPhase, realtimeMessages }: CommonProps & {
  systemInfo: SystemInfo | null
  scanProgress: Record<string, ScanProgressData>
  scrapeProgress: Record<string, ScrapeProgressData>
  transcodeProgress: Record<string, TranscodeProgressData>
  scanPhase: Record<string, ScanPhaseData>
  realtimeMessages: string[]
}) {
  return (
    <DrawerShell open={open} onOpenChange={onOpenChange} size="2xl" title="仪表盘" description="实时进度、系统状态、数据维护">
      <DashboardTab
        systemInfo={systemInfo}
        scanProgress={scanProgress}
        scrapeProgress={scrapeProgress}
        transcodeProgress={transcodeProgress}
        scanPhase={scanPhase}
        realtimeMessages={realtimeMessages}
      />
    </DrawerShell>
  )
}
