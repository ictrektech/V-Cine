import api from './client'
import type {
  VideoAnalysisBatchResult,
  VideoAnalysisDetailedStats,
  VideoAnalysisHealthInfo,
  VideoAnalysisResult,
  VideoAnalysisSettings,
  VideoAnalysisStatistics,
  VideoAnalysisTask,
  VideoAnalysisTaskPage,
  VideoAnalysisWorkflow,
  SceneSearchResult,
} from '@/types/videoAnalysis'

export const videoAnalysisApi = {
  submit: (data: { media_id: string; force?: boolean; include_descriptions?: boolean }) =>
    api.post<{ data: VideoAnalysisTask; reused: boolean }>('/admin/video-analysis/tasks', data),

  batchSubmit: (data: { media_ids: string[]; force?: boolean; include_descriptions?: boolean }) =>
    api.post<{ data: VideoAnalysisBatchResult }>('/admin/video-analysis/tasks/batch', data),

  listTasks: (params: { page?: number; page_size?: number; status?: string; library_id?: string; keyword?: string; media_id?: string; group_by_media?: boolean }) =>
    api.get<{ data: VideoAnalysisTaskPage }>('/admin/video-analysis/tasks', { params }),

  getLatestTaskByMedia: (mediaId: string) =>
    api.get<{ data: VideoAnalysisTask | null }>('/admin/video-analysis/tasks/latest', { params: { media_id: mediaId } }),

  getTask: (id: string) =>
    api.get<{ data: VideoAnalysisTask }>(`/admin/video-analysis/tasks/${id}`),

  retryTask: (id: string) =>
    api.post<{ data: VideoAnalysisTask }>(`/admin/video-analysis/tasks/${id}/retry`),

  deleteTask: (id: string) =>
    api.delete<{ message: string }>(`/admin/video-analysis/tasks/${id}`),

  statistics: () =>
    api.get<{ data: VideoAnalysisStatistics }>('/admin/video-analysis/statistics'),

  detailedStatistics: () =>
    api.get<{ data: VideoAnalysisDetailedStats }>('/admin/video-analysis/statistics/detailed'),

  getConfig: () =>
    api.get<{ data: { describe_enabled: boolean; remote_video_enabled: boolean } }>('/admin/video-analysis/config'),

  getHealth: () =>
    api.get<{ data: VideoAnalysisHealthInfo }>('/admin/video-analysis/health'),

  getSettings: () =>
    api.get<{ data: VideoAnalysisSettings }>('/admin/video-analysis/settings'),

  updateSettings: (data: VideoAnalysisSettings) =>
    api.put('/admin/video-analysis/settings', data),

  getResult: (mediaId: string, taskId?: string) =>
    api.get<{ data: VideoAnalysisResult }>(`/media/${mediaId}/video-analysis`, { params: taskId ? { task_id: taskId } : undefined }),

  getSceneGridBlob: (mediaId: string, sceneIndex: number, taskId?: string) =>
    api.get<Blob>(`/media/${mediaId}/video-analysis/scenes/${sceneIndex}/grid`, {
      params: taskId ? { task_id: taskId } : undefined,
      responseType: 'blob',
    }),

  /** 场景向量检索：文本 → SigLIP2 文本向量 → 检索场景图片 embedding 列（mode=image） */
  searchScenes: (q: string, mode: 'image' | 'text' = 'image', limit = 30) =>
    api.get<{ data: SceneSearchResult[] }>('/video-analysis/scenes/search', {
      params: { q, mode, limit },
    }),
    // Workflow
  getWorkflow: (taskId: string) =>
    api.get<{ data: VideoAnalysisWorkflow }>(`/video-analysis/tasks/${taskId}/workflow`),

  runStage: (taskId: string, stage: string) =>
    api.post<{ message: string }>(`/video-analysis/tasks/${taskId}/run-stage`, { stage }),

  runAll: (taskId: string) =>
    api.post<{ message: string }>(`/video-analysis/tasks/${taskId}/run-all`),

  runMissing: (taskId: string) =>
    api.post<{ message: string }>(`/video-analysis/tasks/${taskId}/run-missing`),

  // V-Scheduler 模型仓库状态查询（只读，登录用户可用）
  getModelHubStatus: (model: string) =>
    api.get<{ data: ModelHubModelStatus }>('/video-analysis/models/status', {
      params: { model },
    }),

  // 触发 V-Scheduler 模型仓库下载缺失模型（管理员）
  pullModelHubModel: (model: string) =>
    api.post<{ data: { task_id: string } }>('/admin/video-analysis/models/pull', { model }),
}

// not_registered：仓库里有模型文件，但网关注册表里没有这个模型名（多为旧命名 model-hub/…）
export type ModelHubStatusValue = 'missing' | 'pulling' | 'ready' | 'failed' | 'unsupported' | 'not_registered'

export interface ModelHubModelStatus {
  requested: string
  model_id: string
  status: ModelHubStatusValue
  progress?: number
  downloaded_bytes?: number
  total_bytes?: number
  current_file?: string
  error_msg?: string
  task_id?: string
}
