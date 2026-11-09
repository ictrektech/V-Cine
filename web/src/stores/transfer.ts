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
  /** 上传落点；library_id 为空时在首个文件入库时自动建库 */
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
  /** 抽屉当前渲染高度（px，0 表示未显示） */
  dockHeight: number
  /** 入队一批文件，返回入队数量 */
  enqueue: (files: File[], location: ImportLocation, libraryName: string, scanMode?: ScanMode) => number
  retry: (id: string) => void
  cancel: (id: string) => void
  /** 移除已完成/已取消的条目 */
  clearFinished: () => void
  setDockOpen: (open: boolean) => void
  setDockHeight: (h: number) => void
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

/** 串行入库，并把结果写回条目 */
async function commitAndPatch(item: TransferItem) {
  patch([item.id], { status: 'scanning', progress: 100 })
  const ok = await serialCommit(() => commitItem(item)).catch(() => false)
  patch([item.id], { status: 'done', progress: 100, note: ok ? undefined : 'scan_failed' })
}

/** 单文件入库：把 `_incoming` 里的这个文件扫描入库 */
async function commitItem(item: TransferItem): Promise<boolean> {
  const localPath = item.location.local_path
  const libraryId = await resolveLibraryId(item.location, item.libraryName)
  if (!libraryId) return false
  // 只入库这一个文件
  const incoming = `${localPath}/_incoming`
  return requestScan(libraryId, [incoming], [`${incoming}/${item.file.name}`])
}

let commitChain: Promise<unknown> = Promise.resolve()
function serialCommit<T>(task: () => Promise<T>): Promise<T> {
  const run = commitChain.then(task)
  commitChain = run.catch(() => undefined)
  return run
}

/**
 * 批次收口：批次结束且模式为「扫描整个库」时，补一次全库扫描。
 * 落点没有库时（零库冷启动）由后端幂等建 mixed 库（D7：上传/扫描同一条任务的两个阶段）。
 */
async function maybeSettleBatch(batchId: string) {
  const { items } = useTransferStore.getState()
  const batch = items.filter((i) => i.batchId === batchId)
  if (batch.some((i) => i.status === 'queued' || i.status === 'uploading' || i.status === 'scanning')) return

  const uploaded = batch.filter((i) => i.status === 'done')
  if (!uploaded.length) return
  if (!uploaded.some((i) => i.scanMode === 'library')) return
  if (settledBatches.has(batchId)) return
  settledBatches.add(batchId)

  const { location, libraryName } = uploaded[0]
  try {
    const libraryId = await resolveLibraryId(location, libraryName)
    if (libraryId) await requestScan(libraryId)
  } catch {
    // 忽略全库扫描失败
  }
}

/** 202 重试窗口：覆盖一次正常库扫描的时长 */
const scanRetryWindowMs = 60_000

/**
 * 触发扫描；后端同一媒体库同时只允许一个扫描，正在扫时返回 202「扫描已在进行中」。
 * 这里把 202 当作"稍后重试"，返回 false 表示窗口内仍未启动（调用方标记 scan_failed）。
 */
async function requestScan(libraryId: string, paths?: string[], files?: string[]): Promise<boolean> {
  const deadline = Date.now() + scanRetryWindowMs
  for (;;) {
    const resp = paths ? await libraryApi.scanPaths(libraryId, paths, files) : await libraryApi.scan(libraryId)
    if (resp.status !== 202) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
}

/** local_path → library_id，避免同一落点的每个文件都请求一次自动建库 */
const ensuredLibraries = new Map<string, string>()

async function resolveLibraryId(location: ImportLocation, libraryName: string): Promise<string | null> {
  if (location.library_id) return location.library_id
  const cached = ensuredLibraries.get(location.local_path)
  if (cached) return cached
  try {
    const resp = await importTargetApi.ensureLibrary(location.local_path, libraryName)
    const id = resp.data?.data?.library_id ?? null
    if (id) ensuredLibraries.set(location.local_path, id)
    return id
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
    // 上传完成后立即入库
    await commitAndPatch(item)
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
  dockHeight: 0,

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
    if (!item) return
    // 上传成功但入库失败：只重试入库，不重新上传
    if (item.status === 'done' && item.note === 'scan_failed') {
      void commitAndPatch(item)
      return
    }
    if (item.status !== 'failed') return
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

  setDockHeight: (h) => set((s) => (s.dockHeight === h ? s : { dockHeight: h })),

  setConcurrency: (n) => {
    set({ concurrency: Math.min(3, Math.max(1, n)) })
    pump()
  },
}))
