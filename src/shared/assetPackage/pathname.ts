import type { AssetFolder, AssetInfo } from '../domain'
import { normalizeFolders } from '../folderTree'

const WIN_RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
])

export function normalizePathSegment(name: string): string {
  let s = name.normalize('NFC').trim()
  s = s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
  s = s.replace(/\.+$/g, '')
  if (!s) s = 'unnamed'
  const base = s.split('.')[0] ?? s
  if (WIN_RESERVED.has(base.toUpperCase())) s = `_${s}`
  if (s.length > 120) s = s.slice(0, 120)
  return s
}

export function assertSafePackagePathname(pathname: string): string {
  const normalized = pathname.normalize('NFC').replace(/\\/g, '/')
  if (!normalized.startsWith('Assets/')) {
    throw new Error(`pathname 必须以 Assets/ 开头: ${pathname}`)
  }
  if (normalized.includes('\0') || normalized.split('/').some((p) => p === '' || p === '.' || p === '..')) {
    throw new Error(`非法 pathname: ${pathname}`)
  }
  if (/^[a-zA-Z]:/.test(normalized) || normalized.startsWith('/')) {
    throw new Error(`pathname 不能是绝对路径: ${pathname}`)
  }
  return normalized
}

export function folderPathname(
  folders: AssetFolder[],
  folderId: string | null | undefined
): string {
  if (!folderId) return 'Assets'
  const byId = new Map(normalizeFolders(folders).map((f) => [f.id, f]))
  const parts: string[] = []
  let cur: string | null = folderId
  const seen = new Set<string>()
  while (cur) {
    if (seen.has(cur)) throw new Error(`文件夹环: ${cur}`)
    seen.add(cur)
    const folder = byId.get(cur)
    if (!folder) break
    parts.push(normalizePathSegment(folder.name))
    cur = folder.parentId ?? null
  }
  parts.reverse()
  return assertSafePackagePathname(['Assets', ...parts].join('/'))
}

export function assetLeafName(asset: Pick<AssetInfo, 'id' | 'name' | 'type' | 'relativePath'>): string {
  const base = normalizePathSegment(asset.name || asset.type)
  if (asset.relativePath) {
    const ext = asset.relativePath.includes('.')
      ? `.${asset.relativePath.split('.').pop()!.toLowerCase()}`
      : ''
    return `${base}${ext}`
  }
  return `${base}.${asset.type}.asset`
}

export function buildAssetPathname(
  folders: AssetFolder[],
  asset: Pick<AssetInfo, 'id' | 'name' | 'type' | 'relativePath' | 'folderId'>
): string {
  const parent = folderPathname(folders, asset.folderId)
  const leaf = assetLeafName(asset)
  return assertSafePackagePathname(`${parent}/${leaf}`)
}

/** 解析资产用于媒体输出默认目录的上下文 */
export function assetMediaHostDirs(
  asset: Pick<AssetInfo, 'relativePath' | 'folderId' | 'name'> | null | undefined,
  folders: AssetFolder[]
): { hostRelativePath: string | null; hostFolderDir: string; hostAssetName: string } {
  if (!asset) {
    return { hostRelativePath: null, hostFolderDir: 'Assets', hostAssetName: 'Generated' }
  }
  let hostFolderDir = 'Assets'
  try {
    hostFolderDir = folderPathname(folders, asset.folderId)
  } catch {
    hostFolderDir = 'Assets'
  }
  return {
    hostRelativePath: asset.relativePath?.trim() || null,
    hostFolderDir,
    hostAssetName: normalizePathSegment(asset.name || 'Generated')
  }
}

/** 保证 pathname 在集合内唯一；冲突时追加 ~guid前8位 */
export function uniquifyPathnames(
  entries: { guid: string; pathname: string }[]
): Map<string, string> {
  const used = new Set<string>()
  const result = new Map<string, string>()
  for (const entry of entries) {
    let path = assertSafePackagePathname(entry.pathname)
    if (used.has(path)) {
      const slash = path.lastIndexOf('/')
      const dir = slash >= 0 ? path.slice(0, slash) : 'Assets'
      const file = slash >= 0 ? path.slice(slash + 1) : path
      const dot = file.lastIndexOf('.')
      const stem = dot > 0 ? file.slice(0, dot) : file
      const ext = dot > 0 ? file.slice(dot) : ''
      path = assertSafePackagePathname(`${dir}/${stem}~${entry.guid.slice(0, 8)}${ext}`)
    }
    used.add(path)
    result.set(entry.guid, path)
  }
  return result
}

export function pathnameDepth(pathname: string): number {
  return assertSafePackagePathname(pathname).split('/').length
}
