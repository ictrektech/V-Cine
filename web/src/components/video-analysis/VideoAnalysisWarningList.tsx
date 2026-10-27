import type { VideoAnalysisWarning } from '@/types/videoAnalysis'

interface VideoAnalysisWarningListProps {
  warnings: VideoAnalysisWarning[]
}

// 场景号：空值或非数字（结构/远端汇总告警）返回 null
function sceneIndexOf(warning: VideoAnalysisWarning): number | null {
  const raw = warning.target_id?.trim()
  if (!raw) return null
  const index = Number(raw)
  return Number.isFinite(index) ? index : null
}

// 场景告警按场景号升序（并发写入会乱序）；无场景号的保持原顺序排在后面
export function sortVideoAnalysisWarnings(warnings: VideoAnalysisWarning[]) {
  const scenes: VideoAnalysisWarning[] = []
  const others: VideoAnalysisWarning[] = []
  for (const warning of warnings) {
    if (sceneIndexOf(warning) === null) others.push(warning)
    else scenes.push(warning)
  }
  scenes.sort((a, b) => (sceneIndexOf(a) ?? 0) - (sceneIndexOf(b) ?? 0))
  return [...scenes, ...others]
}

/**
 * 告警列表：错误码 + 简短文案 + 上游原始诊断。
 * 结果面板（按 result.warnings 通用展示）与错误详情（抽屉内展开）共用同一套渲染。
 */
export default function VideoAnalysisWarningList({ warnings }: VideoAnalysisWarningListProps) {
  const items = sortVideoAnalysisWarnings(warnings)
  return (
    <ul className="mt-1 max-h-48 space-y-1 overflow-auto pr-0.5">
      {items.map((item, index) => (
        <li key={`${item.code || 'warning'}-${item.target_id || index}`} className="rounded-md bg-background/70 px-2 py-1.5">
          <div>
            {item.code && (
              <span className="mr-1.5 rounded bg-red-500/10 px-1 py-0.5 font-mono text-[10px] text-red-400">{item.code}</span>
            )}
            <span className="text-[11px] leading-relaxed text-foreground [overflow-wrap:anywhere]">{item.message}</span>
          </div>
          {item.detail && (
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-red-500/5 p-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {item.detail}
            </pre>
          )}
        </li>
      ))}
    </ul>
  )
}
