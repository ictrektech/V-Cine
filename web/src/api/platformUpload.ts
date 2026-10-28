/**
 * 直传 VOS Finder 上传端点（`POST /v1000/finder_next/upload`）
 *
 * 为什么用 XHR 而不是 fetch：需要上传进度（fetch 无上传进度事件）。
 * 契约（见 tasks/media-import/PLAN.md 4.4）：
 * - multipart/form-data：adapter / path / name / conflict_strategy / file
 * - 单请求流式落盘，无 body 上限；无分片/断点续传（失败需整文件重传）
 * - 成功返回 `code=0`、`data=""`；错误码 10001/10017/10045/10047/10051/10055
 */

const UPLOAD_ENDPOINT = '/v1000/finder_next/upload'

export class PlatformUploadError extends Error {
  /** 平台业务错误码；-1 网络错误，-2 用户取消，-3 响应不可解析 */
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'PlatformUploadError'
    this.code = code
  }
}

export interface UploadToVOSParams {
  adapter: string
  /** adapter 内的目标目录，如 `/_incoming` */
  path: string
  /** 目标文件名（平台允许含 `/` 表达子目录） */
  name: string
  file: File
  token: string
  conflictStrategy?: 'reject' | 'skip' | 'overwrite' | 'rename'
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
}

export function uploadToVOS(params: UploadToVOSParams): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const form = new FormData()
    form.append('adapter', params.adapter)
    form.append('path', params.path)
    form.append('name', params.name)
    form.append('conflict_strategy', params.conflictStrategy ?? 'skip')
    form.append('file', params.file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', UPLOAD_ENDPOINT, true)
    xhr.setRequestHeader('Authorization', `Bearer ${params.token}`)

    if (params.onProgress) {
      const onProgress = params.onProgress
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total)
      }
    }

    const onAbort = () => xhr.abort()
    params.signal?.addEventListener('abort', onAbort)
    const cleanup = () => params.signal?.removeEventListener('abort', onAbort)

    xhr.onerror = () => {
      cleanup()
      reject(new PlatformUploadError(-1, 'network error'))
    }
    xhr.onabort = () => {
      cleanup()
      reject(new PlatformUploadError(-2, 'aborted'))
    }
    xhr.onload = () => {
      cleanup()
      let code = -3
      let msg = ''
      try {
        const body = JSON.parse(xhr.responseText)
        code = typeof body?.code === 'number' ? body.code : -3
        msg = typeof body?.msg === 'string' ? body.msg : ''
      } catch {
        /* 非 JSON 响应：按 HTTP 状态判断 */
      }
      if (xhr.status >= 200 && xhr.status < 300 && code === 0) {
        resolve()
        return
      }
      reject(new PlatformUploadError(code, msg || `HTTP ${xhr.status}`))
    }

    xhr.send(form)
  })
}
