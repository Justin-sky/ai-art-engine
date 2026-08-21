/**
 * 图层分离（Seedream 5.0 Pro layer_decomposition）：
 * 一张底图拆成底图 + 最多 16 张透明 PNG，带 z_index / bounding_box / name。
 * 运行后可在 dive 编辑器里调整层级与位置，再本地合成。
 */

import { normalizeExpandResolution } from './imageExpand'

export const LAYER_SPLIT_MAX_LAYERS = 16
export const LAYER_SPLIT_Z_MAX = 4096
export const LAYER_SPLIT_RESOLUTIONS = ['auto', '1K', '1.5K', '2K'] as const
export const LAYER_SPLIT_COMPOSITE_SUFFIX = 'composite'

/** 渲染进程 canvas/`Image()` 可直接加载；TOS https 会被 CORS 拦住，必须先落盘再读 data URL */
export function isCanvasSafeImageSrc(url: string | undefined | null): boolean {
  const src = url?.trim() ?? ''
  if (!src) return false
  return (
    src.startsWith('data:') ||
    src.startsWith('blob:') ||
    src.startsWith('studio-media:') ||
    src.startsWith('file:') ||
    src.startsWith('asset:')
  )
}

export type LayerSplitResolution = (typeof LAYER_SPLIT_RESOLUTIONS)[number]

/** 画布像素矩形：left/top 为左上角，width/height 为贴图尺寸 */
export interface ImageLayerSplitRect {
  left: number
  top: number
  width: number
  height: number
}

export type ImageLayerSplitRole = 'canvas-base' | 'layer'

export interface ImageLayerSplitLayer {
  id: string
  /** 对应 generatedImages[].id，用于取图 */
  imageId: string
  zIndex: number
  name: string
  description: string
  visible: boolean
  left: number
  top: number
  width: number
  height: number
  /** 所属分组；空为顶层 */
  groupId?: string
  /** 整张画布底图；嵌套拆层得到的局部底图仍是 layer */
  role?: ImageLayerSplitRole
  /** API 原始绝对框 [left, top, right, bottom]，用于复位 */
  originalAbsolute?: [number, number, number, number]
  originalNormalized?: [number, number, number, number]
}

export interface ImageLayerSplitGroup {
  id: string
  name: string
  collapsed: boolean
  visible: boolean
  /** 被继续拆分的那一层 */
  sourceLayerId: string
  parentGroupId?: string
}

export interface ImageLayerSplitState {
  prompt: string
  resolution: string
  selectedId: string
  canvasWidth: number
  canvasHeight: number
  layers: ImageLayerSplitLayer[]
  groups: ImageLayerSplitGroup[]
  /** 源图 + prompt + 分辨率指纹；变化时重新调用拆层 API */
  sourceFingerprint: string
}

export interface ImageLayerSplitNestedRequest {
  layerId: string
  prompt: string
  resolution: string
  generateModel: string
  generateProviderInstanceId: string
  imageLayerSplit: ImageLayerSplitState
}

export const DEFAULT_IMAGE_LAYER_SPLIT: ImageLayerSplitState = {
  prompt: '',
  resolution: '2K',
  selectedId: '',
  canvasWidth: 0,
  canvasHeight: 0,
  layers: [],
  groups: [],
  sourceFingerprint: ''
}

export function isLayerSplitBase(
  layer: Pick<ImageLayerSplitLayer, 'zIndex' | 'groupId' | 'role'>
): boolean {
  if (layer.role === 'canvas-base') return true
  if (layer.role === 'layer') return false
  return layer.zIndex <= 0 && !layer.groupId
}

export function layerSplitCompositeImageId(nodeId: string): string {
  return `layerSplit:${nodeId}:${LAYER_SPLIT_COMPOSITE_SUFFIX}`
}

export function normalizeLayerSplitResolution(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return DEFAULT_IMAGE_LAYER_SPLIT.resolution
  if (raw.toLowerCase() === 'auto') return 'auto'
  const upper = raw.toUpperCase()
  if (upper === '1.5K') return '1.5K'
  if (upper === '1K' || upper === '2K') return upper
  return normalizeExpandResolution(raw)
}

function clampInt(n: unknown, fallback: number, min = 0, max = 1_000_000): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, v))
}

