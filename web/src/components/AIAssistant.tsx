import { useState, useRef, useEffect, useCallback } from 'react'
import { useWebSocket, WS_EVENTS } from '@/hooks/useWebSocket'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  MessageSquare,
  Send,
  X,
  Loader2,
  Sparkles,
  Bot,
  User,
  ChevronDown,
  ChevronUp,
  Check,
  Play,
  Undo2,
  AlertTriangle,
  History,
  Trash2,
  Minimize2,
  Maximize2,
  ArrowRight,
} from 'lucide-react'
import clsx from 'clsx'
import { aiAssistantApi } from '@/api'
import type { ChatMsg, SuggestedAction, OperationPreview, AssistantOperation } from '@/types'
import { useToast } from '@/components/Toast'

interface AIAssistantProps {
  /** 当前选中的文件ID列表 */
  selectedMediaIds: string[]
  /** 当前媒体库ID */
  libraryId?: string
  /** 操作执行后的回调（用于刷新列表） */
  onOperationComplete?: () => void
  /** 是否展开面板（由父组件控制） */
  isOpen: boolean
  /** 切换面板展开/关闭 */
  onToggle: () => void
}

/** AI助手触发按钮（右下角悬浮 FAB，portal 挂到 body 避免被工具栏的 backdrop-filter 捕获 fixed 定位） */
export function AIAssistantButton({ isOpen, onToggle, selectedCount }: {
  isOpen: boolean
  onToggle: () => void
  selectedCount: number
}) {
  return createPortal(
    <button
      onClick={onToggle}
      className={clsx(
        'fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-200 hover:scale-105',
        isOpen ? 'bg-surface-800 text-surface-100' : 'bg-primary text-primary-foreground'
      )}
      title={isOpen ? '关闭AI助手' : '打开AI助手'}
    >
      {isOpen ? <X size={22} /> : <Bot size={24} />}
      {selectedCount > 0 && !isOpen && (
        <span
          className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold"
          style={{ background: 'var(--neon-blue)', border: '1px solid var(--bg-primary)' }}
        >
          {selectedCount}
        </span>
      )}
    </button>,
    document.body
  )
}

/** Markdown 渲染（react-markdown + remark-gfm：正确渲染 AI 回复中的表格/标题/列表） */
function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="space-y-2 text-xs leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 解构掉 node（react-markdown passNode 默认开启，会把 hast 节点对象传入组件），
          // 避免对象值展开到 DOM 元素上触发 React 告警
          h1: ({ node: _node, ...p }) => <h1 className="text-sm font-bold mt-2 mb-1 first:mt-0" {...p} />,
          h2: ({ node: _node, ...p }) => <h2 className="text-sm font-bold mt-2 mb-1 first:mt-0" {...p} />,
          h3: ({ node: _node, ...p }) => <h3 className="text-xs font-bold mt-2 mb-1 first:mt-0" {...p} />,
          p: ({ node: _node, ...p }) => <p className="whitespace-pre-wrap" {...p} />,
          ul: ({ node: _node, ...p }) => <ul className="list-disc pl-4 space-y-0.5 my-1" {...p} />,
          ol: ({ node: _node, ...p }) => <ol className="list-decimal pl-4 space-y-0.5 my-1" {...p} />,
          table: ({ node: _node, ...p }) => (
            <div className="my-1 overflow-x-auto rounded-md border" style={{ borderColor: 'var(--border-default)' }}>
              <table className="w-full text-xs" {...p} />
            </div>
          ),
          th: ({ node: _node, ...p }) => <th className="border-b px-2 py-1 text-left font-medium bg-muted/50" {...p} />,
          td: ({ node: _node, ...p }) => <td className="border-b px-2 py-1" {...p} />,
          code: ({ node: _node, ...p }) => <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded" {...p} />,
          a: ({ node: _node, ...p }) => <a className="text-neon underline" target="_blank" rel="noreferrer" {...p} />,
          blockquote: ({ node: _node, ...p }) => <blockquote className="border-l-2 pl-2 text-muted-foreground" {...p} />,
          hr: () => <hr className="my-2 border-border" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

