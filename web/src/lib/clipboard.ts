/**
 * 剪贴板工具函数
 *
 * 优先使用 Clipboard API（需要 HTTPS 安全上下文），失败时回退到
 * document.execCommand('copy') 兼容 HTTP 开发环境。
 *
 * 用法参考 AdminPage.tsx 的 copyDoubanImportText。
 */

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}
