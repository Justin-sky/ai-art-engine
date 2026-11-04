export const UI_COMPONENT_LIBRARY_SCHEMA = 'aiart.ui-component-library@1' as const

export type UiComponentScalePolicy = 'exact' | 'uniform' | 'nine-slice'

/**
 * Compact normalized visual fingerprint of a canonical UI component master.
 * Stored inline inside `UiSharedComponentItem` so cross-screen clustering and
 * quick candidate pre-filtering work without decoding full PNGs first.
 */
export interface UiComponentVisualDescriptor {
  /** Square thumbnail side length in pixels (default 24). */
  thumbSize: number
  /** Base64-encoded RGBA bytes (`thumbSize * thumbSize * 4` bytes). */
  thumbRgbaBase64: string
  /** `canonicalWidth / canonicalHeight` */
  aspectRatio: number
  /** Fraction of pixels with alpha >= 32, in [0, 1]. */
  opaqueRatio: number
  /** Mean sRGB of opaque pixels `[r, g, b]`. */
  meanRgb: [number, number, number]
  /** Mean sRGB of outer border ring of opaque pixels `[r, g, b]`. */
  borderMeanRgb: [number, number, number]
}

/**
 * Canonical, de-texted, de-occluded shared UI component master.
 * Multiple UI elements across one or more screens can reference this item by `id`,
 * sharing a single embedded Smart Object (`psdGuid`) in PSD and a single texture in Godot/Unity.
 */
export interface UiSharedComponentItem {
  /** Stable identifier within the library, e.g. `comp_item_slot_01`. */
  id: string
  /**
   * Deterministic lowercase GUID (`xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx`)
   * required by Photoshop / `ag-psd` `placedLayer.id` & `linkedFiles[].id`.
   */
  psdGuid: string
  /** Human-readable display name. */
  name: string
  /** Engine-safe identifier (`/^[A-Za-z_][A-Za-z0-9_]{0,63}$/`), e.g. `Comp_ItemSlot_01`. */
  exportName: string
  /** Semantic UI control / element kind (`button`, `item-slot`, `tab`, `badge`, `panel`, etc.). */
  kind: string
  /** Intrinsic width of the master PNG in pixels. */
  canonicalWidth: number
  /** Intrinsic height of the master PNG in pixels. */
  canonicalHeight: number
  /** How instances of different sizes adapt this master (`exact`, `uniform`, or `nine-slice`). */
  scalePolicy: UiComponentScalePolicy
  /** CSS-order 9-slice borders `[top, right, bottom, left]` in master pixels when `nine-slice`. */
  nineSliceBorders?: [number, number, number, number]
  /** Optional node-local image ID inside `generatedImages`. */
  imageId?: string
  /** Materialized project-relative PNG path. */
  imageRelativePath?: string
  /** Inline `data:image/png;base64,...` URL when not yet materialized or in memory. */
  imageUrl?: string
  /** Number of screen instances fused/clustered to produce this master. */
  sourceCount?: number
  /** Preserves user-curated component across re-extractions when true. */
  locked?: boolean
  /** Compact visual descriptor for fast pre-filtering & cross-screen deduplication. */
  descriptor?: UiComponentVisualDescriptor
}

export interface UiComponentLibrary {
  schema: typeof UI_COMPONENT_LIBRARY_SCHEMA
  name?: string
  items: UiSharedComponentItem[]
  updatedAt?: string
}

const PSD_GUID_RE = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/
const BASE64_ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function encodeUint8ToBase64(bytes: Uint8Array | Uint8ClampedArray): string {
  let out = ''
  const len = bytes.length
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]!
    const b1 = i + 1 < len ? bytes[i + 1]! : 0
    const b2 = i + 2 < len ? bytes[i + 2]! : 0
    const trip = (b0 << 16) | (b1 << 8) | b2
    out += BASE64_ABC[(trip >> 18) & 63]!
    out += BASE64_ABC[(trip >> 12) & 63]!
    out += i + 1 < len ? BASE64_ABC[(trip >> 6) & 63]! : '='
    out += i + 2 < len ? BASE64_ABC[trip & 63]! : '='
  }
  return out
}

