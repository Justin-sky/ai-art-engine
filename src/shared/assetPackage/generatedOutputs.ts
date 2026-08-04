import {
  isUnderAssetLibraryDir,
  isUnderCacheOutputDir,
  normalizeProjectRelativeDir
} from '../domain'

/** 从 genParams / 图 runStates / 分镜等结构中收集的路径字段 */
const RELATIVE_PATH_KEYS = new Set(['relativePath', 'previewRelativePath'])

/** 规范化为工程相对 POSIX 路径；非法则返回空串 */
export function normalizePackableRelativePath(raw?: string | null): string {
  const posix = (raw ?? '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (!posix) return ''
  if (posix.includes('\0') || posix.includes('..')) return ''
  if (posix.startsWith('/') || /^[a-zA-Z]:/.test(posix)) return ''
  return posix.replace(/\/+/g, '/')
}

/**
 * 是否可作为「生成产物」打进资产包（默认 Cache / 历史 Output / graph-outputs）。
 * Assets/ 库内文件走资产条目 payload，不走本通道。
 */
export function isPackableGeneratedRelativePath(
  relativePath?: string | null,
  cacheOutputDir?: string | null
): boolean {
  const posix = normalizePackableRelativePath(relativePath)
  if (!posix) return false
  if (isUnderAssetLibraryDir(posix)) return false
  if (isUnderCacheOutputDir(posix, cacheOutputDir)) return true
  const dir = normalizeProjectRelativeDir(posix)
  if (dir === 'Output' || dir.startsWith('Output/')) return true
  if (dir.startsWith('.aiartengine/graph-outputs/') || dir === '.aiartengine/graph-outputs') {
    return true
  }
  return false
}

/** 深度遍历 JSON，收集 relativePath / previewRelativePath 字符串 */
export function collectRelativePathStrings(value: unknown, out = new Set<string>()): Set<string> {
  if (value == null) return out
  if (Array.isArray(value)) {
    for (const item of value) collectRelativePathStrings(item, out)
    return out
  }
  if (typeof value !== 'object') return out
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (RELATIVE_PATH_KEYS.has(key) && typeof child === 'string') {
      const posix = normalizePackableRelativePath(child)
      if (posix) out.add(posix)
      continue
    }
    collectRelativePathStrings(child, out)
  }
  return out
}
