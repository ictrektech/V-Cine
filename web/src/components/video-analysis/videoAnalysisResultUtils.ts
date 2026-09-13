import type { VideoAnalysisStatus } from '@/types/videoAnalysis'

export const VIDEO_ANALYSIS_SCENES_PER_PAGE = 12

// 任务状态徽章的文案与配色（列表、历史、结果抽层共用），shadcn Badge 变体配色
export const videoAnalysisStatusMeta: Record<VideoAnalysisStatus, { label: string; className: string }> = {
  queued: { label: '排队中', className: 'border-transparent bg-secondary text-secondary-foreground' },
  running: { label: '分析中', className: 'border-amber-500/20 bg-amber-500/10 text-amber-400' },
  succeeded: { label: '已完成', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' },
  partial: { label: '部分完成', className: 'border-amber-500/20 bg-amber-500/10 text-amber-400' },
  failed: { label: '失败', className: 'border-red-500/20 bg-red-500/10 text-red-400' },
  skipped: { label: '已跳过', className: 'border-transparent bg-secondary text-muted-foreground' },
}

export const videoAnalysisStageLabels = { detect: '场景检测', structure: '结构分析', describe: '场景描述', done: '完成' }

export function formatVideoAnalysisTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—'
}

export function formatVideoAnalysisSeconds(value?: number) {
  if (value == null || Number.isNaN(value)) return '—'
  const total = Math.max(0, Math.floor(value))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

// 错误信息中的阶段名称映射
const errorStageLabels: Record<string, string> = {
  detect: '场景检测',
  structure: '结构分析',
  describe: '场景描述',
}

// 折叠重复的错误片段（如 "大模型调用失败: ... 大模型调用失败: ..."），保留首次出现
function dedupeMessageSegments(message: string): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const segment of message.split(/:\s|\uFF1A/)) {
    const key = segment.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    parts.push(key)
  }
  return parts.join('：')
}

/**
 * 格式化视频分析错误信息为友好文案，同时保留阶段与错误码：
 * "describe stage: external job failed: code=DESCRIBE_ERROR message=X"
 * → "场景描述阶段失败（DESCRIBE_ERROR）：X"
 */
export function formatVideoAnalysisError(message?: string | null): string {
  if (!message) return ''
  let text = message
  const m = text.match(/^([a-z]+) stage: (?:external job failed: code=(\S+) message=)?([\s\S]+)$/)
  if (m) {
    text = `${errorStageLabels[m[1]] || m[1]}阶段失败${m[2] ? `（${m[2]}）` : ''}：${m[3]}`
  }
  return dedupeMessageSegments(text)
}
