import { useTranslation } from '@/i18n'
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
  const { t } = useTranslation()
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
      showMsg('success', t('dub.saved'))
    } catch (err: any) {
      const m = err?.response?.data?.error || t('dub.saveFailed')
      showMsg('error', m)
    } finally {
      setSaving(false)
    }
  }

  const handleClearCookie = async () => {
    const ok = await dialog.confirm({
      title: t('dub.clearTitle'),
      message: t('dub.clearMsg'),
      confirmText: t('dub.clearConfirm'),
      variant: 'danger',
    })
    if (!ok) return
    try {
      const res = await adminApi.clearDoubanConfig()
      setDoubanConfig(res.data.data)
      setCookieInput('')
      setEditing(false)
      showMsg('success', t('dub.cleared'))
    } catch {
      showMsg('error', t('dub.clearFailed'))
    }
  }

  const handleValidateCookie = async () => {
    setValidating(true)
    try {
      const res = await adminApi.validateDoubanConfig()
      const { valid, message } = res.data.data
      showMsg(valid ? 'success' : 'error', message)
    } catch (err: any) {
      const m = err?.response?.data?.error || t('dub.validateFailed')
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
      const m = err?.response?.data?.error || t('dub.linkGenFailed')
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
          title: t('dub.pasteTitle'),
          message: t('dub.pasteMsg'),
          placeholder: t('dub.pastePlaceholder'),
          inputType: 'textarea',
        })
        cookie = (input || '').trim()
      }
      cookie = cookie.trim()
      if (!cookie) {
        showMsg('error', t('dub.noCookie'))
        return
      }
      if (cookie.length < 20) {
        showMsg('error', t('dub.cookieTooShort'))
        return
      }
      if (!cookie.includes('dbcl2=')) {
        showMsg('error', t('dub.noDbcl2'))
        return
      }
      const res = await adminApi.updateDoubanConfig(cookie)
      setDoubanConfig(res.data.data)
      showMsg('success', t('dub.importing'))
      try {
        const vres = await adminApi.validateDoubanConfig()
        const { valid, message } = vres.data.data
        showMsg(valid ? 'success' : 'error', message)
      } catch {
        // 校验失败不影响导入结果
      }
      closeImport()
    } catch (err: any) {
      const m = err?.response?.data?.error || t('dub.importFailed')
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
          showMsg('success', res.data.data.message || t('dub.imported'))
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
        {t('dub.title')}
      </h2>
      <div className="glass-panel rounded-xl p-5">
        {/* 说明信息（折叠，避免长文抢占视觉重点） */}
        <details className="group mb-5">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium select-none" style={{ color: 'var(--text-tertiary)' }}>
            <Info size={13} />
            {t('dub.howGet')}
            <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
          </summary>
          <div className="mt-3 rounded-lg p-4" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)' }}>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {t('dub.benefit1')} <span className="font-medium text-neon">Cookie</span>{t('dub.benefit2')}
              {t('dub.benefit3')}
            </p>
            <p className="mt-2 text-xs text-surface-400">
              {t('dub.steps')} <code className="text-neon font-mono">Cookie</code>{t('dub.stepsEnd')}
            </p>
            <a
              href="https://www.douban.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-neon hover:text-neon-blue transition-colors"
            >
              <ExternalLink size={14} />
              {t('dub.openDouban')}
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
              {doubanConfig?.configured ? t('dub.cookieSet') : t('dub.cookieUnset')}
            </p>
            {doubanConfig?.configured && doubanConfig.masked_cookie && (
              <p className="mt-0.5 flex items-center gap-2 text-xs text-surface-400 font-mono truncate">
                {showCookie ? doubanConfig.masked_cookie : '••••••••••••••••••••'}
                <button
                  onClick={() => setShowCookie(!showCookie)}
                  className="text-surface-500 hover:text-surface-300 transition-colors flex-shrink-0"
                  title={showCookie ? t('common.hide') : t('dub.showMask')}
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
                {t('dub.cookieLabel')}
              </label>
              <textarea
                value={cookieInput}
                onChange={(e) => setCookieInput(e.target.value)}
                className="input font-mono text-xs min-h-[120px] resize-y"
                placeholder={t('dub.cookiePlaceholder')}
                autoFocus
              />
              <p className="mt-1.5 text-xs text-surface-500">
                {t('dub.cookieHint1')} <code className="text-neon font-mono">bid</code> / <code className="text-neon font-mono">dbcl2</code> {t('dub.cookieHint2')}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleSaveCookie}
                disabled={!cookieInput.trim() || saving}
                className="btn-primary gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
              >
                {saving ? (
                  <><Loader2 size={14} className="animate-spin" />{t('editLib.saving')}</>
                ) : (
                  <><Check size={14} />{t('dub.save')}</>
                )}
              </button>
              <button
                onClick={() => { setEditing(false); setCookieInput('') }}
                className="btn-ghost px-4 py-2 text-sm"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={openImport}
              className="btn-primary gap-1.5 px-4 py-2 text-sm"
              style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
              title={t('dub.bookmarkHint')}
            >
              <ZapIcon size={14} />
              {t('dub.lazyLogin')}
            </button>
            <button
              onClick={() => setEditing(true)}
              className="btn-ghost gap-1.5 px-4 py-2 text-sm"
            >
              <Key size={14} />
              {doubanConfig?.configured ? t('dub.editCookie') : t('dub.manualCookie')}
            </button>
            {doubanConfig?.configured && (
              <>
                <button
                  onClick={handleValidateCookie}
                  disabled={validating}
                  className="btn-ghost gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
                >
                  {validating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {t('dub.testBtn')}
                </button>
                <button
                  onClick={handleClearCookie}
                  className="btn-ghost gap-1.5 px-4 py-2 text-sm text-red-400 hover:text-red-300"
                >
                  <Trash2 size={14} />
                  {t('dub.clearBtn')}
                </button>
              </>
            )}
          </div>
        )}

        {/* 安全提示 */}
        <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border-default)' }}>
          <p className="text-xs text-surface-500 leading-relaxed">
            ⚠️ <span className="font-medium text-surface-400">{t('dub.securityTitle')}</span>：{t('dub.securityBody')}
          </p>
        </div>
      </div>

      {/* ===== 懒人版导入引导模态框 ===== */}
      <Modal open={importOpen} onClose={closeImport} className="max-w-2xl">
          <div className="glass-panel rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                  <ZapIcon size={18} className="text-green-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{t('dub.lazyTitle')}</h3>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('dub.lazyDesc')}</p>
                </div>
              </div>
              <button onClick={closeImport} className="btn-ghost p-1.5 rounded-lg">
                <X size={16} />
              </button>
            </div>

            {importLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-neon" />
                <span className="ml-3 text-sm" style={{ color: 'var(--text-secondary)' }}>{t('dub.generating')}</span>
              </div>
            )}

            {importInfo && !importLoading && (
              <>
                {/* 状态条 */}
                {importStatus?.status === 'success' ? (
                  <div className="mb-5 rounded-lg p-4" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.4)' }}>
                    <div className="flex items-center gap-2 font-medium text-sm" style={{ color: 'rgb(5,150,105)' }}>
                      <Check size={18} /> {t('dub.importOk')}
                    </div>
                    <p className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{importStatus.message}</p>
                    <button onClick={closeImport} className="mt-3 btn-primary px-4 py-1.5 text-sm">{t('dub.done')}</button>
                  </div>
                ) : importStatus?.status === 'expired' ? (
                  <div className="mb-5 rounded-lg p-4" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)' }}>
                    <div className="flex items-center gap-2 font-medium text-sm" style={{ color: 'rgb(220,38,38)' }}>
                      <X size={18} /> {t('dub.expired')}
                    </div>
                    <button onClick={openImport} className="mt-3 btn-primary gap-1.5 px-4 py-1.5 text-sm">
                      <RefreshCw size={13} />
                      {t('dub.regenerate')}
                    </button>
                  </div>
                ) : importStatus?.status === 'failed' ? (
                  <div className="mb-5 rounded-lg p-4" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)' }}>
                    <div className="flex items-center gap-2 font-medium text-sm" style={{ color: 'rgb(220,38,38)' }}>
                      <X size={18} /> {t('dub.importFail')}
                    </div>
                    <p className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{importStatus.message}</p>
                    <button onClick={openImport} className="mt-3 btn-primary gap-1.5 px-4 py-1.5 text-sm">
                      <RefreshCw size={13} />
                      {t('dub.regenerate')}
                    </button>
                  </div>
                ) : (
                  <div className="mb-5 rounded-lg p-4" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.4)' }}>
                    <div className="flex items-center gap-2 font-medium text-sm" style={{ color: 'rgb(5,150,105)' }}>
                      <ClipboardPaste size={16} />
                      {t('dub.afterScript')}
                    </div>
                    <p className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {t('dub.scriptHint')}
                    </p>
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <button
                        onClick={handlePasteImport}
                        disabled={pasting}
                        className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition-all disabled:opacity-50 hover:brightness-110"
                        style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
                      >
                        {pasting ? (
                          <><Loader2 size={14} className="animate-spin" />{t('dub.importing2')}</>
                        ) : (
                          <><ClipboardPaste size={14} />📋 {t('dub.importBtn')}</>
                        )}
                      </button>
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {t('dub.noScriptHint')}
                      </span>
                    </div>
                  </div>
                )}

                {/* 使用方法 Tab 区 */}
                <div className="mb-4">
                  <h4 className="mb-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('dub.methodsTitle')}
                  </h4>

                  {/* 关键提示条 */}
                  <div className="mb-4 rounded-lg p-4" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)' }}>
                    <div className="flex items-center gap-2 mb-1.5 text-sm font-medium" style={{ color: 'rgb(217,119,6)' }}>
                      {t('dub.warning12')}
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {t('dub.dbcl2Hint1')} <code className="text-neon font-mono">dbcl2</code> <code className="font-mono">HttpOnly</code>{t('dub.dbcl2Hint2')}
                      {t('dub.dbcl2Hint3')}<br/>
                      <span className="font-medium" style={{ color: 'rgb(5,150,105)' }}>✅ {t('dub.recommend3')}</span>，{t('dub.recommend3b')} <code className="font-mono">dbcl2</code>{t('dub.recommend3c')}
                    </p>
                  </div>

                  {/* 方式三：浏览器插件 */}
                  <div className="glass-panel-subtle mb-4 rounded-lg p-4" style={{ border: '1px solid rgba(16,185,129,0.4)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <ExternalLink size={14} className="text-neon" />
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('dub.method3Title')}</span>
                      <span className="ml-auto text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(16,185,129,0.15)', color: 'rgb(5,150,105)' }}>{t('dub.method3Badge')}</span>
                    </div>
                    <ol className="text-xs space-y-1 ml-5 list-decimal mb-2" style={{ color: 'var(--text-secondary)' }}>
                      <li>{t('dub.method3Li1a')} <span className="text-neon font-medium">Cookie-Editor</span>（{t('dub.method3Li1b')} <span className="text-neon">EditThisCookie</span>）</li>
                      <li>{t('dub.visitHome')} <a href={importInfo.douban_url} target="_blank" rel="noopener noreferrer" className="text-neon underline">{t('dub.doubanHome')}</a>{t('dub.visitHomeEnd')}</li>
                      <li>{t('dub.method3Li3')} <span className="text-neon font-medium">Export → Header String</span></li>
                      <li>{t('dub.method3Li4')}</li>
                    </ol>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      💡 {t('dub.method3Tip1')} <code className="text-neon font-mono">dbcl2</code>、<code className="text-neon font-mono">dbcl</code> {t('dub.method3Tip2')}
                    </p>
                  </div>

                  {/* 方式一：Bookmarklet */}
                  <div className="glass-panel-subtle mb-4 rounded-lg p-4" style={{ opacity: 0.85 }}>
                    <div className="flex items-center gap-2 mb-2">
                      <Bookmark size={14} className="text-surface-400" />
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('dub.method1Title')}</span>
                      <span className="ml-auto text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.15)', color: 'rgb(217,119,6)' }}>{t('dub.method1Badge')}</span>
                    </div>
                    <ol className="text-xs space-y-1 ml-5 list-decimal mb-3" style={{ color: 'var(--text-secondary)' }}>
                      <li>{t('dub.method1Li1')}</li>
                      <li>{t('dub.visitHome')} <a href={importInfo.douban_url} target="_blank" rel="noopener noreferrer" className="text-neon underline">{t('dub.doubanHome')}</a>{t('dub.ensureLoggedIn')}</li>
                      <li>{t('dub.method1Li3')}</li>
                      <li>{t('dub.method1Li4')}</li>
                    </ol>
                    <div className="flex items-center gap-2">
                      <a
                        href={importInfo.bookmarklet}
                        onClick={(e) => e.preventDefault()}
                        className="btn-primary gap-1.5 px-3 py-1.5 text-xs cursor-grab active:cursor-grabbing select-none"
                        draggable
                        title={t('dub.dragHint')}
                      >
                        <Bookmark size={12} />
                        📌 {t('dub.bookmarkName')}
                      </a>
                      <button
                        onClick={() => copyImportText(importInfo.bookmarklet, 'bookmarklet')}
                        className="btn-ghost gap-1.5 px-3 py-1.5 text-xs"
                      >
                        {importCopied === 'bookmarklet' ? <Check size={12} className="text-green-400" /> : <CopyIcon size={12} />}
                        {t('dub.copyBookmark')}
                      </button>
                    </div>
                  </div>

                  {/* 方式二：控制台脚本 */}
                  <div className="glass-panel-subtle rounded-lg p-4" style={{ opacity: 0.85 }}>
                    <div className="flex items-center gap-2 mb-2">
                      <Key size={14} className="text-surface-400" />
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('dub.method2Title')}</span>
                      <span className="ml-auto text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.15)', color: 'rgb(217,119,6)' }}>{t('dub.method2Badge')}</span>
                    </div>
                    <ol className="text-xs space-y-1 ml-5 list-decimal mb-3" style={{ color: 'var(--text-secondary)' }}>
                      <li>{t('dub.visitHome')} <a href={importInfo.douban_url} target="_blank" rel="noopener noreferrer" className="text-neon underline">{t('dub.doubanHome')}</a>{t('dub.method2Li1End')}</li>
                      <li>{t('dub.method2Li2a')} <kbd className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--nav-hover-bg)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>F12</kbd>{t('dub.method2Li2b')}</li>
                      <li>{t('dub.method2Li3')}</li>
                      <li>{t('dub.method2Li4')}</li>
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
                        {importCopied === 'script' ? t('dub.copied') : t('dub.copy')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t" style={{ borderColor: 'var(--border-default)' }}>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    🔒 {t('dub.privacy1')}<span className="text-neon">{t('dub.privacy2')}</span>{t('dub.privacy3')}
                  </p>
                </div>
              </>
            )}
          </div>
        </Modal>
    </section>
  )
}
