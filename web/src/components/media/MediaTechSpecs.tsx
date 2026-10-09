import { useState, useCallback } from 'react'
import { formatSize, formatDuration, formatDate } from '@/utils/format'
import type { Media, TechSpecs, FileDetail, LibraryInfo, PlaybackStatsInfo, StreamDetail } from '@/types'
import {
  Monitor,
  Music,
  Subtitles,
  HardDrive,
  ChevronDown,
  ChevronUp,
  Cpu,
  Layers,
  BarChart3,
  Users,
  Clock,
  Play,
  FolderOpen,
  FileJson,
  FileCode,
  Shield,
  User,
  Hash,
  Info,
  Copy,
  Check,
  FileText,
  HelpCircle,
} from 'lucide-react'
import { t as i18n } from '@/i18n'
import { useTranslation } from '@/i18n'

// ==================== 工具函数 ====================

/** 格式化码率为可读格式 */
function formatBitRate(bitRate?: string): string {
  if (!bitRate) return '-'
  const num = parseInt(bitRate)
  if (isNaN(num)) return bitRate
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)} Mbps`
  if (num >= 1000) return `${(num / 1000).toFixed(0)} Kbps`
  return `${num} bps`
}

/** 格式化采样率 */
function formatSampleRate(rate?: string): string {
  if (!rate) return '-'
  const num = parseInt(rate)
  if (isNaN(num)) return rate
  return `${num} Hz`
}

/** 格式化声道数 */
function formatChannels(channels?: number, layout?: string): string {
  if (layout) {
    const layoutMap: Record<string, string> = {
      'mono': i18n('tech.chMono'),
      'stereo': i18n('tech.chStereo'),
      '5.1': i18n('tech.ch51'),
      '5.1(side)': i18n('tech.ch51'),
      '7.1': i18n('tech.ch71'),
      '7.1(wide)': i18n('tech.ch71'),
    }
    return layoutMap[layout] || layout
  }
  if (!channels) return '-'
  if (channels === 1) return i18n('tech.chMono')
  if (channels === 2) return i18n('tech.chStereo')
  if (channels === 6) return i18n('tech.ch51')
  if (channels === 8) return i18n('tech.ch71')
  return i18n('tech.chCount', { count: channels })
}

/** 格式化编码器名称 */
function formatCodecName(name: string, longName?: string): string {
  const codecMap: Record<string, string> = {
    'h264': 'H.264 / AVC',
    'hevc': 'H.265 / HEVC',
    'h265': 'H.265 / HEVC',
    'vp9': 'VP9',
    'av1': 'AV1',
    'mpeg4': 'MPEG-4',
    'aac': 'AAC',
    'ac3': 'AC-3 / Dolby Digital',
    'eac3': 'E-AC-3 / Dolby Digital Plus',
    'dts': 'DTS',
    'flac': 'FLAC',
    'opus': 'Opus',
    'vorbis': 'Vorbis',
    'mp3': 'MP3',
    'truehd': 'Dolby TrueHD',
    'pcm_s16le': 'PCM 16-bit',
    'pcm_s24le': 'PCM 24-bit',
    'srt': 'SRT',
    'ass': 'ASS/SSA',
    'subrip': 'SRT',
    'hdmv_pgs_subtitle': i18n('tech.pgsBluray'),
    'dvd_subtitle': 'VobSub',
    'webvtt': 'WebVTT',
    'mov_text': 'MOV Text',
  }
  return codecMap[name] || longName || name.toUpperCase()
}

/** 格式化容器格式名称 */
function formatContainerName(name: string): string {
  const containerMap: Record<string, string> = {
    'matroska,webm': 'Matroska (MKV)',
    'mov,mp4,m4a,3gp,3g2,mj2': 'MP4 / MOV',
    'avi': 'AVI',
    'mpegts': 'MPEG-TS',
    'flv': 'FLV',
    'ogg': 'OGG',
    'webm': 'WebM',
  }
  return containerMap[name] || name
}

/** 格式化语言代码 */
function formatLanguage(lang?: string): string {
  if (!lang || lang === 'und') return i18n('tech.langUnknown')
  const langMap: Record<string, string> = {
    'chi': i18n('tech.langZh'), 'zho': i18n('tech.langZh'), 'zh': i18n('tech.langZh'),
    'eng': i18n('tech.langEn'), 'en': i18n('tech.langEn'),
    'jpn': i18n('tech.langJa'), 'ja': i18n('tech.langJa'),
    'kor': i18n('tech.langKo'), 'ko': i18n('tech.langKo'),
    'fre': i18n('tech.langFr'), 'fra': i18n('tech.langFr'), 'fr': i18n('tech.langFr'),
    'ger': i18n('tech.langDe'), 'deu': i18n('tech.langDe'), 'de': i18n('tech.langDe'),
    'spa': i18n('tech.langEs'), 'es': i18n('tech.langEs'),
    'ita': i18n('tech.langIt'), 'it': i18n('tech.langIt'),
    'por': i18n('tech.langPt'), 'pt': i18n('tech.langPt'),
    'rus': i18n('tech.langRu'), 'ru': i18n('tech.langRu'),
    'tha': i18n('tech.langTh'), 'th': i18n('tech.langTh'),
    'vie': i18n('tech.langVi'), 'vi': i18n('tech.langVi'),
    'ara': i18n('tech.langAr'), 'ar': i18n('tech.langAr'),
  }
  return langMap[lang] || lang
}

/** 格式化像素格式 */
function formatPixFmt(fmt?: string): string {
  if (!fmt) return '-'
  const fmtMap: Record<string, string> = {
    'yuv420p': 'YUV 4:2:0 8-bit',
    'yuv420p10le': 'YUV 4:2:0 10-bit',
    'yuv420p10be': 'YUV 4:2:0 10-bit',
    'yuv422p': 'YUV 4:2:2 8-bit',
    'yuv444p': 'YUV 4:4:4 8-bit',
    'yuv444p10le': 'YUV 4:4:4 10-bit',
    'rgb24': 'RGB 24-bit',
    'nv12': 'NV12',
  }
  return fmtMap[fmt] || fmt
}

/** 判断是否为HDR */
function isHDR(stream: StreamDetail): boolean {
  const hdrTransfers = ['smpte2084', 'arib-std-b67', 'smpte428']
  const hdrSpaces = ['bt2020nc', 'bt2020c']
  return (
    (stream.color_transfer ? hdrTransfers.includes(stream.color_transfer) : false) ||
    (stream.color_space ? hdrSpaces.includes(stream.color_space) : false) ||
    (stream.pix_fmt?.includes('10') ?? false)
  )
}

/** 获取HDR类型标签 */
function getHDRLabel(stream: StreamDetail): string {
  if (stream.color_transfer === 'smpte2084') return 'HDR10'
  if (stream.color_transfer === 'arib-std-b67') return 'HLG'
  if (stream.color_space === 'bt2020nc' || stream.color_space === 'bt2020c') return 'HDR'
  return 'SDR'
}

/** 格式化色彩原色 */
function formatColorPrimaries(primaries?: string): string {
  if (!primaries) return '--'
  const map: Record<string, string> = {
    'bt709': 'BT.709',
    'bt2020': 'BT.2020',
    'smpte170m': 'SMPTE 170M',
    'smpte240m': 'SMPTE 240M',
    'bt470bg': 'BT.470 BG',
  }
  return map[primaries] || primaries
}



// ==================== 标签页定义 ====================
type TabKey = 'overview' | 'video' | 'audio' | 'file' | 'stats'

interface TabDef {
  key: TabKey
  label: string
  icon: React.ReactNode
  badge?: string | number
}

// ==================== 组件 Props ====================
interface MediaTechSpecsProps {
  media: Media
  techSpecs: TechSpecs | null
  fileInfo: FileDetail | null
  library: LibraryInfo | null
  playbackStats: PlaybackStatsInfo | null
  loading: boolean
  isAdmin: boolean
}

export default function MediaTechSpecs({ media, techSpecs, fileInfo, library, playbackStats, loading, isAdmin }: MediaTechSpecsProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [expanded, setExpanded] = useState(false)


  /** 导出技术规格为JSON */
  const exportJSON = useCallback(() => {
    const data = { techSpecs, fileInfo, library, playbackStats }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tech-specs-${fileInfo?.file_name || media.title || 'media'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [techSpecs, fileInfo, library, playbackStats, media.title])

  /** 导出技术规格为XML */
  const exportXML = useCallback(() => {
    const toXML = (obj: any, rootName: string): string => {
      const escape = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const convert = (o: any, name: string, indent: string): string => {
        if (o === null || o === undefined) return `${indent}<${name}/>\n`
        if (typeof o !== 'object') return `${indent}<${name}>${escape(String(o))}</${name}>\n`
        if (Array.isArray(o)) return o.map((item) => convert(item, name.replace(/s$/, ''), indent)).join('')
        let xml = `${indent}<${name}>\n`
        for (const [k, v] of Object.entries(o)) {
          xml += convert(v, k, indent + '  ')
        }
        xml += `${indent}</${name}>\n`
        return xml
      }
      return `<?xml version="1.0" encoding="UTF-8"?>\n${convert(obj, rootName, '')}`
    }
    const data = { techSpecs, fileInfo, library, playbackStats }
    const xml = toXML(data, 'MediaTechSpecs')
    const blob = new Blob([xml], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tech-specs-${fileInfo?.file_name || media.title || 'media'}.xml`
    a.click()
    URL.revokeObjectURL(url)
  }, [techSpecs, fileInfo, library, playbackStats, media.title])

  if (loading) {
    return (
      <section>
        <div className="flex items-center gap-2 mb-3">
          <div className="skeleton h-5 w-32 rounded-lg" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="skeleton h-24 rounded-xl" />
          ))}
        </div>
      </section>
    )
  }

  const videoStreams = techSpecs?.streams?.filter(s => s.codec_type === 'video') || []
  const audioStreams = techSpecs?.streams?.filter(s => s.codec_type === 'audio') || []
  const subtitleStreams = techSpecs?.streams?.filter(s => s.codec_type === 'subtitle') || []
  const mainVideo = videoStreams[0]
  const mainAudio = audioStreams[0]

  // 构建标签页列表
  const tabs: TabDef[] = [
    { key: 'overview', label: t('tech.tabOverview'), icon: <Cpu size={14} /> },
    { key: 'video', label: t('tech.tabVideo'), icon: <Monitor size={14} />, badge: videoStreams.length > 0 ? undefined : undefined },
    { key: 'audio', label: t('tech.tabAudio'), icon: <Music size={14} />, badge: audioStreams.length > 1 ? t('tech.trackCount', { count: audioStreams.length }) : undefined },
    { key: 'file', label: t('tech.tabFile'), icon: <Layers size={14} /> },
  ]
  // 仅管理员可见播放统计标签
  if (isAdmin && playbackStats && (playbackStats.total_play_count > 0 || playbackStats.unique_viewers > 0)) {
    tabs.push({ key: 'stats', label: t('tech.tabStats'), icon: <BarChart3 size={14} /> })
  }

  return (
    <section>
      {/* ==================== 标题栏（紧凑版） ==================== */}
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold tracking-wide" style={{ color: 'var(--text-primary)' }}>
          <Cpu size={14} className="text-neon/60" />
          {t('tech.title')}
        </h3>
        <div className="flex items-center gap-1.5">
          {/* 导出按钮 */}
          {isAdmin && (
            <div className="flex items-center gap-1">
              <button
                onClick={exportJSON}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:text-neon"
                style={{ color: 'var(--text-muted)', background: 'var(--nav-hover-bg)' }}
                title={t('tech.exportJson')}
              >
                <FileJson size={10} /> JSON
              </button>
              <button
                onClick={exportXML}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:text-neon"
                style={{ color: 'var(--text-muted)', background: 'var(--nav-hover-bg)' }}
                title={t('tech.exportXml')}
              >
                <FileCode size={10} /> XML
              </button>
            </div>
          )}
          {/* 展开/收起按钮（移到标题右侧，节省空间） */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition-all hover:text-neon"
            style={{ color: 'var(--text-muted)', background: 'var(--nav-hover-bg)' }}
            title={expanded ? t('tech.collapse') : t('tech.expandDetail')}
          >
            {expanded ? <><ChevronUp size={10} />{t('tech.collapse')}</> : <><ChevronDown size={10} />{t('tech.detail')}</>}
          </button>
        </div>
      </div>

      {/* ==================== 紧凑的四列概览条（一行展示） ==================== */}
      <div
        className="grid grid-cols-2 lg:grid-cols-4 rounded-lg overflow-hidden"
        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
      >
        {/* 视频概览 */}
        <div className="flex items-center gap-2 px-3 py-2 lg:border-r" style={{ borderColor: 'var(--border-default)' }}>
          <Monitor size={14} className="text-neon shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                {mainVideo
                  ? `${mainVideo.width && mainVideo.height ? `${mainVideo.height}p ` : ''}${formatCodecName(mainVideo.codec_name)}`
                  : (media.resolution || media.video_codec || '-')}
              </span>
              {mainVideo && isHDR(mainVideo) && (
                <span className="rounded px-1 py-px text-[9px] font-bold leading-none" style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#FBBF24' }}>{getHDRLabel(mainVideo)}</span>
              )}
              {mainVideo?.is_interlaced && (
                <span className="rounded px-1 py-px text-[9px] font-medium leading-none" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>i</span>
              )}
            </div>
            <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
              {mainVideo ? [
                mainVideo.width && mainVideo.height ? `${mainVideo.width}×${mainVideo.height}` : null,
                mainVideo.frame_rate ? `${parseFloat(mainVideo.frame_rate).toFixed(0)}fps` : null,
                mainVideo.bit_rate ? formatBitRate(mainVideo.bit_rate) : null,
              ].filter(Boolean).join(' · ') : t('tech.noVideoStream')}
            </div>
          </div>
        </div>

        {/* 音频概览 */}
        <div className="flex items-center gap-2 px-3 py-2 lg:border-r" style={{ borderColor: 'var(--border-default)' }}>
          <Music size={14} className="text-purple-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                {mainAudio
                  ? `${formatCodecName(mainAudio.codec_name)} ${formatChannels(mainAudio.channels, mainAudio.channel_layout)}`
                  : (media.audio_codec || '-')}
              </span>
              {audioStreams.length > 1 && (
                <span className="rounded px-1 py-px text-[9px] font-medium leading-none" style={{ background: 'var(--neon-purple-8)', color: 'var(--text-secondary)' }}>×{audioStreams.length}</span>
              )}
            </div>
            <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
              {mainAudio ? [
                mainAudio.sample_rate ? formatSampleRate(mainAudio.sample_rate) : null,
                mainAudio.bit_rate ? formatBitRate(mainAudio.bit_rate) : null,
                mainAudio.language ? formatLanguage(mainAudio.language) : null,
              ].filter(Boolean).join(' · ') : t('tech.noAudio')}
            </div>
          </div>
        </div>

        {/* 字幕概览 */}
        <div className="flex items-center gap-2 px-3 py-2 lg:border-r" style={{ borderColor: 'var(--border-default)' }}>
          <Subtitles size={14} className="shrink-0" style={{ color: 'var(--neon-green)' }} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {subtitleStreams.length > 0 ? t('tech.subtitleCount', { count: subtitleStreams.length }) : t('tech.noEmbeddedSubtitles')}
            </div>
            <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
              {subtitleStreams.length > 0
                ? subtitleStreams.map(s => formatLanguage(s.language)).filter((v, i, a) => a.indexOf(v) === i).join(' / ')
                : '-'
              }
            </div>
          </div>
        </div>

        {/* 容器/文件概览 */}
        <div className="flex items-center gap-2 px-3 py-2">
          <HardDrive size={14} className="shrink-0" style={{ color: '#FFA500' }} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {techSpecs?.format ? formatContainerName(techSpecs.format.format_name) : fileInfo?.file_ext?.toUpperCase() || '-'}
            </div>
            <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
              {techSpecs?.format ? [
                techSpecs.format.bit_rate ? formatBitRate(techSpecs.format.bit_rate) : null,
                techSpecs.format.stream_count ? t('tech.streamCount', { count: techSpecs.format.stream_count }) : null,
                formatSize(media.file_size),
              ].filter(Boolean).join(' · ') : formatSize(media.file_size)}
            </div>
          </div>
        </div>
      </div>

      {/* ==================== 展开的详细信息（标签页形式） ==================== */}
      {expanded && (
        <div className="mt-4 animate-fade-in">
          {/* 标签页导航 */}
          <div className="mb-4 flex items-center gap-1 overflow-x-auto rounded-xl p-1" style={{ background: 'var(--bg-subtle)' }}>
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-medium transition-all"
                style={{
                  background: activeTab === tab.key ? 'var(--bg-elevated)' : 'transparent',
                  color: activeTab === tab.key ? 'var(--neon-blue)' : 'var(--text-muted)',
                  boxShadow: activeTab === tab.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                {tab.icon}
                {tab.label}
                {tab.badge && (
                  <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--neon-purple-8)', color: 'var(--text-secondary)' }}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ==================== 概览标签页 ==================== */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* 文件基本信息 — 整合路径、大小、时长等 */}
              <div className="glass-panel rounded-xl p-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  <FileText size={14} className="text-neon/60" />
                  {t('tech.basicInfo')}
                </h4>

                {/* 文件路径（突出显示） */}
                {media.file_path && isAdmin && (
                  <div className="mb-3 flex items-start gap-3">
                    <span className="shrink-0 text-xs font-medium mt-1.5" style={{ color: 'var(--text-muted)' }}>{t('tech.path')}</span>
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <code className="flex-1 truncate rounded-lg px-3 py-1.5 text-xs"
                        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                      >
                        {media.file_path}
                      </code>
                      <CopyButton value={media.file_path} />
                    </div>
                  </div>
                )}

                {/* 关键信息网格 */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs sm:grid-cols-3 lg:grid-cols-4">
                  <InfoItemWithCopy label={t('tech.fileSize')} value={formatSize(media.file_size)} highlight />
                  {fileInfo?.file_ext && <InfoItemWithCopy label={t('tech.fileFormat')} value={fileInfo.file_ext.replace('.', '').toUpperCase()} />}
                  {media.duration > 0 && <InfoItemWithCopy label={t('tech.duration')} value={formatDuration(media.duration)} highlight />}
                  {techSpecs?.format?.duration && (
                    <InfoItemWithCopy label={t('tech.lblExactDuration')} value={formatDuration(parseFloat(techSpecs.format.duration))} hint={t('tech.hintExactDuration')} />
                  )}
                  {techSpecs?.format?.bit_rate && (
                    <InfoItemWithCopy label={t('tech.lblTotalBitRate')} value={formatBitRate(techSpecs.format.bit_rate)} hint={t('tech.hintTotalBitRate')} />
                  )}
                  {fileInfo?.mime_type && <InfoItemWithCopy label={t('tech.lblMime')} value={fileInfo.mime_type} hint={t('tech.hintMime')} />}
                  <InfoItemWithCopy label={t('tech.createdAt')} value={fileInfo?.created_at ? formatDate(fileInfo.created_at) : formatDate(media.created_at)} />
                  {fileInfo?.modified_at && <InfoItemWithCopy label={t('tech.modifiedAt')} value={formatDate(fileInfo.modified_at)} />}
                  {fileInfo?.permissions && fileInfo.permissions !== '-' && (
                    <InfoItemWithCopy label={t('tech.permissions')} value={fileInfo.permissions} icon={<Shield size={10} />} />
                  )}
                  {fileInfo?.owner && fileInfo.owner !== '-' && (
                    <InfoItemWithCopy label={t('tech.owner')} value={fileInfo.owner} icon={<User size={10} />} />
                  )}
                </div>

                {/* 哈希值（单独一行，突出显示） */}
                {fileInfo?.md5 && (
                  <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-default)' }}>
                    <InfoItemWithCopy label={t('tech.lblMd5')} value={fileInfo.md5} icon={<Hash size={10} />} mono hint={t('tech.hintMd5')} />
                  </div>
                )}
              </div>

              {/* 媒体库信息 */}
              {library && isAdmin && (
                <div className="glass-panel rounded-xl p-4">
                  <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    <FolderOpen size={14} className="text-neon/60" />
                    {t('tech.library')}
                  </h4>
                  <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>{t('tech.nameLabel')}</span>
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{library.name}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>{t('tech.typeLabel')}</span>
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {{ movie: t('media.movie'), tvshow: t('media.tvshow'), mixed: t('media.mixed'), other: t('media.other') }[library.type] || library.type}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 容器元数据标签 */}
              {techSpecs?.format?.tags && Object.keys(techSpecs.format.tags).length > 0 && (
                <div className="glass-panel rounded-xl p-4">
                  <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    <Info size={14} className="text-neon/60" />
                    {t('tech.metadataTags')}
                  </h4>
                  <div className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                    {Object.entries(techSpecs.format.tags).map(([key, value]) => (
                      <InfoItemWithCopy key={key} label={key} value={String(value)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== 视频标签页 ==================== */}
          {activeTab === 'video' && (
            <div className="space-y-4">
              {videoStreams.length > 0 ? videoStreams.map((stream, idx) => (
                <div key={idx} className="glass-panel rounded-xl p-4">
                  {/* 视频流标题行 */}
                  <div className="mb-3 flex items-center gap-2 flex-wrap">
                    <Monitor size={14} className="text-neon/60" />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {t('tech.videoStreamN', { n: stream.index })}
                    </span>
                    <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                      {stream.width && stream.height ? `${stream.height}p` : ''} {formatCodecName(stream.codec_name)} {getHDRLabel(stream)}
                    </span>
                    {stream.is_default && (
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--neon-blue-8)', color: 'var(--neon-blue)' }}>{t('tech.defaultBadge')}</span>
                    )}
                    {isHDR(stream) && (
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#FBBF24' }}>{getHDRLabel(stream)}</span>
                    )}
                  </div>
                  {/* 详细参数表格 */}
                  <div className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                    <InfoItemWithCopy label={t('tech.lblCodec')} value={formatCodecName(stream.codec_name, stream.codec_long_name)} hint={t('tech.hintCodec')} />
                    {stream.profile && <InfoItemWithCopy label={t('tech.lblProfile')} value={stream.profile} hint={t('tech.hintProfile')} />}
                    {stream.level ? <InfoItemWithCopy label={t('tech.lblLevel')} value={String(stream.level)} hint={t('tech.hintLevel')} /> : null}
                    <InfoItemWithCopy label={t('tech.lblResolution')} value={stream.width && stream.height ? `${stream.width} × ${stream.height}` : '-'} highlight hint={t('tech.hintResolution')} />
                    <InfoItemWithCopy label={t('tech.lblFrameRate')} value={stream.frame_rate ? `${parseFloat(stream.frame_rate).toFixed(2)} fps` : '-'} hint={t('tech.hintFrameRate')} />
                    <InfoItemWithCopy label={t('tech.lblBitRate')} value={formatBitRate(stream.bit_rate)} hint={t('tech.hintBitRate')} />
                    {stream.bit_depth ? <InfoItemWithCopy label={t('tech.lblBitDepth')} value={`${stream.bit_depth} bit`} hint={t('tech.hintBitDepth')} /> : null}
                    <InfoItemWithCopy label={t('tech.lblPixFmt')} value={formatPixFmt(stream.pix_fmt)} hint={t('tech.hintPixFmt')} />
                    <InfoItemWithCopy label={t('tech.lblDynamicRange')} value={getHDRLabel(stream)} hint={t('tech.hintDynamicRange')} />
                    {stream.aspect_ratio && <InfoItemWithCopy label={t('tech.lblAspect')} value={stream.aspect_ratio} hint={t('tech.hintAspect')} />}
                    {stream.color_space && <InfoItemWithCopy label={t('tech.lblColorSpace')} value={stream.color_space} hint={t('tech.hintColorSpace')} />}
                    {stream.color_transfer && <InfoItemWithCopy label={t('tech.lblColorTransfer')} value={stream.color_transfer} hint={t('tech.hintColorTransfer')} />}
                    {stream.color_primaries && <InfoItemWithCopy label={t('tech.lblColorPrimaries')} value={formatColorPrimaries(stream.color_primaries)} hint={t('tech.hintColorPrimaries')} />}
                    {stream.color_range && <InfoItemWithCopy label={t('tech.lblColorRange')} value={stream.color_range === 'tv' ? 'TV (Limited)' : stream.color_range === 'pc' ? 'PC (Full)' : stream.color_range} hint={t('tech.hintColorRange')} />}
                    <InfoItemWithCopy label={t('tech.lblInterlaced')} value={stream.is_interlaced ? t('common.yes') : t('common.no')} hint={t('tech.hintInterlaced')} />
                    {stream.ref_frames ? <InfoItemWithCopy label={t('tech.lblRefFrames')} value={String(stream.ref_frames)} hint={t('tech.hintRefFrames')} /> : null}
                    {stream.nb_frames && <InfoItemWithCopy label={t('tech.lblNbFrames')} value={stream.nb_frames} hint={t('tech.hintNbFrames')} />}
                  </div>
                </div>
              )) : (
                <div className="glass-panel rounded-xl p-8 text-center">
                  <Monitor size={32} className="mx-auto mb-2 opacity-30" style={{ color: 'var(--text-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {media.video_codec ? t('tech.videoCodec', { codec: media.video_codec }) : t('tech.noVideoDetail')}
                  </p>
                  {media.resolution && (
                    <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{t('tech.resolutionLabel', { r: media.resolution })}</p>
                  )}
                </div>
              )}

              {/* 字幕流信息也放在视频标签页下 */}
              {subtitleStreams.length > 0 && (
                <div className="glass-panel rounded-xl p-4">
                  <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    <Subtitles size={14} style={{ color: 'var(--neon-green)', opacity: 0.6 }} />
                    {t('tech.subtitleTrack', { count: subtitleStreams.length })}
                  </h4>
                  <div className="space-y-1.5">
                    {subtitleStreams.map((stream, idx) => (
                      <div key={idx} className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--bg-subtle)' }}>
                        <span className="shrink-0 font-mono" style={{ color: 'var(--text-muted)' }}>#{stream.index}</span>
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                          {formatCodecName(stream.codec_name)}
                        </span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {formatLanguage(stream.language)}
                        </span>
                        {stream.title && (
                          <span className="truncate" style={{ color: 'var(--text-muted)' }}>{stream.title}</span>
                        )}
                        <div className="ml-auto flex gap-1.5">
                          {stream.is_default && (
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--neon-blue-8)', color: 'var(--neon-blue)' }}>{t('tech.defaultBadge')}</span>
                          )}
                          {stream.is_forced && (
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'rgba(255,165,0,0.1)', color: '#FFA500' }}>{t('tech.forcedBadge')}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== 音频标签页 ==================== */}
          {activeTab === 'audio' && (
            <div className="space-y-4">
              {audioStreams.length > 0 ? audioStreams.map((stream, idx) => (
                <div key={idx} className="glass-panel rounded-xl p-4">
                  <div className="mb-3 flex items-center gap-2 flex-wrap">
                    <Music size={14} className="text-purple-400/60" />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {t('tech.audioTrackN', { n: stream.index })}
                    </span>
                    <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                      {formatCodecName(stream.codec_name)} {formatChannels(stream.channels, stream.channel_layout)}
                    </span>
                    {stream.title && (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>— {stream.title}</span>
                    )}
                    {stream.is_default && (
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--neon-blue-8)', color: 'var(--neon-blue)' }}>{t('tech.defaultBadge')}</span>
                    )}
                    {stream.is_forced && (
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'rgba(255,165,0,0.1)', color: '#FFA500' }}>{t('tech.forcedBadge')}</span>
                    )}
                  </div>
                  <div className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                    <InfoItemWithCopy label={t('tech.lblLanguage')} value={formatLanguage(stream.language)} hint={t('tech.hintLanguage')} />
                    <InfoItemWithCopy label={t('tech.lblCodec')} value={formatCodecName(stream.codec_name, stream.codec_long_name)} hint={t('tech.hintCodec')} />
                    {stream.profile && <InfoItemWithCopy label={t('tech.lblProfile')} value={stream.profile} hint={t('tech.hintProfile')} />}
                    <InfoItemWithCopy label={t('tech.lblLayout')} value={stream.channel_layout || '-'} hint={t('tech.hintLayout')} />
                    <InfoItemWithCopy label={t('tech.lblChannels')} value={stream.channels ? `${stream.channels} ch` : '-'} hint={t('tech.hintChannels')} />
                    <InfoItemWithCopy label={t('tech.lblSampleRate')} value={formatSampleRate(stream.sample_rate)} hint={t('tech.hintSampleRate')} />
                    <InfoItemWithCopy label={t('tech.lblBitRate')} value={formatBitRate(stream.bit_rate)} hint={t('tech.hintBitRate')} />
                    {stream.bits_per_sample && stream.bits_per_sample > 0 && <InfoItemWithCopy label={t('tech.lblSampleBitDepth')} value={`${stream.bits_per_sample}-bit`} hint={t('tech.hintSampleBitDepth')} />}
                    <InfoItemWithCopy label={t('tech.defaultBadge')} value={stream.is_default ? t('common.yes') : t('common.no')} />
                  </div>
                </div>
              )) : (
                <div className="glass-panel rounded-xl p-8 text-center">
                  <Music size={32} className="mx-auto mb-2 opacity-30" style={{ color: 'var(--text-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {media.audio_codec ? t('tech.audioCodec', { codec: media.audio_codec }) : t('tech.noAudioDetail')}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ==================== 文件标签页 ==================== */}
          {activeTab === 'file' && (
            <div className="space-y-4">
              {/* 文件详情 */}
              <div className="glass-panel rounded-xl p-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  <Layers size={14} className="text-neon/60" />
                  {t('tech.fileDetail')}
                </h4>

                {/* 文件路径（管理员可见） */}
                {media.file_path && isAdmin && (
                  <div className="mb-3 flex items-start gap-3">
                    <span className="shrink-0 text-xs font-medium mt-1.5" style={{ color: 'var(--text-muted)' }}>{t('tech.fullPath')}</span>
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <code className="flex-1 truncate rounded-lg px-3 py-1.5 text-xs"
                        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                      >
                        {media.file_path}
                      </code>
                      <CopyButton value={media.file_path} />
                    </div>
                  </div>
                )}

                <div className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                  {fileInfo && <InfoItemWithCopy label={t('tech.fileName')} value={fileInfo.file_name} />}
                  <InfoItemWithCopy label={t('tech.fileFormat')} value={fileInfo?.file_ext?.replace('.', '').toUpperCase() || '-'} />
                  <InfoItemWithCopy label={t('tech.fileSize')} value={formatSize(media.file_size)} highlight />
                  {fileInfo?.mime_type && <InfoItemWithCopy label={t('tech.lblMime')} value={fileInfo.mime_type} hint={t('tech.hintMime')} />}
                  {techSpecs?.format?.duration && (
                    <InfoItemWithCopy label={t('tech.lblExactDuration')} value={formatDuration(parseFloat(techSpecs.format.duration))} hint={t('tech.hintExactDuration')} />
                  )}
                  {techSpecs?.format?.bit_rate && (
                    <InfoItemWithCopy label={t('tech.lblTotalBitRate')} value={formatBitRate(techSpecs.format.bit_rate)} hint={t('tech.hintTotalBitRate')} />
                  )}
                  <InfoItemWithCopy label={t('tech.createdAt')} value={fileInfo?.created_at ? formatDate(fileInfo.created_at) : formatDate(media.created_at)} />
                  {fileInfo?.modified_at && <InfoItemWithCopy label={t('tech.modifiedAt')} value={formatDate(fileInfo.modified_at)} />}
                  {fileInfo?.permissions && fileInfo.permissions !== '-' && (
                    <InfoItemWithCopy label={t('tech.permissions')} value={fileInfo.permissions} icon={<Shield size={10} />} />
                  )}
                  {fileInfo?.owner && fileInfo.owner !== '-' && (
                    <InfoItemWithCopy label={t('tech.owner')} value={fileInfo.owner} icon={<User size={10} />} />
                  )}
                </div>

                {/* 哈希值 */}
                {fileInfo?.md5 && (
                  <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-default)' }}>
                    <div className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-1">
                      <InfoItemWithCopy label={t('tech.lblMd5')} value={fileInfo.md5} icon={<Hash size={10} />} mono hint={t('tech.hintMd5')} />
                    </div>
                  </div>
                )}
              </div>

              {/* 容器格式详情 */}
              {techSpecs?.format && (
                <div className="glass-panel rounded-xl p-4">
                  <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    <HardDrive size={14} style={{ color: '#FFA500', opacity: 0.6 }} />
                    {t('tech.container')}
                  </h4>
                  <div className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                    <InfoItemWithCopy label={t('tech.formatName')} value={formatContainerName(techSpecs.format.format_name)} />
                    {techSpecs.format.format_long_name && <InfoItemWithCopy label={t('tech.longName')} value={techSpecs.format.format_long_name} />}
                    <InfoItemWithCopy label={t('tech.streamCountLabel')} value={t('tech.streamCountValue', { count: techSpecs.format.stream_count })} />
                    {techSpecs.format.size && <InfoItemWithCopy label={t('tech.containerSize')} value={formatSize(parseInt(techSpecs.format.size))} />}
                    {techSpecs.format.start_time && <InfoItemWithCopy label={t('tech.startTime')} value={`${parseFloat(techSpecs.format.start_time).toFixed(3)}s`} />}
                  </div>
                </div>
              )}

              {/* 容器元数据标签 */}
              {techSpecs?.format?.tags && Object.keys(techSpecs.format.tags).length > 0 && (
                <div className="glass-panel rounded-xl p-4">
                  <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    <Info size={14} className="text-neon/60" />
                    {t('tech.metadataTags')}
                  </h4>
                  <div className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                    {Object.entries(techSpecs.format.tags).map(([key, value]) => (
                      <InfoItemWithCopy key={key} label={key} value={String(value)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== 统计标签页 ==================== */}
          {activeTab === 'stats' && playbackStats && (
            <div className="space-y-4">
              <div className="glass-panel rounded-xl p-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  <BarChart3 size={14} className="text-neon/60" />
                  {t('tech.playStats')}
                </h4>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-lg font-bold" style={{ color: 'var(--neon-blue)' }}>
                      <Play size={16} />
                      {playbackStats.total_play_count}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('tech.totalPlays')}</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-lg font-bold" style={{ color: 'var(--neon-blue)' }}>
                      <Users size={16} />
                      {playbackStats.unique_viewers}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('tech.uniqueViewers')}</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-lg font-bold" style={{ color: 'var(--neon-blue)' }}>
                      <Clock size={16} />
                      {playbackStats.total_watch_minutes > 60
                        ? `${(playbackStats.total_watch_minutes / 60).toFixed(1)}h`
                        : `${playbackStats.total_watch_minutes.toFixed(0)}m`
                      }
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('tech.totalWatchTime')}</div>
                  </div>
                  {playbackStats.last_played_at && (
                    <div className="text-center">
                      <div className="text-sm font-bold" style={{ color: 'var(--neon-blue)' }}>
                        {formatDate(playbackStats.last_played_at)}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('tech.lastPlayed')}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ==================== 子组件 ====================

/** 复制按钮组件 */
function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }, [value])

  return (
    <button
      onClick={handleCopy}
      className="shrink-0 rounded-lg p-1.5 transition-all hover:text-neon hover:bg-neon-blue/5"
      style={{ color: copied ? 'var(--neon-green)' : 'var(--text-muted)' }}
      title={copied ? t('tech.copied') : t('tech.copy')}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}

/** 带复制和提示功能的信息项组件 */
function InfoItemWithCopy({ label, value, highlight, icon, mono, hint }: {
  label: string
  value: string
  highlight?: boolean
  icon?: React.ReactNode
  mono?: boolean
  hint?: string
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [showHint, setShowHint] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }, [value])

  return (
    <div className="group flex items-start gap-2 relative">
      <span className="shrink-0 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
        {icon}
        {label}
        {hint && (
          <span
            className="relative cursor-help"
            onMouseEnter={() => setShowHint(true)}
            onMouseLeave={() => setShowHint(false)}
          >
            <HelpCircle size={10} className="opacity-40 hover:opacity-80 transition-opacity" />
            {showHint && (
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 rounded-lg px-2.5 py-1.5 text-[10px] leading-relaxed shadow-lg z-50 pointer-events-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
              >
                {hint}
              </span>
            )}
          </span>
        )}
        ：
      </span>
      <span
        className={`${highlight ? 'font-semibold' : 'font-medium'} ${mono ? 'font-mono text-[11px] break-all' : ''} cursor-pointer transition-colors hover:text-neon`}
        style={{ color: copied ? 'var(--neon-green)' : highlight ? '#FBBF24' : 'var(--text-primary)' }}
        onClick={handleCopy}
        title={t('tech.clickCopy')}
      >
        {copied ? t('tech.copiedTick') : value}
      </span>
    </div>
  )
}
