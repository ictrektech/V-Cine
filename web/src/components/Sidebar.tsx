import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { libraryApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { NotificationBell } from '@/components/NotificationCenter'
import { useThemeStore } from '@/stores/theme'
import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useWebSocket, WS_EVENTS } from '@/hooks/useWebSocket'
import { bumpPosterVersion } from '@/stores/mediaRefresh'
import LanguageSwitcher from './LanguageSwitcher'
import { useTranslation } from '@/i18n'
import {
  Home,
  Search,
  Settings,
  LogOut,
  ChevronLeft,
  Zap,
  Sun,
  Moon,
  Monitor,
  Layers,
  X,
  UserRound,
  FolderOpen as FolderOpenIcon,
  Library as LibraryIcon,
} from 'lucide-react'
import clsx from 'clsx'
import { motion, AnimatePresence } from 'framer-motion'
import { sidebarVariants, sidebarMobileVariants } from '@/lib/motion'

interface SidebarProps {
  /** 移动端是否展开 */
  isMobileOpen?: boolean
  /** 移动端关闭回调 */
  onMobileClose?: () => void
}

// 导航项文案：侧边栏宽度固定，长文案（尤其英文）会被 CSS 截断成 "..."，检测到截断时在悬停时用 Tooltip 展示完整文案，避免信息丢失
function NavLabel({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)

  // 挂载（含折叠/展开切换时的重挂载）时测量一次即可：侧边栏宽度固定，
  // 是否截断只取决于文案本身
  useEffect(() => {
    const el = ref.current
    if (el) setTruncated(el.scrollWidth > el.clientWidth)
  }, [text])

  const span = <span ref={ref} className="truncate">{text}</span>

  if (!truncated) return span

  return (
    <Tooltip>
      <TooltipTrigger asChild>{span}</TooltipTrigger>
      <TooltipContent side="right">{text}</TooltipContent>
    </Tooltip>
  )
}