export function parseImageSizeField(size: string | undefined): { width: number; height: number } | null {
  const m = /^(\d+)\s*[xX×]\s*(\d+)$/.exec(String(size ?? '').trim())
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null
  return { width, height }
}

export function tuple4(raw: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length < 4) return undefined
  const nums = raw.slice(0, 4).map((n) => Number(n))
  if (nums.some((n) => !Number.isFinite(n))) return undefined
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!]
}

/** 归一化坐标（0–1000）→ 输出底图像素框 */
export function normalizedToRect(
  normalized: [number, number, number, number],
  canvasWidth: number,
  canvasHeight: number
): ImageLayerSplitRect {
  const w = Math.max(1, canvasWidth)
  const h = Math.max(1, canvasHeight)
  const left = Math.round((normalized[0] / 1000) * w)
  const top = Math.round((normalized[1] / 1000) * h)
  const right = Math.round((normalized[2] / 1000) * w)
  const bottom = Math.round((normalized[3] / 1000) * h)
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  }
}

export function absoluteToRect(absolute: [number, number, number, number]): ImageLayerSplitRect {
  const left = Math.round(absolute[0])
  const top = Math.round(absolute[1])
  const right = Math.round(absolute[2])
  const bottom = Math.round(absolute[3])
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  }
}

export function rectFromApiBoxes(
  boundingBox: { absolute?: unknown; normalized?: unknown } | undefined,
  canvasWidth: number,
  canvasHeight: number,
  fallback?: ImageLayerSplitRect
): ImageLayerSplitRect {
  const abs = tuple4(boundingBox?.absolute)
  if (abs) return absoluteToRect(abs)
  const norm = tuple4(boundingBox?.normalized)
  if (norm) return normalizedToRect(norm, canvasWidth, canvasHeight)
  return fallback ?? { left: 0, top: 0, width: Math.max(1, canvasWidth), height: Math.max(1, canvasHeight) }
}

export function layerSplitFingerprint(sourceUrl: string, prompt: string, resolution: string): string {
  const src = sourceUrl.trim()
  const head = src.slice(0, 64)
  const tail = src.length > 80 ? src.slice(-24) : ''
  return `${src.length}:${head}:${tail}|${prompt.trim()}|${normalizeLayerSplitResolution(resolution)}`
}

function normalizeLayerRole(
  row: Partial<ImageLayerSplitLayer>,
  zIndex: number,
  groupId: string
): ImageLayerSplitRole {
  if (row.role === 'canvas-base') return 'canvas-base'
  if (row.role === 'layer') return 'layer'
  return zIndex <= 0 && !groupId ? 'canvas-base' : 'layer'
}

function normalizeLayer(raw: unknown, index: number): ImageLayerSplitLayer | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Partial<ImageLayerSplitLayer>
  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `layer:${index}`
  const imageId =
    typeof row.imageId === 'string' && row.imageId.trim() ? row.imageId.trim() : id
  const zIndex = clampInt(row.zIndex, index, 0, LAYER_SPLIT_Z_MAX)
  const width = clampInt(row.width, 1, 1)
  const height = clampInt(row.height, 1, 1)
  const originalAbsolute = tuple4(row.originalAbsolute)
  const originalNormalized = tuple4(row.originalNormalized)
  const groupId = typeof row.groupId === 'string' && row.groupId.trim() ? row.groupId.trim() : ''
  const role = normalizeLayerRole(row, zIndex, groupId)
  return {
    id,
    imageId,
    zIndex,
    name: typeof row.name === 'string' ? row.name : '',
    description: typeof row.description === 'string' ? row.description : '',
    visible: row.visible !== false,
    left: clampInt(row.left, 0),
    top: clampInt(row.top, 0),
    width,
    height,
    role,
    ...(groupId ? { groupId } : {}),
    ...(originalAbsolute ? { originalAbsolute } : {}),
    ...(originalNormalized ? { originalNormalized } : {})
  }
}

