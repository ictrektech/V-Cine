import type { VideoAnalysisStatus } from '@/types/videoAnalysis'
import type { TFunc } from '@/i18n'

export const VIDEO_ANALYSIS_SCENES_PER_PAGE = 12

// 任务状态徽章的文案与配色（列表、历史、结果抽层共用），shadcn Badge 变体配色
// 状态徽章配色（列表、历史、结果抽层共用）；文案走 i18n（videoAnalysisStatusKeys）
export const videoAnalysisStatusMeta: Record<VideoAnalysisStatus, { className: string }> = {
  queued: { className: 'border-transparent bg-secondary text-secondary-foreground' },
  running: { className: 'border-amber-500/20 bg-amber-500/10 text-amber-400' },
  succeeded: { className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' },
  partial: { className: 'border-amber-500/20 bg-amber-500/10 text-amber-400' },
  failed: { className: 'border-red-500/20 bg-red-500/10 text-red-400' },
  skipped: { className: 'border-transparent bg-secondary text-muted-foreground' },
}

// 任务状态文案的 i18n key（列表、历史、结果抽层共用）
export const videoAnalysisStatusKeys: Record<VideoAnalysisStatus, string> = {
  queued: 'vat.statusQueued',
  running: 'vat.statusRunning',
  succeeded: 'vat.statusSucceeded',
  partial: 'vat.statusPartial',
  failed: 'vat.statusFailed',
  skipped: 'vat.statusSkipped',
}

// 阶段 → i18n key（任务列表、错误详情、通知共用；工作流面板的 structure 另有文案）
export const videoAnalysisStageKeys: Record<string, string> = {
  detect: 'vat.stageDetect',
  structure: 'vat.stageStructure',
  describe: 'vat.stageDescribe',
  done: 'vat.stageDone',
}

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

// 错误信息中阶段的 i18n key（传入 translate 时按语言输出）
const errorStageKeys: Record<string, string> = {
  detect: 'vat.errorStageDetect',
  structure: 'vat.errorStageStructure',
  describe: 'vat.errorStageDescribe',
}

// 折叠重复的错误片段（如 "大模型调用失败: ... 大模型调用失败: ..."），保留首次出现
function dedupeMessageSegments(message: string, translate?: TFunc): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const segment of message.split(/:\s|\uFF1A/)) {
    const key = segment.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    parts.push(key)
  }
  return parts.join(translate ? ': ' : '：')
}

// 上游统一错误体（V-Scheduler / OpenAI 兼容网关）：
// "Error code: 404 - {'category': 'v-scheduler', 'code': 'NOT_FOUND', ..., 'msg': 'unknown model or upstream'}"
const upstreamErrorPattern = /Error code:\s*(\d{3})\s*-\s*(\{[\s\S]*\})\s*$/

// 把上游的 JSON 错误体折叠成一句话：状态码 + 错误码 + msg。
// 上游体是 Python repr（单引号），不能 JSON.parse，按字段取即可。
function formatUpstreamError(text: string, translate?: TFunc): string | null {
  const matched = text.match(upstreamErrorPattern)
  if (!matched) return null
  const [, status, body] = matched
  const code = body.match(/'code':\s*'([^']+)'/)?.[1] || ''
  const message = body.match(/'(?:msg|message)':\s*'([^']+)'/)?.[1] || ''
  if (!message) return null

  const params = { status, code, msg: message }
  const sentence = code
    ? translate
      ? translate('vat.upstreamErrorWithCode', params)
      : `上游返回 ${status}（${code}）：${message}`
    : translate
      ? translate('vat.upstreamError', params)
      : `上游返回 ${status}：${message}`

  // 模型缺失额外补一句可操作提示：上游不回显模型名，只能指向模型仓库
  const hint = /unknown model/i.test(message) ? (translate ? translate('vat.upstreamModelHint') : '（模型未在 V-Scheduler 注册或未下载）') : ''
  return text.slice(0, matched.index ?? 0) + sentence + hint
}

/**
 * 格式化视频分析错误信息为友好文案，同时保留阶段与错误码：
 * "describe stage: external job failed: code=DESCRIBE_ERROR message=X"
 * → "场景描述阶段失败（DESCRIBE_ERROR）：X"
 * 传入 translate 时输出对应语言（如 "Scene description stage failed (DESCRIBE_ERROR): X"）
 */
export function formatVideoAnalysisError(message?: string | null, translate?: TFunc): string {
  if (!message) return ''
  let text = message
  const m = text.match(/^([a-z]+) stage: (?:external job failed: code=(\S+) message=)?([\s\S]+)$/)
  if (m) {
    const stageKey = errorStageKeys[m[1]]
    const stageLabel = stageKey ? (translate ? translate(stageKey) : errorStageLabels[m[1]]) : m[1]
    const failedSuffix = translate ? translate('vat.errorStageFailed') : '阶段失败'
    const code = m[2] ? (translate ? ` (${m[2]})` : `（${m[2]}）`) : ''
    const sep = translate ? ': ' : '：'
    text = `${stageLabel}${failedSuffix}${code}${sep}${m[3]}`
  }
  text = formatUpstreamError(text, translate) ?? text
  return dedupeMessageSegments(text, translate)
}
