import api from './client'
import type {
  VideoAnalysisBatchResult,
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

  getTask: (id: string) =>
    api.get<{ data: VideoAnalysisTask }>(`/admin/video-analysis/tasks/${id}`),

  retryTask: (id: string) =>
    api.post<{ data: VideoAnalysisTask }>(`/admin/video-analysis/tasks/${id}/retry`),

  statistics: () =>
    api.get<{ data: VideoAnalysisStatistics }>('/admin/video-analysis/statistics'),
}
