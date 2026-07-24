import api from './client'
import type {
  VideoAnalysisBatchResult,
  VideoAnalysisResult,
  VideoAnalysisStatistics,
  VideoAnalysisTask,
  VideoAnalysisTaskPage,
} from '@/types/videoAnalysis'

export const videoAnalysisApi = {
  submit: (data: { media_id: string; force?: boolean; include_descriptions?: boolean }) =>
    api.post<{ data: VideoAnalysisTask; reused: boolean }>('/admin/video-analysis/tasks', data),

  batchSubmit: (data: { media_ids: string[]; force?: boolean; include_descriptions?: boolean }) =>
    api.post<{ data: VideoAnalysisBatchResult }>('/admin/video-analysis/tasks/batch', data),

  listTasks: (params: { page?: number; page_size?: number; status?: string; library_id?: string; keyword?: string }) =>
    api.get<{ data: VideoAnalysisTaskPage }>('/admin/video-analysis/tasks', { params }),

  getLatestTaskByMedia: (mediaId: string) =>
    api.get<{ data: VideoAnalysisTask | null }>('/admin/video-analysis/tasks/latest', { params: { media_id: mediaId } }),

  getTask: (id: string) =>
    api.get<{ data: VideoAnalysisTask }>(`/admin/video-analysis/tasks/${id}`),

  retryTask: (id: string) =>
    api.post<{ data: VideoAnalysisTask }>(`/admin/video-analysis/tasks/${id}/retry`),

  statistics: () =>
    api.get<{ data: VideoAnalysisStatistics }>('/admin/video-analysis/statistics'),

  getResult: (mediaId: string, taskId?: string) =>
    api.get<{ data: VideoAnalysisResult }>(`/media/${mediaId}/video-analysis`, { params: taskId ? { task_id: taskId } : undefined }),

  getSceneGridBlob: (mediaId: string, sceneIndex: number, taskId?: string) =>
    api.get<Blob>(`/media/${mediaId}/video-analysis/scenes/${sceneIndex}/grid`, {
      params: taskId ? { task_id: taskId } : undefined,
      responseType: 'blob',
    }),
}
