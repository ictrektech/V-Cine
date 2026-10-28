import api from './client'

/**
 * 「添加视频」上传落点（后端本地推导，不含公共目录 uuid）
 *
 * - kind=public：需前端用用户 token 查 VOS 目录表，join 出 `p_<public_dir_uuid>`
 * - kind=user_data：`adapter` 已给出（`v_<卷uuid>`）
 * - `library_id` 为空 = 该位置还没有媒体库，上传完成后调 `ensureLibrary` 自动建库
 * 见 tasks/media-import/PLAN.md 4.2
 */
export interface ImportLocation {
  kind: 'public' | 'user_data'
  /** 公共目录名；主媒体库为空 */
  name?: string
  /** 容器内路径（展示与建库都用它） */
  local_path: string
  volume_uuid?: string
  /** 卷昵称（如 vos_workspace），用于说明"在哪个存储空间" */
  volume_name?: string
  public_dir_name?: string
  user?: string
  adapter?: string
  /** 相对 adapter 根的上传目录，"/" 表示根 */
  path: string
  uploadable: boolean
  library_id?: string
  library_name?: string
}

export interface EnsureLibraryResult {
  library_id: string
  library_name: string
  created: boolean
}

export const importTargetApi = {
  targets: () => api.get<{ data: ImportLocation[] }>('/admin/import/targets'),
  /** 幂等：确保覆盖该路径的媒体库存在（没有则以该路径建 mixed 库） */
  ensureLibrary: (localPath: string) =>
    api.post<{ data: EnsureLibraryResult }>('/admin/import/ensure-library', { local_path: localPath }),
}