/** 刮削进度账本：msgIndex < 0 表示进度气泡尚未插入消息列表，事件先记账 */
interface ScrapeTrack {
  msgIndex: number
  status: Record<string, string>
  titles: Record<string, string>
}

/** 刮削进度文案（WS 事件与初始气泡共用，保证两处展示一致） */
function scrapeProgressText(track: ScrapeTrack): string {
  const entries = Object.entries(track.status)
  if (entries.length === 0) return '🔄 正在启动刮削任务...'
  const done = entries.filter(([, st]) => st === 'done' || st === 'failed').length
  const lines = entries.map(([mediaId, st]) => {
    const mark = st === 'done' ? '✅' : st === 'failed' ? '❌' : '🔄'
    return `- ${mark} ${track.titles[mediaId] || mediaId}`
  })
  const head = done === entries.length
    ? `✅ 刮削完成（${done}/${entries.length}）`
    : `🔄 刮削进行中（${done}/${entries.length} 完成）...`
  return `${head}\n${lines.join('\n')}`
}

export default function AIAssistant({ selectedMediaIds, libraryId, onOperationComplete, isOpen, onToggle }: AIAssistantProps) {
  const toast = useToast()
  const [isMinimized, setIsMinimized] = useState(false)
  const [sessionId, setSessionId] = useState<string>('')
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState<string | null>(null)
  // 已成功执行的操作：按钮置灰避免重复执行
  const [executedIds, setExecutedIds] = useState<Set<string>>(new Set())
  // AI 触发的刮削任务进度跟踪：WS 事件实时更新到 chat 消息
  const scrapeTrackRef = useRef<{ msgIndex: number; status: Record<string, string>; titles: Record<string, string> } | null>(null)
  const lastChatMediaIdsRef = useRef<string[]>([])
  const { on: onWsEvent, off: offWsEvent } = useWebSocket()
  const [showHistory, setShowHistory] = useState(false)
  const [opHistory, setOpHistory] = useState<AssistantOperation[]>([])
  const [expandedPreviews, setExpandedPreviews] = useState<Set<number>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // 打开时聚焦输入框
  useEffect(() => {
    if (isOpen && !isMinimized) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen, isMinimized])

  // 发送消息
  const handleSend = async () => {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')

    // 添加用户消息到列表
    const userMsg: ChatMsg = {
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      lastChatMediaIdsRef.current = selectedMediaIds
      const res = await aiAssistantApi.chat({
        session_id: sessionId || undefined,
        message: userMessage,
        media_ids: selectedMediaIds.length > 0 ? selectedMediaIds : undefined,
        library_id: libraryId,
      })

      const data = res.data.data
      setSessionId(data.session_id)
      setMessages(prev => [...prev, data.message])
    } catch (err: any) {
      const errorMsg: ChatMsg = {
        role: 'assistant',
        content: `❌ ${err?.response?.data?.error || '请求失败，请稍后重试'}`,
        timestamp: new Date().toISOString(),
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }

  // 订阅刮削进度事件：AI 触发的刮削任务进度实时更新到 chat 消息（面板关闭时也在后台累积）
  useEffect(() => {
    const handler = (data: { media_id: string; title: string; status: string; message: string }) => {
      const track = scrapeTrackRef.current
      if (!track || !(data.media_id in track.status)) return
      track.status[data.media_id] = data.status
      track.titles[data.media_id] = data.title
      // 气泡还没插入消息列表（响应未返回）时先记账，避免丢掉这段窗口内的事件
      if (track.msgIndex >= 0) {
        const content = scrapeProgressText(track)
        setMessages(prev => prev.map((m, idx) => (idx === track.msgIndex ? { ...m, content } : m)))
      }
      if (Object.values(track.status).every(st => st === 'done' || st === 'failed')) {
        scrapeTrackRef.current = null
      }
    }
    onWsEvent(WS_EVENTS.FILE_SCRAPE_PROGRESS, handler)
    return () => offWsEvent(WS_EVENTS.FILE_SCRAPE_PROGRESS, handler)
  }, [onWsEvent, offWsEvent])

  // 执行操作
  const handleExecuteAction = async (action: SuggestedAction) => {
    if (!sessionId || executing) return

    setExecuting(action.id)
    // 刮削账本必须在发请求前登记：后端起任务与 HTTP 响应返回之间就会广播 file_scrape_progress，
    // 等响应回来再建账本会丢掉这段窗口内的事件（含快速失败文件的终态）
    const scrapeTrack: ScrapeTrack | null = action.action === 'scrape'
      ? {
          msgIndex: -1,
          status: Object.fromEntries(lastChatMediaIdsRef.current.map(id => [id, 'pending'])),
          titles: {},
        }
      : null
    if (scrapeTrack) scrapeTrackRef.current = scrapeTrack

    try {
      const res = await aiAssistantApi.executeAction({
        session_id: sessionId,
        action_id: action.id,
      })

      const data = res.data.data
      const resultMsg: ChatMsg = {
        role: 'assistant',
        content: data.success
          ? `✅ ${data.message}${data.errors?.length ? `\n\n⚠️ 部分错误:\n${data.errors.join('\n')}` : ''}`
          : `❌ ${data.message}`,
        timestamp: new Date().toISOString(),
        previews: data.results,
      }
      setMessages(prev => [...prev, resultMsg])

      // 刮削任务：追加一条实时进度消息，WS 事件（file_scrape_progress）会就地更新它。
      // 初始文案直接由账本生成，早到的事件不会丢
      if (scrapeTrack && data.success) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: scrapeProgressText(scrapeTrack),
          timestamp: new Date().toISOString(),
        }])
        scrapeTrack.msgIndex = messages.length + 1
      } else if (scrapeTrackRef.current === scrapeTrack) {
        scrapeTrackRef.current = null // 执行失败，撤销账本
      }

      if (data.success) {
        setExecutedIds(prev => new Set(prev).add(action.id))
        toast.success(data.message)
        onOperationComplete?.()
      }
    } catch (err: any) {
      if (scrapeTrackRef.current === scrapeTrack) scrapeTrackRef.current = null
      toast.error(err?.response?.data?.error || '操作执行失败')
    } finally {
      setExecuting(null)
    }
  }

  // 撤销操作
  const handleUndo = async (opId: string) => {
    try {
      const res = await aiAssistantApi.undoOperation(opId)
      const data = res.data.data
      toast.success(data.message)
      onOperationComplete?.()
      // 刷新历史
      loadHistory()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || '撤销失败')
    }
  }

  // 加载操作历史
  const loadHistory = async () => {
    try {
      const res = await aiAssistantApi.getOperationHistory(20)
      setOpHistory(res.data.data || [])
    } catch {
      // 忽略
    }
  }

  // 新建会话
  const handleNewSession = () => {
    setSessionId('')
    setMessages([])
    setExpandedPreviews(new Set())
  }

  // 切换预览展开
  const togglePreview = (index: number) => {
    setExpandedPreviews(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  // 快捷指令
  const quickCommands = [
    { label: '📊 分析文件库', cmd: '分析当前文件库的整体状态，给出优化建议' },
    { label: '🔍 批量刮削', cmd: '为选中的文件批量获取元数据' },
    { label: '🏷️ 自动分类', cmd: '分析选中文件的内容，自动添加合适的标签分类' },
    { label: '🔧 检测问题', cmd: '检查选中文件是否有命名不规范、信息缺失等问题' },
    { label: '🎬 误分类检测', cmd: '分析文件库中被误标记为电影的剧集文件，提供重分类建议' },
  ]

  // 渲染预览列表
  const renderPreviews = (previews: OperationPreview[], msgIndex: number) => {
    if (!previews || previews.length === 0) return null
    const isExpanded = expandedPreviews.has(msgIndex)

    return (
      <div className="mt-2">
        <button
          onClick={() => togglePreview(msgIndex)}
          className="flex items-center gap-1 text-xs hover:text-neon transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          预览变更 ({previews.length} 项)
        </button>
        {isExpanded && (
          <div className="mt-1.5 space-y-1 max-h-48 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {previews.map((p, i) => (
              <div key={i} className="flex items-start gap-2 p-1.5 rounded text-xs" style={{ background: 'var(--bg-tertiary)' }}>
                <span className="text-surface-500 font-mono flex-shrink-0 w-4 text-right">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-red-400/80 line-through truncate">{p.old_value}</div>
                  <div className="flex items-center gap-1">
                    <ArrowRight size={10} className="text-surface-500 flex-shrink-0" />
                    <span className="text-green-400 truncate">{p.new_value}</span>
                  </div>
                </div>
                <span className="text-[10px] px-1 py-0.5 rounded flex-shrink-0"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-tertiary)' }}>
                  {p.change_type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // 渲染操作按钮
  const renderActions = (actions: SuggestedAction[]) => {
    if (!actions || actions.length === 0) return null

    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {actions.map(action => (
          <button
            key={action.id}
            onClick={() => handleExecuteAction(action)}
            disabled={!!executing || executedIds.has(action.id)}
            className={clsx(
              'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
              action.dangerous
                ? 'border border-red-500/30 text-red-400 hover:bg-red-500/10'
                : 'border border-neon/30 text-neon hover:bg-neon-blue/10',
              executing === action.id && 'opacity-50',
              executedIds.has(action.id) && 'opacity-60'
            )}
            title={action.description}
          >
            {executing === action.id ? (
              <Loader2 size={12} className="animate-spin" />
            ) : executedIds.has(action.id) ? (
              <Check size={12} />
            ) : action.dangerous ? (
              <AlertTriangle size={12} />
            ) : (
              <Play size={12} />
            )}
            {action.label}
          </button>
        ))}
      </div>
    )
  }

  // 面板未展开时不渲染
  if (!isOpen) return null

  return (
    // 收起时不设高（自适应为标题栏高度），面板依旧由底部锚定向上生长
    <div className={clsx('flex flex-col', !isMinimized && 'h-[calc(100vh-160px)]')}>
      <div className="flex flex-col h-full bg-card border border-border rounded-xl shadow-lg overflow-hidden">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Bot size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">AI 文件助手</h3>
              <p className="text-[10px] text-muted-foreground">
                {selectedMediaIds.length > 0 ? `已选 ${selectedMediaIds.length} 个文件` : '自然语言管理文件'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => { setShowHistory(!showHistory) ; if (!showHistory) loadHistory() }}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="操作历史">
              <History size={14} />
            </button>
            <button onClick={handleNewSession}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="新建会话">
              <Trash2 size={14} />
            </button>
            <button onClick={() => setIsMinimized(!isMinimized)}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={isMinimized ? '展开面板' : '收起面板'}>
              {isMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
            </button>
            <button onClick={onToggle}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <X size={14} />
            </button>
          </div>
        </div>

        {!isMinimized && (
          <>
            {/* 操作历史面板 */}
            {showHistory && (
              <div className="max-h-48 overflow-y-auto border-b px-4 py-3" style={{ scrollbarWidth: 'thin' }}>
                <h4 className="mb-2 text-xs font-bold text-foreground">操作历史</h4>
                {opHistory.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无操作记录</p>
                ) : (
                  <div className="space-y-1.5">
                    {opHistory.map(op => (
                      <div key={op.id} className="flex items-center justify-between rounded-lg bg-muted/50 p-2 text-xs">
                        <div className="flex-1 min-w-0">
                          <span className={clsx('font-medium', op.undone ? 'line-through text-muted-foreground' : 'text-foreground')}>
                            {op.action}
                          </span>
                          <span className="ml-2 text-muted-foreground">
                            {op.previews?.length || 0} 项
                          </span>
                        </div>
                        {!op.undone && op.previews?.length > 0 && (
                          <button onClick={() => handleUndo(op.id)}
                            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-amber-400 transition-colors hover:bg-amber-400/10">
                            <Undo2 size={10} /> 撤销
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 消息列表：flex-1 填满面板，输入区钉底 */}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" style={{ scrollbarWidth: 'thin' }}>
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Sparkles size={24} />
                  </div>
                  <p className="mb-1 text-sm font-medium text-foreground">
                    你好！我是AI文件助手
                  </p>
                  <p className="mb-4 text-center text-xs text-muted-foreground">
                    用自然语言告诉我你想做什么<br />
                    比如重命名、刮削、分类整理等
                  </p>
                  {/* 快捷指令 */}
                  <div className="w-full space-y-1.5">
                    {quickCommands.map((cmd, i) => (
                      <button
                        key={i}
                        onClick={() => { setInput(cmd.cmd); setTimeout(() => inputRef.current?.focus(), 50) }}
                        className="w-full rounded-lg bg-muted/50 px-3 py-2 text-left text-xs text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
                      >
                        {cmd.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={clsx('flex gap-2', msg.role === 'user' ? 'flex-row-reverse' : '')}>
                    {/* 头像 */}
                    <div className={clsx(
                      'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg',
                      msg.role === 'user' ? 'bg-secondary text-secondary-foreground' : 'bg-primary text-primary-foreground'
                    )}>
                      {msg.role === 'user' ? <User size={12} /> : <Bot size={12} />}
                    </div>
                    {/* 消息内容 */}
                    <div className={clsx(
                      'min-w-0 max-w-[85%] rounded-xl px-3 py-2',
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    )}>
                      {msg.role === 'assistant' ? (
                        <MarkdownContent content={msg.content} />
                      ) : (
                        <p className="whitespace-pre-wrap text-xs">{msg.content}</p>
                      )}
                      {renderPreviews(msg.previews || [], i)}
                      {renderActions(msg.actions || [])}
                    </div>
                  </div>
                ))
              )}
              {loading && (
                <div className="flex gap-2">
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Bot size={12} />
                  </div>
                  <div className="rounded-xl bg-muted px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Loader2 size={12} className="animate-spin text-neon" />
                      <span className="text-xs text-muted-foreground">思考中...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 输入区域 */}
            <div className="border-t px-4 py-3">
              {/* 选中文件提示 */}
              {selectedMediaIds.length > 0 && (
                <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-muted/50 px-2 py-1 text-[10px] text-muted-foreground">
                  <MessageSquare size={10} />
                  已关联 {selectedMediaIds.length} 个选中文件
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder="输入指令，如：帮我把这些文件按电影格式重命名..."
                  className="min-h-9 max-h-20 flex-1 resize-none rounded-xl bg-muted/50 px-3 py-2 text-xs text-foreground outline-none transition-all placeholder:text-muted-foreground focus:ring-1 focus:ring-neon/30"
                  rows={1}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || loading}
                  className={clsx(
                    'flex h-9 w-9 items-center justify-center rounded-xl transition-all',
                    input.trim() && !loading
                      ? 'bg-primary text-primary-foreground hover:scale-105 active:scale-95'
                      : 'bg-muted/50 text-muted-foreground opacity-50'
                  )}
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** AI助手侧边面板包装器（带动画过渡） */
export function AIAssistantPanel({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) {
  return (
    <div
      className={clsx(
        'fixed bottom-24 right-6 z-50 w-[380px] transition-all duration-300 ease-out',
        isOpen ? 'visible opacity-100 translate-y-0' : 'invisible pointer-events-none opacity-0 translate-y-4'
      )}
    >
      {/* 高度由内部面板自行决定，收起时才不会残留空白 */}
      <div className="w-full">
        {children}
      </div>
    </div>
  )
}
