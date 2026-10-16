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

/**
 * UI 图层分离引擎模式：
 * - 'auto': 智能自动（若所选模型原生返回多图层则优先使用；否则用所选图片模型重绘纯净底板 + 像素差分反混合抠出所有 UI 控件图层；无模型时回退本地智能拆层）
 * - 'ai-inpaint-slice': 通用图片模型底板重绘 + 像素级差分软抠层（支持所有图片模型，100% 保持原图控件位置与像素锐度）
 * - 'ai-layers': 原生多图层 API 拆解（Seedream 5.0 Pro layer_decomposition）
 * - 'local-slice': 本地零 API 智能 UI 连通域切层（毫秒级直出纯净底图 + 透明 UI 控件图层）
 */
export const UI_LAYER_SPLIT_MODES = [
  'auto',
  'ai-inpaint-slice',
  'ai-layers',
  'local-slice'
] as const

export type UiLayerSplitMode = (typeof UI_LAYER_SPLIT_MODES)[number]

export function normalizeLayerSplitMode(value: unknown): UiLayerSplitMode {
  const raw = String(value ?? '').trim()
  if (
    raw === 'auto' ||
    raw === 'ai-inpaint-slice' ||
    raw === 'ai-layers' ||
    raw === 'local-slice'
  ) {
    return raw
  }
  return 'auto'
}

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
  /** 拆层引擎模式（缺省 'auto'） */
  splitMode?: UiLayerSplitMode
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
  splitMode?: UiLayerSplitMode
  generateModel: string
  generateProviderInstanceId: string
  imageLayerSplit: ImageLayerSplitState
}

