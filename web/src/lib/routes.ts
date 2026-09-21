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
}
