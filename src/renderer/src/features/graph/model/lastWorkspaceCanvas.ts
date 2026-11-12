import { isCanvasAsset, isDraftAssetId, type AssetInfo } from '@shared/domain'

const LAST_CANVAS_STORAGE_KEY = 'aiart.workspace.lastCanvasByRoot.v1'
const MAX_REMEMBERED_WORKSPACES = 100

/**
 * 归一化工作空间根目录路径作为持久化映射键：
 * 统一斜杠方向、去除末尾多余斜杠，并统一 Windows 盘符大小写（如 F:\Demo 与 f:/Demo/ 视为同一工作空间）。
 */
export function normalizeWorkspaceRootKey(rootPath: string | null | undefined): string {
  const raw = typeof rootPath === 'string' ? rootPath.trim() : ''
  if (!raw) return ''
  let normalized = raw.replace(/\\/g, '/')
  if (normalized.length > 1) {
    normalized = normalized.replace(/\/+$/, '')
  }
  if (/^[A-Za-z]:(?:\/|$)/.test(normalized)) {
    normalized = normalized[0]!.toLowerCase() + normalized.slice(1)
  }
  return normalized
}

function readLastCanvasMap(): Record<string, string> {
  try {
    const storage = globalThis.localStorage
    if (!storage || typeof storage.getItem !== 'function') return {}
    const raw = storage.getItem(LAST_CANVAS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof val === 'string' && val.trim()) {
        out[key] = val.trim()
      }
    }
    return out
  } catch {
    return {}
  }
}

function writeLastCanvasMap(map: Record<string, string>): void {
  try {
    const storage = globalThis.localStorage
    if (!storage || typeof storage.setItem !== 'function') return
    storage.setItem(LAST_CANVAS_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Node 无 --localstorage-file、隐私模式或配额满时静默降级
  }
}

/** 记录指定工作空间最近一次打开/激活的正式画布资产 ID（忽略临时 draft: 画布） */
export function rememberLastCanvasForWorkspace(
  rootPath: string | null | undefined,
  canvasAssetId: string | null | undefined
): void {
  const rootKey = normalizeWorkspaceRootKey(rootPath)
  const id = typeof canvasAssetId === 'string' ? canvasAssetId.trim() : ''
  if (!rootKey || !id || isDraftAssetId(id)) return
  const current = readLastCanvasMap()
  if (current[rootKey] === id) return
  delete current[rootKey]
  current[rootKey] = id
  const keys = Object.keys(current)
  if (keys.length > MAX_REMEMBERED_WORKSPACES) {
    for (const staleKey of keys.slice(0, keys.length - MAX_REMEMBERED_WORKSPACES)) {
      delete current[staleKey]
    }
  }
  writeLastCanvasMap(current)
}

/** 读取指定工作空间上次记住的画布资产 ID */
export function getRememberedCanvasForWorkspace(
  rootPath: string | null | undefined
): string | null {
  const rootKey = normalizeWorkspaceRootKey(rootPath)
  if (!rootKey) return null
  const map = readLastCanvasMap()
  return map[rootKey] ?? null
}

/** 当画布资产被删除时清理对应的历史记录（传 onlyIfCanvasId 时仅在命中该 ID 时清理） */
export function clearRememberedCanvasForWorkspace(
  rootPath: string | null | undefined,
  onlyIfCanvasId?: string
): void {
  const rootKey = normalizeWorkspaceRootKey(rootPath)
  if (!rootKey) return
  const current = readLastCanvasMap()
  if (!(rootKey in current)) return
  if (onlyIfCanvasId && current[rootKey] !== onlyIfCanvasId.trim()) return
  delete current[rootKey]
  writeLastCanvasMap(current)
}

/**
 * 解析打开工作空间时默认应当自动打开的画布资产 ID：
 * 1. 优先打开该工作空间上一次激活/打开且仍存在的画布；
 * 2. 若尚无记录或上次画布已删除，回退到工作空间内最近更新（updatedAt / createdAt 最新）的画布；
 * 3. 若工作空间内没有任何画布资产，返回 null。
 */
export function resolveDefaultCanvasForWorkspace(
  rootPath: string | null | undefined,
  assets: ReadonlyArray<AssetInfo>
): string | null {
  const canvases = assets.filter((asset) => isCanvasAsset(asset.type) && !isDraftAssetId(asset.id))
  if (canvases.length === 0) return null

  const rememberedId = getRememberedCanvasForWorkspace(rootPath)
  if (rememberedId && canvases.some((asset) => asset.id === rememberedId)) {
    return rememberedId
  }

  let latest = canvases[0]!
  let latestTs = Date.parse(latest.updatedAt || latest.createdAt || '') || 0
  for (let i = 1; i < canvases.length; i++) {
    const candidate = canvases[i]!
    const candidateTs = Date.parse(candidate.updatedAt || candidate.createdAt || '') || 0
    if (candidateTs >= latestTs) {
      latest = candidate
      latestTs = candidateTs
    }
  }
  return latest.id
}
