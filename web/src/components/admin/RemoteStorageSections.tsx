import { useEffect, useState, useCallback } from 'react'
import { storageApi } from '@/api'
import type { AlistConfig, S3Config } from '@/api/storage'
import { useStorageStatuses } from '@/hooks/useStorageStatuses'
import {
  Cloud,
  Loader2,
  Save,
  Wifi,
  Server,
  Database,
  RefreshCw,
  Link2,
} from 'lucide-react'
import { useTranslation } from '@/i18n'
import { Switch } from '@/components/ui/switch'
import {
  SectionShell,
  FieldGroup,
  Field,
  Input,
  ActionBar,
  ActionButton,
  Toast,
  StatusBadge,
  VersionBadge,
  EyeToggle,
  EnableRow,
  ProviderState,
} from './storage/StorageUIKit'

// ==================== V2.3: 远程存储扩展管理 ====================
// Alist / S3 两个 section，样式与 WebDAV 完全对齐

// ---------- 默认值 ----------

const DEFAULT_ALIST: AlistConfig = {
  enabled: false,
  server_url: '',
  username: '',
  password: '',
  token: '',
  base_path: '/',
  timeout: 30,
  enable_cache: true,
  cache_ttl_hours: 12,
  read_block_size_mb: 8,
  read_block_count: 4,
}

const DEFAULT_S3: S3Config = {
  enabled: false,
  endpoint: '',
  region: 'us-east-1',
  access_key: '',
  secret_key: '',
  bucket: '',
  base_path: '',
  path_style: true,
  timeout: 30,
  enable_cache: true,
  cache_ttl_hours: 24,
  read_block_size_mb: 8,
  read_block_count: 4,
}

function toProviderState(status: { enabled?: boolean; connected?: boolean } | null | undefined): ProviderState {
  if (!status) return 'disabled'
  if (!status.enabled) return 'disabled'
  if (status.connected) return 'connected'
  return 'error'
}

// ==================== Alist Section ====================

