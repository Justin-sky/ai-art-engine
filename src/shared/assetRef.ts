/**
 * 统一资产 GUID 引用（对标 Unity PPtr / GUID 序列化的轻量版）。
 *
 * 磁盘/开放 JSON 推荐形态：
 *   { "$type": "AssetRef", "guid": "<uuid>" }
 *
 * 深度遍历（collect / remap）识别：
 * - TaggedAssetRef：{ $type: "AssetRef", guid }
 * - { guid: string }（无 $type，且 guid 像 UUID）
 * - 已知域字段上的 UUID 字符串（assetId 等内存主字段，非任意裸 GUID）
 *
 * 内存侧多数 API 仍可用 string；读写时用 readAssetGuid / tagAssetRef 转换。
 */

export const ASSET_REF_TYPE = 'AssetRef' as const

/** 内存/类型层的资产引用 */
export interface AssetRef {
  guid: string
}

/** 落盘/树遍历可识别的标签形态 */
export interface TaggedAssetRef extends AssetRef {
  $type: typeof ASSET_REF_TYPE
}

/**
 * 已知资产 GUID 字段名（深度遍历时：该 key 的 string 值视为资产 GUID）。
 * 不含 shotId / selectedImageId / folderId 等非资产身份字段。
 */
export const ASSET_GUID_FIELD_KEYS = new Set([
  'assetId',
  'modelAssetId',
  'linkedPanoramaAssetId',
  'sourceModelAssetId',
  'skeletonAssetId',
  'studioAssetId',
  'folderGuid'
])

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 正式 UUID，或内存草稿 `draft:<uuid>` */
export function isAssetGuid(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (UUID_RE.test(trimmed)) return true
  if (trimmed.startsWith('draft:') && UUID_RE.test(trimmed.slice('draft:'.length))) return true
  return false
}

export function isTaggedAssetRef(value: unknown): value is TaggedAssetRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  return o.$type === ASSET_REF_TYPE && isAssetGuid(o.guid)
}

export function isAssetRef(value: unknown): value is AssetRef {
  if (isTaggedAssetRef(value)) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  const keys = Object.keys(o)
  // 未打标签时仅承认 { guid }，避免误伤带 guid 字段的普通对象
  return keys.length === 1 && keys[0] === 'guid' && isAssetGuid(o.guid)
}

export function tagAssetRef(guid: string): TaggedAssetRef {
  const trimmed = guid.trim()
  if (!isAssetGuid(trimmed)) {
    throw new Error(`Invalid asset GUID: ${guid}`)
  }
  return { $type: ASSET_REF_TYPE, guid: trimmed }
}

/** 从 string | AssetRef | TaggedAssetRef 读取 GUID；非法则 undefined */
export function readAssetGuid(value: unknown): string | undefined {
  if (isAssetGuid(value)) return value.trim()
  if (isAssetRef(value)) return value.guid.trim()
  return undefined
}

export type RemapAssetGuidMap = ReadonlyMap<string, string> | Readonly<Record<string, string>>

function lookupRemap(map: RemapAssetGuidMap, guid: string): string {
  if (map instanceof Map) return map.get(guid) ?? guid
  return map[guid] ?? guid
}

/**
 * 收集值树中全部资产 GUID（TaggedAssetRef / { guid } / 已知域字段上的 UUID）。
 * 不会把普通文本 / 任意裸 GUID / @N / selectedImageId 等当成引用。
 */
export function collectAssetGuids(value: unknown): string[] {
  const found = new Set<string>()
  walkCollect(value, found, null)
  return [...found]
}

function walkCollect(value: unknown, found: Set<string>, parentKey: string | null): void {
  if (value == null) return
  if (typeof value === 'string') {
    if (parentKey && ASSET_GUID_FIELD_KEYS.has(parentKey) && isAssetGuid(value)) {
      found.add(value.trim())
    }
    return
  }
  if (typeof value !== 'object') return
  if (isTaggedAssetRef(value) || (isAssetRef(value) && !Array.isArray(value))) {
    found.add(value.guid.trim())
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) walkCollect(item, found, parentKey)
    return
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    walkCollect(child, found, key)
  }
}

/**
 * 深拷贝并重映射资产 GUID。
 * 只改 TaggedAssetRef / { guid } / 已知域字段上的 UUID，不改普通字符串。
 */
export function remapAssetGuids<T>(value: T, map: RemapAssetGuidMap): T {
  return walkRemap(value, map, null) as T
}

function walkRemap(value: unknown, map: RemapAssetGuidMap, parentKey: string | null): unknown {
  if (value == null) return value
  if (typeof value === 'string') {
    if (parentKey && ASSET_GUID_FIELD_KEYS.has(parentKey) && isAssetGuid(value)) {
      return lookupRemap(map, value.trim())
    }
    return value
  }
  if (typeof value !== 'object') return value

  if (isTaggedAssetRef(value)) {
    const next = lookupRemap(map, value.guid.trim())
    return next === value.guid ? value : { ...value, guid: next }
  }
  if (isAssetRef(value) && !Array.isArray(value)) {
    const next = lookupRemap(map, value.guid.trim())
    return next === value.guid ? value : { ...value, guid: next }
  }

  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const mapped = walkRemap(item, map, parentKey)
      if (mapped !== item) changed = true
      return mapped
    })
    return changed ? next : value
  }

  const obj = value as Record<string, unknown>
  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(obj)) {
    const mapped = walkRemap(child, map, key)
    next[key] = mapped
    if (mapped !== child) changed = true
  }
  return changed ? next : value
}

/** 同步 Graph 节点上的 assetId ↔ assetRef（内存 hydrate） */
export function syncNodeAssetRefFields<T extends { assetId?: string; assetRef?: unknown }>(
  node: T
): T {
  const fromRef = readAssetGuid(node.assetRef)
  const fromId = readAssetGuid(node.assetId)
  const guid = fromRef ?? fromId
  if (!guid) return node
  const tagged = tagAssetRef(guid)
  if (node.assetId === guid && isTaggedAssetRef(node.assetRef) && node.assetRef.guid === guid) {
    return node
  }
  return { ...node, assetId: guid, assetRef: tagged }
}
