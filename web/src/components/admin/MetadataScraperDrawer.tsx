import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { useTranslation } from '@/i18n'
import TMDbConfigSection from '@/components/admin/TMDbConfigSection'
import DoubanConfigSection from '@/components/admin/DoubanConfigSection'
import type { TMDbConfigStatus, DoubanConfigStatus } from '@/types'

// ==================== 元数据刮削 Drawer ====================
// TMDb Key + 豆瓣 Cookie（+ 代理）。状态由 AdminPage 持有并回传，
// 配置操作各自内聚在 section 组件内。

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tmdbConfig: TMDbConfigStatus | null
  setTmdbConfig: (c: TMDbConfigStatus) => void
  doubanConfig: DoubanConfigStatus | null
  setDoubanConfig: (c: DoubanConfigStatus) => void
}

export default function MetadataScraperDrawer({ open, onOpenChange, tmdbConfig, setTmdbConfig, doubanConfig, setDoubanConfig }: Props) {
  const { t } = useTranslation()
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="xl" title={t("drawer.metadataScrape")} description={t("drawer.metadataScrapeDesc")}>
        <div className="space-y-8">
          <TMDbConfigSection tmdbConfig={tmdbConfig} setTmdbConfig={setTmdbConfig} />
          <DoubanConfigSection doubanConfig={doubanConfig} setDoubanConfig={setDoubanConfig} />
        </div>
      </DrawerContent>
    </Drawer>
  )
}
