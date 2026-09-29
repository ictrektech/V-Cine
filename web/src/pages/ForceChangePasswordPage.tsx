import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useTranslation } from '@/i18n'
import { KeyRound, Loader2 } from 'lucide-react'

/**
 * ForceChangePasswordPage 强制修改密码页
 * 管理员重置密码或首次默认 admin 登录后会被导流到此页面
 */
export default function ForceChangePasswordPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const logout = useAuthStore((s) => s.logout)
  const { t } = useTranslation()
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [newPwd2, setNewPwd2] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPwd.length < 6) { setError(t('forceChange.errTooShort')); return }
    if (newPwd !== newPwd2) { setError(t('forceChange.errMismatch')); return }
    if (newPwd === oldPwd) { setError(t('forceChange.errSameAsOld')); return }

    setLoading(true)
    try {
      const res = await authApi.changePassword(oldPwd, newPwd)
      const tokenData = res.data.data

      // 后端改密后会吊销旧 Token。只有拿到新 Token 才能视为完整成功，
      // 避免响应异常时仍跳转首页，给用户造成“密码已经修改”的假象。
      if (!tokenData?.token || !tokenData.user) {
        setError(res.data.message || t('forceChange.errSessionRefresh'))
        return
      }

      // 改密接口返回的新会话必须与清除后的强制改密状态一起落库。
      // 显式归一化该字段，也兼容仍返回旧 user 快照的后端版本。
      setAuth(tokenData.token, { ...tokenData.user, must_change_pwd: false })
      navigate('/', { replace: true })
    } catch (err: any) {
      setError(err?.response?.data?.error || t('forceChange.errFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4" style={{ background: 'var(--bg-base)' }}>
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}>
            <KeyRound size={26} className="text-white" />
          </div>
          <h1 className="font-display text-xl font-bold tracking-wider" style={{ color: 'var(--text-primary)' }}>{t('forceChange.title')}</h1>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {t('forceChange.subtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="glass-panel rounded-2xl p-6 space-y-4">
          {error && (
            <div className="rounded-xl px-4 py-3 text-sm text-red-400" style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.15)' }}>
              {error}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{t('forceChange.currentPassword')}</label>
            <input
              type="password"
              name="current-password"
              autoComplete="current-password"
              value={oldPwd}
              onChange={e => setOldPwd(e.target.value)}
              className="input"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{t('forceChange.newPassword')}</label>
            <input
              type="password"
              name="new-password"
              autoComplete="new-password"
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              className="input"
              required
              minLength={6}
              maxLength={64}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{t('forceChange.confirmPassword')}</label>
            <input
              type="password"
              name="confirm-password"
              autoComplete="new-password"
              value={newPwd2}
              onChange={e => setNewPwd2(e.target.value)}
              className="input"
              required
              minLength={6}
              maxLength={64}
            />
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full py-3">
            {loading ? <span className="flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" />{t('forceChange.submitting')}</span> : t('forceChange.submit')}
          </button>

          <button type="button" onClick={handleLogout} className="block w-full text-center text-xs transition-colors hover:text-neon" style={{ color: 'var(--text-muted)' }}>
            {t('forceChange.logout')}
          </button>
        </form>
      </div>
    </div>
  )
}
