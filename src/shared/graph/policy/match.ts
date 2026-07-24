/** `asset.*` → 以 `asset.` 开头；精确 id 全等 */
export function matchesTypeIdPattern(pattern: string, typeId: string | undefined | null): boolean {
  if (!typeId) return false
  if (pattern === '*') return true
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1)
    return typeId.startsWith(prefix)
  }
  return pattern === typeId
}
