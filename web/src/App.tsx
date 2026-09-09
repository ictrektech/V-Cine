import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth'
import { ToastProvider } from '@/components/Toast'
import { DialogProvider } from '@/components/Dialog'
import { getBasePath } from '@/lib/basePath'
import { Toaster } from 'react-hot-toast'
import Layout from '@/components/Layout'
import TitleBar from '@/components/TitleBar'
import LoginPage from '@/pages/LoginPage'
import ForceChangePasswordPage from '@/pages/ForceChangePasswordPage'
import { DesktopEventBinder, DesktopServerPicker, UpdateBanner } from '@/desktop'
import { authApi } from '@/api/auth'
import { acquireVOSAccessToken } from '@/utils/vos-oidc'
import HomePage from '@/pages/HomePage'
import LibraryPage from '@/pages/LibraryPage'
import MediaDetailPage from '@/pages/MediaDetailPage'
import PlayerPage from '@/pages/PlayerPage'
import SearchPage from '@/pages/SearchPage'
import FavoritesPage from '@/pages/FavoritesPage'
import HistoryPage from '@/pages/HistoryPage'
import PlaylistsPage from '@/pages/PlaylistsPage'
import MinePage from '@/pages/MinePage'
import AdminPage from '@/pages/AdminPage'
import SeriesDetailPage from '@/pages/SeriesDetailPage'
import ProfilePage from '@/pages/ProfilePage'
import StatsPage from '@/pages/StatsPage'
import FileManagerPage from '@/pages/FileManagerPage'
import BrowsePage from '@/pages/BrowsePage'
import PersonDetailPage from '@/pages/PersonDetailPage'
import CollectionsPage from '@/pages/CollectionsPage'
import CollectionDetailPage from '@/pages/CollectionDetailPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
})

// 需要登录的路由守卫
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  // 强制改密拦截：有 must_change_pwd 标记时强制跳转
  const isVOSFrame = typeof window !== 'undefined' && window.parent !== window
  if (!isVOSFrame && user?.must_change_pwd && window.location.pathname !== '/force-change-password') {
    return <Navigate to="/force-change-password" replace />
  }
  return <>{children}</>
}

// 强制改密页路由包装：只要登录过就能访问（绕过强制改密拦截本身）
function ForceChangePasswordRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <ForceChangePasswordPage />
}

export default function App() {
  const setAuth = useAuthStore((s) => s.setAuth)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isVOSFrame = typeof window !== 'undefined' && window.parent !== window
  const [vosLoginError, setVOSLoginError] = useState(false)
  const [vosLoginAttempt, setVOSLoginAttempt] = useState(0)

  useEffect(() => {
    if (isAuthenticated || !isVOSFrame) return
    setVOSLoginError(false)
    void acquireVOSAccessToken().then(async (accessToken) => {
      if (!accessToken) throw new Error('VOS access token unavailable')
      const response = await authApi.vosOIDC(accessToken)
      if (!response.data.token || !response.data.user) throw new Error('Nowen session unavailable')
      setAuth(response.data.token, response.data.user)
      const basePath = getBasePath()
      window.location.replace(basePath ? `${basePath}/` : '/')
    }).catch(() => setVOSLoginError(true))
  }, [isAuthenticated, isVOSFrame, setAuth, vosLoginAttempt])

  if (isVOSFrame && !isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-950 text-slate-100">
        <div className="text-lg font-semibold">正在使用 VOS 账户登录 Nowen</div>
        {vosLoginError && <button className="rounded bg-cyan-500 px-4 py-2 text-slate-950" onClick={() => setVOSLoginAttempt((attempt) => attempt + 1)}>重新连接 VOS</button>}
      </div>
    )
  }
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <DialogProvider>
      <Toaster position="top-right" />
      <BrowserRouter basename={getBasePath() || '/'}>
        {/* 桌面端：首次启动"服务器地址"引导（仅在默认端口探活失败时出现） */}
        <DesktopServerPicker />
        {/* 桌面端事件绑定器（仅 Tauri 环境生效） */}
        <DesktopEventBinder />
        {/* 桌面端自动更新横幅 */}
        <UpdateBanner />
        {/* 顶层应用壳：桌面端标题栏 + 全屏主体 */}
        <div className="nv-app-shell">
          <TitleBar />
          <div className="nv-app-body">
            <Routes>
            {/* 公开路由 */}
            <Route path="/login" element={<LoginPage />} />
            {/* 强制改密页面（需要登录但绕过强制改密拦截） */}
            <Route path="/force-change-password" element={<ForceChangePasswordRoute />} />

            {/* 播放页面（全屏，不含布局） */}
            <Route
              path="/play/:id"
              element={
                <ProtectedRoute>
                  <PlayerPage />
                </ProtectedRoute>
              }
            />

            {/* 含侧边栏布局的路由 */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<HomePage />} />
              <Route path="library/:id" element={<LibraryPage />} />
              <Route path="media/:id" element={<MediaDetailPage />} />
              <Route path="series/:id" element={<SeriesDetailPage />} />
              <Route path="search" element={<SearchPage />} />
              {/* "我的"聚合页：四个子页保留原路径，tab 由 MinePage 呈现 */}
              <Route element={<MinePage />}>
                <Route path="favorites" element={<FavoritesPage />} />
                <Route path="history" element={<HistoryPage />} />
                <Route path="playlists" element={<PlaylistsPage />} />
                <Route path="stats" element={<StatsPage />} />
              </Route>
              <Route path="mine" element={<Navigate to="/favorites" replace />} />
              <Route path="admin" element={<AdminPage />} />
              <Route path="scrape" element={<Navigate to="/files?tab=scrape" replace />} />
              <Route path="files" element={<FileManagerPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="pulse" element={<Navigate to="/admin?tab=pulse" replace />} />
              {/* 兼容旧预处理独立页 —— 重定向到媒体库管理预处理 Tab */}
              <Route path="preprocess" element={<Navigate to="/files?tab=preprocess" replace />} />
              <Route path="preprocess/subtitle" element={<Navigate to="/files?tab=preprocess&pre=subtitle" replace />} />
              {/* 兼容旧侧栏入口 /subtitle-preprocess —— 重定向到新地址 */}
              <Route path="subtitle-preprocess" element={<Navigate to="/files?tab=preprocess&pre=subtitle" replace />} />
              <Route path="browse" element={<BrowsePage />} />
              <Route path="collections" element={<CollectionsPage />} />
              <Route path="collections/:id" element={<CollectionDetailPage />} />
              <Route path="person/:id" element={<PersonDetailPage />} />
              {/* 智能重命名独立页已下线；AI 整理随媒体库扫描/重建索引自动执行。 */}
            </Route>

            {/* 未匹配路由 */}
            <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </div>
      </BrowserRouter>
        </DialogProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
