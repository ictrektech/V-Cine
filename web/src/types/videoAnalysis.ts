export type VideoAnalysisStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'skipped'
export type VideoAnalysisStage = 'detect' | 'structure' | 'describe' | 'done'

export interface VideoAnalysisTask {
  id: string
  media_id: string
  library_id: string
  media_title: string
  file_size: number
  file_mtime: number
  trigger: 'manual' | 'auto'
  status: VideoAnalysisStatus
  stage: VideoAnalysisStage
  progress: number
  detect_job_id: string
  structure_job_id: string
  describe_job_id: string
  video_hash: string
  error_code: string
  error_message: string
  attempt: number
  include_descriptions: boolean
  force: boolean
  fallback_used: boolean
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export interface VideoAnalysisTaskPage {
  tasks: VideoAnalysisTask[]
  total: number
  page: number
  page_size: number
}

export interface VideoAnalysisBatchResult {
  created: number
  reused: number
  skipped: number
  errors: Array<{ media_id: string; message: string }>
  task_ids: string[]
  tasks: VideoAnalysisTask[]
}

export type VideoAnalysisStatistics = Partial<Record<VideoAnalysisStatus, number>>
