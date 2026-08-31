import api from './client'

// 状态接口可能因远程存储不可达而长时间阻塞，统一用短超时避免拖垮页面
const STATUS_TIMEOUT_MS = 8000

// ==================== V2.1: WebDAV 存储管理 ====================

export interface WebDAVConfig {
  enabled: boolean
  server_url: string
  username: string
  password: string
  base_path: string
  timeout: number
  enable_pool: boolean
  pool_size: number
  enable_cache: boolean
  cache_ttl_hours: number
  max_retries: number
  retry_interval: number
}

export interface WebDAVStatus {
  enabled: boolean
  server_url: string
  base_path: string
  client_count: number
  connected?: boolean
  error?: string
}

// ==================== V2.3: Alist 聚合网盘 ====================

export interface AlistConfig {
  enabled: boolean
  server_url: string
  username: string
  password: string
  token: string
  base_path: string
  timeout: number
  enable_cache: boolean
  cache_ttl_hours: number
  read_block_size_mb: number
  read_block_count: number
}

export interface AlistStatus {
  enabled: boolean
  server_url: string
  base_path: string
  connected: boolean
}

export interface TestAlistRequest {
  server_url: string
  username?: string
  password?: string
  token?: string
  base_path?: string
}

// ==================== V2.3: S3 兼容对象存储 ====================

export interface S3Config {
  enabled: boolean
  endpoint: string
  region: string
  access_key: string
  secret_key: string
  bucket: string
  base_path: string
  path_style: boolean
  timeout: number
  enable_cache: boolean
  cache_ttl_hours: number
  read_block_size_mb: number
  read_block_count: number
}

export interface S3Status {
  enabled: boolean
  endpoint: string
  bucket: string
  region: string
  path_style: boolean
  connected: boolean
}

export interface TestS3Request {
  endpoint: string
  region?: string
  access_key: string
  secret_key: string
  bucket: string
  base_path?: string
  path_style?: boolean
}

export interface TestWebDAVRequest {
  server_url: string
  username?: string
  password?: string
  base_path?: string
}

export interface RemoteBrowseItem {
  name: string
  path: string
}

export interface RemoteBrowseResponse {
  current: string
  parent: string
  items: RemoteBrowseItem[]
}

export const storageApi = {
  // ---------- WebDAV ----------
  getWebDAVConfig: () =>
    api.get<{ data: WebDAVConfig }>('/admin/storage/webdav'),
  updateWebDAVConfig: (data: Partial<WebDAVConfig>) =>
    api.put<{ message: string }>('/admin/storage/webdav', data),
  testWebDAVConnection: (data: TestWebDAVRequest) =>
    api.post<{ message: string }>('/admin/storage/webdav/test', data),
  getWebDAVStatus: () =>
    api.get<{ data: WebDAVStatus }>('/admin/storage/webdav/status', { timeout: STATUS_TIMEOUT_MS }),
  registerWebDAVLibrary: (libraryId: string) =>
    api.post<{ message: string }>('/admin/storage/webdav/libraries/register', {
      library_id: libraryId,
    }),

  // ---------- 远程存储目录浏览 ----------
  browseRemote: (type: 'webdav' | 'alist' | 's3', path: string) =>
    api.get<{ data: RemoteBrowseResponse }>(
      '/admin/storage/browse',
      { params: { type, path } }
    ),

  // ---------- V2.3: Alist ----------
  getAlistConfig: () =>
    api.get<{ data: AlistConfig }>('/admin/storage/alist'),
  updateAlistConfig: (data: Partial<AlistConfig>) =>
    api.put<{ message: string }>('/admin/storage/alist', data),
  testAlistConnection: (data: TestAlistRequest) =>
    api.post<{ message: string }>('/admin/storage/alist/test', data),
  // 单存储状态：独立探测，便于前端逐个返回时增量更新
  getAlistStatus: () =>
    api.get<{ data: AlistStatus }>('/admin/storage/alist/status', { timeout: STATUS_TIMEOUT_MS }),

  // ---------- V2.3: S3 ----------
  getS3Config: () => api.get<{ data: S3Config }>('/admin/storage/s3'),
  updateS3Config: (data: Partial<S3Config>) =>
    api.put<{ message: string }>('/admin/storage/s3', data),
  testS3Connection: (data: TestS3Request) =>
    api.post<{ message: string }>('/admin/storage/s3/test', data),
  // 单存储状态：独立探测，便于前端逐个返回时增量更新
  getS3Status: () =>
    api.get<{ data: S3Status }>('/admin/storage/s3/status', { timeout: STATUS_TIMEOUT_MS }),
}
