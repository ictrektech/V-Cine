import { create } from 'zustand'
import { libraryApi } from '@/api'
import { importTargetApi, type ImportLocation } from '@/api/importTargets'
import { PlatformUploadError, uploadToVOS } from '@/api/platformUpload'
import { rememberPublicDirUuid, resolvePublicDirUuid } from '@/lib/vosDirectoryMap'
import { acquireVOSAccessToken } from '@/utils/vos-oidc'

/**
 * 「添加视频」上传队列（前端队列，D5）
 *
 * 为什么在前端：平台没有上传任务接口（无分片/断点续传），服务端中继等于把流量与落盘翻倍。
 * 明确限制：刷新页面会丢失未完成的队列（文件对象无法持久化），UI 需明示。
 */

export type TransferStatus = 'queued' | 'uploading' | 'scanning' | 'done' | 'failed'

/** 上传完成后的扫描范围：只处理本次上传的文件 / 整个媒体库 */
export type ScanMode = 'uploaded' | 'library'

export interface TransferItem {
  id: string
  batchId: string
  file: File
  /** 上传落点；library_id 为空时在批次收口阶段自动建库 */
  location: ImportLocation
  /** 自动建库用的库名（前端按当前语言生成，库名会落库） */
  libraryName: string
  scanMode: ScanMode
  status: TransferStatus
  progress: number
  /** 平台业务错误码（-1 网络错误 / -2 用户取消） */
  errorCode?: number
  note?: 'scan_failed'
}

interface TransferStore {
  items: TransferItem[]
  /** 并发上传数（1–3，默认 2） */
  concurrency: number
  dockOpen: boolean
  /** 入队一批文件，返回入队数量 */
  enqueue: (files: File[], location: ImportLocation, libraryName: string, scanMode?: ScanMode) => number
  retry: (id: string) => void
  cancel: (id: string) => void
  /** 移除已完成/已取消的条目 */
  clearFinished: () => void
  setDockOpen: (open: boolean) => void
  setConcurrency: (n: number) => void
}

const aborts = new Map<string, AbortController>()
/** 已收口的批次，避免最后两个文件同时完成时重复建库/扫描 */
const settledBatches = new Set<string>()
let pumping = false

let seq = 0
const nextId = () => `t${Date.now().toString(36)}-${++seq}`

function patch(ids: string[], next: Partial<TransferItem>) {
  if (!ids.length) return
  const idSet = new Set(ids)
  useTransferStore.setState((s) => ({
    items: s.items.map((item) => (idSet.has(item.id) ? { ...item, ...next } : item)),
  }))
}

/** 解析上传用的 Finder adapter：user_data 直接用后端给的，public 需前端 join 目录表 */
async function resolveAdapter(location: ImportLocation, token: string): Promise<string | null> {
  if (location.adapter) return location.adapter
  const { volume_uuid: volumeUUID, public_dir_name: dirName } = location
  if (!volumeUUID || !dirName) return null
  const uuid = await resolvePublicDirUuid(volumeUUID, dirName, token)
  if (!uuid) return null
  rememberPublicDirUuid(volumeUUID, dirName, uuid)
  return `p_${uuid}`
}

/**
 * 批次收口：所有文件上传结束后，对每个落点各做一次「确保库 → 扫描」。
 * 落点没有库时（零库冷启动）由后端幂等建 mixed 库（D7：上传/扫描同一条任务的两个阶段）。
 */
async function maybeSettleBatch(batchId: string) {
  const { items } = useTransferStore.getState()
  const batch = items.filter((i) => i.batchId === batchId)
  if (batch.some((i) => i.status === 'queued' || i.status === 'uploading')) return

  const uploaded = batch.filter((i) => i.status === 'done')
  if (!uploaded.length) return
  if (settledBatches.has(batchId)) return
  settledBatches.add(batchId)

  const ids = uploaded.map((i) => i.id)
  const { location, scanMode, libraryName } = uploaded[0]
  const localPath = location.local_path

  patch(ids, { status: 'scanning' })
  let scanFailed = false

  try {
    const libraryId = location.library_id || (await ensureLibrary(localPath, libraryName))
    if (!libraryId) {
      scanFailed = true
    } else if (scanMode === 'library') {
      await requestScan(libraryId)
    } else {
      // 只处理本次上传：限定扫描 `_incoming`，并只入库本批次上传的文件
      // （否则 `_incoming` 里历史遗留的文件会一起被扫进来）
      const incoming = `${localPath}/_incoming`
      const files = uploaded.map((i) => `${incoming}/${i.file.name}`)
      await requestScan(libraryId, [incoming], files)
    }
  } catch {
    scanFailed = true
  }

  patch(ids, { status: 'done', note: scanFailed ? 'scan_failed' : undefined })
}