function normalizeGroup(raw: unknown, index: number): ImageLayerSplitGroup | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Partial<ImageLayerSplitGroup>
  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `group:${index}`
  const sourceLayerId =
    typeof row.sourceLayerId === 'string' && row.sourceLayerId.trim()
      ? row.sourceLayerId.trim()
      : ''
  if (!sourceLayerId) return null
  const parentGroupId =
    typeof row.parentGroupId === 'string' && row.parentGroupId.trim()
      ? row.parentGroupId.trim()
      : ''
  return {
    id,
    name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : id,
    collapsed: row.collapsed === true,
    visible: row.visible !== false,
    sourceLayerId,
    ...(parentGroupId ? { parentGroupId } : {})
  }
}

export function normalizeImageLayerSplit(
  raw?: Partial<ImageLayerSplitState> | null
): ImageLayerSplitState {
  const base = { ...DEFAULT_IMAGE_LAYER_SPLIT, ...(raw ?? {}) }
  const layers: ImageLayerSplitLayer[] = []
  const seen = new Set<string>()
  const incoming = Array.isArray(base.layers) ? base.layers : []
  for (const [index, item] of incoming.entries()) {
    const layer = normalizeLayer(item, index)
    if (!layer) continue
    if (seen.has(layer.id)) continue
    seen.add(layer.id)
    layers.push(layer)
  }
  const groups: ImageLayerSplitGroup[] = []
  const seenGroups = new Set<string>()
  const incomingGroups = Array.isArray(base.groups) ? base.groups : []
  for (const [index, item] of incomingGroups.entries()) {
    const group = normalizeGroup(item, index)
    if (!group) continue
    if (seenGroups.has(group.id)) continue
    seenGroups.add(group.id)
    groups.push(group)
  }
  const groupIds = new Set(groups.map((g) => g.id))
  const layersWithGroups = layers.map((layer) =>
    layer.groupId && !groupIds.has(layer.groupId) ? { ...layer, groupId: undefined } : layer
  )
  const selectedId =
    typeof base.selectedId === 'string' &&
    layersWithGroups.some((l) => l.id === base.selectedId.trim())
      ? base.selectedId.trim()
      : ''
  return {
    prompt: typeof base.prompt === 'string' ? base.prompt : '',
    resolution: normalizeLayerSplitResolution(base.resolution),
    selectedId,
    canvasWidth: clampInt(base.canvasWidth, 0, 0),
    canvasHeight: clampInt(base.canvasHeight, 0, 0),
    layers: layersWithGroups,
    groups,
    sourceFingerprint: typeof base.sourceFingerprint === 'string' ? base.sourceFingerprint : ''
  }
}

export function readImageLayerSplitFromNode(params: {
  imageLayerSplit?: Partial<ImageLayerSplitState>
}): ImageLayerSplitState {
  return normalizeImageLayerSplit(params.imageLayerSplit)
}

export function imageLayerSplitToNodePatch(state: ImageLayerSplitState): {
  imageLayerSplit: ImageLayerSplitState
} {
  return { imageLayerSplit: normalizeImageLayerSplit(state) }
}

export function sortLayersForCompose(
  layers: ImageLayerSplitLayer[]
): ImageLayerSplitLayer[] {
  return [...layers].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))
}

function siblingGroupKey(layer: Pick<ImageLayerSplitLayer, 'groupId'>): string {
  return layer.groupId?.trim() || ''
}

export function reorderLayerSplit(
  layers: ImageLayerSplitLayer[],
  id: string,
  direction: 'up' | 'down' | 'front' | 'back'
): ImageLayerSplitLayer[] {
  const current = layers.find((l) => l.id === id)
  if (!current || isLayerSplitBase(current)) return layers
  const groupKey = siblingGroupKey(current)
  const siblings = layers
    .filter((l) => siblingGroupKey(l) === groupKey && !isLayerSplitBase(l))
    .sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))
  const index = siblings.findIndex((l) => l.id === id)
  if (index < 0) return layers
  const next = [...siblings]
  if (direction === 'front') {
    const [item] = next.splice(index, 1)
    if (item) next.push(item)
  } else if (direction === 'back') {
    const [item] = next.splice(index, 1)
    if (item) next.unshift(item)
  } else if (direction === 'up') {
    if (index >= next.length - 1) return layers
    ;[next[index], next[index + 1]] = [next[index + 1]!, next[index]!]
  } else if (direction === 'down') {
    if (index <= 0) return layers
    ;[next[index], next[index - 1]] = [next[index - 1]!, next[index]!]
  }
  const zSlots = siblings.map((layer) => layer.zIndex)
  const remapped = new Map(next.map((layer, i) => [layer.id, zSlots[i] ?? layer.zIndex]))
  return layers.map((layer) => {
    const z = remapped.get(layer.id)
    return z == null ? layer : { ...layer, zIndex: z }
  })
}

