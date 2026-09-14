export type StorageType = 'local' | 'webdav' | 'alist' | 's3'

export const REMOTE_SCHEMES: Record<Exclude<StorageType, 'local'>, string> = {
  webdav: 'webdav://',
  alist: 'alist://',
  s3: 's3://',
}

export function storageTypeFromPath(p: string): StorageType {
  if (p.startsWith('webdav://')) return 'webdav'
  if (p.startsWith('alist://')) return 'alist'
  if (p.startsWith('s3://')) return 's3'
  return 'local'
}

export function joinRemotePath(storageType: StorageType, rel: string): string {
  if (storageType === 'local') return rel
  const scheme = REMOTE_SCHEMES[storageType]
  return rel === '/' ? scheme : scheme + rel
}

export const STORAGE_TYPE_LABELS: Record<StorageType, string> = {
  local: '本地路径',
  webdav: 'WebDAV',
  alist: 'Alist',
  s3: 'S3',
}

export function pathPlaceholder(storageType: StorageType, idx: number): string {
  if (storageType === 'local') {
    return idx === 0 ? '主路径，如: /media/movies 或 D:\\Videos' : '额外路径'
  }
  return idx === 0 ? '相对路径，如 media 或 movies/2024' : '额外相对路径'
}
