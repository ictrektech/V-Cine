import type { TFunc } from '@/i18n'

/**
 * 平台 Finder 上传错误码 → 可读文案（PLAN 4.4 实测码）
 *
 * -2（用户取消）返回空串，调用方据此不提示。
 */
export function uploadErrorMessage(code: number | undefined, t: TFunc): string {
  switch (code) {
    case -2:
      return ''
    case 10001:
      return t('fm.uploadTokenExpired')
    case 10002:
    case 10047:
      return t('fm.uploadNoPermission')
    case 10045:
      return t('fm.uploadAdapterInvalid')
    case 10051:
      return t('fm.uploadConflict')
    case 10055:
      return t('fm.uploadNoSpace')
    default:
      return t('fm.uploadFailed')
  }
}
