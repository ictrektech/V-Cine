import { useEffect, useMemo, useState, useCallback } from 'react'
import { storageApi } from '@/api'
import type { WebDAVConfig } from '@/api/storage'
import { useStorageStatuses } from '@/hooks/useStorageStatuses'
import {
  HardDrive,
  Cloud,
  Loader2,
  Save,
  Wifi,
  Link2,
  Database,
  Server,
  RefreshCw,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { AlistSection, S3Section } from './RemoteStorageSections'
import {
  ProviderCard,
  SectionShell,
  FieldGroup,
  Field,
  Input,
  ActionBar,
  ActionButton,
  Toast,
  StatusBadge,
  EyeToggle,
  EnableRow,
  type ProviderState,
} from './storage/StorageUIKit'

// ==================== 存储管理标签页 ====================
// V2.3 UI 重构：四 provider 统一 Provider Registry 布局
//   顶部：全局概览（Local / WebDAV / Alist / S3 四张卡片，充当 Tab 入口）
//   下部：当前选中 provider 的完整配置表单
// WebDAV 直接在此文件实现；Alist / S3 复用 RemoteStorageSections

const DEFAULT_CONFIG: WebDAVConfig = {
  enabled: false,
  server_url: '',
  username: '',
  password: '',
  base_path: '/',
  timeout: 30,
  enable_pool: true,
  pool_size: 5,
  enable_cache: true,
  cache_ttl_hours: 24,
  max_retries: 3,
  retry_interval: 5,
}

type ProviderKey = 'local' | 'webdav' | 'alist' | 's3'

function toState(enabled?: boolean, connected?: boolean): ProviderState {
  if (!enabled) return 'disabled'
  if (connected) return 'connected'
  return 'error'
}

export default function StorageTab() {
  // WebDAV 本地 state
  const [config, setConfig] = useState<WebDAVConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [passwordDirty, setPasswordDirty] = useState(false)
  const [hasPassword, setHasPassword] = useState(false)

  // 当前激活的 provider tab
  const [activeTab, setActiveTab] = useState<ProviderKey>('webdav')

  // 统一的状态轮询：WebDAV / Alist / S3 状态由 hook 维护并每 30s 自动刷新
  const { webdavStatus, alistStatus, s3Status } = useStorageStatuses()
  const status = webdavStatus

  // 加载 WebDAV 配置 + 统一状态概览
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      // 配置是表单的关键数据，优先单独加载；状态是辅助信息，
      // 不能因为远程存储不可达（状态探测会卡住/超时）而挡住配置展示。
      const cfgRes = await storageApi.getWebDAVConfig()
      const data = cfgRes.data.data
      setHasPassword(!!data.password)
      setConfig({ ...DEFAULT_CONFIG, ...data, password: '' })
      setPasswordDirty(false)
    } catch (e: any) {
      console.error('加载存储配置失败', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // ----- WebDAV 动作 -----
  const handleSave = async () => {
    setSaving(true)
    setToast(null)
    try {
      const payload: Partial<WebDAVConfig> = { ...config }
      if (!passwordDirty) payload.password = ''
      await storageApi.updateWebDAVConfig(payload)
      setToast({ ok: true, msg: 'WebDAV 配置已保存' })
      await loadAll()
    } catch (e: any) {
      setToast({ ok: false, msg: e?.response?.data?.error || '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setToast(null)
    try {
      await storageApi.testWebDAVConnection({
        server_url: config.server_url,
        username: config.username,
        password: passwordDirty ? config.password : '',
        base_path: config.base_path,
      })
      setToast({ ok: true, msg: 'WebDAV 连接测试成功' })
    } catch (e: any) {
      const raw = e?.response?.data?.error || '连接测试失败'
      const missingCreds = !hasPassword && (!config.username.trim() || !config.password.trim())
      const msg = missingCreds
        ? '连接失败：账号/密码未填写完整，请确认服务器是否需要认证'
        : raw
      setToast({ ok: false, msg })
    } finally {
      setTesting(false)
    }
  }

  // 概览卡数据
  const providers = useMemo(
    () => [
      {
        key: 'local' as const,
        name: '本地存储',
        subtitle: '文件系统直读',
        icon: <HardDrive size={20} />,
        state: 'connected' as ProviderState,
        accent: 'emerald' as const,
      },
      {
        key: 'webdav' as const,
        name: 'WebDAV',
        subtitle: status?.server_url || '远程文件协议',
        icon: <Cloud size={20} />,
        state: toState(status?.enabled, status?.connected),
        accent: 'blue' as const,
      },
      {
        key: 'alist' as const,
        name: 'Alist 聚合网盘',
        subtitle: '阿里云盘 / 115 / 夸克 等',
        icon: <Server size={20} />,
        state: toState(alistStatus?.enabled, alistStatus?.connected),
        accent: 'purple' as const,
      },
      {
        key: 's3' as const,
        name: 'S3 对象存储',
        subtitle: 'AWS S3 / MinIO / R2 / OSS / COS',
        icon: <Database size={20} />,
        state: toState(s3Status?.enabled, s3Status?.connected),
        accent: 'amber' as const,
      },
    ],
    [status, alistStatus, s3Status]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-400" size={32} />
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* ============ 顶部：存储概览 + Tab 切换 ============ */}
      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2
              className="flex items-center gap-2 font-display text-lg font-semibold tracking-wide"
              style={{ color: 'var(--text-primary)' }}
            >
              <HardDrive size={20} className="text-primary-400" />
              存储概览
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              点击下方卡片切换 provider 配置
            </p>
          </div>
          <ActionButton variant="icon" onClick={loadAll} icon={<RefreshCw size={16} />} aria-label="刷新状态" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {providers.map((p) => (
            <ProviderCard
              key={p.key}
              name={p.name}
              subtitle={p.subtitle}
              icon={p.icon}
              state={p.state}
              accent={p.accent}
              active={activeTab === p.key}
              onClick={p.key === 'local' ? undefined : () => setActiveTab(p.key)}
            />
          ))}
        </div>
      </section>

      {/* ============ 详情区：根据激活 tab 渲染 ============ */}
      {activeTab === 'local' && (
        <SectionShell
          icon={<HardDrive size={18} />}
          title="本地存储"
          subtitle="直接读取宿主机挂载的目录"
          statusSlot={<StatusBadge state="connected" label="始终启用" />}
          description="本地存储始终启用，媒体库路径使用标准文件系统路径（如 /vol01/Media/电影）。无需额外配置。"
        >
          <div className="text-sm text-center py-4" style={{ color: 'var(--text-tertiary)' }}>
            本地存储无配置项。请在「媒体库」菜单中新增本地路径的媒体库。
          </div>
        </SectionShell>
      )}

      {activeTab === 'webdav' && (
        <>
          <SectionShell
            icon={<Cloud size={18} />}
            title="WebDAV 存储"
            subtitle="兼容坚果云 / Nextcloud / ownCloud / Synology WebDAV"
            statusSlot={<StatusBadge state={toState(status?.enabled, status?.connected)} />}
            description={
              <>
                媒体库路径使用{' '}
                <code
                  className="mx-0.5 rounded px-1.5 py-0.5 font-mono text-[11px]"
                  style={{
                    background: 'var(--nav-hover-bg)',
                    color: 'var(--neon-blue)',
                    border: '1px solid var(--border-default)',
                  }}
                >
                  webdav://
                </code>{' '}
                前缀。扫描时会自动从远程目录拉取文件列表。
                {status?.error && (
                  <div className="mt-2 text-red-500 dark:text-red-400">
                    <strong>错误：</strong>{status.error}
                  </div>
                )}
              </>
            }
          >
            {/* 启用开关 */}
            <EnableRow
              icon={<Link2 size={16} />}
              title="启用 WebDAV 存储"
              description="启用后媒体库可使用 webdav:// 远程路径"
              checked={config.enabled}
              onChange={(v) => setConfig({ ...config, enabled: v })}
            />

            {/* 启用后显示详细配置；未启用保持清爽 */}
            {config.enabled ? (
              <>
            {/* 连接 */}
            <FieldGroup title="连接" description="WebDAV 服务器地址与基础路径" collapsible defaultOpen={!(status?.enabled && status?.connected)}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="服务器地址" required fullWidth>
                  <Input
                    type="url"
                    value={config.server_url}
                    onChange={(e) => setConfig({ ...config, server_url: e.target.value })}
                    placeholder="https://webdav.example.com/dav/"
                    disabled={!config.enabled}
                  />
                </Field>
                <Field label="基础路径" hint="所有媒体库路径基于此路径解析" fullWidth>
                  <Input
                    type="text"
                    value={config.base_path}
                    onChange={(e) => setConfig({ ...config, base_path: e.target.value })}
                    placeholder="/ 或 /media/videos"
                    disabled={!config.enabled}
                  />
                </Field>
              </div>
            </FieldGroup>

            {/* 鉴权 */}
            <FieldGroup title="鉴权" description="HTTP Basic 认证凭据" collapsible defaultOpen={!(status?.enabled && status?.connected)}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="用户名">
                  <Input
                    type="text"
                    value={config.username}
                    onChange={(e) => setConfig({ ...config, username: e.target.value })}
                    disabled={!config.enabled}
                    autoComplete="username"
                  />
                </Field>
                <Field label="密码">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={config.password}
                    onChange={(e) => {
                      setConfig({ ...config, password: e.target.value })
                      setPasswordDirty(true)
                    }}
                    disabled={!config.enabled}
                    placeholder={passwordDirty ? '' : (hasPassword ? '已设置密码，留空保持不变' : '未设置密码')}
                    autoComplete="current-password"
                    suffix={
                      <EyeToggle
                        visible={showPassword}
                        onToggle={() => setShowPassword((v) => !v)}
                      />
                    }
                  />
                </Field>
              </div>
            </FieldGroup>

            {/* 性能与可靠性（折叠） */}
            <FieldGroup
              title="性能与可靠性"
              collapsible
              defaultOpen={false}
              description="连接池、缓存、重试等高级参数"
            >
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Field label="请求超时（秒）">
                  <Input
                    type="number"
                    min={1}
                    value={config.timeout}
                    onChange={(e) => setConfig({ ...config, timeout: Number(e.target.value) })}
                    disabled={!config.enabled}
                  />
                </Field>
                <Field label="连接池大小">
                  <Input
                    type="number"
                    min={1}
                    value={config.pool_size}
                    onChange={(e) => setConfig({ ...config, pool_size: Number(e.target.value) })}
                    disabled={!config.enabled}
                  />
                </Field>
                <Field label="最大重试次数">
                  <Input
                    type="number"
                    min={0}
                    value={config.max_retries}
                    onChange={(e) => setConfig({ ...config, max_retries: Number(e.target.value) })}
                    disabled={!config.enabled}
                  />
                </Field>
                <Field label="重试间隔（秒）">
                  <Input
                    type="number"
                    min={1}
                    value={config.retry_interval}
                    onChange={(e) => setConfig({ ...config, retry_interval: Number(e.target.value) })}
                    disabled={!config.enabled}
                  />
                </Field>
                <Field label="启用元数据缓存">
                  <div className="flex items-center h-9">
                    <Switch
                      checked={config.enable_cache}
                      onCheckedChange={(v) => setConfig({ ...config, enable_cache: v })}
                      disabled={!config.enabled}
                    />
                  </div>
                </Field>
                <Field label="缓存 TTL（小时）">
                  <Input
                    type="number"
                    min={0}
                    value={config.cache_ttl_hours}
                    onChange={(e) => setConfig({ ...config, cache_ttl_hours: Number(e.target.value) })}
                    disabled={!config.enabled || !config.enable_cache}
                  />
                </Field>
              </div>
            </FieldGroup>

              </>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                启用 WebDAV 存储后，将在这里显示连接与鉴权配置。
              </p>
            )}

            {toast && <Toast ok={toast.ok} msg={toast.msg} onDismiss={() => setToast(null)} />}

            <ActionBar
              inline
              secondaryActions={
                <>
                  <ActionButton
                    variant="secondary"
                    accent="neon"
                    onClick={handleTest}
                    disabled={!config.enabled || !config.server_url || testing || saving}
                    loading={testing}
                    icon={<Wifi size={16} />}
                  >
                    测试连接
                  </ActionButton>
                  <ActionButton
                    variant="icon"
                    onClick={loadAll}
                    icon={<RefreshCw size={16} />}
                    aria-label="刷新"
                  />
                </>
              }
              primaryActions={
                <ActionButton
                  variant="primary"
                  accent="neon"
                  onClick={handleSave}
                  disabled={saving || testing}
                  loading={saving}
                  icon={<Save size={16} />}
                >
                  保存配置
                </ActionButton>
              }
            />
          </SectionShell>
        </>
      )}

      {activeTab === 'alist' && <AlistSection />}
      {activeTab === 's3' && <S3Section />}
    </div>
  )
}
