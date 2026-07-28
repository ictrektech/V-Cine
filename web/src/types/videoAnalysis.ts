export type VideoAnalysisStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'skipped'
export type VideoAnalysisStage = 'detect' | 'structure' | 'describe' | 'done'
export type VideoAnalysisStageStatus = '' | 'running' | 'succeeded' | 'failed' | 'skipped'

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
  detect_status: VideoAnalysisStageStatus
  structure_status: VideoAnalysisStageStatus
  describe_status: VideoAnalysisStageStatus
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export interface VideoAnalysisWorkflow {
  task_id: string
  media_id: string
  media_title: string
  status: VideoAnalysisStatus
  stage: VideoAnalysisStage
  progress: number
  detect_status: VideoAnalysisStageStatus
  structure_status: VideoAnalysisStageStatus
  describe_status: VideoAnalysisStageStatus
  error_code?: string
  error_message?: string
  started_at?: string | null
  finished_at?: string | null
  created_at: string
}

export interface VideoAnalysisTaskPage {
  tasks: VideoAnalysisTask[]
  total: number
  page: number
  page_size: number
}

export interface VideoAnalysisBatchIssue {
  media_id: string
  kind?: string
  message: string
}

export interface VideoAnalysisBatchResult {
  created: number
  reused: number
  skipped: number
  skipped_errors?: VideoAnalysisBatchIssue[]
  errors: VideoAnalysisBatchIssue[]
  task_ids: string[]
  tasks: VideoAnalysisTask[]
}

export type VideoAnalysisStatistics = Partial<Record<VideoAnalysisStatus, number>>

export interface VideoAnalysisDetailedStats {
  status_counts: Record<string, number>
  total_tasks: number
  queued_count: number
  running_count: number
  success_rate: number
  error_rate: number
  partial_rate: number
  avg_elapsed_seconds: number
}

export interface VideoAnalysisWarning {
  code?: string
  message: string
  scope?: string
  target_id?: string
}

export interface VideoAnalysisSceneResult {
  scene_id?: string
  scene_index: number
  start_time: number
  end_time: number
  start_frame: number
  end_frame: number
  grid_available: boolean
  grid_url?: string
  description?: string
  status?: string
  error?: string
}

export interface VideoAnalysisResult {
  task_id: string
  media_id: string
  library_id: string
  media_title: string
  status: VideoAnalysisStatus
  stage: VideoAnalysisStage
  trigger: 'manual' | 'auto'
  progress: number
  video_hash: string
  video_path: string
  mapped_video_path: string
  duration?: number
  fps?: number
  width?: number
  height?: number
  codec?: string
  bitrate?: number
  has_audio: boolean
  total_frames?: number
  scene_count: number
  warnings?: VideoAnalysisWarning[]
  stage_timings?: Record<string, number>
  elapsed_sec?: number
  fallback_used: boolean
  include_descriptions: boolean
  force: boolean
  attempt: number
  error_code?: string
  error_message?: string
  created_at: string
  started_at: string | null
  finished_at: string | null
  scenes: VideoAnalysisSceneResult[]
}