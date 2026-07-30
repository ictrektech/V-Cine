import api from './client'

export interface ApiKey {
  id: string
  name: string
  key_prefix: string
  key: string        // 解密后的完整 key
  last_used_at: string | null
  expires_at: string | null
  is_revoked: boolean
  created_at: string
}

export interface CreateApiKeyRequest {
  name: string
  expires_at?: string | null
}

export interface CreateApiKeyResult {
  id: string
  name: string
  key_prefix: string
  key: string
  raw_key: string    // 完整 key，仅创建时返回
  last_used_at: string | null
  expires_at: string | null
  is_revoked: boolean
  created_at: string
}

export const apiKeyApi = {
  list: () =>
    api.get<{ data: ApiKey[] }>('/users/me/api-keys'),

  create: (data: CreateApiKeyRequest) =>
    api.post<{ data: CreateApiKeyResult }>('/users/me/api-keys', data),

  revoke: (id: string) =>
    api.delete(`/users/me/api-keys/${id}`),

  delete: (id: string) =>
    api.delete(`/users/me/api-keys/${id}/hard`),
}
