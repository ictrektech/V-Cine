import { useEffect, useMemo, useState, useCallback } from 'react'
import { storageApi } from '@/api'
import { useTranslation } from '@/i18n'
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
  const { t } = useTranslation()
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
      setToast({ ok: true, msg: t('st.savedWebdav') })
      await loadAll()
    } catch (e: any) {
      setToast({ ok: false, msg: e?.response?.data?.error || t('st.saveFailed') })
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
      setToast({ ok: true, msg: t('st.testOkWebdav') })
    } catch (e: any) {
      const raw = e?.response?.data?.error || t('st.testFailed')
      const missingCreds = !hasPassword && (!config.username.trim() || !config.password.trim())
      const msg = missingCreds
        ? t('st.testAuthHintWebdav')
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
        name: t('st.localName'),
        subtitle: t('st.localSubtitle'),
        icon: <HardDrive size={20} />,
        state: 'connected' as ProviderState,
        accent: 'emerald' as const,
      },
      {
        key: 'webdav' as const,
        name: 'WebDAV',
        subtitle: status?.server_url || t('st.remoteProto'),
        icon: <Cloud size={20} />,
        state: toState(status?.enabled, status?.connected),
        accent: 'blue' as const,
      },
      {
        key: 'alist' as const,
        name: t('st.alistName'),
        subtitle: t('st.alistSubtitle'),
        icon: <Server size={20} />,
        state: toState(alistStatus?.enabled, alistStatus?.connected),
        accent: 'purple' as const,
      },
      {
        key: 's3' as const,
        name: t('st.s3Name'),
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
              {t('st.overviewTitle')}
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {t('st.overviewHint')}
            </p>
          </div>
          <ActionButton variant="icon" onClick={loadAll} icon={<RefreshCw size={16} />} aria-label={t('st.refreshAria')} />
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
          title={t('st.localCardTitle')}
          subtitle={t('st.localCardSubtitle')}
          statusSlot={<StatusBadge state="connected" label={t('st.localBadge')} />}
          description={t('st.localCardDesc')}
        >
          <div className="text-sm text-center py-4" style={{ color: 'var(--text-tertiary)' }}>
            {t('st.localNoConfig')}
          </div>
        </SectionShell>
      )}

      {activeTab === 'webdav' && (
        <>
          <SectionShell
            icon={<Cloud size={18} />}
            title={t('st.webdavName')}
            subtitle={t('st.webdavSubtitle')}
            statusSlot={<StatusBadge state={toState(status?.enabled, status?.connected)} />}
            description={
              <>
                {t('st.prefixStart')}{' '}
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
                {t('st.prefixEndWebdav')}
                {status?.error && (
                  <div className="mt-2 text-red-500 dark:text-red-400">
                    <strong>{t('st.err')}：</strong>{status.error}
                  </div>
                )}
              </>
            }
          >
            {/* 启用开关 */}
            <EnableRow
              icon={<Link2 size={16} />}
              title={t('st.enableTitleWebdav')}
              description={t('st.enableDescWebdav')}
              checked={config.enabled}
              onChange={(v) => setConfig({ ...config, enabled: v })}
            />

            {/* 启用后显示详细配置；未启用保持清爽 */}
            {config.enabled ? (
              <>
            {/* 连接 */}
            <FieldGroup title={t('st.connTitle')} description={t('st.connDescWebdav')} collapsible defaultOpen={!(status?.enabled && status?.connected)}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label={t('st.serverUrl')} required fullWidth>
                  <Input
                    type="url"
                    value={config.server_url}
                    onChange={(e) => setConfig({ ...config, server_url: e.target.value })}
                    placeholder="https://webdav.example.com/dav/"
                    disabled={!config.enabled}
                  />
                </Field>
                <Field label={t('st.basePath')} hint={t('st.basePathHintWebdav')} fullWidth>
                  <Input
                    type="text"
                    value={config.base_path}
                    onChange={(e) => setConfig({ ...config, base_path: e.target.value })}
                    placeholder={t('st.basePathPlaceholder')}
                    disabled={!config.enabled}
                  />
                </Field>
              </div>
            </FieldGroup>

            {/* 鉴权 */}
            <FieldGroup title={t('st.authTitle')} description={t('st.authDescWebdav')} collapsible defaultOpen={!(status?.enabled && status?.connected)}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label={t('st.username')}>
                  <Input
                    type="text"
                    value={config.username}
                    onChange={(e) => setConfig({ ...config, username: e.target.value })}
                    disabled={!config.enabled}
                    autoComplete="username"
                  />
                </Field>
                <Field label={t('st.password')}>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={config.password}
                    onChange={(e) => {
                      setConfig({ ...config, password: e.target.value })
                      setPasswordDirty(true)
                    }}
                    disabled={!config.enabled}
                    placeholder={passwordDirty ? '' : (hasPassword ? t('st.pwdSet') : t('st.pwdUnset'))}
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
              title={t('st.perfTitle')}
              collapsible
              defaultOpen={false}
              description={t('st.perfDescWebdav')}
            >
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Field label={t('st.timeout')}>
                  <Input
                    type="number"
                    min={1}
                    value={config.timeout}
                    onChange={(e) => setConfig({ ...config, timeout: Number(e.target.value) })}
                    disabled={!config.enabled}
                  />
                </Field>
                <Field label={t('st.poolSize')}>
                  <Input
                    type="number"
                    min={1}
                    value={config.pool_size}
                    onChange={(e) => setConfig({ ...config, pool_size: Number(e.target.value) })}
                    disabled={!config.enabled}
                  />
                </Field>
                <Field label={t('st.retries')}>
                  <Input
                    type="number"
                    min={0}
                    value={config.max_retries}
                    onChange={(e) => setConfig({ ...config, max_retries: Number(e.target.value) })}
                    disabled={!config.enabled}
                  />
                </Field>
                <Field label={t('st.retryInterval')}>
                  <Input
                    type="number"
                    min={1}
                    value={config.retry_interval}
                    onChange={(e) => setConfig({ ...config, retry_interval: Number(e.target.value) })}
                    disabled={!config.enabled}
                  />
                </Field>
                <Field label={t('st.metaCache')}>
                  <div className="flex items-center h-9">
                    <Switch
                      checked={config.enable_cache}
                      onCheckedChange={(v) => setConfig({ ...config, enable_cache: v })}
                      disabled={!config.enabled}
                    />
                  </div>
                </Field>
                <Field label={t('st.cacheTtl')}>
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
                {t('st.notConfiguredHintWebdav')}
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
                    {t('st.testBtn')}
                  </ActionButton>
                  <ActionButton
                    variant="icon"
                    onClick={loadAll}
                    icon={<RefreshCw size={16} />}
                    aria-label={t('st.refresh')}
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
                  {t('st.saveBtn')}
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
