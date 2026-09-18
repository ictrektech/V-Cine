import { useAuthStore } from '@/stores/auth'
import { useMediaRefreshStore } from '@/stores/mediaRefresh'
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

// 图片类 URL 统一附加缓存破坏参数 ?v=<海报版本戳>：
//  - 版本戳平时稳定，URL 不变，浏览器缓存照常命中；
//  - 刮削完成/替换海报时 bumpPosterVersion() 使 URL 变化，强制重新拉取。
function withPosterVersion(url: string, version?: number): string {
  const v = version ?? useMediaRefreshStore.getState().posterVersion
  return withBaseAndToken(`${url}?v=${v}`)
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

  // version 可选：显式指定缓存破坏版本号（不传则自动使用全局海报版本戳）。
  getPosterUrl: (mediaId: string, version?: number) =>
    withPosterVersion(`/api/media/${mediaId}/poster`, version),

  getSeriesPosterUrl: (seriesId: string, version?: number) =>
    withPosterVersion(`/api/series/${seriesId}/poster`, version),

  getSeriesBackdropUrl: (seriesId: string, version?: number) =>
    withPosterVersion(`/api/series/${seriesId}/backdrop`, version),

  getCollectionPosterUrl: (collectionId: string, version?: number) =>
    withPosterVersion(`/api/collections/${collectionId}/poster`, version),

  getPersonProfileUrl: (personId: string, version?: number) =>
    withPosterVersion(`/api/persons/${personId}/profile`, version),

  // 为任意 URL 添加认证 token
  withTokenUrl: (url: string) => withBaseAndToken(url),
}

// 导出 withToken 供其他模块使用
export { withBaseAndToken as withToken }
