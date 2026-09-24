/**
 * 内部路由唯一真源。
 *
 * 所有业务页面路径都从这里生成：
 * - React Router 的 `<Link to={...}>` / `navigate(...)` 使用返回值。
 *
 * 这里只负责“逻辑路径”（根相对路径），不负责 VOS 子路径前缀；
 * 前缀统一由 `appUrl.ts` / `basePath.ts` 处理。
 */
export const routes = {
  login: () => '/login',
  admin: (drawer?: string) => (drawer ? `/admin?drawer=${drawer}` : '/admin'),
  player: (mediaId: string, start?: number) =>
    start === undefined
      ? `/play/${encodeURIComponent(mediaId)}`
      : `/play/${encodeURIComponent(mediaId)}?start=${start}`,
  /** 后台任务处理页（/files 系列页） */
  tasks: {
    /** 文件列表 Tab（文件刮削链路） */
    files: '/files',
    /** 媒体库管理 Tab（媒体库扫描进度） */
    library: '/files?tab=library',
    /** 视频预处理 Tab（转码/翻录） */
    video: '/files?tab=preprocess',
    /** 字幕预处理 Tab（ASR/翻译） */
    subtitle: '/files?tab=preprocess&pre=subtitle',
    /** 视频分析 Tab；taskId 聚焦指定任务，openResult 时自动打开该任务的结果抽屉 */
    analysis: (taskId?: string, openResult?: boolean) =>
      taskId
        ? `/files?tab=analysis&analysisTaskId=${taskId}${openResult ? `&analysisResultTaskId=${taskId}` : ''}`
        : '/files?tab=analysis',
  },
}