export function decodeBase64ToUint8(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '')
  if (!clean) return new Uint8Array(0)
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  const byteLen = Math.max(0, Math.floor((clean.length * 3) / 4) - pad)
  const out = new Uint8Array(byteLen)
  let outIdx = 0
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = Math.max(0, BASE64_ABC.indexOf(clean[i] ?? 'A'))
    const c1 = Math.max(0, BASE64_ABC.indexOf(clean[i + 1] ?? 'A'))
    const c2 = clean[i + 2] === '=' ? 0 : Math.max(0, BASE64_ABC.indexOf(clean[i + 2] ?? 'A'))
    const c3 = clean[i + 3] === '=' ? 0 : Math.max(0, BASE64_ABC.indexOf(clean[i + 3] ?? 'A'))
    const trip = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3
    if (outIdx < byteLen) out[outIdx++] = (trip >> 16) & 0xff
    if (outIdx < byteLen) out[outIdx++] = (trip >> 8) & 0xff
    if (outIdx < byteLen) out[outIdx++] = trip & 0xff
  }
  return out
}

function fnv1a32(input: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * Generates a deterministic lowercase RFC-4122-shaped GUID for Photoshop Smart Objects
 * (`placedLayer.id` and `linkedFiles[].id` in `ag-psd`).
 */
export function componentIdToPsdGuid(componentId: string): string {
  const trimmed = componentId.trim()
  if (PSD_GUID_RE.test(trimmed)) return trimmed
  const key = `aiart.ui-comp:${trimmed || 'default'}`
  const h0 = fnv1a32(key, 0x811c9dc5)
  const h1 = fnv1a32(`${key}#1`, 0x9e3779b9)
  const h2 = fnv1a32(`${key}#2`, 0x85ebca6b)
  const h3 = fnv1a32(`${key}#3`, 0xc2b2ae35)
  const hex8 = (v: number): string => (v >>> 0).toString(16).padStart(8, '0')
  const s0 = hex8(h0)
  const s1 = hex8(h1)
  const s2 = hex8(h2)
  const s3 = hex8(h3)
  const part1 = s0
  const part2 = s1.slice(0, 4)
  const part3 = `4${s1.slice(5, 8)}`
  const variantNibble = ((parseInt(s2[0]!, 16) & 0x3) | 0x8).toString(16)
  const part4 = `${variantNibble}${s2.slice(1, 4)}`
  const part5 = `${s2.slice(4, 8)}${s3}`
  return `${part1}-${part2}-${part3}-${part4}-${part5}`
}

export function sanitizeComponentExportName(raw: string, fallbackIndex = 1): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const candidate = cleaned
    ? /^[A-Za-z_]/.test(cleaned)
      ? cleaned
      : `Comp_${cleaned}`
    : `Comp_Item_${String(Math.max(1, fallbackIndex)).padStart(2, '0')}`
  return candidate.slice(0, 64)
}

function clampByte(n: unknown, fallback = 0): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return fallback
  return Math.max(0, Math.min(255, v))
}

function clampPositiveInt(n: unknown, fallback = 1, max = 16384): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return fallback
  return Math.max(1, Math.min(max, v))
}

function normalizeRgb3(raw: unknown): [number, number, number] {
  if (!Array.isArray(raw) || raw.length < 3) return [128, 128, 128]
  return [clampByte(raw[0], 128), clampByte(raw[1], 128), clampByte(raw[2], 128)]
}

function normalizeTuple4NonNeg(raw: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length < 4) return undefined
  const vals = raw.slice(0, 4).map((x) => Math.max(0, Math.round(Number(x))))
  if (vals.some((x) => !Number.isFinite(x))) return undefined
  if (vals.every((x) => x === 0)) return undefined
  return [vals[0]!, vals[1]!, vals[2]!, vals[3]!]
}