export function resetLayerSplitRect(layer: ImageLayerSplitLayer, canvasWidth: number, canvasHeight: number): ImageLayerSplitLayer {
  const rect = rectFromApiBoxes(
    {
      absolute: layer.originalAbsolute,
      normalized: layer.originalNormalized
    },
    canvasWidth,
    canvasHeight,
    { left: layer.left, top: layer.top, width: layer.width, height: layer.height }
  )
  if (isLayerSplitBase(layer)) {
    return {
      ...layer,
      left: 0,
      top: 0,
      width: Math.max(1, canvasWidth),
      height: Math.max(1, canvasHeight)
    }
  }
  return { ...layer, ...rect }
}

export function nudgeLayerSplit(
  layer: ImageLayerSplitLayer,
  dx: number,
  dy: number
): ImageLayerSplitLayer {
  if (isLayerSplitBase(layer)) return layer
  return {
    ...layer,
    left: layer.left + dx,
    top: layer.top + dy
  }
}

export function layerSplitGroupForSource(
  state: Pick<ImageLayerSplitState, 'groups'>,
  layerId: string
): ImageLayerSplitGroup | undefined {
  const id = layerId.trim()
  if (!id) return undefined
  return state.groups.find((group) => group.sourceLayerId === id)
}

/** 从根到该分组的祖先链（含自身） */
export function layerSplitExportGroupChain(
  state: Pick<ImageLayerSplitState, 'groups'>,
  groupId?: string
): ImageLayerSplitGroup[] {
  const chain: ImageLayerSplitGroup[] = []
  let gid = groupId?.trim() ?? ''
  const seen = new Set<string>()
  while (gid) {
    if (seen.has(gid)) break
    seen.add(gid)
    const group = state.groups.find((item) => item.id === gid)
    if (!group) break
    chain.unshift(group)
    gid = group.parentGroupId?.trim() ?? ''
  }
  return chain
}

/**
 * 导出时的相对文件夹（分组名）。
 * rootGroupId 有值时去掉该分组及祖先，便于「导出选中分组」时本组图层落在所选目录根下。
 */
export function layerSplitExportFolderSegments(
  state: Pick<ImageLayerSplitState, 'groups'>,
  groupId?: string,
  rootGroupId?: string
): string[] {
  const chain = layerSplitExportGroupChain(state, groupId)
  const root = rootGroupId?.trim() ?? ''
  const start = root ? chain.findIndex((group) => group.id === root) : -1
  const sliced = start >= 0 ? chain.slice(start + 1) : chain
  return sliced.map((group) => group.name.trim() || group.id)
}

/** 分组及其嵌套子分组里的全部图层（按叠放顺序） */
export function collectLayerSplitGroupLayers(
  state: Pick<ImageLayerSplitState, 'groups' | 'layers'>,
  groupId: string
): ImageLayerSplitLayer[] {
  const root = groupId.trim()
  if (!root) return []
  const ids = new Set<string>([root])
  let added = true
  while (added) {
    added = false
    for (const group of state.groups) {
      const parent = group.parentGroupId?.trim() ?? ''
      if (!parent || !ids.has(parent) || ids.has(group.id)) continue
      ids.add(group.id)
      added = true
    }
  }
  return sortLayersForCompose(state.layers.filter((layer) => ids.has(layer.groupId ?? '')))
}

export function isLayerSplitLayerDrawable(
  state: Pick<ImageLayerSplitState, 'groups'>,
  layer: Pick<ImageLayerSplitLayer, 'visible' | 'groupId'>
): boolean {
  if (!layer.visible) return false
  let gid = layer.groupId?.trim() ?? ''
  const seen = new Set<string>()
  while (gid) {
    if (seen.has(gid)) break
    seen.add(gid)
    const group = state.groups.find((item) => item.id === gid)
    if (!group || group.visible === false) return false
    gid = group.parentGroupId?.trim() ?? ''
  }
  return true
}

