import { useAuthStore } from '@/stores/auth'
import type {
  MediaPlayInfo,
} from '@/types'
import { toAppUrl } from '@/lib/appUrl'
import api from './client'

// ==================== 流媒体 ====================

// 兼容 VOS 子路径：海报/流媒体 URL 是 path-absolute（/api/...），
// 不受 <base> 影响，必须显式加前缀才能经过 Traefik 命中应用；
// 绝对 URL（http/https/data 等）由 toAppUrl 透传，再拼上鉴权 token。
function withBaseAndToken(url: string): string {
  const prefixed = toAppUrl(url)
  const token = useAuthStore.getState().token
  if (!token) return prefixed
  const sep = prefixed.includes('?') ? '&' : '?'
  return `${prefixed}${sep}token=${encodeURIComponent(token)}`
}

export const streamApi = {
  getPlayInfo: (mediaId: string) =>
    api.get<{ data: MediaPlayInfo }>(`/stream/${mediaId}/info`),

  getMasterUrl: (mediaId: string) =>
    withBaseAndToken(`/api/stream/${mediaId}/master.m3u8`),

  getDirectUrl: (mediaId: string) =>
    withBaseAndToken(`/api/stream/${mediaId}/direct`),

  getRemuxUrl: (mediaId: string) =>
    withBaseAndToken(`/api/stream/${mediaId}/remux`),

  // 上报当前播放位置，驱动后端 FFmpeg 节流（Throttling）
  // position: 当前播放时间（秒，绝对位置）
  reportPlayback: (mediaId: string, position: number) =>
    api.post(`/stream/${mediaId}/playback`, null, {
      params: { position: position.toFixed(2) },
    }),

  // 上报客户端 hls.js 的带宽评估（bit/s），驱动服务端 ABR 档位过滤建议
  // 服务端会在响应中返回推荐的 maxBitrate（留 20% 余量）和当前节流状态，
  // 前端可用于：
  //   1. 下次请求 master.m3u8 时带上 ?maxBitrate=xxx
  //   2. 在 Settings 菜单显示节流/转码状态
  reportBandwidth: (mediaId: string, bitrate: number) =>
    api.post<{
      ok: boolean
      reported_bitrate: number
      recommended_max: number
      throttle?: {
        media_id: string
        running: boolean
        active_qualities: string[] | null
        suspended_count: number
        playback_pos: number
        transcoded_pos: number
        ahead_seconds: number
      }
    }>(`/stream/${mediaId}/bandwidth`, null, { params: { bitrate: Math.round(bitrate) } }),

  // 独立查询节流/转码状态（低频，5s 一次即可）
  getThrottleStatus: (mediaId: string) =>
    api.get<{
      data: {
        media_id: string
        running: boolean
        active_qualities: string[] | null
        suspended_count: number
        playback_pos: number
        transcoded_pos: number
        ahead_seconds: number
      }
    }>(`/stream/${mediaId}/throttle`),

  // STRM 链路健康检查：返回连通性 + 关键响应头，用于播放器诊断面板
  checkSTRM: (mediaId: string) =>
    api.get<{
      data: {
        media_id: string
        url: string
        status_code: number
        ok: boolean
        content_type?: string
        content_length?: number
        accept_ranges?: string
        response_ms: number
        error?: string
        effective_url?: string
        headers?: Record<string, string>
      }
    }>(`/stream/${mediaId}/strm-check`),

  // version 可选：用于缓存破坏（cache-busting）。
  // 当元数据/海报被替换后，传入一个新的数字即可触发浏览器重新请求图片。
  getPosterUrl: (mediaId: string, version?: number) =>
    withBaseAndToken(`/api/media/${mediaId}/poster${version ? `?v=${version}` : ''}`),

  getSeriesPosterUrl: (seriesId: string, version?: number) =>
    withBaseAndToken(`/api/series/${seriesId}/poster${version ? `?v=${version}` : ''}`),

  getSeriesBackdropUrl: (seriesId: string, version?: number) =>
    withBaseAndToken(`/api/series/${seriesId}/backdrop${version ? `?v=${version}` : ''}`),

  getCollectionPosterUrl: (collectionId: string, version?: number) =>
    withBaseAndToken(`/api/collections/${collectionId}/poster${version ? `?v=${version}` : ''}`),

  getPersonProfileUrl: (personId: string, version?: number) =>
    withBaseAndToken(`/api/persons/${personId}/profile${version ? `?v=${version}` : ''}`),

  // 为任意 URL 添加认证 token
  withTokenUrl: (url: string) => withBaseAndToken(url),
}

// 导出 withToken 供其他模块使用
export { withBaseAndToken as withToken }
