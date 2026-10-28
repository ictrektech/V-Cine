/**
 * VOS 公共目录 → Finder adapter（`p_<公共目录uuid>`）映射
 *
 * 为什么需要：Finder 里公共目录的 adapter 是 `p_<公共目录uuid>`，而 uuid 无法从路径推导，
 * 只能查平台的 `POST /v1000/nas/public-directories/list`（仅需登录态）。
 * 这里用**用户自己的 token** 在前端 join，v-cine 后端不持有任何平台凭据
 * （见 tasks/media-import/PLAN.md 4.2 / 4.3）。
 *
 * 缓存策略（“少感知”要求）：按 `(volume_uuid, 目录名)` 缓存 30 分钟，内存 + localStorage；
 * 查询/上传成功即写入，失败不写；目录改名或换绑后 cache miss 会自动重查。
 */

const STORAGE_KEY = 'vcine.vos.publicDirMap.v1'
const TTL_MS = 30 * 60 * 1000
const PUBLIC_DIRS_ENDPOINT = '/v1000/nas/public-directories/list'

interface CacheEntry {
  uuid: string
  at: number
}

type Cache = Record<string, CacheEntry>

let cache: Cache | null = null

const keyOf = (volumeUUID: string, name: string) => `${volumeUUID}/${name}`

function loadCache(): Cache {
  if (cache) return cache
  cache = {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Cache
      if (parsed && typeof parsed === 'object') cache = parsed
    }
  } catch {
    /* localStorage 不可用或内容损坏 → 用空缓存 */
  }
  return cache
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache || {}))
  } catch {
    /* 配额满/隐私模式 → 仅内存缓存 */
  }
}

/** 记录一次已知的映射（上传成功后调用，成功即证明映射正确） */
export function rememberPublicDirUuid(volumeUUID: string, name: string, uuid: string) {
  if (!volumeUUID || !name || !uuid) return
  const c = loadCache()
  c[keyOf(volumeUUID, name)] = { uuid, at: Date.now() }
  persist()
}

/**
 * 解析公共目录 uuid（调用方自行拼 `p_<uuid>` 作为 Finder adapter）。
 * @returns uuid；查不到（无权限/非公共目录/平台不可达）返回 null
 */
export async function resolvePublicDirUuid(
  volumeUUID: string,
  name: string,
  token: string,
): Promise<string | null> {
  if (!volumeUUID || !name || !token) return null

  const c = loadCache()
  const hit = c[keyOf(volumeUUID, name)]
  if (hit && Date.now() - hit.at < TTL_MS) return hit.uuid

  try {
    const resp = await fetch(PUBLIC_DIRS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ page_num: 1, page_size: 200 }),
    })
    if (!resp.ok) return null
    const body = await resp.json()
    if (body?.code !== 0) return null

    const rows: Array<{ uuid?: string; volume_uuid?: string; name?: string }> = body?.data?.data || []
    const now = Date.now()
    for (const row of rows) {
      if (!row?.uuid || !row?.volume_uuid || !row?.name) continue
      c[keyOf(row.volume_uuid, row.name)] = { uuid: row.uuid, at: now }
    }
    persist()

    const found = c[keyOf(volumeUUID, name)]
    return found ? found.uuid : null
  } catch {
    return null
  }
}