export type LayerSplitListRow =
  | { kind: 'group'; id: string; group: ImageLayerSplitGroup; depth: number }
  | { kind: 'layer'; id: string; layer: ImageLayerSplitLayer; depth: number }

function groupSortZ(state: ImageLayerSplitState, group: ImageLayerSplitGroup): number {
  const members = state.layers.filter((layer) => layer.groupId === group.id)
  const childGroups = state.groups.filter((item) => item.parentGroupId === group.id)
  const zs = [
    ...members.map((layer) => layer.zIndex),
    ...childGroups.map((child) => groupSortZ(state, child)),
    state.layers.find((layer) => layer.id === group.sourceLayerId)?.zIndex ?? 0
  ]
  return zs.reduce((max, n) => Math.max(max, n), 0)
}

function collectLayerSplitList(
  state: ImageLayerSplitState,
  parentGroupId: string,
  depth: number
): LayerSplitListRow[] {
  type Unit = { sortZ: number; id: string; rows: LayerSplitListRow[] }
  const units: Unit[] = []
  for (const group of state.groups) {
    if ((group.parentGroupId ?? '') !== parentGroupId) continue
    const rows: LayerSplitListRow[] = [
      { kind: 'group', id: group.id, group, depth }
    ]
    if (!group.collapsed) {
      rows.push(...collectLayerSplitList(state, group.id, depth + 1))
    }
    units.push({ sortZ: groupSortZ(state, group), id: group.id, rows })
  }
  for (const layer of state.layers) {
    if ((layer.groupId ?? '') !== parentGroupId) continue
    units.push({
      sortZ: layer.zIndex,
      id: layer.id,
      rows: [{ kind: 'layer', id: layer.id, layer, depth }]
    })
  }
  units.sort((a, b) => b.sortZ - a.sortZ || a.id.localeCompare(b.id))
  return units.flatMap((unit) => unit.rows)
}

export function buildLayerSplitList(state: ImageLayerSplitState): LayerSplitListRow[] {
  return collectLayerSplitList(state, '', 0)
}

export function toggleLayerSplitGroupCollapsed(
  groups: ImageLayerSplitGroup[],
  groupId: string
): ImageLayerSplitGroup[] {
  return groups.map((group) =>
    group.id === groupId ? { ...group, collapsed: !group.collapsed } : group
  )
}

export function toggleLayerSplitGroupVisible(
  groups: ImageLayerSplitGroup[],
  groupId: string
): ImageLayerSplitGroup[] {
  return groups.map((group) =>
    group.id === groupId ? { ...group, visible: group.visible === false } : group
  )
}

export interface LayerSplitApiLayerInput {
  url?: string
  zIndex?: number
  size?: string
  name?: string
  description?: string
  boundingBox?: { absolute?: unknown; normalized?: unknown }
}

export interface LayerSplitMappedItem {
  id: string
  title: string
  url: string
}

/** 把 layer_decomposition 的 data[] 映射成画布图层（坐标仍是该次输入图的局部坐标） */
export function mapDecompositionToLayers(input: {
  idPrefix: string
  apiLayers?: LayerSplitApiLayerInput[]
  images?: string[]
  canvasHint: { width: number; height: number }
  asCanvasBase: boolean
}): {
  layers: ImageLayerSplitLayer[]
  items: LayerSplitMappedItem[]
  canvasWidth: number
  canvasHeight: number
} {
  const apiLayers: LayerSplitApiLayerInput[] = input.apiLayers?.length
    ? input.apiLayers
    : (input.images ?? []).map((url, index) => ({
        url,
        zIndex: index,
        name: index === 0 ? 'Base' : `Layer ${index}`
      }))
  let canvasWidth = input.canvasHint.width
  let canvasHeight = input.canvasHint.height
  const base = apiLayers.find((row) => (Number(row.zIndex) || 0) <= 0) ?? apiLayers[0]
  const parsedSize = parseImageSizeField(base?.size)
  if (parsedSize) {
    canvasWidth = parsedSize.width
    canvasHeight = parsedSize.height
  }

  const layers: ImageLayerSplitLayer[] = []
  const items: LayerSplitMappedItem[] = []
  const seenIds = new Set<string>()
  for (const [index, row] of apiLayers.entries()) {
    const url = row.url?.trim()
    if (!url) continue
    const zIndex = Number.isFinite(Number(row.zIndex)) ? Math.round(Number(row.zIndex)) : index
    let id = `${input.idPrefix}:z${zIndex}`
    if (seenIds.has(id)) id = `${id}:${index}`
    seenIds.add(id)
    const isCanvasBase = input.asCanvasBase && zIndex <= 0
    const rect = isCanvasBase
      ? { left: 0, top: 0, width: canvasWidth, height: canvasHeight }
      : rectFromApiBoxes(row.boundingBox, canvasWidth, canvasHeight)
    const name = row.name?.trim() || (zIndex <= 0 ? 'Base' : `Layer ${zIndex}`)
    const originalAbsolute = tuple4(row.boundingBox?.absolute)
    const originalNormalized = tuple4(row.boundingBox?.normalized)
    layers.push({
      id,
      imageId: id,
      zIndex,
      name,
      description: row.description?.trim() || '',
      visible: true,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      role: isCanvasBase ? 'canvas-base' : 'layer',
      ...(originalAbsolute ? { originalAbsolute } : {}),
      ...(originalNormalized ? { originalNormalized } : {})
    })
    items.push({ id, title: name, url })
  }
  return { layers, items, canvasWidth, canvasHeight }
}

