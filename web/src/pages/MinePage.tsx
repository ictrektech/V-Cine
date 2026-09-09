import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Heart, Clock, ListVideo, BarChart3, UserRound } from 'lucide-react'
import { useTranslation } from '@/i18n'
import SegmentedTabs from '@/components/ui/segmented-tabs'
import {
  pageVariants,
} from '@/lib/motion'

// "我的"聚合页：收藏 / 观看历史 / 播放列表 / 观影报告 以 tab 形式呈现，
// 子页面通过嵌套路由（Outlet）渲染，保留原路径可直接访问
const MINE_TABS = [
  { path: '/favorites', labelKey: 'nav.favorites', icon: Heart },
  { path: '/history', labelKey: 'nav.history', icon: Clock },
  { path: '/playlists', labelKey: 'nav.playlists', icon: ListVideo },
  { path: '/stats', labelKey: 'nav.stats', icon: BarChart3 },
] as const

export default function MinePage() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="enter"
      className="space-y-6"
    >
      {/* ===== 页面标题 ===== */}
      <h1 className="text-2xl font-display font-bold flex items-center gap-2 text-gradient">
        <UserRound className="text-neon-blue animate-neon-breathe" size={24} />
        {t('nav.mine')}
      </h1>

      {/* ===== Tab 导航 ===== */}
      <SegmentedTabs
        tabs={MINE_TABS.map((tab) => ({ key: tab.path, label: t(tab.labelKey), icon: tab.icon }))}
        active={pathname}
        onChange={(key) => navigate(key)}
      />

      {/* ===== 子页面内容 ===== */}
      <Outlet />
    </motion.div>
  )
}
