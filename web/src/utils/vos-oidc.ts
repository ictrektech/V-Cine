declare global {
  interface Window {
    vos_platform?: { api?: { v1000?: { oauth2?: {
      authorize(params: Record<string, string>): Promise<{ code: string; state: string }>
      token(params: Record<string, string>): Promise<{ access_token: string }>
    } } } }
  }
}

const DETECT_TIMEOUT_MS = 3000
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const random = () => { const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return b64url(bytes) }

async function waitForOAuth2(): Promise<NonNullable<NonNullable<NonNullable<Window['vos_platform']>['api']>['v1000']>['oauth2'] | null> {
  const current = window.vos_platform?.api?.v1000?.oauth2
  if (current) return current
  if (window.parent === window) return null
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const oauth2 = window.vos_platform?.api?.v1000?.oauth2
      if (oauth2) {
        window.clearInterval(timer)
        resolve(oauth2)
      } else if (Date.now() - startedAt >= DETECT_TIMEOUT_MS) {
        window.clearInterval(timer)
        resolve(null)
      }
    }, 50)
  })
}

// Uses VOS's injected same-origin OIDC bridge; it never reads browser session storage.
export async function acquireVOSAccessToken(): Promise<string | null> {
  const oauth2 = await waitForOAuth2()
  if (!oauth2) return null
  const verifier = random(), state = random(), nonce = random()
  // VOS may be served over HTTP, where WebCrypto digest is unavailable.
  const challenge = b64url(new Uint8Array(sha256.array(verifier)))
  const authorization = await oauth2.authorize({ client_id: 'com.ictrek.nowen-video', response_type: 'code', scope: 'openid profile email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' })
  if (authorization.state !== state) throw new Error('VOS OIDC state mismatch')
  const tokens = await oauth2.token({ grant_type: 'authorization_code', code: authorization.code, code_verifier: verifier, client_id: 'com.ictrek.nowen-video' })
  return tokens.access_token || null
}
import { sha256 } from 'js-sha256'