function rectToAbsolute(
  rect: ImageLayerSplitRect
): [number, number, number, number] {
  return [rect.left, rect.top, rect.left + rect.width, rect.top + rect.height]
}

/** 把子图局部坐标映射到父层在整张底图上的矩形 */
export function placeLayersInParentRect(
  parent: ImageLayerSplitLayer,
  localLayers: ImageLayerSplitLayer[],
  localCanvas: { width: number; height: number }
): ImageLayerSplitLayer[] {
  const scaleX = parent.width / Math.max(1, localCanvas.width)
  const scaleY = parent.height / Math.max(1, localCanvas.height)
  return localLayers.map((layer) => {
    const isLocalBase = layer.zIndex <= 0
    const rect: ImageLayerSplitRect = isLocalBase
      ? {
          left: parent.left,
          top: parent.top,
          width: parent.width,
          height: parent.height
        }
      : {
          left: parent.left + Math.round(layer.left * scaleX),
          top: parent.top + Math.round(layer.top * scaleY),
          width: Math.max(1, Math.round(layer.width * scaleX)),
          height: Math.max(1, Math.round(layer.height * scaleY))
        }
    return {
      ...layer,
      role: 'layer' as const,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      originalAbsolute: rectToAbsolute(rect)
    }
  })
}

export function nestLayerSplitResult(input: {
  state: ImageLayerSplitState
  parentId: string
  nestedLayers: ImageLayerSplitLayer[]
  groupName: string
  stamp?: number
}): ImageLayerSplitState {
  const state = normalizeImageLayerSplit(input.state)
  const parent = state.layers.find((layer) => layer.id === input.parentId)
  if (!parent || !input.nestedLayers.length) return state
  const stamp = input.stamp ?? Date.now()
  const groupId = `group:${parent.id}:${stamp}`
  const group: ImageLayerSplitGroup = {
    id: groupId,
    name: input.groupName.trim() || parent.name || groupId,
    collapsed: false,
    visible: true,
    sourceLayerId: parent.id,
    ...(parent.groupId ? { parentGroupId: parent.groupId } : {})
  }
  const parentZ = parent.zIndex
  const orderedNested = sortLayersForCompose(input.nestedLayers)
  const n = orderedNested.length
  const shifted = state.layers.map((layer) => {
    if (layer.id === parent.id) {
      return { ...layer, visible: false, groupId }
    }
    if (layer.zIndex > parentZ) {
      return { ...layer, zIndex: layer.zIndex + n }
    }
    return layer
  })
  const nested = orderedNested.map((layer, index) => ({
    ...layer,
    groupId,
    zIndex: parentZ + 1 + index
  }))
  const selectedId =
    nested.find((layer) => layer.zIndex > parentZ + 1)?.id || nested[0]?.id || parent.id
  return normalizeImageLayerSplit({
    ...state,
    selectedId,
    layers: [...shifted, ...nested],
    groups: [...state.groups, group]
  })
}