export default function Sidebar({ isMobileOpen = false, onMobileClose }: SidebarProps) {
  const { user, logout } = useAuthStore()
  const { theme, preference, toggleTheme } = useThemeStore()
  const { t } = useTranslation()
  // 自动模式下显示"跟随系统"图标，否则按当前明暗显示日/月
  const themeIcon = preference === 'auto'
    ? <Monitor size={17} className="text-neon" />
    : theme === 'dark'
      ? <Moon size={17} className="text-neon" />
      : <Sun size={17} className="text-amber-500" />
  const themeTitle = preference === 'auto'
    ? `${t('nav.themeAuto')}（${theme === 'dark' ? t('nav.darkMode') : t('nav.lightMode')}）`
    : theme === 'dark' ? t('nav.switchToLight') : t('nav.switchToDark')
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const { on, off } = useWebSocket()

  // 媒体库数量（"影视库"入口的计数徽章）；增删库/扫描完成后刷新
  const queryClient = useQueryClient()
  const { data: libraries = [] } = useQuery({
    queryKey: ['libraries'],
    queryFn: async () => (await libraryApi.list()).data.data,
  })
  useEffect(() => {
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['libraries'] })
    on(WS_EVENTS.LIBRARY_UPDATED, invalidate)
    on(WS_EVENTS.LIBRARY_DELETED, invalidate)
    on(WS_EVENTS.SCAN_COMPLETED, invalidate)
    return () => {
      off(WS_EVENTS.LIBRARY_UPDATED, invalidate)
      off(WS_EVENTS.LIBRARY_DELETED, invalidate)
      off(WS_EVENTS.SCAN_COMPLETED, invalidate)
    }
  }, [on, off, queryClient])

  // "我的"入口在四个子页（收藏/历史/播放列表/观影报告）下均保持高亮
  const isMineActive = ['/favorites', '/history', '/playlists', '/stats']
    .some((p) => pathname.startsWith(p))

  // 监听 WebSocket 事件：刮削/扫描完成后 bump 全局海报版本，
  // 让所有 MediaCard 的图片 URL 更新，破除浏览器缓存
  useEffect(() => {
    const bumpOnMediaChange = () => {
      bumpPosterVersion()
    }

    on(WS_EVENTS.SCAN_COMPLETED, bumpOnMediaChange)
    on(WS_EVENTS.SCRAPE_COMPLETED, bumpOnMediaChange)

    return () => {
      off(WS_EVENTS.SCAN_COMPLETED, bumpOnMediaChange)
      off(WS_EVENTS.SCRAPE_COMPLETED, bumpOnMediaChange)
    }
  }, [on, off])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  // 桌面端用 collapsed，移动端始终展开全宽
  const sidebarContent = (
    <>
      {/* 右侧霓虹分割线 */}
      <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-neon-blue/20 to-transparent" />

      {/* Logo 区域 */}
      <div className="flex h-16 items-center justify-between px-4">
        {(!collapsed || isMobileOpen) && (
          <h1 className="font-display text-lg font-bold tracking-wider">
            <span className="text-neon text-neon-glow">V</span>
            <span style={{ color: 'var(--text-primary)' }}>-Cine</span>
          </h1>
        )}
        {collapsed && !isMobileOpen && (
          <div className="flex w-full justify-center">
            <Zap size={20} className="text-neon animate-neon-breathe" />
          </div>
        )}
        {/* 桌面端折叠按钮 */}
        {!collapsed && !isMobileOpen && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-lg p-1.5 text-surface-400 transition-all duration-200 hover:text-neon hover:bg-neon-blue/5 hidden md:block"
          >
            <ChevronLeft size={18} className="transition-transform" />
          </button>
        )}
        {/* 移动端关闭按钮 */}
        {isMobileOpen && onMobileClose && (
          <button
            onClick={(e) => { e.stopPropagation(); onMobileClose(); }}
            className="rounded-lg p-2 text-surface-400 transition-all duration-200 hover:text-neon hover:bg-neon-blue/5 md:hidden"
            aria-label="关闭菜单"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* 主导航：首页 / 影视库 / 合集 / 搜索，层级递进保持简洁 */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-4">
        <NavLink
          to="/"
          end
          className={({ isActive }) => clsx('nav-item', isActive && 'active')}
          onClick={onMobileClose}
        >
          <Home size={18} />
          {(!collapsed || isMobileOpen) && <NavLabel text={t('nav.home')} />}
        </NavLink>

        <NavLink
          to="/browse"
          className={({ isActive }) => clsx('nav-item', isActive && 'active')}
          onClick={onMobileClose}
        >
          <Layers size={18} />
          {(!collapsed || isMobileOpen) && <NavLabel text={t('nav.browse')} />}
          {(!collapsed || isMobileOpen) && libraries.length > 0 && (
            <span
              className="ml-auto inline-flex items-center rounded-md px-1.5 py-px text-[11px] font-medium tabular-nums"
              style={{
                background: 'var(--nav-hover-bg)',
                color: 'var(--text-tertiary)',
              }}
              title={`${libraries.length} 个媒体库`}
            >
              {libraries.length}
            </span>
          )}
        </NavLink>

        <NavLink
          to="/collections"
          className={({ isActive }) => clsx('nav-item', isActive && 'active')}
          onClick={onMobileClose}
        >
          <LibraryIcon size={18} />
          {(!collapsed || isMobileOpen) && <NavLabel text={t('nav.collections')} />}
        </NavLink>

        <NavLink
          to="/search"
          className={({ isActive }) => clsx('nav-item', isActive && 'active')}
          onClick={onMobileClose}
        >
          <Search size={18} />
          {(!collapsed || isMobileOpen) && <NavLabel text={t('nav.search')} />}
        </NavLink>

        {/* 我的：单入口，收藏/历史/播放列表/观影报告收进"我的"页 tab */}
        <NavLink
          to="/mine"
          className={() => clsx('nav-item', isMineActive && 'active')}
          onClick={onMobileClose}
        >
          <UserRound size={18} />
          {(!collapsed || isMobileOpen) && <NavLabel text={t('nav.mine')} />}
        </NavLink>

        {/* 管理中心 */}
        {user?.role === 'admin' && (
          <>
            {(!collapsed || isMobileOpen) && (
              <div className="px-3 pb-1 pt-6 text-[10px] font-bold uppercase tracking-[0.2em] text-neon/40">
                {t('nav.management')}
              </div>
            )}
            {collapsed && !isMobileOpen && (
              <div className="my-3 mx-3 border-t border-neon-blue/10" />
            )}

            <NavLink
              to="/admin"
              className={({ isActive }) => clsx('nav-item', isActive && 'active')}
              onClick={onMobileClose}
            >
              <Settings size={18} />
              {(!collapsed || isMobileOpen) && <NavLabel text={t('nav.admin')} />}
            </NavLink>

            <NavLink
              to="/files?tab=library"
              className={({ isActive }) => clsx('nav-item', isActive && 'active')}
              onClick={onMobileClose}
            >
              <FolderOpenIcon size={18} />
              {(!collapsed || isMobileOpen) && <NavLabel text={t('nav.files')} />}
            </NavLink>
          </>
        )}
      </nav>

      {/* 用户卡片 + 快捷操作（个人设置/语言/主题/登出） */}
      <div className="border-t p-3 border-[var(--border-default)]">
        {/* 用户卡片：整体点击进入个人设置 */}
        <NavLink
          to="/profile"
          aria-label={t('nav.profile')}
          onClick={onMobileClose}
          className="flex items-center gap-3 rounded-xl p-2 transition-all hover:bg-[var(--nav-hover-bg)]"
        >
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold"
            style={{
              background: 'var(--neon-blue)',
              boxShadow: 'var(--shadow-neon)',
              color: 'var(--text-on-neon)',
            }}
          >
            {user?.username?.charAt(0).toUpperCase()}
          </div>
          {(!collapsed || isMobileOpen) && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-theme-primary">{user?.username}</p>
              <p className="truncate text-xs text-theme-tertiary">
                {user?.role === 'admin' ? t('user.admin') : t('user.user')}
              </p>
            </div>
          )}
        </NavLink>

        {/* 快捷图标排 */}
        <div className={clsx(
          'mt-2',
          (collapsed && !isMobileOpen) ? 'flex flex-col items-center gap-1' : 'flex items-center gap-1'
        )}>
          {/* 语言切换 */}
          <LanguageSwitcher />

          {/* 主题切换 */}
          <button
            onClick={toggleTheme}
            className="relative flex h-9 w-9 items-center justify-center rounded-lg text-surface-400 transition-all hover:text-neon hover:bg-neon-blue/5"
            title={themeTitle}
            aria-label={themeTitle}
            role="switch"
            aria-checked={theme === 'dark'}
          >
            {themeIcon}
          </button>

          {/* 通知中心 */}
          <NotificationBell />

          {/* 登出 */}
          <button
            onClick={handleLogout}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-surface-400 transition-all hover:text-red-400 hover:bg-red-400/5"
            title={t('nav.logout')}
            aria-label={t('nav.logout')}
          >
            <LogOut size={17} />
          </button>
        </div>

        {/* 折叠/展开按钮（折叠模式下显示在底部） */}
        {collapsed && !isMobileOpen && (
          <button
            onClick={() => setCollapsed(false)}
            className="mt-3 flex w-full justify-center rounded-lg p-1.5 text-surface-500 transition-all hover:text-neon hover:bg-neon-blue/5"
          >
            <ChevronLeft size={16} className="rotate-180" />
          </button>
        )}
      </div>
    </>
  )

  return (
    // Radix Tooltip 需要 Provider；仅包住侧边栏，不影响其他页面
    <TooltipProvider delayDuration={300}>
      {/* 桌面端侧边栏 */}
      <motion.aside
        className={clsx(
          'glass-panel-strong relative z-20 hidden h-screen flex-col md:flex overflow-hidden flex-shrink-0',
          collapsed ? 'min-w-[68px]' : 'min-w-[210px]'
        )}
        animate={collapsed ? 'collapsed' : 'expanded'}
        variants={sidebarVariants}
        style={{ willChange: 'width' }}
      >
        {sidebarContent}
      </motion.aside>

      {/* 移动端遮罩 + 抽屉侧边栏 — 通过 Portal 渲染到 body，彻底避免父级层叠上下文干扰 */}
      {createPortal(
        <>
          <AnimatePresence>
            {isMobileOpen && (
              <motion.div
                key="sidebar-overlay"
                className="fixed inset-0 z-[9998] bg-black/60 md:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={onMobileClose}
                aria-hidden="true"
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {isMobileOpen && (
              <motion.aside
                key="sidebar-drawer"
                className="glass-panel-strong fixed inset-y-0 left-0 z-[9999] flex w-52 flex-col md:hidden"
                variants={sidebarMobileVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                {sidebarContent}
              </motion.aside>
            )}
          </AnimatePresence>
        </>,
        document.body
      )}
    </TooltipProvider>
  )
}
