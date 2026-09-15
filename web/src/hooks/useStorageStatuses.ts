import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { storageApi } from '@/api'
import type { WebDAVStatus, AlistStatus, S3Status } from '@/api/storage'
import type { StorageType } from '@/lib/storageSchemes'

type StorageStatuses = {
  webdavStatus: WebDAVStatus | null
  alistStatus: AlistStatus | null
  s3Status: S3Status | null
}

const StorageStatusesContext = createContext<StorageStatuses | null>(null)

// 由 Layout 统一挂载 Provider，所有订阅者共享同一份状态和轮询。
export function StorageStatusesProvider({ children, poll = true }: { children: ReactNode; poll?: boolean }) {
  const [webdavStatus, setWebdavStatus] = useState<WebDAVStatus | null>(null)
  const [alistStatus, setAlistStatus] = useState<AlistStatus | null>(null)
  const [s3Status, setS3Status] = useState<S3Status | null>(null)

  const refresh = useCallback(() => {
    void storageApi.getWebDAVStatus().then((res) => {
      setWebdavStatus(res.data.data)
    }).catch(() => {
      setWebdavStatus(null)
    })
    void storageApi.getAlistStatus().then((res) => {
      setAlistStatus(res.data.data)
    }).catch(() => {
      setAlistStatus(null)
    })
    void storageApi.getS3Status().then((res) => {
      setS3Status(res.data.data)
    }).catch(() => {
      setS3Status(null)
    })
  }, [])

  useEffect(() => {
    if (!poll) return // 探测接口仅管理员可用，非管理员不轮询（状态保持 null，订阅方按未知处理）
    refresh()
    const timer = window.setInterval(refresh, 30000)
    return () => window.clearInterval(timer)
  }, [refresh, poll])

  const value = useMemo(() => ({ webdavStatus, alistStatus, s3Status }), [webdavStatus, alistStatus, s3Status])

  return createElement(StorageStatusesContext.Provider, { value }, children)
}

export function useStorageStatuses() {
  const ctx = useContext(StorageStatusesContext)
  if (!ctx) {
    throw new Error('useStorageStatuses must be used within StorageStatusesProvider')
  }
  return ctx
}

// 状态探测接口仅管理员可用（/api/admin/...），探测失败或非管理员时返回 null，
// 订阅方据此回退为「不标记离线」，保持默认浏览体验。
const EMPTY_OFFLINE_TYPES = new Set<StorageType>()

/**
 * 当前已断连的远程存储类型集合。
 * 判定规则：已配置（启用过或填过地址）但未连接 → 该存储上的媒体不可播放。
 * 不依赖 enabled：alist/s3 保存配置时连接测试失败或后端重启后配置未持久化，
 * enabled 可能为 false 但媒体仍在（VFS 已不可用），此时同样需要标记。
 * WebDAV 的 connected 仅在「启用且客户端就绪」时返回，禁用/未就绪时缺失，同样按未连接处理。
 * 状态未知（探测失败/非管理员）时为空集 → 不标记任何媒体离线，恢复后随轮询自动消失。
 */
export function useOfflineRemoteTypes(): Set<StorageType> {
  const statuses = useContext(StorageStatusesContext)
  return useMemo(() => {
    if (!statuses) return EMPTY_OFFLINE_TYPES
    const offline = new Set<StorageType>()
    const ws = statuses.webdavStatus
    if (ws && ws.connected !== true && (ws.enabled || !!ws.server_url)) offline.add('webdav')
    const as = statuses.alistStatus
    if (as && as.connected !== true && (as.enabled || !!as.server_url)) offline.add('alist')
    const ss = statuses.s3Status
    if (ss && ss.connected !== true && (ss.enabled || !!ss.endpoint)) offline.add('s3')
    return offline
  }, [statuses])
}