function normalizeDescriptor(raw: unknown): UiComponentVisualDescriptor | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const d = raw as Partial<UiComponentVisualDescriptor>
  const thumbSize = clampPositiveInt(d.thumbSize, 24, 64)
  const thumbRgbaBase64 = typeof d.thumbRgbaBase64 === 'string' ? d.thumbRgbaBase64.trim() : ''
  if (!thumbRgbaBase64) return undefined
  const aspectRatio = Number(d.aspectRatio)
  const opaqueRatio = Number(d.opaqueRatio)
  return {
    thumbSize,
    thumbRgbaBase64,
    aspectRatio:
      Number.isFinite(aspectRatio) && aspectRatio > 0 ? Number(aspectRatio.toFixed(4)) : 1,
    opaqueRatio:
      Number.isFinite(opaqueRatio) && opaqueRatio >= 0
        ? Math.min(1, Number(opaqueRatio.toFixed(4)))
        : 1,
    meanRgb: normalizeRgb3(d.meanRgb),
    borderMeanRgb: normalizeRgb3(d.borderMeanRgb)
  }
}

export function normalizeUiSharedComponentItem(
  raw: unknown,
  index = 0
): UiSharedComponentItem | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Partial<UiSharedComponentItem>
  const id =
    typeof row.id === 'string' && row.id.trim()
      ? row.id.trim()
      : `comp_${String(index + 1).padStart(2, '0')}`
  const psdGuid =
    typeof row.psdGuid === 'string' && PSD_GUID_RE.test(row.psdGuid.trim())
      ? row.psdGuid.trim()
      : componentIdToPsdGuid(id)
  const exportName = sanitizeComponentExportName(
    typeof row.exportName === 'string' && row.exportName.trim()
      ? row.exportName
      : typeof row.name === 'string'
        ? row.name
        : id,
    index + 1
  )
  const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : exportName
  const kind = typeof row.kind === 'string' && row.kind.trim() ? row.kind.trim() : 'other'
  const canonicalWidth = clampPositiveInt(row.canonicalWidth, 64)
  const canonicalHeight = clampPositiveInt(row.canonicalHeight, 64)
  const nineSliceBorders = normalizeTuple4NonNeg(row.nineSliceBorders)
  const scalePolicy: UiComponentScalePolicy =
    row.scalePolicy === 'exact' || row.scalePolicy === 'uniform' || row.scalePolicy === 'nine-slice'
      ? row.scalePolicy
      : nineSliceBorders
        ? 'nine-slice'
        : 'uniform'
  const imageId = typeof row.imageId === 'string' && row.imageId.trim() ? row.imageId.trim() : ''
  const imageRelativePath =
    typeof row.imageRelativePath === 'string' && row.imageRelativePath.trim()
      ? row.imageRelativePath.trim()
      : ''
  const imageUrl =
    typeof row.imageUrl === 'string' && row.imageUrl.trim() ? row.imageUrl.trim() : ''
  const sourceCount =
    typeof row.sourceCount === 'number' && Number.isFinite(row.sourceCount) && row.sourceCount >= 1
      ? Math.round(row.sourceCount)
      : undefined
  const descriptor = normalizeDescriptor(row.descriptor)
  return {
    id,
    psdGuid,
    name,
    exportName,
    kind,
    canonicalWidth,
    canonicalHeight,
    scalePolicy,
    ...(nineSliceBorders ? { nineSliceBorders } : {}),
    ...(imageId ? { imageId } : {}),
    ...(imageRelativePath ? { imageRelativePath } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(sourceCount ? { sourceCount } : {}),
    ...(row.locked === true ? { locked: true } : {}),
    ...(descriptor ? { descriptor } : {})
  }
}

export function emptyUiComponentLibrary(name?: string): UiComponentLibrary {
  return {
    schema: UI_COMPONENT_LIBRARY_SCHEMA,
    ...(name?.trim() ? { name: name.trim() } : {}),
    items: []
  }
}

