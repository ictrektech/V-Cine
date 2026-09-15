import { useState, useRef } from 'react'
import { importExportApi } from '@/api'
import type { ImportSource, ImportResult, EmbyLibrary, ExportData } from '@/types'
import {
  Download, Upload, Server, TestTube, Loader2, CheckCircle,
  AlertCircle, FileJson, X, ArrowRight, FolderOpen,
} from 'lucide-react'
import clsx from 'clsx'
import EmbyImportPanel from './EmbyImportPanel'

interface ImportExportPanelProps {
  libraries: { id: string; name: string }[]
  onClose: () => void
}

type Tab = 'import' | 'export'

export default function ImportExportPanel({ libraries, onClose }: ImportExportPanelProps) {
  const [tab, setTab] = useState<Tab>('import')
  const [source, setSource] = useState<ImportSource>({
    type: 'emby',
    server_url: '',
    api_key: '',
  })
  const [connected, setConnected] = useState(false)
  const [testing, setTesting] = useState(false)
  const [remoteLibraries, setRemoteLibraries] = useState<EmbyLibrary[]>([])
  const [selectedRemoteLib, setSelectedRemoteLib] = useState('')
  const [targetLibraryId, setTargetLibraryId] = useState(libraries[0]?.id || '')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportLibraryId, setExportLibraryId] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showEmbyImport, setShowEmbyImport] = useState(false)

  const handleTestConnection = async () => {
    setTesting(true)
    setMessage(null)
    try {
      await importExportApi.testConnection(source)
      // 获取媒体库列表
      const res = await importExportApi.fetchLibraries(source)
      setRemoteLibraries(res.data.data || [])
      setConnected(true)
      setMessage({ type: 'success', text: '连接成功！' })
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || '连接失败' })
      setConnected(false)
    } finally {
      setTesting(false)
      setTimeout(() => setMessage(null), 3000)
    }
  }

  const handleImport = async () => {
    if (!selectedRemoteLib || !targetLibraryId) return
    setImporting(true)
    try {
      const res = await importExportApi.importFromExternal({
        source,
        library_id: selectedRemoteLib,
        target_library_id: targetLibraryId,
      })
      setImportResult(res.data.data)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || '导入失败' })
    } finally {
      setImporting(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await importExportApi.exportLibrary(exportLibraryId || undefined)
      const data = res.data.data
      // 下载为 JSON 文件
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `v-cine-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setMessage({ type: 'success', text: '导出成功！' })
    } catch {
      setMessage({ type: 'error', text: '导出失败' })
    } finally {
      setExporting(false)
      setTimeout(() => setMessage(null), 3000)
    }
  }

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const data: ExportData = JSON.parse(text)
      setImporting(true)
      const res = await importExportApi.importFromData({
        data,
        target_library_id: targetLibraryId,
      })
      setImportResult(res.data.data)
    } catch {
      setMessage({ type: 'error', text: '文件解析或导入失败' })
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl p-6" style={{
        background: 'var(--glass-bg)',
        border: '1px solid var(--neon-blue-15)',
        backdropFilter: 'blur(20px)',
      }}>
        {/* 标题 */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-display text-lg font-semibold text-white">媒体库导入 / 导出</h3>
          <button onClick={onClose} className="text-surface-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 消息提示 */}
        {message && (
          <div className={clsx(
            'rounded-xl px-4 py-2 text-sm font-medium mb-4',
            message.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
          )}>
            {message.text}
          </div>
        )}

        {/* Tab 切换 */}
        <div className="flex gap-1 rounded-xl bg-surface-800/50 p-1 mb-6">
          {[
            { key: 'import' as Tab, label: '导入', icon: Upload },
            { key: 'export' as Tab, label: '导出', icon: Download },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all',
                tab === key ? 'bg-neon-blue/20 text-neon-blue' : 'text-surface-400 hover:text-white'
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {tab === 'import' ? (
          <div className="space-y-4">
            {importResult ? (
              /* 导入结果 */
              <div className="space-y-4">
                <div className={clsx(
                  'rounded-xl p-6 text-center',
                  importResult.failed === 0 ? 'bg-green-500/10 border border-green-500/20' : 'bg-yellow-500/10 border border-yellow-500/20'
                )}>
                  {importResult.failed === 0 ? (
                    <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-3" />
                  ) : (
                    <AlertCircle className="h-12 w-12 text-yellow-400 mx-auto mb-3" />
                  )}
                  <p className="text-white font-medium text-lg">导入完成</p>
                  <div className="flex justify-center gap-6 mt-3 text-sm">
                    <span className="text-surface-400">总计 <span className="text-white font-medium">{importResult.total}</span></span>
                    <span className="text-green-400">导入 <span className="font-medium">{importResult.imported}</span></span>
                    <span className="text-yellow-400">跳过 <span className="font-medium">{importResult.skipped}</span></span>
                    <span className="text-red-400">失败 <span className="font-medium">{importResult.failed}</span></span>
                  </div>
                </div>
                <button onClick={onClose} className="btn-neon w-full rounded-xl py-2.5 text-sm font-medium">
                  关闭
                </button>
              </div>
            ) : (
              <>
                {/* 从 EMBY 本地文件夹导入 */}
                <div className="card-glass rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <FolderOpen className="h-4 w-4 text-green-400" />
                    <h4 className="text-sm font-medium text-white">从 EMBY 本地文件夹导入</h4>
                  </div>
                  <p className="text-xs text-surface-400 mb-3">
                    自动识别 EMBY/Jellyfin 标准文件夹结构，解析 NFO 元数据、海报和字幕文件。
                  </p>
                  <button onClick={() => setShowEmbyImport(true)}
                    className="btn-ghost w-full rounded-lg py-2.5 text-sm flex items-center justify-center gap-2">
                    <FolderOpen className="h-4 w-4" />
                    打开 EMBY 格式导入
                  </button>
                </div>

                {/* 从外部服务器导入 */}
                <div className="card-glass rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Server className="h-4 w-4 text-neon-purple" />
                    <h4 className="text-sm font-medium text-white">从 Emby / Jellyfin 导入</h4>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-surface-400">服务器类型</label>
                      <select value={source.type}
                        onChange={e => { setSource(prev => ({ ...prev, type: e.target.value as any })); setConnected(false) }}
                        className="input-glass mt-1 w-full rounded-lg px-3 py-2 text-sm">
                        <option value="emby">Emby</option>
                        <option value="jellyfin">Jellyfin</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-surface-400">服务器地址</label>
                      <input type="url" value={source.server_url}
                        onChange={e => { setSource(prev => ({ ...prev, server_url: e.target.value })); setConnected(false) }}
                        placeholder="http://192.168.1.100:8096"
                        className="input-glass mt-1 w-full rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-surface-400">API Key</label>
                      <input type="password" value={source.api_key}
                        onChange={e => { setSource(prev => ({ ...prev, api_key: e.target.value })); setConnected(false) }}
                        className="input-glass mt-1 w-full rounded-lg px-3 py-2 text-sm" />
                    </div>
                  </div>
                  <button onClick={handleTestConnection} disabled={testing || !source.server_url || !source.api_key}
                    className="btn-ghost mt-3 rounded-lg px-4 py-2 text-sm flex items-center gap-2">
                    {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube className="h-4 w-4" />}
                    测试连接
                  </button>

                  {connected && remoteLibraries.length > 0 && (
                    <div className="mt-4 space-y-3 border-t border-white/5 pt-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <label className="text-xs text-surface-400">源媒体库</label>
                          <select value={selectedRemoteLib}
                            onChange={e => setSelectedRemoteLib(e.target.value)}
                            className="input-glass mt-1 w-full rounded-lg px-3 py-2 text-sm">
                            <option value="">选择媒体库...</option>
                            {remoteLibraries.map(lib => (
                              <option key={lib.Id} value={lib.Id}>{lib.Name} ({lib.CollectionType})</option>
                            ))}
                          </select>
                        </div>
                        <ArrowRight className="h-4 w-4 text-surface-500 mt-5" />
                        <div className="flex-1">
                          <label className="text-xs text-surface-400">目标媒体库</label>
                          <select value={targetLibraryId}
                            onChange={e => setTargetLibraryId(e.target.value)}
                            className="input-glass mt-1 w-full rounded-lg px-3 py-2 text-sm">
                            {libraries.map(lib => (
                              <option key={lib.id} value={lib.id}>{lib.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <button onClick={handleImport} disabled={importing || !selectedRemoteLib}
                        className="btn-neon w-full rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-2">
                        {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        开始导入
                      </button>
                    </div>
                  )}
                </div>

                {/* 从文件导入 */}
                <div className="card-glass rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <FileJson className="h-4 w-4 text-neon-blue" />
                    <h4 className="text-sm font-medium text-white">从导出文件导入</h4>
                  </div>
                  <div className="flex items-center gap-3">
                    <select value={targetLibraryId}
                      onChange={e => setTargetLibraryId(e.target.value)}
                      className="input-glass rounded-lg px-3 py-2 text-sm">
                      {libraries.map(lib => (
                        <option key={lib.id} value={lib.id}>{lib.name}</option>
                      ))}
                    </select>
                    <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileImport} className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()} disabled={importing}
                      className="btn-ghost flex-1 rounded-lg py-2 text-sm flex items-center justify-center gap-2">
                      {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      选择 JSON 文件
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          /* 导出 */
          <div className="space-y-4">
            <div className="card-glass rounded-xl p-4">
              <p className="text-sm text-surface-400 mb-3">将媒体库数据导出为 JSON 文件，可用于备份或迁移到其他系统。</p>
              <div className="flex items-center gap-3">
                <select value={exportLibraryId}
                  onChange={e => setExportLibraryId(e.target.value)}
                  className="input-glass flex-1 rounded-lg px-3 py-2 text-sm">
                  <option value="">全部媒体库</option>
                  {libraries.map(lib => (
                    <option key={lib.id} value={lib.id}>{lib.name}</option>
                  ))}
                </select>
                <button onClick={handleExport} disabled={exporting}
                  className="btn-neon rounded-xl px-6 py-2.5 text-sm font-medium flex items-center gap-2">
                  {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  导出
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>

    {/* EMBY 格式导入面板 */}
    {showEmbyImport && (
      <EmbyImportPanel
        libraries={libraries}
        onClose={() => setShowEmbyImport(false)}
      />
    )}
    </>
  )
}
