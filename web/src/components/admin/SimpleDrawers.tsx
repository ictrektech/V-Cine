import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { useTranslation } from '@/i18n'
import type { ComponentProps, ReactNode } from 'react'
import DashboardTab from '@/components/admin/DashboardTab'
import UsersTab from '@/components/admin/UsersTab'
import LogsTab from '@/components/admin/LogsTab'
import AITab, { type AISectionKey } from '@/components/admin/AITab'
import StorageTab from '@/components/admin/StorageTab'
import STRMConfigSection from '@/components/admin/STRMConfigSection'
import type { SetupTarget } from '@/lib/setupTargets'
import type { SystemInfo, User } from '@/types'
import type { ScanProgressData, ScrapeProgressData, TranscodeProgressData, ScanPhaseData } from '@/hooks/useWebSocket'

// ==================== 各配置模块 Drawer 壳 ====================
// 将既有整页组件（AI/存储/用户/日志/仪表盘）原样嵌入 Drawer，
// 行为零改动。后续迭代可逐步把内部字段折叠化。

type CommonProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function DrawerShell({ open, onOpenChange, title, description, size, contentClassName, children }: CommonProps & {
  title: string
  description: string
  size?: ComponentProps<typeof DrawerContent>['size']
  /** 传给 DrawerContent 的额外 className（如固定高度，避免内容切换时弹窗跳变） */
  contentClassName?: string
  children: ReactNode
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size={size} className={contentClassName} title={title} description={description}>
        {children}
      </DrawerContent>
    </Drawer>
  )
}

export function AIDrawer({ open, onOpenChange, initialSection, target, targetNonce }: CommonProps & { initialSection?: AISectionKey; target?: SetupTarget; targetNonce?: number }) {
  const { t } = useTranslation()
  return (
    <DrawerShell open={open} onOpenChange={onOpenChange} size="2xl" contentClassName="h-[85vh]" title={t('admin.ovCardAi')} description={t('admin.ovCardAiDesc')}>
      <AITab initialSection={initialSection} open={open} target={target} targetNonce={targetNonce} />
    </DrawerShell>
  )
}

export function StorageDrawer({ open, onOpenChange }: CommonProps) {
  const { t } = useTranslation()
  return (
    <DrawerShell open={open} onOpenChange={onOpenChange} size="2xl" title={t('admin.ovCardStorage')} description={t('admin.ovCardStorageDesc')}>
      <StorageTab />
    </DrawerShell>
  )
}

export function STRMDrawer({ open, onOpenChange }: CommonProps) {
  const { t } = useTranslation()
  return (
    <DrawerShell open={open} onOpenChange={onOpenChange} size="2xl" title={t('admin.ovCardStrm')} description={t('admin.ovCardStrmDesc')}>
      <STRMConfigSection />
    </DrawerShell>
  )
}

export function UsersDrawer({ open, onOpenChange, users, setUsers }: CommonProps & { users: User[]; setUsers: React.Dispatch<React.SetStateAction<User[]>> }) {
  const { t } = useTranslation()
  return (
    <DrawerShell open={open} onOpenChange={onOpenChange} title={t('admin.ovCardUsers')} description={t('admin.ovCardUsersDesc')}>
      <UsersTab users={users} setUsers={setUsers} />
    </DrawerShell>
  )
}

export function LogsDrawer({ open, onOpenChange }: CommonProps) {
  const { t } = useTranslation()
  return (
    <DrawerShell open={open} onOpenChange={onOpenChange} size="xl" title={t('admin.ovCardLogs')} description={t('admin.ovCardLogsDesc')}>
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
  const { t } = useTranslation()
  return (
    <DrawerShell open={open} onOpenChange={onOpenChange} size="2xl" title={t('admin.ovCardDashboard')} description={t('admin.ovCardDashboardDesc')}>
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
