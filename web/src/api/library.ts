import api from './client'
import type {
  Library,
  CreateLibraryRequest,
  ListResponse,
} from '@/types'

// ==================== 媒体库 ====================
export const libraryApi = {
  list: () =>
    api.get<ListResponse<Library>>('/libraries'),

  create: (data: CreateLibraryRequest) =>
    api.post<{ data: Library }>('/libraries', data),

  update: (id: string, data: Partial<CreateLibraryRequest>) =>
    api.put<{ data: Library }>(`/libraries/${id}`, data),

  scanStatus: () =>
    api.get<{ data: import('@/hooks/useWebSocket').ScanPhaseData[] }>('/libraries/scan-status'),

  scan: (id: string) =>
    api.post(`/libraries/${id}/scan`),

  /**
   * 只扫描库内指定子路径；传 files 时只入库这些文件
   * （上传后的"只处理这次上传的文件"，files 用于排除同目录下历史遗留的文件）
   */
  scanPaths: (id: string, paths: string[], files?: string[]) =>
    api.post(`/libraries/${id}/scan`, files?.length ? { paths, files } : { paths }),

  reindex: (id: string) =>
    api.post(`/libraries/${id}/reindex`),

  delete: (id: string) =>
    api.delete(`/libraries/${id}`),
}