export function AlistSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AlistConfig>(DEFAULT_ALIST)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null)
  const [showPwd, setShowPwd] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [pwdDirty, setPwdDirty] = useState(false)
  const [tokenDirty, setTokenDirty] = useState(false)
  const [hasPwd, setHasPwd] = useState(false)
  const [hasToken, setHasToken] = useState(false)
  const { alistStatus } = useStorageStatuses()
  const status = alistStatus

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 配置先加载：状态探测在远程存储不可达时可能长时间不返回，不能阻塞表单。
      const cfgRes = await storageApi.getAlistConfig()
      const data = cfgRes.data.data
      setHasPwd(!!data.password)
      setHasToken(!!data.token)
      setConfig({ ...DEFAULT_ALIST, ...data, password: '', token: '' })
    } catch (e) {
      console.error('加载 Alist 配置失败', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleSave = async () => {
    setSaving(true)
    setToast(null)
    try {
      const payload: Partial<AlistConfig> = { ...config }
      if (!pwdDirty) delete payload.password
      if (!tokenDirty) delete payload.token
      await storageApi.updateAlistConfig(payload)
      setPwdDirty(false)
      setTokenDirty(false)
      setToast({ ok: true, msg: t('st.savedAlist') })
      await load()
    } catch (e: any) {
      setToast({ ok: false, msg: t('st.saveFailedColon') + (e.response?.data?.error || e.message) })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setToast(null)
    try {
      await storageApi.testAlistConnection({
        server_url: config.server_url,
        username: config.username,
        password: pwdDirty ? config.password : '',
        token: tokenDirty ? config.token : '',
        base_path: config.base_path,
      })
      setToast({ ok: true, msg: t('st.testOkAlist') })
    } catch (e: any) {
      const raw = e.response?.data?.error || t('st.testFailed')
      const missingCreds = !hasToken && !hasPwd && !config.token.trim() && (!config.username.trim() || !config.password.trim())
      const msg = missingCreds
        ? t('st.testAuthHintAlist')
        : raw
      setToast({ ok: false, msg })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <section className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin text-primary-400" size={20} />
      </section>
    )
  }

  return (
    <SectionShell
      icon={<Cloud size={18} />}
      title={t('st.alistCardName')}
      subtitle={t('st.alistCardSubtitle')}
      badge={<VersionBadge accent="purple">V2.3</VersionBadge>}
      statusSlot={<StatusBadge state={toProviderState(status)} />}
      accent="purple"
      description={
        <>
          {t('st.prefixStart')}{' '}
          <code
            className="mx-0.5 rounded px-1.5 py-0.5 font-mono text-[11px] text-purple-600 dark:text-purple-300"
            style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.25)' }}
          >
            alist://
          </code>
          {' '}{t('st.prefixEndAlist')}
        </>
      }
    >
      {/* 启用开关行 */}
      <EnableRow
        icon={<Link2 size={16} />}
        title={t('st.enableTitleAlist')}
        description={t('st.enableDescAlist')}
        checked={config.enabled}
        onChange={(v) => setConfig({ ...config, enabled: v })}
        iconColorClass="text-purple-600 dark:text-purple-300"
      />

      {/* 启用后显示详细配置；未启用保持清爽 */}
      {config.enabled ? (
        <>
      {/* 连接配置 */}
      <FieldGroup title={t('st.connTitle')} description={t('st.connDescAlist')} collapsible defaultOpen={!(config.enabled && status?.connected)}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t('st.serverUrl')} required fullWidth>
            <Input
              type="url"
              value={config.server_url}
              onChange={(e) => setConfig({ ...config, server_url: e.target.value })}
              placeholder="https://alist.example.com"
              disabled={!config.enabled}
            />
          </Field>
          <Field label={t('st.basePath')} hint={t('st.basePathHintAlist')}>
            <Input
              type="text"
              value={config.base_path}
              onChange={(e) => setConfig({ ...config, base_path: e.target.value })}
              placeholder="/aliyun/movies"
              disabled={!config.enabled}
            />
          </Field>
          <Field label={t('st.timeout')}>
            <Input
              type="number"
              min={1}
              value={config.timeout}
              onChange={(e) => setConfig({ ...config, timeout: parseInt(e.target.value) || 30 })}
              disabled={!config.enabled}
            />
          </Field>
        </div>
      </FieldGroup>

      {/* 鉴权 */}
      <FieldGroup title={t('st.authTitle')} description={t('st.authDescAlist')} collapsible defaultOpen={!(config.enabled && status?.connected)}>
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
              type={showPwd ? 'text' : 'password'}
              value={config.password}
              onChange={(e) => {
                setConfig({ ...config, password: e.target.value })
                setPwdDirty(true)
              }}
              disabled={!config.enabled}
              placeholder={pwdDirty ? '' : (hasPwd ? t('st.pwdSet') : t('st.pwdUnset'))}
              autoComplete="current-password"
              suffix={<EyeToggle visible={showPwd} onToggle={() => setShowPwd((v) => !v)} />}
            />
          </Field>
          <Field label={t('st.token')} fullWidth hint={t('st.tokenHint')}>
            <Input
              type={showToken ? 'text' : 'password'}
              value={config.token}
              onChange={(e) => {
                setConfig({ ...config, token: e.target.value })
                setTokenDirty(true)
              }}
              disabled={!config.enabled}
              placeholder={tokenDirty ? '' : (hasToken ? t('st.tokenSet') : t('st.tokenUnset'))}
              className="font-mono"
              suffix={<EyeToggle visible={showToken} onToggle={() => setShowToken((v) => !v)} />}
            />
          </Field>
        </div>
      </FieldGroup>

      {/* 性能（折叠） */}
      <FieldGroup title={t('st.perfTuning')} collapsible defaultOpen={false} description={t('st.perfDescCommon')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              onChange={(e) => setConfig({ ...config, cache_ttl_hours: parseInt(e.target.value) || 12 })}
              disabled={!config.enabled || !config.enable_cache}
            />
          </Field>
          <Field label={t('st.chunkSize')}>
            <Input
              type="number"
              min={1}
              value={config.read_block_size_mb}
              onChange={(e) => setConfig({ ...config, read_block_size_mb: parseInt(e.target.value) || 8 })}
              disabled={!config.enabled}
            />
          </Field>
          <Field label={t('st.maxChunks')}>
            <Input
              type="number"
              min={1}
              value={config.read_block_count}
              onChange={(e) => setConfig({ ...config, read_block_count: parseInt(e.target.value) || 4 })}
              disabled={!config.enabled}
            />
          </Field>
        </div>
      </FieldGroup>

        </>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {t('st.notConfiguredHintAlist')}
        </p>
      )}

      {toast && <Toast ok={toast.ok} msg={toast.msg} onDismiss={() => setToast(null)} />}

      <ActionBar
        inline
        secondaryActions={
          <>
            <ActionButton
              variant="secondary"
              accent="purple"
              onClick={handleTest}
              disabled={!config.enabled || !config.server_url || testing || saving}
              loading={testing}
              icon={<Wifi size={16} />}
            >
              {t('st.testBtn')}
            </ActionButton>
            <ActionButton variant="icon" onClick={load} icon={<RefreshCw size={16} />} aria-label={t('st.refresh')} />
          </>
        }
        primaryActions={
          <ActionButton
            variant="primary"
            accent="purple"
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
  )
}

// ==================== S3 Section ====================

export function S3Section() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<S3Config>(DEFAULT_S3)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null)
  const [showSecret, setShowSecret] = useState(false)
  const [secretDirty, setSecretDirty] = useState(false)
  const [hasSecret, setHasSecret] = useState(false)
  const { s3Status } = useStorageStatuses()
  const status = s3Status

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 配置先加载：状态探测在远程存储不可达时可能长时间不返回，不能阻塞表单。
      const cfgRes = await storageApi.getS3Config()
      const data = cfgRes.data.data
      setHasSecret(!!data.secret_key)
      setConfig({ ...DEFAULT_S3, ...data, secret_key: '' })
    } catch (e) {
      console.error('加载 S3 配置失败', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleSave = async () => {
    setSaving(true)
    setToast(null)
    try {
      const payload: Partial<S3Config> = { ...config }
      if (!secretDirty) delete payload.secret_key
      await storageApi.updateS3Config(payload)
      setSecretDirty(false)
      setToast({ ok: true, msg: t('st.savedS3') })
      await load()
    } catch (e: any) {
      setToast({ ok: false, msg: t('st.saveFailedColon') + (e.response?.data?.error || e.message) })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setToast(null)
    try {
      await storageApi.testS3Connection({
        endpoint: config.endpoint,
        region: config.region,
        access_key: config.access_key,
        secret_key: secretDirty ? config.secret_key : '',
        bucket: config.bucket,
        base_path: config.base_path,
        path_style: config.path_style,
      })
      setToast({ ok: true, msg: t('st.testOkS3') })
    } catch (e: any) {
      const raw = e.response?.data?.error || t('st.testFailed')
      const missingCreds = !config.access_key.trim() || (!hasSecret && !config.secret_key.trim())
      const msg = missingCreds
        ? t('st.testAuthHintS3')
        : raw
      setToast({ ok: false, msg })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <section className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin text-primary-400" size={20} />
      </section>
    )
  }

  return (
    <SectionShell
      icon={<Database size={18} />}
      title={t('st.s3CardName')}
      subtitle={t('st.s3CardSubtitle')}
      badge={<VersionBadge accent="amber">V2.3</VersionBadge>}
      statusSlot={<StatusBadge state={toProviderState(status)} />}
      accent="amber"
      description={
        <>
          {t('st.prefixStart')}{' '}
          <code
            className="mx-0.5 rounded px-1.5 py-0.5 font-mono text-[11px] text-amber-600 dark:text-amber-300"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}
          >
            s3://
          </code>
          {' '}{t('st.prefixEndS3')}
        </>
      }
    >
      {/* 启用 */}
      <EnableRow
        icon={<Database size={16} />}
        title={t('st.enableTitleS3')}
        description={t('st.enableDescS3')}
        checked={config.enabled}
        onChange={(v) => setConfig({ ...config, enabled: v })}
        iconColorClass="text-amber-600 dark:text-amber-300"
      />

      {/* 启用后显示详细配置；未启用保持清爽 */}
      {config.enabled ? (
        <>
      {/* 连接 */}
      <FieldGroup title={t('st.connTitle')} description={t('st.connDescS3')} collapsible defaultOpen={!(config.enabled && status?.connected)}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="Endpoint"
            required
            fullWidth
            hint={t('st.endpointHint2')}
          >
            <Input
              type="url"
              value={config.endpoint}
              onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
              placeholder="https://s3.amazonaws.com"
              disabled={!config.enabled}
            />
          </Field>
          <Field label="Region">
            <Input
              type="text"
              value={config.region}
              onChange={(e) => setConfig({ ...config, region: e.target.value })}
              placeholder="us-east-1"
              disabled={!config.enabled}
            />
          </Field>
          <Field label="Bucket" required>
            <Input
              type="text"
              value={config.bucket}
              onChange={(e) => setConfig({ ...config, bucket: e.target.value })}
              disabled={!config.enabled}
            />
          </Field>
          <Field label={t('st.prefixLabel')} hint={t('st.prefixHint')}>
            <Input
              type="text"
              value={config.base_path}
              onChange={(e) => setConfig({ ...config, base_path: e.target.value })}
              placeholder="media/"
              disabled={!config.enabled}
            />
          </Field>
          <Field label={t('st.pathStyle')}>
            <div className="flex items-center h-9 gap-2">
              <Switch
                checked={config.path_style}
                onCheckedChange={(v) => setConfig({ ...config, path_style: v })}
                disabled={!config.enabled}
              />
              <span className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                <Server size={12} /> {t('st.pathStyleHint')}
              </span>
            </div>
          </Field>
        </div>
      </FieldGroup>

      {/* 鉴权 */}
      <FieldGroup title={t('st.authTitle')} description={t('st.authDescS3')} collapsible defaultOpen={!(config.enabled && status?.connected)}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t('st.accessKey')} required>
            <Input
              type="text"
              value={config.access_key}
              onChange={(e) => setConfig({ ...config, access_key: e.target.value })}
              disabled={!config.enabled}
              className="font-mono"
              autoComplete="off"
            />
          </Field>
          <Field label={t('st.secretKey')} required>
            <Input
              type={showSecret ? 'text' : 'password'}
              value={config.secret_key}
              onChange={(e) => {
                setConfig({ ...config, secret_key: e.target.value })
                setSecretDirty(true)
              }}
              disabled={!config.enabled}
              placeholder={secretDirty ? '' : (hasSecret ? t('st.secretSet') : t('st.secretUnset'))}
              className="font-mono"
              autoComplete="off"
              suffix={<EyeToggle visible={showSecret} onToggle={() => setShowSecret((v) => !v)} />}
            />
          </Field>
        </div>
      </FieldGroup>

      {/* 性能（折叠） */}
      <FieldGroup
        title={t('st.perfTuning')}
        collapsible
        defaultOpen={false}
        description={t('st.perfDescCommon')}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              onChange={(e) => setConfig({ ...config, cache_ttl_hours: parseInt(e.target.value) || 24 })}
              disabled={!config.enabled || !config.enable_cache}
            />
          </Field>
          <Field label={t('st.chunkSize')}>
            <Input
              type="number"
              min={1}
              value={config.read_block_size_mb}
              onChange={(e) => setConfig({ ...config, read_block_size_mb: parseInt(e.target.value) || 8 })}
              disabled={!config.enabled}
            />
          </Field>
          <Field label={t('st.maxChunks')}>
            <Input
              type="number"
              min={1}
              value={config.read_block_count}
              onChange={(e) => setConfig({ ...config, read_block_count: parseInt(e.target.value) || 4 })}
              disabled={!config.enabled}
            />
          </Field>
        </div>
      </FieldGroup>

        </>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {t('st.notConfiguredHintS3')}
        </p>
      )}

      {toast && <Toast ok={toast.ok} msg={toast.msg} onDismiss={() => setToast(null)} />}

      <ActionBar
        inline
        secondaryActions={
          <>
            <ActionButton
              variant="secondary"
              accent="amber"
              onClick={handleTest}
              disabled={!config.enabled || !config.endpoint || !config.bucket || testing || saving}
              loading={testing}
              icon={<Wifi size={16} />}
            >
              {t('st.testBtn')}
            </ActionButton>
            <ActionButton variant="icon" onClick={load} icon={<RefreshCw size={16} />} aria-label={t('st.refresh')} />
          </>
        }
        primaryActions={
          <ActionButton
            variant="primary"
            accent="amber"
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
  )
}
