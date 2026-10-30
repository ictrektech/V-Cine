import api from './client'
import type { Capability } from '@/types/capability'

/**
 * 能力发现 API。
 *
 * GET /api/capabilities 是公开只读接口，不返回地址与密钥，只返回状态与文案 key。
 * 后端已禁用缓存（Cache-Control: no-store），不做前端持久化。
 */
export const capabilityApi = {
  list: () => api.get<{ data: { items: Capability[] } }>('/capabilities'),
}
