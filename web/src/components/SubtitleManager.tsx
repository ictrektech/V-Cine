import { useState, useEffect, useCallback } from 'react'
import { subtitleApi } from '@/api'
import { useWebSocket, WS_EVENTS } from '@/hooks/useWebSocket'
import type { SubtitleInfo, ExtractedSubtitleFile, SubExtractProgressData } from '@/types'
import { useTranslation } from '@/i18n'

interface SubtitleManagerProps {
  mediaId: string
  mediaTitle?: string
  onClose: () => void
}

export default function SubtitleManager({ mediaId, mediaTitle, onClose }: SubtitleManagerProps) {
  const { t } = useTranslation()
  // 字幕数据
  const [subtitleInfo, setSubtitleInfo] = useState<SubtitleInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 提取状态
  const [extracting, setExtracting] = useState(false)
  const [extractFormat, setExtractFormat] = useState<'srt' | 'vtt'>('srt')
  const [selectedTracks, setSelectedTracks] = useState<Set<number>>(new Set())
  const [extractResults, setExtractResults] = useState<ExtractedSubtitleFile[]>([])

  // 异步提取进度（P2）
  const [asyncProgress, setAsyncProgress] = useState<SubExtractProgressData | null>(null)
  const [useAsync, setUseAsync] = useState(false)

  const { on, off } = useWebSocket()

  // 加载字幕轨道信息
  const loadSubtitleInfo = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await subtitleApi.getTracks(mediaId)
      setSubtitleInfo(res.data.data)
    } catch (e: any) {
      setError(e.response?.data?.error || t('sm.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [mediaId])

  useEffect(() => {
    loadSubtitleInfo()
  }, [loadSubtitleInfo])

  // 监听异步提取进度（P2）
  useEffect(() => {
    const handleProgress = (data: SubExtractProgressData) => {
      if (data.media_id === mediaId) {
        setAsyncProgress(data)
      }
    }
    const handleCompleted = (data: SubExtractProgressData) => {
      if (data.media_id === mediaId) {
        setAsyncProgress(data)
        setExtracting(false)
        if (data.results) {
          setExtractResults(data.results)
        }
      }
    }
    const handleFailed = (data: SubExtractProgressData) => {
      if (data.media_id === mediaId) {
        setAsyncProgress(data)
        setExtracting(false)
      }
    }

    on(WS_EVENTS.SUB_EXTRACT_STARTED as any, handleProgress)
    on(WS_EVENTS.SUB_EXTRACT_PROGRESS as any, handleProgress)
    on(WS_EVENTS.SUB_EXTRACT_COMPLETED as any, handleCompleted)
    on(WS_EVENTS.SUB_EXTRACT_FAILED as any, handleFailed)

    return () => {
      off(WS_EVENTS.SUB_EXTRACT_STARTED as any, handleProgress)
      off(WS_EVENTS.SUB_EXTRACT_PROGRESS as any, handleProgress)
      off(WS_EVENTS.SUB_EXTRACT_COMPLETED as any, handleCompleted)
      off(WS_EVENTS.SUB_EXTRACT_FAILED as any, handleFailed)
    }
  }, [mediaId, on, off])

  // 切换轨道选择
  const toggleTrack = (index: number) => {
    setSelectedTracks(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  // 全选/取消全选文本字幕
  const toggleSelectAll = () => {
    if (!subtitleInfo) return
    const textTracks = subtitleInfo.embedded.filter(t => !t.bitmap)
    if (selectedTracks.size === textTracks.length) {
      setSelectedTracks(new Set())
    } else {
      setSelectedTracks(new Set(textTracks.map(t => t.index)))
    }
  }

  // P0: 同步批量提取
  const handleExtractSync = async () => {
    setExtracting(true)
    setExtractResults([])
    setAsyncProgress(null)
    try {
      const tracks = selectedTracks.size > 0 ? Array.from(selectedTracks) : undefined
      const res = await subtitleApi.extractAll(mediaId, extractFormat, tracks)
      setExtractResults(res.data.data.files)
    } catch (e: any) {
      setError(e.response?.data?.error || t('sm.batchFailed'))
    } finally {
      setExtracting(false)
    }
  }

  // P2: 异步批量提取
  const handleExtractAsync = async () => {
    setExtracting(true)
    setExtractResults([])
    setAsyncProgress(null)
    try {
      const tracks = selectedTracks.size > 0 ? Array.from(selectedTracks) : undefined
      await subtitleApi.extractAllAsync(mediaId, mediaTitle, extractFormat, tracks)
    } catch (e: any) {
      setError(e.response?.data?.error || t('sm.asyncFailed'))
      setExtracting(false)
    }
  }

  // 下载字幕文件
  const handleDownload = async (filePath: string) => {
    const url = await subtitleApi.getDownloadUrl(filePath)
    window.open(url, '_blank')
  }

  // 获取语言显示名
  const getLanguageLabelKey = (lang: string) => {
    const langMap: Record<string, string> = {
      chi: 'sm.langChi', zho: 'sm.langZho', chs: 'sm.langChs', cht: 'sm.langCht',
      eng: 'sm.langEng', jpn: 'sm.langJpn', kor: 'sm.langKor', fra: 'sm.langFra',
      deu: 'sm.langDeu', spa: 'sm.langSpa', ita: 'sm.langIta', por: 'sm.langPor',
      rus: 'sm.langRus', ara: 'sm.langAra', tha: 'sm.langTha', vie: 'sm.langVie',
      und: 'sm.langUnd', '': 'sm.langUnd',
    }
    return langMap[lang] || lang
  }

  // 获取编解码器显示名
  const getCodecLabel = (codec: string) => {
    const codecMap: Record<string, string> = {
      subrip: 'SRT', ass: 'ASS', ssa: 'SSA', webvtt: 'WebVTT',
      mov_text: 'MP4 Text', hdmv_pgs_subtitle: 'PGS', dvd_subtitle: 'VobSub',
      dvb_subtitle: 'DVB',
    }
    return codecMap[codec] || codec.toUpperCase()
  }

  const embeddedTracks = subtitleInfo?.embedded || []
  const externalSubs = subtitleInfo?.external || []
  const textTracks = embeddedTracks.filter(t => !t.bitmap)
  const bitmapTracks = embeddedTracks.filter(t => t.bitmap)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div
        className="relative w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl shadow-2xl flex flex-col"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--glass-border)' }}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              {t('sm.title')}
            </h2>
            {mediaTitle && (
              <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>{mediaTitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-white/10"
            style={{ color: 'var(--text-secondary)' }}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {loading ? (
            <div className="space-y-5 animate-fade-in">
              {/* 内嵌字幕区骨架 */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <div className="skeleton h-4 w-36 rounded" />
                  <div className="skeleton h-6 w-14 rounded-lg" />
                </div>
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}>
                      <div className="skeleton h-4 w-4 rounded" />
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="skeleton h-4 w-16 rounded" />
                          <div className="skeleton h-4 w-10 rounded" />
                        </div>
                        <div className="skeleton h-3 w-24 rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              {/* 外挂字幕区骨架 */}
              <section>
                <div className="skeleton h-4 w-32 rounded mb-3" />
                <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}>
                  <div className="skeleton mx-auto h-3 w-32 rounded" />
                </div>
              </section>
            </div>
          ) : error && !subtitleInfo ? (
            <div className="rounded-xl p-4 text-center text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
              {error}
            </div>
          ) : (
            <>
              {/* ==================== 内嵌文本字幕 ==================== */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {t('sm.embeddedText', { count: textTracks.length })}
                  </h3>
                  {textTracks.length > 0 && (
                    <button
                      onClick={toggleSelectAll}
                      className="text-xs px-3 py-1 rounded-lg transition-colors"
                      style={{ color: 'var(--neon-blue)', background: 'var(--neon-blue-6)' }}
                    >
                      {selectedTracks.size === textTracks.length ? t('sm.deselectAll') : t('sm.selectAll')}
                    </button>
                  )}
                </div>

                {textTracks.length === 0 ? (
                  <div className="rounded-xl p-4 text-center text-xs" style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
                    {t('sm.noTextTracks')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {textTracks.map(track => (
                      <label
                        key={track.index}
                        className="flex items-center gap-3 rounded-xl px-4 py-3 cursor-pointer transition-all"
                        style={{
                          background: selectedTracks.has(track.index) ? 'var(--neon-blue-6)' : 'var(--bg-surface)',
                          border: `1px solid ${selectedTracks.has(track.index) ? 'var(--neon-blue)' : 'var(--border-default)'}`,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedTracks.has(track.index)}
                          onChange={() => toggleTrack(track.index)}
                          className="h-4 w-4 rounded accent-blue-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                              {t('sm.trackN', { n: track.index })}
                            </span>
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-mono" style={{ background: 'var(--neon-blue-6)', color: 'var(--neon-blue)' }}>
                              {getCodecLabel(track.codec)}
                            </span>
                            {track.default && (
                              <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                                {t('sm.default')}
                              </span>
                            )}
                            {track.forced && (
                              <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'rgba(234,179,8,0.15)', color: '#eab308' }}>
                                {t('sm.forced')}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                            {t(getLanguageLabelKey(track.language))}
                            {track.title && ` · ${track.title}`}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </section>

              {/* ==================== 内嵌图形字幕 ==================== */}
              {bitmapTracks.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                    {t('sm.embeddedBitmap', { count: bitmapTracks.length })}
                  </h3>
                  <div className="space-y-2">
                    {bitmapTracks.map(track => (
                      <div
                        key={track.index}
                        className="flex items-center gap-3 rounded-xl px-4 py-3"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', opacity: 0.7 }}
                      >
                        <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--text-muted)' }}>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                              {t('sm.trackN', { n: track.index })}
                            </span>
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-mono" style={{ background: 'rgba(234,179,8,0.1)', color: '#eab308' }}>
                              {getCodecLabel(track.codec)}
                            </span>
                          </div>
                          <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                            {t('sm.bitmapOcr', { lang: t(getLanguageLabelKey(track.language)) })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ==================== 外挂字幕 ==================== */}
              <section>
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                  {t('sm.external', { count: externalSubs.length })}
                </h3>
                {externalSubs.length === 0 ? (
                  <div className="rounded-xl p-4 text-center text-xs" style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
                    {t('sm.noExternal')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {externalSubs.map((sub, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 rounded-xl px-4 py-3"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
                      >
                        <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--neon-blue)' }}>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                            {sub.filename}
                          </div>
                          <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                            {sub.format.toUpperCase()} · {t(getLanguageLabelKey(sub.language))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ==================== 提取操作区 ==================== */}
              {textTracks.length > 0 && (
                <section className="rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}>
                  <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                    {t('sm.batchExtract')}
                  </h3>

                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    {/* 输出格式选择 */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('sm.outputFormat')}</span>
                      <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-default)' }}>
                        {(['srt', 'vtt'] as const).map(fmt => (
                          <button
                            key={fmt}
                            onClick={() => setExtractFormat(fmt)}
                            className="px-3 py-1.5 text-xs font-medium transition-all"
                            style={{
                              background: extractFormat === fmt ? 'var(--neon-blue)' : 'transparent',
                              color: extractFormat === fmt ? '#fff' : 'var(--text-secondary)',
                            }}
                          >
                            {fmt.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 异步模式开关 */}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useAsync}
                        onChange={e => setUseAsync(e.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-blue-500"
                      />
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {t('sm.asyncMode')}
                      </span>
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={useAsync ? handleExtractAsync : handleExtractSync}
                      disabled={extracting}
                      className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
                      style={{ background: 'var(--neon-blue)' }}
                    >
                      {extracting ? (
                        <span className="flex items-center gap-2">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          {t('sm.extracting')}
                        </span>
                      ) : (
                        <>
                          {selectedTracks.size > 0
                            ? t('sm.extractSelected', { count: selectedTracks.size })
                            : t('sm.extractAll', { count: textTracks.length })
                          }
                        </>
                      )}
                    </button>
                  </div>

                  {/* 异步进度条（P2） */}
                  {asyncProgress && extracting && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {asyncProgress.message}
                        </span>
                        <span className="text-xs font-mono" style={{ color: 'var(--neon-blue)' }}>
                          {asyncProgress.progress.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-base)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${asyncProgress.progress}%`,
                            background: 'var(--neon-blue)',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* ==================== 提取结果 ==================== */}
              {extractResults.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                    {t('sm.results')}
                  </h3>
                  <div className="space-y-2">
                    {extractResults.map((result, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 rounded-xl px-4 py-3"
                        style={{
                          background: result.error ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.05)',
                          border: `1px solid ${result.error ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}`,
                        }}
                      >
                        {result.error ? (
                          <span className="text-red-400 text-sm">✗</span>
                        ) : (
                          <span className="text-green-400 text-sm">✓</span>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                              {t('sm.trackN', { n: result.track_index })}
                            </span>
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              {t(getLanguageLabelKey(result.language))} · {getCodecLabel(result.codec)}
                            </span>
                          </div>
                          {result.error && (
                            <div className="mt-0.5 text-xs text-red-400">{result.error}</div>
                          )}
                        </div>
                        {result.path && !result.error && (
                          <button
                            onClick={() => handleDownload(result.path)}
                            className="rounded-lg px-3 py-1.5 text-xs font-medium transition-all hover:opacity-80"
                            style={{ background: 'var(--neon-blue-6)', color: 'var(--neon-blue)' }}
                          >
                            {t('sm.download', { format: result.format })}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* 错误提示 */}
              {error && subtitleInfo && (
                <div className="rounded-xl p-3 text-center text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-t" style={{ borderColor: 'var(--border-default)' }}>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {subtitleInfo && (
              <>
                {t('sm.summary', { embedded: embeddedTracks.length, external: externalSubs.length })}
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadSubtitleInfo}
              className="rounded-xl px-4 py-2 text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: 'var(--text-secondary)', background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
            >
              {t('common.refresh')}
            </button>
            <button
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: 'var(--text-secondary)', background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