/**
 * 触发扫描；后端同一媒体库同时只允许一个扫描，正在扫时返回 202「扫描已在进行中」。
 * 这里把 202 当作"稍后重试"，否则同一库的并发批次会让后一批的文件永远不入库。
 */
async function requestScan(libraryId: string, paths?: string[], files?: string[]): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = paths ? await libraryApi.scanPaths(libraryId, paths, files) : await libraryApi.scan(libraryId)
    if (resp.status !== 202) return
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
}

async function ensureLibrary(localPath: string, libraryName: string): Promise<string | null> {
  try {
    const resp = await importTargetApi.ensureLibrary(localPath, libraryName)
    return resp.data?.data?.library_id ?? null
  } catch {
    return null
  }
}

async function runItem(item: TransferItem) {
  patch([item.id], { status: 'uploading', progress: 0, errorCode: undefined, note: undefined })
  const controller = new AbortController()
  aborts.set(item.id, controller)

  try {
    // token 获取失败（bridge 缺失/授权流程异常）统一归入 10001，文案提示刷新重试
    const token = await acquireVOSAccessToken().catch(() => null)
    if (!token) throw new PlatformUploadError(10001, 'no token')

    const adapter = await resolveAdapter(item.location, token)
    if (!adapter) throw new PlatformUploadError(10047, 'no adapter')

    const base = (item.location.path || '/').replace(/\/+$/, '')
    await uploadToVOS({
      adapter,
      path: `${base}/_incoming`,
      name: item.file.name,
      file: item.file,
      token,
      conflictStrategy: 'skip',
      signal: controller.signal,
      onProgress: (loaded, total) => patch([item.id], { progress: total > 0 ? Math.round((loaded / total) * 100) : 0 }),
    })
    patch([item.id], { status: 'done', progress: 100 })
  } catch (err) {
    const code = err instanceof PlatformUploadError ? err.code : -1
    if (code === -2) {
      // 用户取消：直接移出队列，不显示为失败
      useTransferStore.setState((s) => ({ items: s.items.filter((i) => i.id !== item.id) }))
    } else {
      patch([item.id], { status: 'failed', errorCode: code })
    }
  } finally {
    aborts.delete(item.id)
    await maybeSettleBatch(item.batchId)
    pump()
  }
}

function pump() {
  if (pumping) return
  pumping = true
  try {
    const { items, concurrency } = useTransferStore.getState()
    const running = items.filter((i) => i.status === 'uploading').length
    const idle = Math.max(0, concurrency - running)
    if (idle === 0) return
    items
      .filter((i) => i.status === 'queued')
      .slice(0, idle)
      .forEach((item) => {
        void runItem(item)
      })
  } finally {
    pumping = false
  }
}

export const useTransferStore = create<TransferStore>((set, get) => ({
  items: [],
  concurrency: 2,
  dockOpen: false,

  enqueue: (files, location, libraryName, scanMode = 'uploaded') => {
    if (!files.length) return 0
    const batchId = nextId()
    const items: TransferItem[] = files.map((file) => ({
      id: nextId(),
      batchId,
      file,
      location,
      libraryName,
      scanMode,
      status: 'queued',
      progress: 0,
    }))
    set((s) => ({ items: [...s.items, ...items], dockOpen: true }))
    pump()
    return items.length
  },

  retry: (id) => {
    const item = get().items.find((i) => i.id === id)
    if (!item || item.status !== 'failed') return
    // 重试沿用原批次，但该批次需要重新允许收口（建库/扫描）
    settledBatches.delete(item.batchId)
    patch([id], { status: 'queued', progress: 0, errorCode: undefined, note: undefined })
    pump()
  },

  cancel: (id) => {
    const item = get().items.find((i) => i.id === id)
    if (!item) return
    if (item.status === 'uploading') {
      aborts.get(id)?.abort()
      return
    }
    if (item.status === 'queued') {
      set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
    }
  },

  clearFinished: () => {
    set((s) => ({ items: s.items.filter((i) => i.status !== 'done' && i.status !== 'failed') }))
  },

  setDockOpen: (open) => set({ dockOpen: open }),

  setConcurrency: (n) => {
    set({ concurrency: Math.min(3, Math.max(1, n)) })
    pump()
  },
}))
