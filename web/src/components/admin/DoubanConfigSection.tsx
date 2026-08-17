import { useEffect, useState } from 'react'
import {
  Film, ExternalLink, Key, Eye, EyeOff, Check, X, Loader2, Trash2, Zap as ZapIcon, Copy as CopyIcon, ClipboardPaste, Bookmark, RefreshCw, Info, ChevronRight,
} from 'lucide-react'
import clsx from 'clsx'
import { Modal } from '@/components/ui/modal'
import { adminApi } from '@/api'
import { useDialog } from '@/components/Dialog'
import type { DoubanConfigStatus, DoubanImportTokenInfo, DoubanImportTokenStatus } from '@/types'

// ==================== 元数据刮削 › 豆瓣 Cookie 配置 ====================
// Cookie 配置（懒人版导入 / 手动 / 测试 / 清除）+ 导入引导模态框。

type Props = {
  doubanConfig: DoubanConfigStatus | null
  setDoubanConfig: (c: DoubanConfigStatus) => void
}

export default function DoubanConfigSection({ doubanConfig, setDoubanConfig }: Props) {
  const dialog = useDialog()
  const [cookieInput, setCookieInput] = useState('')
  const [editing, setEditing] = useState(false)
  const [showCookie, setShowCookie] = useState(false)
  const [saving, setSaving] = useState(false)
  const [validating, setValidating] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  // 懒人版一键导入
  const [importOpen, setImportOpen] = useState(false)
  const [importInfo, setImportInfo] = useState<DoubanImportTokenInfo | null>(null)
  const [importStatus, setImportStatus] = useState<DoubanImportTokenStatus | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importCopied, setImportCopied] = useState<'script' | 'bookmarklet' | null>(null)
  const [pasting, setPasting] = useState(false)

  const showMsg = (type: 'success' | 'error' | 'info', text: string) => {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 5000)
  }

  const handleSaveCookie = async () => {
    const cookie = cookieInput.trim()
    if (!cookie) return
    setSaving(true)
    try {
      const res = await adminApi.updateDoubanConfig(cookie)
      setDoubanConfig(res.data.data)
      setCookieInput('')
      setEditing(false)
      setShowCookie(false)
      showMsg('success', '豆瓣 Cookie 已保存')
    } catch (err: any) {
      const m = err?.response?.data?.error || '保存失败，请稍后重试'
      showMsg('error', m)
    } finally {
      setSaving(false)
    }
  }

  const handleClearCookie = async () => {
    const ok = await dialog.confirm({
      title: '清除豆瓣 Cookie',
      message: '确定要清除豆瓣 Cookie 吗？清除后豆瓣刮削将回退到匿名模式（成功率较低）。',
      confirmText: '清除',
      variant: 'danger',
    })
    if (!ok) return
    try {
      const res = await adminApi.clearDoubanConfig()
      setDoubanConfig(res.data.data)
      setCookieInput('')
      setEditing(false)
      showMsg('success', '豆瓣 Cookie 已清除')
    } catch {
      showMsg('error', '清除失败，请稍后重试')
    }
  }

  const handleValidateCookie = async () => {
    setValidating(true)
    try {
      const res = await adminApi.validateDoubanConfig()
      const { valid, message } = res.data.data
      showMsg(valid ? 'success' : 'error', message)
    } catch (err: any) {
      const m = err?.response?.data?.error || '校验失败'
      showMsg('error', m)
    } finally {
      setValidating(false)
    }
  }

  // ===== 懒人版导入 =====
  const openImport = async () => {
    setImportOpen(true)
    setImportInfo(null)
    setImportStatus(null)
    setImportCopied(null)
    setImportLoading(true)
    try {
      const res = await adminApi.createDoubanImportToken()
      setImportInfo(res.data.data)
    } catch (err: any) {
      const m = err?.response?.data?.error || '生成导入链接失败，请稍后重试'
      showMsg('error', m)
      setImportOpen(false)
    } finally {
      setImportLoading(false)
    }
  }

  const closeImport = () => {
    setImportOpen(false)
    setImportInfo(null)
    setImportStatus(null)
  }

  const copyImportText = async (text: string, kind: 'script' | 'bookmarklet') => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setImportCopied(kind)
    setTimeout(() => setImportCopied(null), 2000)
  }

  const handlePasteImport = async () => {
    setPasting(true)
    try {
      let cookie = ''
      if (navigator.clipboard && navigator.clipboard.readText) {
        try {
          cookie = (await navigator.clipboard.readText()) || ''
        } catch {
          cookie = ''
        }
      }
      if (!cookie) {
        const input = await dialog.prompt({
          title: '手动粘贴豆瓣 Cookie',
          message: '无法自动读取剪贴板，请在下方手动粘贴豆瓣 Cookie：',
          placeholder: '粘贴完整 Cookie 字符串',
          inputType: 'textarea',
        })
        cookie = (input || '').trim()
      }
      cookie = cookie.trim()
      if (!cookie) {
        showMsg('error', '未读取到 Cookie，请先在豆瓣页面执行脚本')
        return
      }
      if (cookie.length < 20) {
        showMsg('error', 'Cookie 内容过短，请确认已在豆瓣页面成功执行脚本')
        return
      }
      if (!cookie.includes('dbcl2=')) {
        showMsg('error', '剪贴板内容中缺少登录凭证 dbcl2（浏览器将其标为 HttpOnly，JS 读不到）。请改用『方式 3：Cookie 浏览器插件』导出完整 Cookie')
        return
      }
      const res = await adminApi.updateDoubanConfig(cookie)
      setDoubanConfig(res.data.data)
      showMsg('success', '豆瓣 Cookie 已导入，正在校验登录态...')
      try {
        const vres = await adminApi.validateDoubanConfig()
        const { valid, message } = vres.data.data
        showMsg(valid ? 'success' : 'error', message)
      } catch {
        // 校验失败不影响导入结果
      }
      closeImport()
    } catch (err: any) {
      const m = err?.response?.data?.error || '导入失败，请确认 Cookie 格式正确'
      showMsg('error', m)
    } finally {
      setPasting(false)
    }
  }

  // 轮询导入状态
  useEffect(() => {
    if (!importOpen || !importInfo) return
    if (importStatus?.status === 'success' || importStatus?.status === 'expired') return
    const timer = setInterval(async () => {
      try {
        const res = await adminApi.getDoubanImportTokenStatus(importInfo.token)
        setImportStatus(res.data.data)
        if (res.data.data.status === 'success') {
          const cfgRes = await adminApi.getDoubanConfig()
          setDoubanConfig(cfgRes.data.data)
          showMsg('success', res.data.data.message || '豆瓣 Cookie 已导入')
        }
      } catch {
        // 静默失败，下一轮再试
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [importOpen, importInfo, importStatus?.status, setDoubanConfig])

  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-wide" style={{ color: 'var(--text-primary)' }}>
        <Film size={20} className="text-neon/60" />
        豆瓣刮削登录配置
      </h2>
      <div className="glass-panel rounded-xl p-5">
        {/* 说明信息（折叠，避免长文抢占视觉重点） */}
        <details className="group mb-5">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium select-none" style={{ color: 'var(--text-tertiary)' }}>
            <Info size={13} />
            如何获取豆瓣 Cookie
            <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
          </summary>
          <div className="mt-3 rounded-lg p-4" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)' }}>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              配置豆瓣登录 <span className="font-medium text-neon">Cookie</span> 后可提升豆瓣刮削成功率、降低风控概率，并获取更完整的元数据。
              未配置时将以匿名模式访问（成功率较低）。
            </p>
            <p className="mt-2 text-xs text-surface-400">
              获取方式：浏览器登录豆瓣 → F12 打开开发者工具 → Network 标签 → 刷新页面 → 任意请求的 Request Headers → 复制完整 <code className="text-neon font-mono">Cookie</code> 值
            </p>
            <a
              href="https://www.douban.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-neon hover:text-neon-blue transition-colors"
            >
              <ExternalLink size={14} />
              打开豆瓣登录
            </a>
          </div>
        </details>

        {/* 当前状态 */}
        <div className="mb-4 flex items-center gap-3">
          <div className={clsx(
            'flex h-10 w-10 items-center justify-center rounded-lg',
            doubanConfig?.configured ? 'bg-green-500/10' : ''
          )}
            style={!doubanConfig?.configured ? { background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)' } : undefined}
          >
            <Key size={18} className={doubanConfig?.configured ? 'text-green-400' : 'text-surface-500'} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {doubanConfig?.configured ? 'Cookie 已配置' : 'Cookie 未配置（匿名模式）'}
            </p>
            {doubanConfig?.configured && doubanConfig.masked_cookie && (
              <p className="mt-0.5 flex items-center gap-2 text-xs text-surface-400 font-mono truncate">
                {showCookie ? doubanConfig.masked_cookie : '••••••••••••••••••••'}
                <button
                  onClick={() => setShowCookie(!showCookie)}
                  className="text-surface-500 hover:text-surface-300 transition-colors flex-shrink-0"
                  title={showCookie ? '隐藏' : '显示掩码'}
                >
                  {showCookie ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </p>
            )}
          </div>
        </div>

        {/* 操作提示消息 */}
        {msg && (
          <div className={clsx(
            'mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm',
            msg.type === 'success' && 'bg-green-500/10 text-green-400',
            msg.type === 'error' && 'bg-red-500/10 text-red-400',
            msg.type === 'info' && 'bg-blue-500/10 text-blue-400'
          )}>
            {msg.type === 'success' ? <Check size={16} /> : <X size={16} />}
            {msg.text}
          </div>
        )}

        {/* 编辑表单 */}
        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                豆瓣 Cookie 字符串
              </label>
              <textarea
                value={cookieInput}
                onChange={(e) => setCookieInput(e.target.value)}
                className="input font-mono text-xs min-h-[120px] resize-y"
                placeholder='示例：bid=xxxxxxxxxxxx; ll="108288"; dbcl2="xxxxxxx:xxxxxxx"; ck=xxxx; ...'
                autoFocus
              />
              <p className="mt-1.5 text-xs text-surface-500">
                应当包含 <code className="text-neon font-mono">bid</code> / <code className="text-neon font-mono">dbcl2</code> 等关键字段。Cookie 有效期约 1 个月，失效后需重新获取。
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleSaveCookie}
                disabled={!cookieInput.trim() || saving}
                className="btn-primary gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
              >
                {saving ? (
                  <><Loader2 size={14} className="animate-spin" />保存中...</>
                ) : (
                  <><Check size={14} />保存</>
                )}
              </button>
              <button
                onClick={() => { setEditing(false); setCookieInput('') }}
                className="btn-ghost px-4 py-2 text-sm"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={openImport}
              className="btn-primary gap-1.5 px-4 py-2 text-sm"
              style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
              title="无需 F12，通过浏览器书签一键导入 Cookie"
            >
              <ZapIcon size={14} />
              懒人版登录
            </button>
            <button
              onClick={() => setEditing(true)}
              className="btn-ghost gap-1.5 px-4 py-2 text-sm"
            >
              <Key size={14} />
              {doubanConfig?.configured ? '手动修改 Cookie' : '手动配置 Cookie'}
            </button>
            {doubanConfig?.configured && (
              <>
                <button
                  onClick={handleValidateCookie}
                  disabled={validating}
                  className="btn-ghost gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
                >
                  {validating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  测试连接
                </button>
                <button
                  onClick={handleClearCookie}
                  className="btn-ghost gap-1.5 px-4 py-2 text-sm text-red-400 hover:text-red-300"
                >
                  <Trash2 size={14} />
                  清除 Cookie
                </button>
              </>
            )}
          </div>
        )}

        {/* 安全提示 */}
        <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border-default)' }}>
          <p className="text-xs text-surface-500 leading-relaxed">
            ⚠️ <span className="font-medium text-surface-400">安全提示</span>：Cookie 等同于您的豆瓣登录凭证，请妥善保管。仅供个人刮削使用，请勿分享或用于商业/公共服务。如账号被豆瓣风控，请先清除 Cookie 使用匿名模式。
          </p>
        </div>
      </div>

      {/* ===== 懒人版导入引导模态框 ===== */}
      {importOpen && (
        <Modal onClose={closeImport} className="max-w-2xl">
          <div className="glass-panel rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                  <ZapIcon size={18} className="text-green-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>豆瓣懒人版登录</h3>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>无需 F12，剪贴板中转导入豆瓣 Cookie</p>
                </div>
              </div>
              <button onClick={closeImport} className="btn-ghost p-1.5 rounded-lg">
                <X size={16} />
              </button>
            </div>

            {importLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-neon" />
                <span className="ml-3 text-sm" style={{ color: 'var(--text-secondary)' }}>正在生成一次性导入链接...</span>
              </div>
            )}

            {importInfo && !importLoading && (
              <>
                {/* 状态条 */}
                {importStatus?.status === 'success' ? (
                  <div className="mb-5 rounded-lg p-4" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.4)' }}>
                    <div className="flex items-center gap-2 font-medium text-sm" style={{ color: 'rgb(5,150,105)' }}>
                      <Check size={18} /> 导入成功！
                    </div>
                    <p className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{importStatus.message}</p>
                    <button onClick={closeImport} className="mt-3 btn-primary px-4 py-1.5 text-sm">完成</button>
                  </div>
                ) : importStatus?.status === 'expired' ? (
                  <div className="mb-5 rounded-lg p-4" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)' }}>
                    <div className="flex items-center gap-2 font-medium text-sm" style={{ color: 'rgb(220,38,38)' }}>
                      <X size={18} /> 链接已过期
                    </div>
                    <button onClick={openImport} className="mt-3 btn-primary gap-1.5 px-4 py-1.5 text-sm">
                      <RefreshCw size={13} />
                      重新生成
                    </button>
                  </div>
                ) : importStatus?.status === 'failed' ? (
                  <div className="mb-5 rounded-lg p-4" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)' }}>
                    <div className="flex items-center gap-2 font-medium text-sm" style={{ color: 'rgb(220,38,38)' }}>
                      <X size={18} /> 导入失败
                    </div>
                    <p className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{importStatus.message}</p>
                    <button onClick={openImport} className="mt-3 btn-primary gap-1.5 px-4 py-1.5 text-sm">
                      <RefreshCw size={13} />
                      重新生成
                    </button>
                  </div>
                ) : (
                  <div className="mb-5 rounded-lg p-4" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.4)' }}>
                    <div className="flex items-center gap-2 font-medium text-sm" style={{ color: 'rgb(5,150,105)' }}>
                      <ClipboardPaste size={16} />
                      已在豆瓣页面执行完脚本？点下面按钮导入
                    </div>
                    <p className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      脚本已将豆瓣 Cookie 复制到剪贴板，点击下方按钮即可完成导入（无需跨域）。
                    </p>
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <button
                        onClick={handlePasteImport}
                        disabled={pasting}
                        className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition-all disabled:opacity-50 hover:brightness-110"
                        style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
                      >
                        {pasting ? (
                          <><Loader2 size={14} className="animate-spin" />正在导入...</>
                        ) : (
                          <><ClipboardPaste size={14} />📋 从剪贴板粘贴并导入</>
                        )}
                      </button>
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        未执行脚本？请按下面方式一/方式二操作
                      </span>
                    </div>
                  </div>
                )}

                {/* 使用方法 Tab 区 */}
                <div className="mb-4">
                  <h4 className="mb-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    在豆瓣页面执行脚本（三种方式任选其一）
                  </h4>

                  {/* 关键提示条 */}
                  <div className="mb-4 rounded-lg p-4" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)' }}>
                    <div className="flex items-center gap-2 mb-1.5 text-sm font-medium" style={{ color: 'rgb(217,119,6)' }}>
                      ⚠️ 重要：方式 1/2 在大多数现代浏览器中已失效
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      豆瓣的核心登录凭证 <code className="text-neon font-mono">dbcl2</code> 被设为 <code className="font-mono">HttpOnly</code>，浏览器禁止所有 JS / Bookmarklet 读取。
                      仅能复制到不包含登录态的跟踪 Cookie，导入后测试连接仍会提示未登录。<br/>
                      <span className="font-medium" style={{ color: 'rgb(5,150,105)' }}>✅ 强烈推荐使用方式 3（Cookie 浏览器插件）</span>，可靠完整地导出包含 <code className="font-mono">dbcl2</code> 在内的所有 Cookie。
                    </p>
                  </div>

                  {/* 方式三：浏览器插件 */}
                  <div className="glass-panel-subtle mb-4 rounded-lg p-4" style={{ border: '1px solid rgba(16,185,129,0.4)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <ExternalLink size={14} className="text-neon" />
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>方式 3：Cookie 浏览器插件</span>
                      <span className="ml-auto text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(16,185,129,0.15)', color: 'rgb(5,150,105)' }}>✅ 最可靠·推荐</span>
                    </div>
                    <ol className="text-xs space-y-1 ml-5 list-decimal mb-2" style={{ color: 'var(--text-secondary)' }}>
                      <li>在 Chrome / Edge / Firefox 扩展商店搜索安装 <span className="text-neon font-medium">Cookie-Editor</span>（或 <span className="text-neon">EditThisCookie</span>）</li>
                      <li>访问 <a href={importInfo.douban_url} target="_blank" rel="noopener noreferrer" className="text-neon underline">豆瓣首页</a> 并确认已登录</li>
                      <li>点击插件图标 → 右下角 <span className="text-neon font-medium">Export → Header String</span>（正好是分号分隔格式）</li>
                      <li>关闭本弹窗 → 点击『手动配置 Cookie』→ 粘贴 → 保存 → 测试连接</li>
                    </ol>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      💡 这样导出的 Cookie 包含 <code className="text-neon font-mono">dbcl2</code>、<code className="text-neon font-mono">dbcl</code> 等完整登录态，测试连接一定能通过。
                    </p>
                  </div>

                  {/* 方式一：Bookmarklet */}
                  <div className="glass-panel-subtle mb-4 rounded-lg p-4" style={{ opacity: 0.85 }}>
                    <div className="flex items-center gap-2 mb-2">
                      <Bookmark size={14} className="text-surface-400" />
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>方式 1：浏览器书签（Bookmarklet）</span>
                      <span className="ml-auto text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.15)', color: 'rgb(217,119,6)' }}>⚠️ 仅在未启用 HttpOnly 时可用</span>
                    </div>
                    <ol className="text-xs space-y-1 ml-5 list-decimal mb-3" style={{ color: 'var(--text-secondary)' }}>
                      <li>把下面的链接 <span className="text-neon">拖动</span> 到浏览器 <span className="text-neon">书签栏</span>（或右键加入书签）</li>
                      <li>打开 <a href={importInfo.douban_url} target="_blank" rel="noopener noreferrer" className="text-neon underline">豆瓣首页</a> 并确保已登录</li>
                      <li>点击刚刚创建的书签 → 若提示缺少 dbcl2 请改用方式 3</li>
                      <li>成功后回到本页面 → 点击上方 <span style={{ color: 'rgb(5,150,105)' }} className="font-medium">《从剪贴板粘贴并导入》</span></li>
                    </ol>
                    <div className="flex items-center gap-2">
                      <a
                        href={importInfo.bookmarklet}
                        onClick={(e) => e.preventDefault()}
                        className="btn-primary gap-1.5 px-3 py-1.5 text-xs cursor-grab active:cursor-grabbing select-none"
                        draggable
                        title="拖到书签栏即可"
                      >
                        <Bookmark size={12} />
                        📌 豆瓣一键登录
                      </a>
                      <button
                        onClick={() => copyImportText(importInfo.bookmarklet, 'bookmarklet')}
                        className="btn-ghost gap-1.5 px-3 py-1.5 text-xs"
                      >
                        {importCopied === 'bookmarklet' ? <Check size={12} className="text-green-400" /> : <CopyIcon size={12} />}
                        复制书签地址
                      </button>
                    </div>
                  </div>

                  {/* 方式二：控制台脚本 */}
                  <div className="glass-panel-subtle rounded-lg p-4" style={{ opacity: 0.85 }}>
                    <div className="flex items-center gap-2 mb-2">
                      <Key size={14} className="text-surface-400" />
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>方式 2：浏览器控制台</span>
                      <span className="ml-auto text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.15)', color: 'rgb(217,119,6)' }}>⚠️ 仅在未启用 HttpOnly 时可用</span>
                    </div>
                    <ol className="text-xs space-y-1 ml-5 list-decimal mb-3" style={{ color: 'var(--text-secondary)' }}>
                      <li>打开 <a href={importInfo.douban_url} target="_blank" rel="noopener noreferrer" className="text-neon underline">豆瓣首页</a> 并登录</li>
                      <li>按 <kbd className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>F12</kbd> 打开开发者工具 → Console 标签</li>
                      <li>粘贴下面脚本并回车 → 若提示缺少 dbcl2 请改用方式 3</li>
                      <li>成功后回到本页面 → 点击上方 <span style={{ color: 'rgb(5,150,105)' }} className="font-medium">《从剪贴板粘贴并导入》</span></li>
                    </ol>
                    <div className="relative">
                      <pre className="rounded p-2 text-[11px] font-mono max-h-32 overflow-auto whitespace-pre-wrap break-all" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
                        {importInfo.script.trim()}
                      </pre>
                      <button
                        onClick={() => copyImportText(importInfo.script, 'script')}
                        className="absolute top-2 right-2 btn-ghost gap-1 px-2 py-1 text-xs"
                      >
                        {importCopied === 'script' ? <Check size={11} className="text-green-500" /> : <CopyIcon size={11} />}
                        {importCopied === 'script' ? '已复制' : '复制'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t" style={{ borderColor: 'var(--border-default)' }}>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    🔒 本方案采用<span className="text-neon">剪贴板中转</span>，豆瓣页面不会直接访问后台，适用于 HTTP / 内网部署场景。Cookie 仅保存在您的服务器上，不会发送给第三方。
                  </p>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </section>
  )
}
