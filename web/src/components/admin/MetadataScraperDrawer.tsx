import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { useTranslation } from '@/i18n'
import { useSetupHighlight } from '@/hooks/useSetupHighlight'
import TMDbConfigSection from '@/components/admin/TMDbConfigSection'
import DoubanConfigSection from '@/components/admin/DoubanConfigSection'
import type { SetupTarget } from '@/lib/setupTargets'
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
  /** 从推荐配置跳进来时需要高亮的锚点。 */
  target?: SetupTarget
  targetNonce?: number
}

export default function MetadataScraperDrawer({ open, onOpenChange, tmdbConfig, setTmdbConfig, doubanConfig, setDoubanConfig, target, targetNonce }: Props) {
  const { t } = useTranslation()
  useSetupHighlight(target, targetNonce, open)

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="xl" title={t("drawer.metadataScrape")} description={t("drawer.metadataScrapeDesc")}>
        <div className="space-y-8">
          <div data-setup-target="metadata">
            <TMDbConfigSection tmdbConfig={tmdbConfig} setTmdbConfig={setTmdbConfig} />
          </div>
          <DoubanConfigSection doubanConfig={doubanConfig} setDoubanConfig={setDoubanConfig} />
        </div>
      </DrawerContent>
    </Drawer>
  )
}