export const DEFAULT_IMAGE_LAYER_SPLIT: ImageLayerSplitState = {
  prompt: '',
  resolution: '2K',
  splitMode: 'auto',
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

export function parseImageSizeField(
  size: string | undefined
): { width: number; height: number } | null {
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
  return (
    fallback ?? {
      left: 0,
      top: 0,
      width: Math.max(1, canvasWidth),
      height: Math.max(1, canvasHeight)
    }
  )
}

export function layerSplitFingerprint(
  sourceUrl: string,
  prompt: string,
  resolution: string,
  extra?: {
    splitMode?: string
    model?: string
    providerInstanceId?: string
  }
): string {
  const src = sourceUrl.trim()
  const head = src.slice(0, 64)
  const tail = src.length > 80 ? src.slice(-24) : ''
  const base = `${src.length}:${head}:${tail}|${prompt.trim()}|${normalizeLayerSplitResolution(resolution)}`
  if (!extra) return base
  const mode = normalizeLayerSplitMode(extra.splitMode)
  const modelKey = `${extra.providerInstanceId?.trim() ?? ''}:${extra.model?.trim() ?? ''}`
  if (mode === 'auto' && modelKey === ':') return base
  return `${base}|${mode}|${modelKey}`
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
  const imageId = typeof row.imageId === 'string' && row.imageId.trim() ? row.imageId.trim() : id
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
    splitMode: normalizeLayerSplitMode(base.splitMode),
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

export function sortLayersForCompose(layers: ImageLayerSplitLayer[]): ImageLayerSplitLayer[] {
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

export function resetLayerSplitRect(
  layer: ImageLayerSplitLayer,
  canvasWidth: number,
  canvasHeight: number
): ImageLayerSplitLayer {
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
    const rows: LayerSplitListRow[] = [{ kind: 'group', id: group.id, group, depth }]
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

export type LayerSplitTreeNode =
  | { kind: 'group'; group: ImageLayerSplitGroup; children: LayerSplitTreeNode[] }
  | { kind: 'layer'; layer: ImageLayerSplitLayer }

/**
 * 分组树：组为枝、图层为叶，同级按 z 从高到低（顶 → 底）排列，顺序与 buildLayerSplitList 一致。
 * 与列表版的区别是保留嵌套结构、且不受 collapsed 影响（折叠只是 UI 状态，导出始终展开完整层级），
 * 供 PSD 等需要还原图层分组的导出使用。
 */
function collectLayerSplitTree(
  state: ImageLayerSplitState,
  parentGroupId: string
): LayerSplitTreeNode[] {
  type Unit = { sortZ: number; id: string; node: LayerSplitTreeNode }
  const units: Unit[] = []
  for (const group of state.groups) {
    if ((group.parentGroupId ?? '') !== parentGroupId) continue
    units.push({
      sortZ: groupSortZ(state, group),
      id: group.id,
      node: { kind: 'group', group, children: collectLayerSplitTree(state, group.id) }
    })
  }
  for (const layer of state.layers) {
    if ((layer.groupId ?? '') !== parentGroupId) continue
    units.push({ sortZ: layer.zIndex, id: layer.id, node: { kind: 'layer', layer } })
  }
  units.sort((a, b) => b.sortZ - a.sortZ || a.id.localeCompare(b.id))
  return units.map((unit) => unit.node)
}

export function buildLayerSplitTree(state: ImageLayerSplitState): LayerSplitTreeNode[] {
  return collectLayerSplitTree(state, '')
}

/**
 * 把分组树摊平成 ag-psd `children` 的顺序（底 → 顶）。
 *
 * buildLayerSplitTree 同级是「顶 → 底」（高 z 在前，与图层面板一致），
 * 而 ag-psd 的 children[0] 是最底层、末尾才是最顶层，两者相反，所以每一层都要反转，
 * 嵌套分组由递归各自反转。空分组（无任何可绘制叶子）会被跳过。
 * 叶子/分组节点的构造交给回调，避免让 @shared 反向依赖 ag-psd 类型。
 */
export function orderLayerSplitTreeForPsd<T>(
  nodes: LayerSplitTreeNode[],
  build: {
    layer: (layer: ImageLayerSplitLayer) => T | null
    group: (group: ImageLayerSplitGroup, children: T[]) => T
  }
): T[] {
  const out: T[] = []
  for (const node of nodes) {
    if (node.kind === 'layer') {
      const leaf = build.layer(node.layer)
      if (leaf != null) out.push(leaf)
      continue
    }
    const children = orderLayerSplitTreeForPsd(node.children, build)
    if (!children.length) continue // 跳过没有任何可绘制内容的空分组
    out.push(build.group(node.group, children))
  }
  return out.reverse()
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

function rectToAbsolute(rect: ImageLayerSplitRect): [number, number, number, number] {
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

export type UiLayerSplitPresetId =
  'ui-standard' | 'ui-hud' | 'ui-popup' | 'ui-inventory' | 'ui-card'

export interface UiLayerSplitPreset {
  id: UiLayerSplitPresetId
  promptZh: string
  promptEn: string
}

export const DEFAULT_UI_LAYER_SPLIT_PROMPT_ZH =
  '将游戏 UI 界面分层拆解为：底层背景与主面板底框、装饰边框与顶栏横幅、次级内容容器与槽位格子、独立交互按钮与关闭按钮、顶部图标徽章与货币角标，所有组件层需保持边缘干净与透明背景' // cjk-ok 游戏 UI 拆层默认指令

export const DEFAULT_UI_LAYER_SPLIT_PROMPT_EN =
  'Decompose this game UI screen into clean transparent layers: base background & main panel frame, decorative header banner & corner ornaments, content container cards & item slots, interactive CTA buttons & close button, and top icons, badges & currency widgets.'

export const UI_LAYER_SPLIT_PRESETS: readonly UiLayerSplitPreset[] = [
  {
    id: 'ui-standard',
    promptZh: DEFAULT_UI_LAYER_SPLIT_PROMPT_ZH,
    promptEn: DEFAULT_UI_LAYER_SPLIT_PROMPT_EN
  },
  {
    id: 'ui-hud',
    promptZh:
      '拆解游戏战斗 HUD 界面图层：底层场景背景、左上角色头像框与血条/蓝条槽、右上小地图与资源货币栏、右下技能轮盘与普攻按钮、顶部首领血条与状态图标', // cjk-ok 游戏 HUD 拆层预设
    promptEn:
      'Decompose game battle HUD layers: underlying scene backdrop, top-left avatar frame with HP/MP bars, top-right minimap & currency bar, bottom-right skill wheel & attack buttons, top boss HP bar & buff icons.'
  },
  {
    id: 'ui-popup',
    promptZh:
      '拆解游戏弹窗对话框图层：半透明遮罩与弹窗主底板、顶部标题横幅丝带与角花装饰、中部奖励槽位与内嵌子面板、底部确认/取消主次按钮与右上关闭按钮', // cjk-ok 游戏弹窗拆层预设
    promptEn:
      'Decompose game modal popup layers: modal main frame & backdrop, top ribbon title banner & corner ornaments, center reward slots & inset sub-panel, bottom confirm/cancel buttons & top-right close button.'
  },
  {
    id: 'ui-inventory',
    promptZh:
      '拆解背包与养成界面图层：全屏底板与立绘展示台、左侧页签导航栏、右侧网格物品槽位矩阵與滚动容器、底部强化/穿戴操作按钮与顶部资源栏', // cjk-ok 游戏背包养成拆层预设
    promptEn:
      'Decompose RPG inventory & progression UI layers: fullscreen background & character stage, left tab navigation bar, right item grid slots & scroll panel, bottom upgrade/equip action buttons & top resource bar.'
  },
  {
    id: 'ui-card',
    promptZh:
      '拆解抽卡与商店界面图层：史诗舞台背景、核心卡池横幅与角色立绘展示框、稀有度徽章与价格标签、底部单抽/十连抽高亮按钮与顶部代币栏', // cjk-ok 游戏抽卡商店拆层预设
    promptEn:
      'Decompose gacha & shop UI layers: epic stage background, main banner & featured character frame, rarity badges & price tags, bottom single/10x pull CTA buttons & top currency bar.'
  }
]

/**
 * 解析图层分离实际送入大模型的拆层提示词：
 * - 若用户填写了自定义提示词，优先使用用户提示词
 * - 若为空，则回退到专业游戏 UI 组件拆层指令（如上游带有界面标题则拼入上下文）
 */
export function resolveEffectiveLayerSplitPrompt(
  userPrompt: string | undefined,
  options?: { locale?: string; sourceTitle?: string }
): string {
  const trimmed = typeof userPrompt === 'string' ? userPrompt.trim() : ''
  if (trimmed) return trimmed
  const isEn = typeof options?.locale === 'string' && /^en\b/i.test(options.locale.trim())
  const base = isEn ? DEFAULT_UI_LAYER_SPLIT_PROMPT_EN : DEFAULT_UI_LAYER_SPLIT_PROMPT_ZH
  const cleanTitle = (options?.sourceTitle ?? '')
    .replace(/^(?:图片|底图|Image|Clean plate)\s*[·•:\-—]\s*/i, '') // cjk-ok 清理上游端口前缀
    .trim()
  if (!cleanTitle || /^image\s*\d*$/i.test(cleanTitle)) return base
  return isEn ? `${base} (UI Screen: ${cleanTitle})` : `${base}（目标界面：${cleanTitle}）` // cjk-ok 拼接界面名
}

/**
 * 重命名图层或分组（同步导出 PSD / 切片目录时的名称）。
 */
export function renameLayerSplitItem(
  state: ImageLayerSplitState,
  itemId: string,
  nextName: string
): ImageLayerSplitState {
  const cleanName = nextName.trim()
  if (!cleanName) return state
  const normalized = normalizeImageLayerSplit(state)
  const groupHit = normalized.groups.some((group) => group.id === itemId)
  if (groupHit) {
    return {
      ...normalized,
      groups: normalized.groups.map((group) =>
        group.id === itemId ? { ...group, name: cleanName } : group
      )
    }
  }
  return {
    ...normalized,
    layers: normalized.layers.map((layer) =>
      layer.id === itemId ? { ...layer, name: cleanName } : layer
    )
  }
}

type GameUiAutoGroupBucket = 'header' | 'controls' | 'panels'

function classifyGameUiLayerBucket(
  layer: ImageLayerSplitLayer,
  canvasWidth: number,
  canvasHeight: number
): GameUiAutoGroupBucket {
  const text = `${layer.name} ${layer.description ?? ''}`.toLowerCase()
  const areaRatio =
    (Math.max(1, layer.width) * Math.max(1, layer.height)) / Math.max(1, canvasWidth * canvasHeight)
  const centerYRatio = (layer.top + layer.height / 2) / Math.max(1, canvasHeight)

  const controlRe =
    /button|btn|cta|close|tab|switch|slider|toggle|icon|badge|coin|gem|token|reward|slot|item|skill|avatar|按钮|开关|图标|徽章|角标|货币|金币|宝石|钻石|技能|道具|头像|关闭|确认|取消|返回/ // cjk-ok
  if (controlRe.test(text)) {
    return 'controls'
  }
  const headerRe =
    /title|header|banner|ribbon|ornament|crest|crown|top bar|status bar|nav|标题|顶栏|横幅|丝带|角花|装饰|状态栏|导航|顶部/ // cjk-ok
  if (headerRe.test(text)) {
    return 'header'
  }
  const panelRe =
    /panel|frame|board|card|modal|dialog|window|container|grid|background|backdrop|面板|底板|底框|边框|容器|弹窗|对话框|卡片|网格|背景/ // cjk-ok
  if (panelRe.test(text)) {
    return 'panels'
  }

  if (areaRatio >= 0.16) return 'panels'
  if (centerYRatio <= 0.22 && layer.height <= canvasHeight * 0.25) return 'header'
  return 'controls'
}

/**
 * 一键按游戏 UI 工程规范将顶层前景图层归类到标准 PSD 文件夹：
 * - `01_顶栏与装饰`（高 zIndex）
 * - `02_交互控件与按钮`（中 zIndex）
 * - `03_面板与容器底框`（低 zIndex，位于底图之上）
 * 已处于子拆层分组内的图层保持原分组不变。
 */
export function autoGroupLayersForGameUi(
  inputState: ImageLayerSplitState,
  locale?: string
): ImageLayerSplitState {
  const state = normalizeImageLayerSplit(inputState)
  const baseLayer = state.layers.find((layer) => isLayerSplitBase(layer)) ?? state.layers[0]
  if (!baseLayer) return state

  const isEn = typeof locale === 'string' && /^en\b/i.test(locale.trim())
  const autoGroupSpecs: readonly {
    bucket: GameUiAutoGroupBucket
    id: string
    name: string
  }[] = [
    {
      bucket: 'panels',
      id: 'group:ui-auto:panels',
      name: isEn ? '03_Panels_Containers' : '03_面板与容器底框' // cjk-ok PSD 面板分组名
    },
    {
      bucket: 'controls',
      id: 'group:ui-auto:controls',
      name: isEn ? '02_Interactive_Controls' : '02_交互控件与按钮' // cjk-ok PSD 控件分组名
    },
    {
      bucket: 'header',
      id: 'group:ui-auto:header',
      name: isEn ? '01_Header_Ornaments' : '01_顶栏与装饰' // cjk-ok PSD 顶栏分组名
    }
  ]
  const autoGroupIds = new Set(autoGroupSpecs.map((spec) => spec.id))

  // 保留非自动分组（如对单层执行「再次拆层」产生的嵌套分组）
  const preservedGroups = state.groups.filter((group) => !autoGroupIds.has(group.id))
  const preservedGroupIds = new Set(preservedGroups.map((group) => group.id))

  const bucketLayers = new Map<GameUiAutoGroupBucket, ImageLayerSplitLayer[]>([
    ['panels', []],
    ['controls', []],
    ['header', []]
  ])
  const customGroupedLayers: ImageLayerSplitLayer[] = []

  const ordered = sortLayersForCompose(state.layers)
  for (const layer of ordered) {
    if (isLayerSplitBase(layer)) continue
    if (layer.groupId && preservedGroupIds.has(layer.groupId)) {
      customGroupedLayers.push(layer)
      continue
    }
    const bucket = classifyGameUiLayerBucket(layer, state.canvasWidth, state.canvasHeight)
    const spec = autoGroupSpecs.find((item) => item.bucket === bucket)!
    bucketLayers.get(bucket)!.push({
      ...layer,
      groupId: spec.id
    })
  }

  let nextZ = 1
  const reindexedForeground: ImageLayerSplitLayer[] = []
  const createdAutoGroups: ImageLayerSplitGroup[] = []

  for (const spec of autoGroupSpecs) {
    const list = bucketLayers.get(spec.bucket) ?? []
    if (!list.length) continue
    createdAutoGroups.push({
      id: spec.id,
      name: spec.name,
      collapsed: false,
      visible: true,
      sourceLayerId: baseLayer.id
    })
    for (const layer of list) {
      reindexedForeground.push({
        ...layer,
        zIndex: nextZ++
      })
    }
  }

  for (const layer of customGroupedLayers) {
    reindexedForeground.push({
      ...layer,
      zIndex: nextZ++
    })
  }

  return normalizeImageLayerSplit({
    ...state,
    layers: [{ ...baseLayer, zIndex: 0, role: 'canvas-base' }, ...reindexedForeground],
    groups: [...preservedGroups, ...createdAutoGroups]
  })
}

export interface UiLayerManifestNineSliceHint {
  recommended: boolean
  /** 建议九宫格边距 [top, right, bottom, left]（像素） */
  bordersPx: [number, number, number, number]
}

export interface UiLayerManifestItem {
  id: string
  name: string
  description: string
  role: 'base' | 'layer'
  zIndex: number
  visible: boolean
  groupPath: string[]
  rect: {
    left: number
    top: number
    width: number
    height: number
  }
  normalizedRect: {
    x: number
    y: number
    w: number
    h: number
  }
  anchor:
    | 'fullscreen'
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'center-left'
    | 'center'
    | 'center-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right'
  nineSliceHint: UiLayerManifestNineSliceHint
}

export interface UiLayerLayoutManifest {
  schemaVersion: '1.0'
  canvas: {
    width: number
    height: number
  }
  groups: {
    id: string
    name: string
    parentGroupId?: string
    visible: boolean
  }[]
  layers: UiLayerManifestItem[]
}

function inferLayerAnchor(
  layer: ImageLayerSplitLayer,
  canvasWidth: number,
  canvasHeight: number
): UiLayerManifestItem['anchor'] {
  if (
    isLayerSplitBase(layer) ||
    (layer.width >= canvasWidth * 0.92 && layer.height >= canvasHeight * 0.92)
  ) {
    return 'fullscreen'
  }
  const cx = (layer.left + layer.width / 2) / Math.max(1, canvasWidth)
  const cy = (layer.top + layer.height / 2) / Math.max(1, canvasHeight)
  const h = cx < 0.34 ? 'left' : cx > 0.66 ? 'right' : 'center'
  const v = cy < 0.28 ? 'top' : cy > 0.72 ? 'bottom' : 'center'
  if (v === 'center' && h === 'center') return 'center'
  if (v === 'center') return h === 'left' ? 'center-left' : 'center-right'
  return `${v}-${h}` as UiLayerManifestItem['anchor']
}

function inferNineSliceHint(
  layer: ImageLayerSplitLayer,
  canvasWidth: number,
  canvasHeight: number
): UiLayerManifestNineSliceHint {
  if (isLayerSplitBase(layer)) {
    return { recommended: false, bordersPx: [0, 0, 0, 0] }
  }
  const bucket = classifyGameUiLayerBucket(layer, canvasWidth, canvasHeight)
  const text = `${layer.name} ${layer.description ?? ''}`.toLowerCase()
  const nineSliceRe =
    /button|btn|bar|panel|frame|card|dialog|modal|banner|slot|按钮|面板|底框|边框|弹窗|横幅|槽位/ // cjk-ok
  const isScalableWidget = bucket === 'panels' || nineSliceRe.test(text)
  if (!isScalableWidget || layer.width < 48 || layer.height < 36) {
    return { recommended: false, bordersPx: [0, 0, 0, 0] }
  }
  const borderX = Math.max(8, Math.min(64, Math.round(layer.width * 0.22)))
  const borderY = Math.max(8, Math.min(64, Math.round(layer.height * 0.22)))
  return {
    recommended: true,
    bordersPx: [borderY, borderX, borderY, borderX]
  }
}

/**
 * 生成可导入 Unity / Unreal / FairyGUI / Cocos 的 UI 布局与图层坐标清单（JSON 结构）。
 */
export function buildLayerSplitUiManifest(inputState: ImageLayerSplitState): UiLayerLayoutManifest {
  const state = normalizeImageLayerSplit(inputState)
  const cw = Math.max(1, state.canvasWidth || 1)
  const ch = Math.max(1, state.canvasHeight || 1)
  const ordered = sortLayersForCompose(state.layers)

  return {
    schemaVersion: '1.0',
    canvas: {
      width: cw,
      height: ch
    },
    groups: state.groups.map((group) => ({
      id: group.id,
      name: group.name,
      ...(group.parentGroupId ? { parentGroupId: group.parentGroupId } : {}),
      visible: group.visible
    })),
    layers: ordered.map((layer) => ({
      id: layer.id,
      name: layer.name,
      description: layer.description ?? '',
      role: isLayerSplitBase(layer) ? 'base' : 'layer',
      zIndex: layer.zIndex,
      visible: isLayerSplitLayerDrawable(state, layer),
      groupPath: layerSplitExportFolderSegments(state, layer.groupId),
      rect: {
        left: layer.left,
        top: layer.top,
        width: layer.width,
        height: layer.height
      },
      normalizedRect: {
        x: Number((layer.left / cw).toFixed(4)),
        y: Number((layer.top / ch).toFixed(4)),
        w: Number((layer.width / cw).toFixed(4)),
        h: Number((layer.height / ch).toFixed(4))
      },
      anchor: inferLayerAnchor(layer, cw, ch),
      nineSliceHint: inferNineSliceHint(layer, cw, ch)
    }))
  }
}

/**
 * 为通用图片模型（Gemini / GPT-Image-1 / Seedream 4.5 / Flux 等）构建「擦除前景悬浮 UI 控件、生成纯净背景底板」提示词。
 */
export function buildUiCleanBaseInpaintPrompt(
  userPrompt?: string,
  options?: { locale?: string; sourceTitle?: string }
): string {
  const isZh = (options?.locale ?? 'zh-CN').toLowerCase().startsWith('zh')
  const titleHint = options?.sourceTitle?.trim()
    ? options.sourceTitle
        .trim()
        .replace(/^(?:图片|底图|Image|Base)\s*[·:：-]\s*/i, '') // cjk-ok 剥离通用前缀
        .trim()
    : ''
  const custom = userPrompt?.trim() || ''
  if (isZh) {
    const scope = titleHint ? `（界面：${titleHint}）` : '' // cjk-ok 界面上下文
    const extra = custom ? `重点擦除并分离这些前景控件：${custom}。` : '' // cjk-ok 用户补充拆层指令
    return `保持这张游戏 UI 画面${scope}的整体背景底图、环境光影与外层主画框完全不变，将画面上所有悬浮的前景 UI 交互按钮、图标徽章、货币资源胶囊、道具槽位、关闭按钮与浮动小控件干净擦除并无缝修补背景纹理，输出一张纯净无悬浮控件的 UI 背景底板图（严禁绘制任何文字或新增元素）。${extra}` // cjk-ok 通用生图模型底板重绘提示词
  }
  const scope = titleHint ? ` (${titleHint})` : ''
  const extra = custom
    ? ` Focus on removing and isolating these foreground widgets: ${custom}.`
    : ''
  return `Keep the overall background scene, lighting, and outer main frame of this game UI screen${scope} unchanged, and cleanly remove and inpaint over all floating foreground interactive UI buttons, icon badges, currency pills, item slots, close buttons, and overlay widgets to produce a clean background base plate with no text or added elements.${extra}`
}

/**
 * 判断指定的图片模型是否原生支持 API 级 `layer_decomposition`（如火山方舟 Seedream 5.0 Pro 或自定义 ep- 接入点）。
 * 当模型未指定（空字符串）时返回 true，以保持默认 Seedream 5.0 Pro 行为；
 * 当明确指定了 Gemini / GPT-Image / Flux / Qwen / Seedream 4.x 等常规图片模型时返回 false。
 */
export function isNativeLayerDecompositionModel(model?: string): boolean {
  const m = model?.trim().toLowerCase() ?? ''
  if (!m) return true
  if (m.includes('seedream-5') || m.includes('seedream5') || m.startsWith('ep-')) {
    return true
  }
  return false
}

/**
 * 根据用户选择的拆层模式 (`splitMode`) 与当前选中的生图模型 (`model`)，
 * 决定实际执行的拆层引擎策略：
 * - `'ai-layers'`: 调用模型原生 `layer_decomposition` API
 * - `'ai-inpaint-slice'`: 调用任意生图模型擦除前景生成干净底板 + 智能连通域软抠图切分
 * - `'local-slice'`: 零 API 极速本地连通域切分 + 边界纹理修补底板
 */
export function resolveEffectiveUiLayerSplitStrategy(
  splitMode?: UiLayerSplitMode,
  model?: string
): 'ai-layers' | 'ai-inpaint-slice' | 'local-slice' {
  const mode = normalizeLayerSplitMode(splitMode)
  if (mode === 'local-slice') return 'local-slice'
  if (mode === 'ai-inpaint-slice') return 'ai-inpaint-slice'
  if (mode === 'ai-layers') return 'ai-layers'
  return isNativeLayerDecompositionModel(model) ? 'ai-layers' : 'ai-inpaint-slice'
}

export interface ExtractedUiLayerBuffer {
  id: string
  name: string
  description: string
  zIndex: number
  left: number
  top: number
  width: number
  height: number
  rgba: Uint8ClampedArray
}

export interface DecomposedRgbaUiLayersResult {
  canvasWidth: number
  canvasHeight: number
  baseRgba: Uint8ClampedArray
  layers: ExtractedUiLayerBuffer[]
}

interface GridBox {
  gx0: number
  gy0: number
  gx1: number
  gy1: number
  score: number
}

function inferExtractedUiWidgetName(
  rect: ImageLayerSplitRect,
  canvasWidth: number,
  canvasHeight: number,
  index: number,
  locale = 'zh-CN'
): { name: string; description: string } {
  const isZh = locale.toLowerCase().startsWith('zh')
  const cw = Math.max(1, canvasWidth)
  const ch = Math.max(1, canvasHeight)
  const areaRatio = (rect.width * rect.height) / (cw * ch)
  const cy = (rect.top + rect.height / 2) / ch
  const aspect = rect.width / Math.max(1, rect.height)

  if (areaRatio >= 0.14) {
    return isZh
      ? { name: `主面板底框_${index}`, description: 'UI 面板容器与背景底框' } // cjk-ok 自动命名的游戏 UI 图层
      : { name: `Main_Panel_Frame_${index}`, description: 'UI panel container frame' }
  }
  if (cy <= 0.18 && aspect >= 2.2) {
    return isZh
      ? { name: `顶栏横幅条_${index}`, description: '顶部资源状态栏与标题横幅' } // cjk-ok 自动命名的游戏 UI 图层
      : { name: `Top_Header_Bar_${index}`, description: 'Top status and currency header bar' }
  }
  if (cy <= 0.22 && aspect < 2.2) {
    return isZh
      ? { name: `顶部装饰徽章_${index}`, description: '顶栏图标、角标或关闭按钮' } // cjk-ok 自动命名的游戏 UI 图层
      : { name: `Top_Ornament_Badge_${index}`, description: 'Top ornament badge or close button' }
  }
  if (aspect >= 1.75 && rect.height <= ch * 0.18) {
    return isZh
      ? { name: `交互按钮_${index}`, description: '可点击 CTA 交互按钮控件' } // cjk-ok 自动命名的游戏 UI 图层
      : { name: `Action_Button_${index}`, description: 'Interactive CTA button widget' }
  }
  if (areaRatio >= 0.025) {
    return isZh
      ? { name: `道具卡片槽_${index}`, description: '列表卡片或道具格子容器' } // cjk-ok 自动命名的游戏 UI 图层
      : { name: `Item_Slot_Card_${index}`, description: 'Item slot or content card container' }
  }
  return isZh
    ? { name: `UI控件图标_${index}`, description: '独立 UI 图标与装饰组件' } // cjk-ok 自动命名的游戏 UI 图层
    : { name: `UI_Widget_Icon_${index}`, description: 'Standalone UI icon or widget' }
}

/**
 * 像素级游戏 UI 图层分解引擎（纯 RGBA 缓冲区算法，兼容任意生图模型差分重绘底板与零 API 本地智能拆层）：
 * 1. 若提供 `cleanBaseRgba`（由任意图片模型擦除前景控件后生成），按感知色差 + 边缘能量提取前景控件显著图；
 * 2. 若未提供 `cleanBaseRgba`（本地零 API 拆层），自动建模多尺度背景底色并结合 Sobel 边缘梯度定位独立 UI 控件岛；
 * 3. 经形态学闭运算 + 连通域聚类 + 邻近框合并，提取每个 UI 控件的精确像素包围盒；
 * 4. 若无外部底板，自动用边界双线性纹理内插修补底图上的控件区域，生成干净无重影的 `baseRgba`；
 * 5. 对每个前景控件执行色彩反混合软抠图（Color-Unmixing Alpha Matting），消除锯齿与背景杂边。
 */
export function decomposeRgbaBufferToUiLayers(input: {
  width: number
  height: number
  sourceRgba: Uint8Array | Uint8ClampedArray
  cleanBaseRgba?: Uint8Array | Uint8ClampedArray | null
  maxLayers?: number
  idPrefix?: string
  locale?: string
}): DecomposedRgbaUiLayersResult {
  const width = Math.max(1, Math.round(input.width))
  const height = Math.max(1, Math.round(input.height))
  const totalPixels = width * height
  const src = new Uint8ClampedArray(totalPixels * 4)
  src.set(input.sourceRgba.subarray(0, totalPixels * 4))

  const hasExternalBase =
    Boolean(input.cleanBaseRgba) && input.cleanBaseRgba!.length >= totalPixels * 4
  const baseRgba = new Uint8ClampedArray(totalPixels * 4)
  if (hasExternalBase && input.cleanBaseRgba) {
    baseRgba.set(input.cleanBaseRgba.subarray(0, totalPixels * 4))
  } else {
    baseRgba.set(src)
  }

  const maxDim = 192
  const step = Math.max(1, Math.ceil(Math.max(width, height) / maxDim))
  const gw = Math.max(1, Math.ceil(width / step))
  const gh = Math.max(1, Math.ceil(height / step))

  const gridR = new Float32Array(gw * gh)
  const gridG = new Float32Array(gw * gh)
  const gridB = new Float32Array(gw * gh)
  const gridA = new Float32Array(gw * gh)

  for (let gy = 0; gy < gh; gy++) {
    const py0 = gy * step
    const py1 = Math.min(height, py0 + step)
    for (let gx = 0; gx < gw; gx++) {
      const px0 = gx * step
      const px1 = Math.min(width, px0 + step)
      let rSum = 0
      let gSum = 0
      let bSum = 0
      let aSum = 0
      let count = 0
      for (let py = py0; py < py1; py++) {
        for (let px = px0; px < px1; px++) {
          const idx = (py * width + px) * 4
          rSum += src[idx]!
          gSum += src[idx + 1]!
          bSum += src[idx + 2]!
          aSum += src[idx + 3]!
          count++
        }
      }
      const gIdx = gy * gw + gx
      const inv = count > 0 ? 1 / count : 0
      gridR[gIdx] = rSum * inv
      gridG[gIdx] = gSum * inv
      gridB[gIdx] = bSum * inv
      gridA[gIdx] = aSum * inv
    }
  }

  // 计算每个网格单元的前景显著度与参考背景色
  const bgR = new Float32Array(gw * gh)
  const bgG = new Float32Array(gw * gh)
  const bgB = new Float32Array(gw * gh)
  const salience = new Float32Array(gw * gh)

  if (hasExternalBase) {
    for (let gy = 0; gy < gh; gy++) {
      const py0 = gy * step
      const py1 = Math.min(height, py0 + step)
      for (let gx = 0; gx < gw; gx++) {
        const px0 = gx * step
        const px1 = Math.min(width, px0 + step)
        let rSum = 0
        let gSum = 0
        let bSum = 0
        let maxDiff = 0
        let count = 0
        for (let py = py0; py < py1; py++) {
          for (let px = px0; px < px1; px++) {
            const idx = (py * width + px) * 4
            const br = baseRgba[idx]!
            const bg = baseRgba[idx + 1]!
            const bb = baseRgba[idx + 2]!
            rSum += br
            gSum += bg
            bSum += bb
            const dr = Math.abs(src[idx]! - br)
            const dg = Math.abs(src[idx + 1]! - bg)
            const db = Math.abs(src[idx + 2]! - bb)
            const d = Math.max(dr, dg, db) + 0.3 * (dr + dg + db)
            if (d > maxDiff) maxDiff = d
            count++
          }
        }
        const gIdx = gy * gw + gx
        const inv = count > 0 ? 1 / count : 0
        bgR[gIdx] = rSum * inv
        bgG[gIdx] = gSum * inv
        bgB[gIdx] = bSum * inv
        salience[gIdx] = maxDiff
      }
    }
  } else {
    // 零 API 本地模式：用外圈边框采样 + 粗网格平滑估计底层背景场
    let borderR = 0
    let borderG = 0
    let borderB = 0
    let borderCount = 0
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        if (gx === 0 || gy === 0 || gx === gw - 1 || gy === gh - 1) {
          const gIdx = gy * gw + gx
          borderR += gridR[gIdx]!
          borderG += gridG[gIdx]!
          borderB += gridB[gIdx]!
          borderCount++
        }
      }
    }
    const globalBgR = borderCount > 0 ? borderR / borderCount : 32
    const globalBgG = borderCount > 0 ? borderG / borderCount : 32
    const globalBgB = borderCount > 0 ? borderB / borderCount : 40

    const radius = Math.max(2, Math.round(Math.min(gw, gh) * 0.14))
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const gIdx = gy * gw + gx
        // 取周围大半径环形邻域均值与全局边框均值融合作为背景估计
        let ringR = 0
        let ringG = 0
        let ringB = 0
        let ringN = 0
        const sampleOffsets = [
          [-radius, 0],
          [radius, 0],
          [0, -radius],
          [0, radius],
          [-radius, -radius],
          [radius, -radius],
          [-radius, radius],
          [radius, radius]
        ] as const
        for (const [ox, oy] of sampleOffsets) {
          const sx = Math.min(gw - 1, Math.max(0, gx + ox))
          const sy = Math.min(gh - 1, Math.max(0, gy + oy))
          const sIdx = sy * gw + sx
          ringR += gridR[sIdx]!
          ringG += gridG[sIdx]!
          ringB += gridB[sIdx]!
          ringN++
        }
        const estR = ringN > 0 ? (ringR / ringN) * 0.55 + globalBgR * 0.45 : globalBgR
        const estG = ringN > 0 ? (ringG / ringN) * 0.55 + globalBgG * 0.45 : globalBgG
        const estB = ringN > 0 ? (ringB / ringN) * 0.55 + globalBgB * 0.45 : globalBgB
        bgR[gIdx] = estR
        bgG[gIdx] = estG
        bgB[gIdx] = estB

        const dr = Math.abs(gridR[gIdx]! - globalBgR)
        const dg = Math.abs(gridG[gIdx]! - globalBgG)
        const db = Math.abs(gridB[gIdx]! - globalBgB)
        const dGlobal = Math.max(dr, dg, db) + 0.3 * (dr + dg + db)

        const ldr = Math.abs(gridR[gIdx]! - estR)
        const ldg = Math.abs(gridG[gIdx]! - estG)
        const ldb = Math.abs(gridB[gIdx]! - estB)
        const dLocal = Math.max(ldr, ldg, ldb) + 0.3 * (ldr + ldg + ldb)

        salience[gIdx] = Math.max(dGlobal * 0.85, dLocal)
      }
    }
  }

  // 二值化前景掩码 + 1 轮膨胀闭运算使按钮内文字与边框连成整体
  const threshold = hasExternalBase ? 26 : 32
  const rawMask = new Uint8Array(gw * gh)
  for (let i = 0; i < gw * gh; i++) {
    if (gridA[i]! > 16 && salience[i]! >= threshold) {
      rawMask[i] = 1
    }
  }

  const closedMask = new Uint8Array(gw * gh)
  if (gw >= 6 && gh >= 6) {
    const dilated = new Uint8Array(gw * gh)
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        let hit = 0
        for (let dy = -1; dy <= 1 && !hit; dy++) {
          const ny = gy + dy
          if (ny < 0 || ny >= gh) continue
          for (let dx = -1; dx <= 1; dx++) {
            const nx = gx + dx
            if (nx < 0 || nx >= gw) continue
            if (rawMask[ny * gw + nx]) {
              hit = 1
              break
            }
          }
        }
        dilated[gy * gw + gx] = hit
      }
    }
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        if (!dilated[gy * gw + gx]) continue
        closedMask[gy * gw + gx] = 1
      }
    }
  } else {
    closedMask.set(rawMask)
  }

  // 8-连通域 BFS 搜索提取候选 UI 控件框
  const visited = new Uint8Array(gw * gh)
  const rawBoxes: GridBox[] = []
  const queue = new Int32Array(gw * gh)

  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const start = gy * gw + gx
      if (!closedMask[start] || visited[start]) continue
      let head = 0
      let tail = 0
      queue[tail++] = start
      visited[start] = 1
      let gx0 = gx
      let gy0 = gy
      let gx1 = gx
      let gy1 = gy
      let scoreSum = 0
      let cellCount = 0

      while (head < tail) {
        const cur = queue[head++]!
        const cy = Math.floor(cur / gw)
        const cx = cur - cy * gw
        if (cx < gx0) gx0 = cx
        if (cy < gy0) gy0 = cy
        if (cx > gx1) gx1 = cx
        if (cy > gy1) gy1 = cy
        scoreSum += salience[cur]!
        cellCount++

        for (let dy = -1; dy <= 1; dy++) {
          const ny = cy + dy
          if (ny < 0 || ny >= gh) continue
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = cx + dx
            if (nx < 0 || nx >= gw) continue
            const nIdx = ny * gw + nx
            if (closedMask[nIdx] && !visited[nIdx]) {
              visited[nIdx] = 1
              queue[tail++] = nIdx
            }
          }
        }
      }

      const bw = gx1 - gx0 + 1
      const bh = gy1 - gy0 + 1
      // 过滤全屏背景框与极小噪点
      if (bw >= gw * 0.94 && bh >= gh * 0.94) continue
      if (cellCount < 1) continue
      rawBoxes.push({
        gx0,
        gy0,
        gx1,
        gy1,
        score: scoreSum
      })
    }
  }

  // 合并高度重叠或紧邻的同组件碎片框（仅当合并后不超过画布 75% 时）
  const mergedBoxes = [...rawBoxes]
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < mergedBoxes.length; i++) {
      for (let j = i + 1; j < mergedBoxes.length; j++) {
        const a = mergedBoxes[i]!
        const b = mergedBoxes[j]!
        const gapX = Math.max(0, Math.max(a.gx0, b.gx0) - Math.min(a.gx1, b.gx1) - 1)
        const gapY = Math.max(0, Math.max(a.gy0, b.gy0) - Math.min(a.gy1, b.gy1) - 1)
        if (gapX <= 0 && gapY <= 0) {
          const nx0 = Math.min(a.gx0, b.gx0)
          const ny0 = Math.min(a.gy0, b.gy0)
          const nx1 = Math.max(a.gx1, b.gx1)
          const ny1 = Math.max(a.gy1, b.gy1)
          if (nx1 - nx0 + 1 <= gw * 0.82 && ny1 - ny0 + 1 <= gh * 0.82) {
            mergedBoxes[i] = {
              gx0: nx0,
              gy0: ny0,
              gx1: nx1,
              gy1: ny1,
              score: a.score + b.score
            }
            mergedBoxes.splice(j, 1)
            changed = true
            break
          }
        }
      }
      if (changed) break
    }
  }

  const maxLayers = Math.max(1, Math.min(LAYER_SPLIT_MAX_LAYERS - 1, input.maxLayers ?? 12))
  const minPxSide = Math.max(4, Math.min(12, Math.floor(Math.min(width, height) * 0.025)))

  const candidateRects: Array<ImageLayerSplitRect & { score: number }> = []
  for (const box of mergedBoxes) {
    const pad = step > 1 ? Math.min(4, step) : 0
    const left = Math.max(0, box.gx0 * step - pad)
    const top = Math.max(0, box.gy0 * step - pad)
    const right = Math.min(width, (box.gx1 + 1) * step + pad)
    const bottom = Math.min(height, (box.gy1 + 1) * step + pad)
    const rw = right - left
    const rh = bottom - top
    if (rw < minPxSide || rh < minPxSide) continue
    if (rw >= width * 0.95 && rh >= height * 0.95) continue
    candidateRects.push({ left, top, width: rw, height: rh, score: box.score })
  }

  // 若整张图极其平滑导致未检出独立连通域，按经典三段式 UI 布局（顶栏 / 中心主面板 / 底部操作栏）切分兜底
  if (!candidateRects.length && width >= 32 && height >= 32) {
    candidateRects.push(
      {
        left: Math.round(width * 0.05),
        top: Math.round(height * 0.03),
        width: Math.round(width * 0.9),
        height: Math.round(height * 0.1),
        score: 100
      },
      {
        left: Math.round(width * 0.08),
        top: Math.round(height * 0.18),
        width: Math.round(width * 0.84),
        height: Math.round(height * 0.6),
        score: 300
      },
      {
        left: Math.round(width * 0.2),
        top: Math.round(height * 0.82),
        width: Math.round(width * 0.6),
        height: Math.round(height * 0.11),
        score: 150
      }
    )
  }

  // 先按显著度挑选前 maxLayers 个组件，再按面积从大到小赋 zIndex（大面板在下、小按钮与顶栏装饰在上）
  const topRects = candidateRects
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLayers)
    .sort((a, b) => b.width * b.height - a.width * a.height)

  // 若无外部 AI 底图，在本地对 baseRgba 执行边界色彩双线性修补（Inpainting），消除移动图层时的底图重影
  if (!hasExternalBase) {
    for (const rect of topRects) {
      const x0 = Math.max(0, rect.left)
      const y0 = Math.max(0, rect.top)
      const x1 = Math.min(width - 1, rect.left + rect.width - 1)
      const y1 = Math.min(height - 1, rect.top + rect.height - 1)
      const leftSampleX = Math.max(0, x0 - 1)
      const rightSampleX = Math.min(width - 1, x1 + 1)
      const topSampleY = Math.max(0, y0 - 1)
      const bottomSampleY = Math.min(height - 1, y1 + 1)
      const spanW = Math.max(1, x1 - x0 + 1)
      const spanH = Math.max(1, y1 - y0 + 1)

      for (let py = y0; py <= y1; py++) {
        const ty = (py - y0) / spanH
        const leftIdx = (py * width + leftSampleX) * 4
        const rightIdx = (py * width + rightSampleX) * 4
        for (let px = x0; px <= x1; px++) {
          const tx = (px - x0) / spanW
          const topIdx = (topSampleY * width + px) * 4
          const bottomIdx = (bottomSampleY * width + px) * 4
          const dstIdx = (py * width + px) * 4
          for (let c = 0; c < 3; c++) {
            const horiz = src[leftIdx + c]! * (1 - tx) + src[rightIdx + c]! * tx
            const vert = src[topIdx + c]! * (1 - ty) + src[bottomIdx + c]! * ty
            baseRgba[dstIdx + c] = Math.round((horiz + vert) * 0.5)
          }
          baseRgba[dstIdx + 3] = 255
        }
      }
    }
  }

  // 提取每个前景 UI 控件的透明 PNG 像素（边缘色彩反混合软抠图 + 内部主体全不透明保护）
  const idPrefix = input.idPrefix?.trim() || 'ui-slice'
  const layers: ExtractedUiLayerBuffer[] = []

  for (const [idx, rect] of topRects.entries()) {
    const lw = Math.max(1, rect.width)
    const lh = Math.max(1, rect.height)
    const layerRgba = new Uint8ClampedArray(lw * lh * 4)
    const borderBandX = Math.max(2, Math.min(8, Math.round(lw * 0.08)))
    const borderBandY = Math.max(2, Math.min(8, Math.round(lh * 0.08)))

    for (let ly = 0; ly < lh; ly++) {
      const py = rect.top + ly
      if (py < 0 || py >= height) continue
      const isEdgeY = ly < borderBandY || ly >= lh - borderBandY
      for (let lx = 0; lx < lw; lx++) {
        const px = rect.left + lx
        if (px < 0 || px >= width) continue
        const isEdgeX = lx < borderBandX || lx >= lw - borderBandX
        const srcIdx = (py * width + px) * 4
        const dstIdx = (ly * lw + lx) * 4

        const sr = src[srcIdx]!
        const sg = src[srcIdx + 1]!
        const sb = src[srcIdx + 2]!
        const sa = src[srcIdx + 3]!
        if (sa === 0) continue

        const br = baseRgba[srcIdx]!
        const bg = baseRgba[srcIdx + 1]!
        const bb = baseRgba[srcIdx + 2]!

        const dr = Math.abs(sr - br)
        const dg = Math.abs(sg - bg)
        const db = Math.abs(sb - bb)
        const maxDiff = Math.max(dr, dg, db)

        if (!isEdgeX && !isEdgeY && maxDiff >= 12) {
          // 控件内部主体保持 100% 原始像素与不透明度，保证按钮/图标纹理想素级锐利
          layerRgba[dstIdx] = sr
          layerRgba[dstIdx + 1] = sg
          layerRgba[dstIdx + 2] = sb
          layerRgba[dstIdx + 3] = sa
        } else {
          // 外圈边缘采用色彩反混合软 Alpha（Color Unmixing），消除锯齿与背景杂边
          const rawAlpha = Math.min(1, Math.max(0, (maxDiff - 8) / 28))
          const alpha = Math.round(rawAlpha * sa)
          if (alpha <= 2) continue
          const aNorm = alpha / 255
          const unmixR = Math.min(255, Math.max(0, Math.round((sr - (1 - aNorm) * br) / aNorm)))
          const unmixG = Math.min(255, Math.max(0, Math.round((sg - (1 - aNorm) * bg) / aNorm)))
          const unmixB = Math.min(255, Math.max(0, Math.round((sb - (1 - aNorm) * bb) / aNorm)))
          layerRgba[dstIdx] = unmixR
          layerRgba[dstIdx + 1] = unmixG
          layerRgba[dstIdx + 2] = unmixB
          layerRgba[dstIdx + 3] = alpha
        }
      }
    }

    const zIndex = idx + 1
    const meta = inferExtractedUiWidgetName(rect, width, height, zIndex, input.locale)
    layers.push({
      id: `${idPrefix}:layer:${zIndex}`,
      name: meta.name,
      description: meta.description,
      zIndex,
      left: rect.left,
      top: rect.top,
      width: lw,
      height: lh,
      rgba: layerRgba
    })
  }

  return {
    canvasWidth: width,
    canvasHeight: height,
    baseRgba,
    layers
  }
}