export function normalizeUiComponentLibrary(raw: unknown): UiComponentLibrary | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Partial<UiComponentLibrary> & { entries?: unknown[] }
  const rawItems = Array.isArray(obj.items)
    ? obj.items
    : Array.isArray(obj.entries)
      ? obj.entries
      : null
  if (!rawItems) return null
  const items: UiSharedComponentItem[] = []
  const seen = new Set<string>()
  for (const [idx, item] of rawItems.entries()) {
    const normalized = normalizeUiSharedComponentItem(item, idx)
    if (!normalized || seen.has(normalized.id)) continue
    seen.add(normalized.id)
    items.push(normalized)
  }
  return {
    schema: UI_COMPONENT_LIBRARY_SCHEMA,
    ...(typeof obj.name === 'string' && obj.name.trim() ? { name: obj.name.trim() } : {}),
    items,
    ...(typeof obj.updatedAt === 'string' && obj.updatedAt.trim()
      ? { updatedAt: obj.updatedAt.trim() }
      : {})
  }
}

export function parseUiComponentLibrary(raw: unknown): UiComponentLibrary | null {
  if (!raw) return null
  if (typeof raw === 'object') return normalizeUiComponentLibrary(raw)
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    return normalizeUiComponentLibrary(JSON.parse(trimmed))
  } catch {
    return null
  }
}

export function stringifyUiComponentLibrary(doc: UiComponentLibrary): string {
  const normalized = normalizeUiComponentLibrary(doc) ?? emptyUiComponentLibrary()
  return JSON.stringify(normalized, null, 2)
}

export function uiComponentItemImage(
  item: Pick<UiSharedComponentItem, 'imageRelativePath' | 'imageUrl'>
): string {
  return item.imageRelativePath?.trim() || item.imageUrl?.trim() || ''
}

export function mergeUiComponentLibraries(
  ...libs: Array<UiComponentLibrary | null | undefined>
): UiComponentLibrary {
  const byId = new Map<string, UiSharedComponentItem>()
  let name = ''
  let updatedAt = ''
  for (const lib of libs) {
    if (!lib) continue
    if (!name && lib.name?.trim()) name = lib.name.trim()
    if (lib.updatedAt?.trim()) updatedAt = lib.updatedAt.trim()
    for (const item of lib.items ?? []) {
      const normalized = normalizeUiSharedComponentItem(item, byId.size)
      if (!normalized) continue
      const prev = byId.get(normalized.id)
      if (!prev) {
        byId.set(normalized.id, normalized)
        continue
      }
      if (prev.locked && !normalized.locked) continue
      const nextHasImg = Boolean(uiComponentItemImage(normalized))
      const prevHasImg = Boolean(uiComponentItemImage(prev))
      byId.set(normalized.id, nextHasImg || !prevHasImg ? normalized : { ...normalized, ...prev })
    }
  }
  return {
    schema: UI_COMPONENT_LIBRARY_SCHEMA,
    ...(name ? { name } : {}),
    items: [...byId.values()],
    ...(updatedAt ? { updatedAt } : {})
  }
}

export function uiComponentLibraryFingerprintKey(
  items: ReadonlyArray<UiSharedComponentItem> | null | undefined
): string {
  if (!items?.length) return ''
  const sig = items
    .map(
      (c) =>
        `${c.id}:${c.canonicalWidth}x${c.canonicalHeight}:${c.scalePolicy}:${c.imageRelativePath || c.imageId || c.psdGuid}`
    )
    .join(',')
  return `${items.length}:${fnv1a32(sig, 0x811c9dc5).toString(16)}`
}

export function uiComponentLibrarySummary(
  doc: UiComponentLibrary | null | undefined,
  locale?: string
): string {
  const count = doc?.items?.length ?? 0
  const isZh = (locale ?? '').toLowerCase().startsWith('zh')
  if (!count) {
    return isZh ? '暂无共享组件' : 'No shared components' // cjk-ok
  }
  const nineSliceCount = doc!.items.filter((i) => i.scalePolicy === 'nine-slice').length
  if (isZh) {
    const nineText = nineSliceCount > 0 ? ` · ${nineSliceCount} 个九宫格` : '' // cjk-ok
    return `共享组件库 · ${count} 个母本${nineText}` // cjk-ok
  }
  return `Component library · ${count} master${count === 1 ? '' : 's'}${nineSliceCount > 0 ? ` · ${nineSliceCount} 9-slice` : ''}`
}
