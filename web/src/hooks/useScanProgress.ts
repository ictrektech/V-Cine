import { useEffect, useState, useCallback, useRef } from 'react'
import { libraryApi } from '@/api'
import { WS_EVENTS } from '@/hooks/useWebSocket'
import type { WSEventType } from '@/hooks/useWebSocket'
import type { ScanProgressData, ScrapeProgressData, TranscodeProgressData, ScanPhaseData } from '@/hooks/useWebSocket'

// ==================== 扫描/刮削/转码实时进度状态 Hook ====================
// 抽取自 AdminPage：统一管理扫描、刮削、转码的实时进度 + 实时消息，
// 并持久化到 localStorage（刷新页面后恢复进行中的任务状态）。
// AdminPage（仪表盘）与 FileManagerPage（媒体库管理页）共用。

const SCAN_PROGRESS_STORAGE_KEY = 'nowen:scan-progress:v2'

// 从 Record 状态中移除指定 key（返回新对象，保持不可变更新）
function removeKey<K extends string, V>(record: Record<K, V>, key: K): Record<K, V> {
  const next = { ...record }
  delete next[key]
  return next
}

// 刮削进度按媒体库聚合；无 library_id 的事件归入 'default'
const scrapeKey = (data: ScrapeProgressData) => data.library_id || 'default'

type PersistedScanState = {
  scanningIds: string[]
  scanProgress: Record<string, ScanProgressData>
  scrapeProgress: Record<string, ScrapeProgressData>
  scanPhase: Record<string, ScanPhaseData>
  updatedAt: number
}

function loadPersistedScanState(): PersistedScanState {
  if (typeof window === 'undefined') {
    return { scanningIds: [], scanProgress: {}, scrapeProgress: {}, scanPhase: {}, updatedAt: 0 }
  }
  try {
    const raw = window.localStorage.getItem(SCAN_PROGRESS_STORAGE_KEY)
    if (!raw) return { scanningIds: [], scanProgress: {}, scrapeProgress: {}, scanPhase: {}, updatedAt: 0 }
    const parsed = JSON.parse(raw) as PersistedScanState
    if (!parsed || Date.now() - (parsed.updatedAt || 0) > 24 * 60 * 60 * 1000) {
      window.localStorage.removeItem(SCAN_PROGRESS_STORAGE_KEY)
      return { scanningIds: [], scanProgress: {}, scrapeProgress: {}, scanPhase: {}, updatedAt: 0 }
    }
    return {
      scanningIds: Array.isArray(parsed.scanningIds) ? parsed.scanningIds : [],
      scanProgress: parsed.scanProgress || {},
      scrapeProgress: parsed.scrapeProgress || {},
      scanPhase: parsed.scanPhase || {},
      updatedAt: parsed.updatedAt || 0,
    }
  } catch {
    return { scanningIds: [], scanProgress: {}, scrapeProgress: {}, scanPhase: {}, updatedAt: 0 }
  }
}

export interface ScanProgressController {
  scanning: Set<string>
  setScanning: React.Dispatch<React.SetStateAction<Set<string>>>
  scanProgress: Record<string, ScanProgressData>
  scrapeProgress: Record<string, ScrapeProgressData>
  transcodeProgress: Record<string, TranscodeProgressData>
  scanPhase: Record<string, ScanPhaseData>
  realtimeMessages: string[]
  addMessage: (msg: string) => void
}

/**
 * @param on  useWebSocket 的 on（订阅）
 * @param off useWebSocket 的 off（取消订阅）
 * @param onLibraryRefresh 扫描完成/媒体库变更后刷新媒体库列表的回调
 */
