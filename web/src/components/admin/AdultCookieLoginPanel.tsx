// 番号刮削 - Cookie 登录管理（参考 mdcx）
// 功能：为每个站点配置完整 Cookie 字符串，解锁登录态刮削（JavDB 高清封面、评分、完整演员等）
import { useCallback, useEffect, useState } from 'react'
import { adultScraperApi } from '@/api'
import { Cookie, Save, TestTube2, CheckCircle2, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react'
import clsx from 'clsx'
import { useDialog } from '@/components/Dialog'
import { useTranslation } from '@/i18n'

interface SiteDef {
  id: string
  name: string
  home: string
  tipKey: string
}

const SITES: SiteDef[] = [
  {
    id: 'javbus',
    name: 'JavBus',
    home: 'https://www.javbus.com/',
    tipKey: 'ac.tipUncensored',
  },
  {
    id: 'javdb',
    name: 'JavDB',
    home: 'https://javdb.com/',
    tipKey: 'ac.tipRecommended',
  },
  {
    id: 'freejavbt',
    name: 'Freejavbt',
    home: 'https://freejavbt.com/',
    tipKey: 'ac.tipOptionalCf',
  },
  {
    id: 'jav321',
    name: 'JAV321',
    home: 'https://www.jav321.com/',
    tipKey: 'ac.tipOptionalCookie',
  },
  {
    id: 'fanza',
    name: 'Fanza (DMM)',
    home: 'https://www.dmm.co.jp/',
    tipKey: 'ac.tipDmm',
  },
  {
    id: 'mgstage',
    name: 'MGStage',
    home: 'https://www.mgstage.com/',
    tipKey: 'ac.tipMgs',
  },
  {
    id: 'fc2hub',
    name: 'FC2Hub',
    home: 'https://fc2hub.com/',
    tipKey: 'ac.tipFc2',
  },
]

type CookieMap = Record<string, string>

export default function AdultCookieLoginPanel() {
  const { t } = useTranslation()
  const dialog = useDialog()
  const [cookies, setCookies] = useState<CookieMap>({})
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string>('')
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await adultScraperApi.getConfig()
      const c = res.data.data.cookies || {}
      setCookies({
        javbus: c.javbus || '',
        javdb: c.javdb || '',
        freejavbt: c.freejavbt || '',
        jav321: c.jav321 || '',
        fanza: c.fanza || '',
        mgstage: c.mgstage || '',
        fc2hub: c.fc2hub || '',
      })
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    try {
      await adultScraperApi.updateConfig({
        cookie_javbus: cookies.javbus,
        cookie_javdb: cookies.javdb,
        cookie_freejavbt: cookies.freejavbt,
        cookie_jav321: cookies.jav321,
        cookie_fanza: cookies.fanza,
        cookie_mgstage: cookies.mgstage,
        cookie_fc2hub: cookies.fc2hub,
      })
      await dialog.alert({ title: t('ac.saved'), variant: 'success' })
    } catch (err: any) {
      await dialog.alert({
        title: t('ac.saveFailed'),
        message: err?.response?.data?.error || err?.message,
        variant: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (siteId: string) => {
    setTesting(siteId)
    try {
      const res = await adultScraperApi.testCookie(siteId)
      const { ok, message } = res.data.data
      setTestResults({ ...testResults, [siteId]: { ok, message } })
    } catch (err: any) {
      setTestResults({
        ...testResults,
        [siteId]: { ok: false, message: err?.response?.data?.error || err?.message || t('ac.testFailed') },
      })
    } finally {
      setTesting('')
    }
  }

  return (
    <div className="space-y-4">
      {/* 说明卡片 */}
      <div className="rounded-lg p-3 text-xs" style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        color: 'var(--text-secondary)',
      }}>
        <div className="mb-1 flex items-center gap-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          <Cookie className="h-4 w-4 text-amber-500" /> {t('ac.title')}
        </div>
        <p>{t('ac.desc')}</p>
        <p className="mt-1">
          <strong>{t('ac.getMethodHead')}</strong>{t('ac.getMethod')}
        </p>
      </div>

      {/* 站点列表 */}
      <div className="space-y-3">
        {SITES.map((site) => {
          const val = cookies[site.id] || ''
          const show = visible[site.id] || false
          const res = testResults[site.id]
          return (
            <div key={site.id} className="rounded-lg p-3"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{site.name}</span>
                <a href={site.home} target="_blank" rel="noreferrer"
                  className="text-xs text-blue-500 hover:underline">{site.home}</a>
                <span className="ml-auto text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {val ? t('ac.charCount', { n: val.length }) : t('ac.notSet')}
                </span>
              </div>
              <div className="mb-2 text-xs" style={{ color: 'var(--text-secondary)' }}>💡 {t(site.tipKey)}</div>
              <div className="flex gap-2">
                <textarea
                  rows={2}
                  value={show ? val : val ? '•'.repeat(Math.min(val.length, 60)) : ''}
                  readOnly={!show}
                  onChange={(e) => setCookies({ ...cookies, [site.id]: e.target.value })}
                  placeholder={loaded ? t('ac.placeholder') : t('common.loading')}
                  className="flex-1 rounded px-2 py-1 font-mono text-xs"
                  style={{
                    background: 'var(--nav-hover-bg)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-primary)',
                    resize: 'vertical',
                  }}
                />
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => setVisible({ ...visible, [site.id]: !show })}
                    title={show ? t('ac.hide') : t('ac.show')}
                    className="rounded p-1 hover:bg-[var(--nav-hover-bg)]"
                    style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                  >
                    {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => handleTest(site.id)}
                    disabled={testing === site.id}
                    title={t('ac.test')}
                    className="rounded p-1 hover:bg-[var(--nav-hover-bg)]"
                    style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                  >
                    {testing === site.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <TestTube2 className="h-3 w-3" />}
                  </button>
                </div>
              </div>
              {res && (
                <div className={clsx('mt-2 flex items-start gap-1 text-xs',
                  res.ok ? 'text-green-500' : 'text-red-500')}>
                  {res.ok ? <CheckCircle2 className="h-3 w-3 mt-0.5" /> : <AlertCircle className="h-3 w-3 mt-0.5" />}
                  <span>{res.message}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 保存按钮 */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={load}
          className="rounded px-3 py-1.5 text-sm hover:bg-[var(--nav-hover-bg)]"
          style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
        >
          {t('ac.reload')}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !loaded}
          className="flex items-center gap-1.5 rounded bg-purple-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-600 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t('ac.saveAll')}
        </button>
      </div>
    </div>
  )
}
