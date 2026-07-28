import api from './client'
import type {
  VideoAnalysisBatchResult,
  VideoAnalysisDetailedStats,
  VideoAnalysisResult,
  VideoAnalysisStatistics,
  VideoAnalysisTask,
  VideoAnalysisTaskPage,
  VideoAnalysisWorkflow,
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

  deleteTask: (id: string) =>
    api.delete<{ message: string }>(`/admin/video-analysis/tasks/${id}`),

  statistics: () =>
    api.get<{ data: VideoAnalysisStatistics }>('/admin/video-analysis/statistics'),

  detailedStatistics: () =>
    api.get<{ data: VideoAnalysisDetailedStats }>('/admin/video-analysis/statistics/detailed'),

  getResult: (mediaId: string, taskId?: string) =>
    api.get<{ data: VideoAnalysisResult }>(`/media/${mediaId}/video-analysis`, { params: taskId ? { task_id: taskId } : undefined }),

  getSceneGridBlob: (mediaId: string, sceneIndex: number, taskId?: string) =>
    api.get<Blob>(`/media/${mediaId}/video-analysis/scenes/${sceneIndex}/grid`, {
      params: taskId ? { task_id: taskId } : undefined,
      responseType: 'blob',
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
}