export function useScanProgress(
  on: (event: WSEventType, handler: (data: any) => void) => void,
  off: (event: WSEventType, handler: (data: any) => void) => void,
  onLibraryRefresh?: () => void
): ScanProgressController {
  const persistedScanStateRef = useRef<PersistedScanState>(loadPersistedScanState())

  const [scanning, setScanning] = useState<Set<string>>(() => new Set(persistedScanStateRef.current.scanningIds))
  const [scanProgress, setScanProgress] = useState<Record<string, ScanProgressData>>(() => persistedScanStateRef.current.scanProgress)
  const [scrapeProgress, setScrapeProgress] = useState<Record<string, ScrapeProgressData>>(() => persistedScanStateRef.current.scrapeProgress)
  const [transcodeProgress, setTranscodeProgress] = useState<Record<string, TranscodeProgressData>>({})
  const [scanPhase, setScanPhase] = useState<Record<string, ScanPhaseData>>(() => persistedScanStateRef.current.scanPhase)
  const [realtimeMessages, setRealtimeMessages] = useState<string[]>([])

  // 用 ref 持有回调，避免 WS 订阅因回调引用变化而反复重建
  const onLibraryRefreshRef = useRef(onLibraryRefresh)
  useEffect(() => { onLibraryRefreshRef.current = onLibraryRefresh }, [onLibraryRefresh])

  // 添加实时消息（保留最近20条）
  const addMessage = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setRealtimeMessages((prev) => [`[${time}] ${msg}`, ...prev].slice(0, 20))
  }, [])

  // 持久化进行中的扫描状态
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (scanning.size === 0 && Object.keys(scanProgress).length === 0 && Object.keys(scrapeProgress).length === 0 && Object.keys(scanPhase).length === 0) {
      window.localStorage.removeItem(SCAN_PROGRESS_STORAGE_KEY)
      return
    }
    const payload: PersistedScanState = {
      scanningIds: Array.from(scanning),
      scanProgress,
      scrapeProgress,
      scanPhase,
      updatedAt: Date.now(),
    }
    window.localStorage.setItem(SCAN_PROGRESS_STORAGE_KEY, JSON.stringify(payload))
  }, [scanning, scanProgress, scrapeProgress, scanPhase])

  // ==================== WebSocket 事件监听 ====================
  useEffect(() => {
    const handleScanStarted = (data: ScanProgressData) => {
      setScanning((s) => new Set(s).add(data.library_id))
      setScanProgress((prev) => ({ ...prev, [data.library_id]: data }))
      addMessage(`📂 ${data.message}`)
    }
    const handleScanProgress = (data: ScanProgressData) => {
      setScanProgress((prev) => ({ ...prev, [data.library_id]: data }))
    }
    const handleScanCompleted = (data: ScanProgressData) => {
      setScanning((s) => { const ns = new Set(s); ns.delete(data.library_id); return ns })
      setScanProgress((prev) => removeKey(prev, data.library_id))
      setScrapeProgress((prev) => removeKey(prev, data.library_id))
      setScanPhase((prev) => removeKey(prev, data.library_id))
      addMessage(`✅ ${data.message}`)
      onLibraryRefreshRef.current?.()
    }
    const handleScanFailed = (data: ScanProgressData) => {
      setScanning((s) => { const ns = new Set(s); ns.delete(data.library_id); return ns })
      setScanProgress((prev) => removeKey(prev, data.library_id))
      setScrapeProgress((prev) => removeKey(prev, data.library_id))
      setScanPhase((prev) => removeKey(prev, data.library_id))
      addMessage(`❌ ${data.message}`)
    }

    const handleScrapeStarted = (data: ScrapeProgressData) => {
      setScrapeProgress((prev) => ({ ...prev, [scrapeKey(data)]: data }))
      addMessage(`🎨 ${data.message}`)
    }
    const handleScrapeProgress = (data: ScrapeProgressData) => {
      setScrapeProgress((prev) => ({ ...prev, [scrapeKey(data)]: data }))
    }
    const handleScrapeCompleted = (data: ScrapeProgressData) => {
      setScrapeProgress((prev) => ({ ...prev, [scrapeKey(data)]: data }))
      addMessage(`✨ ${data.message}`)
    }

    const handleTranscodeStarted = (data: TranscodeProgressData) => {
      setTranscodeProgress((prev) => ({ ...prev, [data.task_id]: data }))
      addMessage(`🎥 ${data.message}`)
    }
    const handleTranscodeProgress = (data: TranscodeProgressData) => {
      setTranscodeProgress((prev) => ({ ...prev, [data.task_id]: data }))
    }
    const handleTranscodeCompleted = (data: TranscodeProgressData) => {
      setTranscodeProgress((prev) => removeKey(prev, data.task_id))
      addMessage(`✅ ${data.message}`)
    }
    const handleTranscodeFailed = (data: TranscodeProgressData) => {
      setTranscodeProgress((prev) => removeKey(prev, data.task_id))
      addMessage(`❌ ${data.message}`)
    }

    const handleScanPhase = (data: ScanPhaseData) => {
      if (data.phase === 'completed') {
        setScanPhase((prev) => removeKey(prev, data.library_id))
        setScanning((s) => { const ns = new Set(s); ns.delete(data.library_id); return ns })
        addMessage(`✨ ${data.message}`)
        onLibraryRefreshRef.current?.()
      } else {
        setScanPhase((prev) => ({ ...prev, [data.library_id]: data }))
        addMessage(`📦 ${data.message}`)
      }
    }

    on(WS_EVENTS.SCAN_STARTED, handleScanStarted)
    on(WS_EVENTS.SCAN_PROGRESS, handleScanProgress)
    on(WS_EVENTS.SCAN_COMPLETED, handleScanCompleted)
    on(WS_EVENTS.SCAN_FAILED, handleScanFailed)
    on(WS_EVENTS.SCRAPE_STARTED, handleScrapeStarted)
    on(WS_EVENTS.SCRAPE_PROGRESS, handleScrapeProgress)
    on(WS_EVENTS.SCRAPE_COMPLETED, handleScrapeCompleted)
    on(WS_EVENTS.TRANSCODE_STARTED, handleTranscodeStarted)
    on(WS_EVENTS.TRANSCODE_PROGRESS, handleTranscodeProgress)
    on(WS_EVENTS.TRANSCODE_COMPLETED, handleTranscodeCompleted)
    on(WS_EVENTS.TRANSCODE_FAILED, handleTranscodeFailed)
    on(WS_EVENTS.SCAN_PHASE, handleScanPhase)

    return () => {
      off(WS_EVENTS.SCAN_STARTED, handleScanStarted)
      off(WS_EVENTS.SCAN_PROGRESS, handleScanProgress)
      off(WS_EVENTS.SCAN_COMPLETED, handleScanCompleted)
      off(WS_EVENTS.SCAN_FAILED, handleScanFailed)
      off(WS_EVENTS.SCRAPE_STARTED, handleScrapeStarted)
      off(WS_EVENTS.SCRAPE_PROGRESS, handleScrapeProgress)
      off(WS_EVENTS.SCRAPE_COMPLETED, handleScrapeCompleted)
      off(WS_EVENTS.TRANSCODE_STARTED, handleTranscodeStarted)
      off(WS_EVENTS.TRANSCODE_PROGRESS, handleTranscodeProgress)
      off(WS_EVENTS.TRANSCODE_COMPLETED, handleTranscodeCompleted)
      off(WS_EVENTS.TRANSCODE_FAILED, handleTranscodeFailed)
      off(WS_EVENTS.SCAN_PHASE, handleScanPhase)
    }
  }, [on, off, addMessage])

  // 挂载时同步服务端进行中的扫描任务
  useEffect(() => {
    let cancelled = false
    libraryApi.scanStatus()
      .then((res) => {
        if (cancelled) return
        const activeScanPhases = res.data.data || []
        if (activeScanPhases.length > 0) {
          const activeIds = new Set(activeScanPhases.map((p) => p.library_id))
          setScanning(activeIds)
          setScanPhase(Object.fromEntries(activeScanPhases.map((p) => [p.library_id, p])))
          setScanProgress((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => activeIds.has(id))))
          setScrapeProgress((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => activeIds.has(id))))
        } else {
          setScanning(new Set())
          setScanPhase({})
          setScanProgress({})
          setScrapeProgress({})
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return {
    scanning,
    setScanning,
    scanProgress,
    scrapeProgress,
    transcodeProgress,
    scanPhase,
    realtimeMessages,
    addMessage,
  }
}
