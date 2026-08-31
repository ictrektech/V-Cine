import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { storageApi } from '@/api'
import type { WebDAVStatus, AlistStatus, S3Status } from '@/api/storage'

type StorageStatuses = {
  webdavStatus: WebDAVStatus | null
  alistStatus: AlistStatus | null
  s3Status: S3Status | null
}

const StorageStatusesContext = createContext<StorageStatuses | null>(null)

// 由 AdminPage 统一挂载 Provider，所有订阅者共享同一份状态和轮询。
export function StorageStatusesProvider({ children }: { children: ReactNode }) {
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
    refresh()
    const timer = window.setInterval(refresh, 30000)
    return () => window.clearInterval(timer)
  }, [refresh])

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
