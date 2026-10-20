/**
 * 图层分离（Seedream 5.0 Pro layer_decomposition）：
 * 一张底图拆成底图 + 最多 16 张透明 PNG，带 z_index / bounding_box / name。
 * 运行后可在 dive 编辑器里调整层级与位置，再本地合成。
 */

import { normalizeExpandResolution } from './imageExpand'
import {
  decomposeControlIntoStandardParts,
  getUiControlSpec,
  recognizeUiControlType,
  type UiControlPartRole,
  type UiControlType,
  type UiEditableTextMeta
} from './uiControlSpec'

export const LAYER_SPLIT_MAX_LAYERS = 64
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
 * - 'auto': 智能自动（识别 UI 标准控件 → 拆解控件结构子部件 → 生成二级嵌套 PSD）
 * - 'ai-inpaint-slice': 通用图片模型底板重绘 + 标准 UI 控件结构拆解（按钮背景/文字/按下态、滑块轨道/填充/手柄、面板底框/正文）
 * - 'ai-layers': 原生多图层 API 拆解 + 标准 UI 控件结构二次精拆
 * - 'local-slice': 本地零 API 智能 UI 控件识别与结构拆解
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
  /** 像素自相似度测算的真实九宫格切线 [top, right, bottom, left]（像素） */
  nineSliceBorders?: [number, number, number, number]
  /** 所属标准 UI 控件实例 ID（同一控件的文字、常态背景、按下态共享同一 uiControlId，归入同一 PSD 控件组） */
  uiControlId?: string
  /** 所属标准 UI 控件显示名称（如「祭炼升阶按钮」「灵力滑动条」） */
  uiControlName?: string
  /** 标准 UI 控件类型（对齐 HTML5 与 Unity UI Toolkit：button / slider / list-view / panel 等） */
  uiControlType?: UiControlType
  /** 控件内部解剖结构角色（button-label / button-bg-normal / button-bg-pressed / slider-thumb 等） */
  uiPartRole?: UiControlPartRole
  /** 原生 Photoshop 可编辑文本图层元数据（文字内容、估算字号、采样主色、对齐） */
  editableText?: UiEditableTextMeta
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
  const nineSliceBorders = tuple4(row.nineSliceBorders)
  const groupId = typeof row.groupId === 'string' && row.groupId.trim() ? row.groupId.trim() : ''
  const role = normalizeLayerRole(row, zIndex, groupId)
  const uiControlId =
    typeof row.uiControlId === 'string' && row.uiControlId.trim() ? row.uiControlId.trim() : ''
  const uiControlName =
    typeof row.uiControlName === 'string' && row.uiControlName.trim()
      ? row.uiControlName.trim()
      : ''
  const uiControlType =
    typeof row.uiControlType === 'string' && row.uiControlType.trim()
      ? (row.uiControlType.trim() as UiControlType)
      : undefined
  const uiPartRole =
    typeof row.uiPartRole === 'string' && row.uiPartRole.trim()
      ? (row.uiPartRole.trim() as UiControlPartRole)
      : undefined
  const editableText =
    row.editableText &&
    typeof row.editableText === 'object' &&
    typeof row.editableText.text === 'string'
      ? {
          text: row.editableText.text,
          fontSize: clampInt(row.editableText.fontSize, 20, 8, 256),
          color:
            Array.isArray(row.editableText.color) && row.editableText.color.length >= 3
              ? ([
                  clampInt(row.editableText.color[0], 240, 0, 255),
                  clampInt(row.editableText.color[1], 230, 0, 255),
                  clampInt(row.editableText.color[2], 200, 0, 255)
                ] as [number, number, number])
              : ([240, 230, 200] as [number, number, number]),
          ...(row.editableText.align ? { align: row.editableText.align } : {}),
          ...(row.editableText.fontName ? { fontName: row.editableText.fontName } : {})
        }
      : undefined
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
    ...(originalNormalized ? { originalNormalized } : {}),
    ...(nineSliceBorders ? { nineSliceBorders } : {}),
    ...(uiControlId ? { uiControlId } : {}),
    ...(uiControlName ? { uiControlName } : {}),
    ...(uiControlType ? { uiControlType } : {}),
    ...(uiPartRole ? { uiPartRole } : {}),
    ...(editableText ? { editableText } : {})
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

/**
 * 删除指定非底图前景图层，并自动清理不再包含任何图层的空分组。
 */
export function removeLayerSplitLayer(
  inputState: ImageLayerSplitState,
  layerId: string
): ImageLayerSplitState {
  const state = normalizeImageLayerSplit(inputState)
  const target = state.layers.find((layer) => layer.id === layerId)
  if (!target || isLayerSplitBase(target)) return state
  const remainingLayers = state.layers.filter((layer) => layer.id !== layerId)
  const usedGroupIds = new Set<string>()
  for (const layer of remainingLayers) {
    let gid = layer.groupId?.trim() ?? ''
    const seen = new Set<string>()
    while (gid && !seen.has(gid)) {
      seen.add(gid)
      usedGroupIds.add(gid)
      gid = state.groups.find((g) => g.id === gid)?.parentGroupId?.trim() ?? ''
    }
  }
  const remainingGroups = state.groups.filter((g) => usedGroupIds.has(g.id))
  const nextSelected =
    state.selectedId === layerId
      ? remainingLayers.find((layer) => !isLayerSplitBase(layer))?.id ||
        remainingLayers[0]?.id ||
        ''
      : state.selectedId
  return normalizeImageLayerSplit({
    ...state,
    selectedId: nextSelected,
    layers: remainingLayers,
    groups: remainingGroups
  })
}

/**
 * 查找指定前景图层在叠放顺序中紧邻的下层前景图层（供「向下合并」使用，不合并入底图 Base）。
 */
export function findMergeDownTargetLayer(
  inputState: ImageLayerSplitState,
  upperLayerId: string
): ImageLayerSplitLayer | null {
  const state = normalizeImageLayerSplit(inputState)
  const upper = state.layers.find((layer) => layer.id === upperLayerId)
  if (!upper || isLayerSplitBase(upper)) return null
  const groupKey = siblingGroupKey(upper)
  const sameGroupCandidates = sortLayersForCompose(
    state.layers.filter(
      (layer) =>
        !isLayerSplitBase(layer) &&
        layer.visible &&
        layer.id !== upper.id &&
        siblingGroupKey(layer) === groupKey &&
        layer.zIndex <= upper.zIndex
    )
  )
  if (sameGroupCandidates.length > 0) {
    return sameGroupCandidates[sameGroupCandidates.length - 1]!
  }
  const allLowerCandidates = sortLayersForCompose(
    state.layers.filter(
      (layer) =>
        !isLayerSplitBase(layer) &&
        layer.visible &&
        layer.id !== upper.id &&
        layer.zIndex < upper.zIndex
    )
  )
  return allLowerCandidates[allLowerCandidates.length - 1] ?? null
}

/**
 * 将「上层 (`upperId`) 合并入下层 (`lowerId`)」后的新边界与新图像 ID 写回拆层状态。
 */
export function applyMergedLayerSplitPair(input: {
  state: ImageLayerSplitState
  upperId: string
  lowerId: string
  mergedImageId: string
  mergedRect: ImageLayerSplitRect
}): ImageLayerSplitState {
  const state = normalizeImageLayerSplit(input.state)
  const upper = state.layers.find((l) => l.id === input.upperId)
  const lower = state.layers.find((l) => l.id === input.lowerId)
  if (!upper || !lower || isLayerSplitBase(upper) || isLayerSplitBase(lower)) return state

  const abs: [number, number, number, number] = [
    input.mergedRect.left,
    input.mergedRect.top,
    input.mergedRect.left + input.mergedRect.width,
    input.mergedRect.top + input.mergedRect.height
  ]
  const updatedLayers = state.layers
    .filter((layer) => layer.id !== upper.id)
    .map((layer) =>
      layer.id === lower.id
        ? {
            ...layer,
            imageId: input.mergedImageId,
            left: input.mergedRect.left,
            top: input.mergedRect.top,
            width: input.mergedRect.width,
            height: input.mergedRect.height,
            originalAbsolute: abs
          }
        : layer
    )
  return removeLayerSplitLayer(
    {
      ...state,
      selectedId: lower.id,
      layers: [...updatedLayers, upper]
    },
    upper.id
  )
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
  visible?: boolean
  boundingBox?: { absolute?: unknown; normalized?: unknown }
  nineSliceBorders?: [number, number, number, number]
  uiControlId?: string
  uiControlName?: string
  uiControlType?: UiControlType
  uiPartRole?: UiControlPartRole
  editableText?: UiEditableTextMeta
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
    const nineSliceBorders = tuple4(row.nineSliceBorders)
    layers.push({
      id,
      imageId: id,
      zIndex,
      name,
      description: row.description?.trim() || '',
      visible: row.visible !== false,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      role: isCanvasBase ? 'canvas-base' : 'layer',
      ...(originalAbsolute ? { originalAbsolute } : {}),
      ...(originalNormalized ? { originalNormalized } : {}),
      ...(nineSliceBorders ? { nineSliceBorders } : {}),
      ...(row.uiControlId ? { uiControlId: row.uiControlId } : {}),
      ...(row.uiControlName ? { uiControlName: row.uiControlName } : {}),
      ...(row.uiControlType ? { uiControlType: row.uiControlType } : {}),
      ...(row.uiPartRole ? { uiPartRole: row.uiPartRole } : {}),
      ...(row.editableText ? { editableText: row.editableText } : {})
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
  if (layer.uiControlType === 'hud-bar' || layer.uiControlType === 'tab-bar') {
    return 'header'
  }
  if (
    layer.uiControlType === 'panel' ||
    layer.uiControlType === 'list-view' ||
    layer.uiControlType === 'foldout'
  ) {
    return 'panels'
  }
  if (
    layer.uiControlType === 'button' ||
    layer.uiControlType === 'slider' ||
    layer.uiControlType === 'progress-bar' ||
    layer.uiControlType === 'item-slot' ||
    layer.uiControlType === 'dropdown' ||
    layer.uiControlType === 'radio-button' ||
    layer.uiControlType === 'toggle' ||
    layer.uiControlType === 'text-field' ||
    layer.uiControlType === 'scroller' ||
    layer.uiControlType === 'radial-progress' ||
    layer.uiControlType === 'icon-badge'
  ) {
    return 'controls'
  }

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
 * 一键按 HTML5 / Unity UI Toolkit 标准控件规范构建二级嵌套 PSD 文件夹树：
 * 第一级（功能分区文件夹）：
 * - `01_HUD与顶栏导航`（高 zIndex）
 * - `02_交互控件与按钮`（中 zIndex）
 * - `03_列表与容器面板`（低 zIndex，位于底图之上）
 * 第二级（单个标准 UI 控件独立 PSD 文件夹，如 `[Button 按钮] 祭炼升阶`、`[Slider 滑动条] 灵力条`）：
 * - 将同一控件拆解出的 `按钮文字`、`按钮图标`、`按钮背景·常态`、`按钮背景·按下效果` 聚合在同一 PSD 控件文件夹内！
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
      name: isEn ? '03_Panels_And_Containers' : '03_面板与容器底框' // cjk-ok PSD 面板分组名
    },
    {
      bucket: 'controls',
      id: 'group:ui-auto:controls',
      name: isEn ? '02_Interactive_Controls' : '02_交互控件与按钮' // cjk-ok PSD 控件分组名
    },
    {
      bucket: 'header',
      id: 'group:ui-auto:header',
      name: isEn ? '01_Header_And_Ornaments' : '01_顶栏与装饰' // cjk-ok PSD 顶栏分组名
    }
  ]
  const autoGroupIds = new Set(autoGroupSpecs.map((spec) => spec.id))

  // 保留用户手动对单层执行「再次拆层」产生的自定义分组（排除自动生成的 group:ui-auto:* 与 group:ui-ctrl:*）
  const preservedGroups = state.groups.filter(
    (group) => !autoGroupIds.has(group.id) && !group.id.startsWith('group:ui-ctrl:')
  )
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
    const inferredType =
      layer.uiControlType ??
      recognizeUiControlType({
        nameHint: layer.name,
        descriptionHint: layer.description,
        left: layer.left,
        top: layer.top,
        width: layer.width,
        height: layer.height,
        canvasWidth: state.canvasWidth || 1280,
        canvasHeight: state.canvasHeight || 720
      })
    const enriched: ImageLayerSplitLayer = {
      ...layer,
      uiControlType: inferredType
    }
    const bucket = classifyGameUiLayerBucket(enriched, state.canvasWidth, state.canvasHeight)
    bucketLayers.get(bucket)!.push(enriched)
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

    // 统计同一 uiControlId 下的子部件图层数量：若 >= 2（如按钮含文字+背景+按下态），创建二级控件专属 PSD 文件夹
    const byControlId = new Map<string, ImageLayerSplitLayer[]>()
    for (const layer of list) {
      const cid = layer.uiControlId?.trim() || ''
      if (!cid) continue
      const arr = byControlId.get(cid) ?? []
      arr.push(layer)
      byControlId.set(cid, arr)
    }

    const createdControlGroups = new Set<string>()
    for (const layer of list) {
      const cid = layer.uiControlId?.trim() || ''
      const siblings = cid ? (byControlId.get(cid) ?? []) : []
      if (cid && siblings.length >= 2) {
        const ctrlGroupId = `group:ui-ctrl:${cid}`
        if (!createdControlGroups.has(ctrlGroupId)) {
          createdControlGroups.add(ctrlGroupId)
          const cSpec = getUiControlSpec(layer.uiControlType)
          const prefix = isEn ? cSpec.folderPrefixEn : cSpec.folderPrefixZh
          const rawCtrlName = layer.uiControlName?.trim() || layer.name.split('·')[0]?.trim() || cid
          createdAutoGroups.push({
            id: ctrlGroupId,
            name: `${prefix} ${rawCtrlName}`,
            collapsed: false,
            visible: true,
            sourceLayerId: baseLayer.id,
            parentGroupId: spec.id
          })
        }
        reindexedForeground.push({
          ...layer,
          groupId: ctrlGroupId,
          zIndex: nextZ++
        })
      } else {
        reindexedForeground.push({
          ...layer,
          groupId: spec.id,
          zIndex: nextZ++
        })
      }
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
    layers: [
      {
        ...baseLayer,
        zIndex: 0,
        role: 'canvas-base',
        uiPartRole: 'canvas-base'
      },
      ...reindexedForeground
    ],
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
  uiControlId?: string
  uiControlType?: UiControlType
  uiPartRole?: UiControlPartRole
  html5StandardTag?: string
  unityUiToolkitTag?: string
  editableText?: UiEditableTextMeta
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

/**
 * 基于 RGBA 像素缓冲区测算真实的九宫格（9-Slice）可拉伸切线 `[top, right, bottom, left]`。
 * 扫描水平与垂直方向中部像素梯度变化率，定位四角装饰区与中部可平铺/拉伸区的真实像素边界。
 */
export function computeNineSliceFromRgbaBuffer(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): [number, number, number, number] | undefined {
  if (width < 36 || height < 28 || rgba.length < width * height * 4) return undefined

  const xStart = Math.max(4, Math.floor(width * 0.12))
  const xEnd = Math.min(width - 5, Math.ceil(width * 0.88))
  const yStart = Math.max(4, Math.floor(height * 0.12))
  const yEnd = Math.min(height - 5, Math.ceil(height * 0.88))
  if (xEnd - xStart < 8 || yEnd - yStart < 6) return undefined

  // 计算每一列与其相邻列在中段区域的平均像素差
  const colDiff = new Float32Array(width)
  let colDiffSum = 0
  for (let x = xStart; x <= xEnd; x++) {
    let diff = 0
    let count = 0
    for (let y = yStart; y <= yEnd; y += 2) {
      const idx = (y * width + x) * 4
      const prevIdx = (y * width + (x - 1)) * 4
      diff +=
        Math.abs(rgba[idx]! - rgba[prevIdx]!) +
        Math.abs(rgba[idx + 1]! - rgba[prevIdx + 1]!) +
        Math.abs(rgba[idx + 2]! - rgba[prevIdx + 2]!) +
        Math.abs(rgba[idx + 3]! - rgba[prevIdx + 3]!)
      count++
    }
    colDiff[x] = count > 0 ? diff / count : 0
    colDiffSum += colDiff[x]!
  }
  const colMean = colDiffSum / Math.max(1, xEnd - xStart + 1)
  const colThresh = Math.max(6, colMean * 0.85)

  let bestX0 = Math.round(width * 0.25)
  let bestX1 = Math.round(width * 0.75)
  let bestXRun = 0
  let curX0 = xStart
  for (let x = xStart; x <= xEnd; x++) {
    if (colDiff[x]! <= colThresh) {
      const run = x - curX0 + 1
      if (run > bestXRun) {
        bestXRun = run
        bestX0 = curX0
        bestX1 = x
      }
    } else {
      curX0 = x + 1
    }
  }

  // 计算每一行与其相邻行在中段区域的平均像素差
  const rowDiff = new Float32Array(height)
  let rowDiffSum = 0
  for (let y = yStart; y <= yEnd; y++) {
    let diff = 0
    let count = 0
    for (let x = xStart; x <= xEnd; x += 2) {
      const idx = (y * width + x) * 4
      const prevIdx = ((y - 1) * width + x) * 4
      diff +=
        Math.abs(rgba[idx]! - rgba[prevIdx]!) +
        Math.abs(rgba[idx + 1]! - rgba[prevIdx + 1]!) +
        Math.abs(rgba[idx + 2]! - rgba[prevIdx + 2]!) +
        Math.abs(rgba[idx + 3]! - rgba[prevIdx + 3]!)
      count++
    }
    rowDiff[y] = count > 0 ? diff / count : 0
    rowDiffSum += rowDiff[y]!
  }
  const rowMean = rowDiffSum / Math.max(1, yEnd - yStart + 1)
  const rowThresh = Math.max(6, rowMean * 0.85)

  let bestY0 = Math.round(height * 0.25)
  let bestY1 = Math.round(height * 0.75)
  let bestYRun = 0
  let curY0 = yStart
  for (let y = yStart; y <= yEnd; y++) {
    if (rowDiff[y]! <= rowThresh) {
      const run = y - curY0 + 1
      if (run > bestYRun) {
        bestYRun = run
        bestY0 = curY0
        bestY1 = y
      }
    } else {
      curY0 = y + 1
    }
  }

  if (bestXRun < width * 0.18 || bestYRun < height * 0.18) {
    return undefined
  }
  const left = Math.max(6, Math.min(Math.round(width * 0.42), bestX0))
  const right = Math.max(6, Math.min(Math.round(width * 0.42), width - 1 - bestX1))
  const top = Math.max(6, Math.min(Math.round(height * 0.42), bestY0))
  const bottom = Math.max(6, Math.min(Math.round(height * 0.42), height - 1 - bestY1))
  return [top, right, bottom, left]
}

function inferNineSliceHint(
  layer: ImageLayerSplitLayer,
  canvasWidth: number,
  canvasHeight: number
): UiLayerManifestNineSliceHint {
  if (isLayerSplitBase(layer)) {
    return { recommended: false, bordersPx: [0, 0, 0, 0] }
  }
  if (
    layer.nineSliceBorders &&
    layer.nineSliceBorders.length === 4 &&
    layer.nineSliceBorders.some((v) => v > 0)
  ) {
    return {
      recommended: true,
      bordersPx: [
        layer.nineSliceBorders[0]!,
        layer.nineSliceBorders[1]!,
        layer.nineSliceBorders[2]!,
        layer.nineSliceBorders[3]!
      ]
    }
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
    layers: ordered.map((layer) => {
      const ctrlSpec = layer.uiControlType ? getUiControlSpec(layer.uiControlType) : undefined
      return {
        id: layer.id,
        name: layer.name,
        description: layer.description ?? '',
        role: isLayerSplitBase(layer) ? 'base' : 'layer',
        ...(layer.uiControlId ? { uiControlId: layer.uiControlId } : {}),
        ...(layer.uiControlType ? { uiControlType: layer.uiControlType } : {}),
        ...(layer.uiPartRole ? { uiPartRole: layer.uiPartRole } : {}),
        ...(ctrlSpec
          ? { html5StandardTag: ctrlSpec.html5Tag, unityUiToolkitTag: ctrlSpec.unityUiToolkitTag }
          : {}),
        ...(layer.editableText ? { editableText: layer.editableText } : {}),
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
      }
    })
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
    return `保持这张游戏 UI 画面${scope}的整体背景底图、环境光影与外层主画框完全不变，将画面上所有悬浮的前景 UI 交互按钮、滑动条、列表项槽位、图标徽章、货币资源胶囊、关闭按钮与浮动小控件干净擦除并无缝修补背景纹理，输出一张纯净无悬浮控件的 UI 背景底板图（严禁绘制任何文字或新增元素）。${extra}` // cjk-ok 通用生图模型底板重绘提示词
  }
  const scope = titleHint ? ` (${titleHint})` : ''
  const extra = custom
    ? ` Focus on removing and isolating these foreground widgets: ${custom}.`
    : ''
  return `Keep the overall background scene, lighting, and outer main frame of this game UI screen${scope} unchanged, and cleanly remove and inpaint over all floating foreground interactive UI buttons, sliders, list slots, icon badges, currency pills, close buttons, and overlay widgets to produce a clean background base plate with no text or added elements.${extra}`
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
  visible?: boolean
  nineSliceBorders?: [number, number, number, number]
  uiControlId?: string
  uiControlName?: string
  uiControlType?: UiControlType
  uiPartRole?: UiControlPartRole
  editableText?: UiEditableTextMeta
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
 * 在指定 RGBA 缓冲区内对矩形区域执行边界双线性内插修补（Inpainting），擦除前景控件重影。
 */
function inpaintRectBilinearInPlace(
  targetRgba: Uint8ClampedArray,
  width: number,
  height: number,
  sampleSourceRgba: Uint8ClampedArray,
  rect: ImageLayerSplitRect
): void {
  const x0 = Math.max(0, rect.left)
  const y0 = Math.max(0, rect.top)
  const x1 = Math.min(width - 1, rect.left + rect.width - 1)
  const y1 = Math.min(height - 1, rect.top + rect.height - 1)
  if (x1 < x0 || y1 < y0) return

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
        const horiz =
          sampleSourceRgba[leftIdx + c]! * (1 - tx) + sampleSourceRgba[rightIdx + c]! * tx
        const vert =
          sampleSourceRgba[topIdx + c]! * (1 - ty) + sampleSourceRgba[bottomIdx + c]! * ty
        targetRgba[dstIdx + c] = Math.round((horiz + vert) * 0.5)
      }
      targetRgba[dstIdx + 3] = 255
    }
  }
}

/**
 * 计算源像素 `(px, py)` 与参考底板在 `3×3` 局部邻域内的最小色彩差异及最匹配背景色。
 * 抵消通用生图模型重绘底板时产生的 1~2px 扩散重采样微位移（Pixel Drift）。
 */
function computePatchAlignedDiff(
  src: Uint8ClampedArray,
  base: Uint8ClampedArray,
  width: number,
  height: number,
  px: number,
  py: number,
  usePatchSearch: boolean
): { maxChannelDiff: number; perceptualDiff: number; bgR: number; bgG: number; bgB: number } {
  const srcIdx = (py * width + px) * 4
  const sr = src[srcIdx]!
  const sg = src[srcIdx + 1]!
  const sb = src[srcIdx + 2]!

  if (!usePatchSearch) {
    const br = base[srcIdx]!
    const bg = base[srcIdx + 1]!
    const bb = base[srcIdx + 2]!
    const dr = Math.abs(sr - br)
    const dg = Math.abs(sg - bg)
    const db = Math.abs(sb - bb)
    const maxC = Math.max(dr, dg, db)
    return {
      maxChannelDiff: maxC,
      perceptualDiff: maxC + 0.3 * (dr + dg + db),
      bgR: br,
      bgG: bg,
      bgB: bb
    }
  }

  let bestPerceptual = 1e9
  let bestMaxC = 255
  let bestR = base[srcIdx]!
  let bestG = base[srcIdx + 1]!
  let bestB = base[srcIdx + 2]!

  for (let dy = -1; dy <= 1; dy++) {
    const ny = py + dy
    if (ny < 0 || ny >= height) continue
    for (let dx = -1; dx <= 1; dx++) {
      const nx = px + dx
      if (nx < 0 || nx >= width) continue
      const bIdx = (ny * width + nx) * 4
      const br = base[bIdx]!
      const bg = base[bIdx + 1]!
      const bb = base[bIdx + 2]!
      const dr = Math.abs(sr - br)
      const dg = Math.abs(sg - bg)
      const db = Math.abs(sb - bb)
      const maxC = Math.max(dr, dg, db)
      const pDiff = maxC + 0.3 * (dr + dg + db)
      if (pDiff < bestPerceptual) {
        bestPerceptual = pDiff
        bestMaxC = maxC
        bestR = br
        bestG = bg
        bestB = bb
      }
    }
  }

  return {
    maxChannelDiff: bestMaxC,
    perceptualDiff: bestPerceptual,
    bgR: bestR,
    bgG: bestG,
    bgB: bestB
  }
}

/**
 * 全包围盒圆角/异形轮廓软抠图 + 外部泛洪（Exterior Flood-Fill）+ 边缘去溢色（Color Decontamination）：
 * - 从控件矩形框四条外边界向内对背景近似像素执行 8-连通泛洪（Exterior Flood-Fill）：
 *   凡是与外框连通的背景区（如圆角按钮的四个外三角、圆形徽章外围、异形标签凹角）均被精确识别为外部背景并透明化；
 * - 控件闭合轮廓内部的文字、高光、纹章即使局部颜色接近底色，因不与外框背景连通而受到 100% 不透明度保护（绝不抠穿孔洞）；
 * - 在轮廓交界带（Contour Transition Band）执行色彩反混合（Color Unmixing），彻底消除黑边/白边与锯齿。
 */
function extractWidgetRgbaWithContourMatting(input: {
  src: Uint8ClampedArray
  baseRgba: Uint8ClampedArray
  canvasWidth: number
  canvasHeight: number
  rect: ImageLayerSplitRect
  usePatchSearch: boolean
}): Uint8ClampedArray {
  const { src, baseRgba, canvasWidth, canvasHeight, rect, usePatchSearch } = input
  const lw = Math.max(1, rect.width)
  const lh = Math.max(1, rect.height)
  const total = lw * lh
  const layerRgba = new Uint8ClampedArray(total * 4)

  const maxDiffMap = new Float32Array(total)
  const refBgR = new Uint8Array(total)
  const refBgG = new Uint8Array(total)
  const refBgB = new Uint8Array(total)

  for (let ly = 0; ly < lh; ly++) {
    const py = rect.top + ly
    if (py < 0 || py >= canvasHeight) continue
    for (let lx = 0; lx < lw; lx++) {
      const px = rect.left + lx
      if (px < 0 || px >= canvasWidth) continue
      const localIdx = ly * lw + lx
      const diff = computePatchAlignedDiff(
        src,
        baseRgba,
        canvasWidth,
        canvasHeight,
        px,
        py,
        usePatchSearch
      )
      maxDiffMap[localIdx] = diff.maxChannelDiff
      refBgR[localIdx] = diff.bgR
      refBgG[localIdx] = diff.bgG
      refBgB[localIdx] = diff.bgB
    }
  }

  // 从矩形四条外边界向内执行 8-连通外部背景泛洪（识别圆角外侧三角与异形控件外围背景）
  const exteriorBg = new Uint8Array(total)
  const floodQueue = new Int32Array(total)
  let qHead = 0
  let qTail = 0
  const floodThreshold = 24

  const trySeed = (lx: number, ly: number): void => {
    const idx = ly * lw + lx
    if (exteriorBg[idx]) return
    if (maxDiffMap[idx]! <= floodThreshold) {
      exteriorBg[idx] = 1
      floodQueue[qTail++] = idx
    }
  }

  for (let lx = 0; lx < lw; lx++) {
    trySeed(lx, 0)
    if (lh > 1) trySeed(lx, lh - 1)
  }
  for (let ly = 1; ly < lh - 1; ly++) {
    trySeed(0, ly)
    if (lw > 1) trySeed(lw - 1, ly)
  }

  while (qHead < qTail) {
    const cur = floodQueue[qHead++]!
    const cy = Math.floor(cur / lw)
    const cx = cur - cy * lw
    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy
      if (ny < 0 || ny >= lh) continue
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = cx + dx
        if (nx < 0 || nx >= lw) continue
        const nIdx = ny * lw + nx
        if (!exteriorBg[nIdx] && maxDiffMap[nIdx]! <= floodThreshold) {
          exteriorBg[nIdx] = 1
          floodQueue[qTail++] = nIdx
        }
      }
    }
  }

  // 构建轮廓边缘 2px 抗锯齿过渡带（Contour Band）
  const contourBand = new Uint8Array(total)
  const edgePad = Math.max(1, Math.min(4, Math.round(Math.min(lw, lh) * 0.05)))
  for (let ly = 0; ly < lh; ly++) {
    const isOuterY = ly < edgePad || ly >= lh - edgePad
    for (let lx = 0; lx < lw; lx++) {
      const idx = ly * lw + lx
      if (exteriorBg[idx]) {
        contourBand[idx] = 1
        continue
      }
      if (isOuterY || lx < edgePad || lx >= lw - edgePad) {
        contourBand[idx] = 1
        continue
      }
      // 紧邻外部泛洪背景的 2px 轮廓边界设为抗锯齿反混合带
      let touchesExterior = 0
      for (let dy = -2; dy <= 2 && !touchesExterior; dy++) {
        const ny = ly + dy
        if (ny < 0 || ny >= lh) continue
        for (let dx = -2; dx <= 2; dx++) {
          const nx = lx + dx
          if (nx < 0 || nx >= lw) continue
          if (exteriorBg[ny * lw + nx]) {
            touchesExterior = 1
            break
          }
        }
      }
      if (touchesExterior) {
        contourBand[idx] = 1
      }
    }
  }

  // 逐像素合成透明图层（外部圆角背景透明 + 轮廓带 Color-Unmixing 去溢色 + 闭合内部 100% 保护）
  for (let ly = 0; ly < lh; ly++) {
    const py = rect.top + ly
    if (py < 0 || py >= canvasHeight) continue
    for (let lx = 0; lx < lw; lx++) {
      const px = rect.left + lx
      if (px < 0 || px >= canvasWidth) continue
      const localIdx = ly * lw + lx
      const srcIdx = (py * canvasWidth + px) * 4
      const dstIdx = localIdx * 4

      const sr = src[srcIdx]!
      const sg = src[srcIdx + 1]!
      const sb = src[srcIdx + 2]!
      const sa = src[srcIdx + 3]!
      if (sa === 0) continue

      const maxDiff = maxDiffMap[localIdx]!
      const br = refBgR[localIdx]!
      const bg = refBgG[localIdx]!
      const bb = refBgB[localIdx]!

      if (exteriorBg[localIdx] && maxDiff < 12) {
        // 圆角/异形控件外部泛洪背景区：彻底透明
        continue
      }

      if (!contourBand[localIdx]) {
        // 控件闭合轮廓内部：100% 保留原始像素与锐度，防止内部文字或图标被误伤
        layerRgba[dstIdx] = sr
        layerRgba[dstIdx + 1] = sg
        layerRgba[dstIdx + 2] = sb
        layerRgba[dstIdx + 3] = sa
      } else {
        // 轮廓过渡带：色彩反混合软抠图（Color Unmixing）+ 前景色去污（Decontamination）
        const rawAlpha = Math.min(1, Math.max(0, (maxDiff - 8) / 28))
        const alpha = Math.round(rawAlpha * sa)
        if (alpha <= 3) continue
        const aNorm = Math.max(0.12, alpha / 255)
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

  return layerRgba
}

/**
 * 针对大面积面板容器（如弹窗底框、主面板），自动检测并剥离其内部嵌套的高对比度子控件（如按钮、道具槽）。
 * 返回被剥离出的子控件矩形框列表。
 */
function detectInnerChildWidgetsInContainer(
  src: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  container: ImageLayerSplitRect,
  minPxSide: number
): Array<ImageLayerSplitRect & { score: number }> {
  const cw = container.width
  const ch = container.height
  if (cw < minPxSide * 3 || ch < minPxSide * 3) return []

  // 内缩 10% 避开容器自身的外边框与角花装饰
  const insetX = Math.max(4, Math.round(cw * 0.1))
  const insetY = Math.max(4, Math.round(ch * 0.1))
  const ix0 = container.left + insetX
  const iy0 = container.top + insetY
  const iw = cw - insetX * 2
  const ih = ch - insetY * 2
  if (iw < minPxSide * 2 || ih < minPxSide * 2) return []

  // 采样容器内圈边缘估算容器底板主色（Plate Color）
  let pR = 0
  let pG = 0
  let pB = 0
  let pCount = 0
  for (let x = ix0; x < ix0 + iw; x += 2) {
    const topIdx = (iy0 * canvasWidth + x) * 4
    const botIdx = ((iy0 + ih - 1) * canvasWidth + x) * 4
    pR += src[topIdx]! + src[botIdx]!
    pG += src[topIdx + 1]! + src[botIdx + 1]!
    pB += src[topIdx + 2]! + src[botIdx + 2]!
    pCount += 2
  }
  for (let y = iy0; y < iy0 + ih; y += 2) {
    const leftIdx = (y * canvasWidth + ix0) * 4
    const rightIdx = (y * canvasWidth + (ix0 + iw - 1)) * 4
    pR += src[leftIdx]! + src[rightIdx]!
    pG += src[leftIdx + 1]! + src[rightIdx + 1]!
    pB += src[leftIdx + 2]! + src[rightIdx + 2]!
    pCount += 2
  }
  if (pCount === 0) return []
  const plateR = pR / pCount
  const plateG = pG / pCount
  const plateB = pB / pCount

  const step = Math.max(1, Math.ceil(Math.max(iw, ih) / 96))
  const gw = Math.max(1, Math.ceil(iw / step))
  const gh = Math.max(1, Math.ceil(ih / step))
  const mask = new Uint8Array(gw * gh)
  const cellScore = new Float32Array(gw * gh)

  for (let gy = 0; gy < gh; gy++) {
    const py = Math.min(canvasHeight - 1, iy0 + gy * step)
    for (let gx = 0; gx < gw; gx++) {
      const px = Math.min(canvasWidth - 1, ix0 + gx * step)
      const idx = (py * canvasWidth + px) * 4
      const dr = Math.abs(src[idx]! - plateR)
      const dg = Math.abs(src[idx + 1]! - plateG)
      const db = Math.abs(src[idx + 2]! - plateB)
      const diff = Math.max(dr, dg, db) + 0.3 * (dr + dg + db)
      const gIdx = gy * gw + gx
      cellScore[gIdx] = diff
      if (src[idx + 3]! > 32 && diff >= 42) {
        mask[gIdx] = 1
      }
    }
  }

  const visited = new Uint8Array(gw * gh)
  const queue = new Int32Array(gw * gh)
  const children: Array<ImageLayerSplitRect & { score: number }> = []
  const containerArea = cw * ch

  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const start = gy * gw + gx
      if (!mask[start] || visited[start]) continue
      let head = 0
      let tail = 0
      queue[tail++] = start
      visited[start] = 1
      let gx0 = gx
      let gy0 = gy
      let gx1 = gx
      let gy1 = gy
      let scoreSum = 0

      while (head < tail) {
        const cur = queue[head++]!
        const cy = Math.floor(cur / gw)
        const cx = cur - cy * gw
        if (cx < gx0) gx0 = cx
        if (cy < gy0) gy0 = cy
        if (cx > gx1) gx1 = cx
        if (cy > gy1) gy1 = cy
        scoreSum += cellScore[cur]!

        for (let dy = -1; dy <= 1; dy++) {
          const ny = cy + dy
          if (ny < 0 || ny >= gh) continue
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = cx + dx
            if (nx < 0 || nx >= gw) continue
            const nIdx = ny * gw + nx
            if (mask[nIdx] && !visited[nIdx]) {
              visited[nIdx] = 1
              queue[tail++] = nIdx
            }
          }
        }
      }

      const left = ix0 + gx0 * step
      const top = iy0 + gy0 * step
      const right = Math.min(ix0 + iw, ix0 + (gx1 + 1) * step)
      const bottom = Math.min(iy0 + ih, iy0 + (gy1 + 1) * step)
      const rw = right - left
      const rh = bottom - top
      const area = rw * rh
      if (rw < minPxSide || rh < minPxSide) continue
      // 子控件面积须在容器面积的 0.8% ~ 45% 之间（排除噪点与容器本身）
      if (area < containerArea * 0.008 || area > containerArea * 0.45) continue
      children.push({ left, top, width: rw, height: rh, score: scoreSum })
    }
  }

  return children
}

/**
 * 手动框选切层（Box Slice Tool）：
 * 将用户在 Dive 画布上框选的矩形区域 `rect` 从源图提取为带圆角/异形透明轮廓的独立前景图层，
 * 同时在底图缓冲区 `baseRgba` 上对该矩形执行双线性纹理修补（消除移走控件后的底图重影）。
 */
export function sliceUiLayerFromRgbaRect(input: {
  width: number
  height: number
  sourceRgba: Uint8Array | Uint8ClampedArray
  baseRgba?: Uint8Array | Uint8ClampedArray | null
  rect: ImageLayerSplitRect
  layerId?: string
  name?: string
  zIndex?: number
  locale?: string
}): {
  layer: ExtractedUiLayerBuffer
  subParts: ExtractedUiLayerBuffer[]
  updatedBaseRgba: Uint8ClampedArray
} {
  const width = Math.max(1, Math.round(input.width))
  const height = Math.max(1, Math.round(input.height))
  const totalPixels = width * height
  const src = new Uint8ClampedArray(totalPixels * 4)
  src.set(input.sourceRgba.subarray(0, totalPixels * 4))

  const updatedBaseRgba = new Uint8ClampedArray(totalPixels * 4)
  if (input.baseRgba && input.baseRgba.length >= totalPixels * 4) {
    updatedBaseRgba.set(input.baseRgba.subarray(0, totalPixels * 4))
  } else {
    updatedBaseRgba.set(src)
  }

  const left = Math.max(0, Math.min(width - 1, Math.round(input.rect.left)))
  const top = Math.max(0, Math.min(height - 1, Math.round(input.rect.top)))
  const rw = Math.max(1, Math.min(width - left, Math.round(input.rect.width)))
  const rh = Math.max(1, Math.min(height - top, Math.round(input.rect.height)))
  const clampedRect: ImageLayerSplitRect = { left, top, width: rw, height: rh }

  // 先用框选外围像素对底图对应区域执行双线性修补，再以修补后的干净底图为参考抠出框内圆角/异形控件
  inpaintRectBilinearInPlace(updatedBaseRgba, width, height, src, clampedRect)

  const layerRgba = extractWidgetRgbaWithContourMatting({
    src,
    baseRgba: updatedBaseRgba,
    canvasWidth: width,
    canvasHeight: height,
    rect: clampedRect,
    usePatchSearch: false
  })

  const zIndex = input.zIndex ?? 1
  const meta = inferExtractedUiWidgetName(clampedRect, width, height, zIndex, input.locale)
  const nineSliceBorders = computeNineSliceFromRgbaBuffer(layerRgba, rw, rh)
  const controlName = input.name?.trim() || meta.name
  const controlId = input.layerId?.trim() || `manual-slice:${zIndex}`
  const uiControlType = recognizeUiControlType({
    nameHint: controlName,
    descriptionHint: meta.description,
    left,
    top,
    width: rw,
    height: rh,
    canvasWidth: width,
    canvasHeight: height,
    rgba: layerRgba
  })
  const decomposedParts = decomposeControlIntoStandardParts({
    nameHint: controlName,
    descriptionHint: meta.description,
    left,
    top,
    width: rw,
    height: rh,
    canvasWidth: width,
    canvasHeight: height,
    rgba: layerRgba,
    nineSliceBorders,
    locale: input.locale
  })
  const subParts: ExtractedUiLayerBuffer[] = decomposedParts.map((part, pIdx) => ({
    id: `${controlId}:${part.idSuffix}`,
    name: part.name,
    description: part.description,
    zIndex: zIndex + pIdx,
    left: part.left,
    top: part.top,
    width: part.width,
    height: part.height,
    rgba: part.rgba,
    visible: part.visible,
    uiControlId: controlId,
    uiControlName: controlName,
    uiControlType: part.uiControlType,
    uiPartRole: part.uiPartRole,
    ...(part.nineSliceBorders ? { nineSliceBorders: part.nineSliceBorders } : {}),
    ...(part.editableText ? { editableText: part.editableText } : {})
  }))

  return {
    layer: {
      id: controlId,
      name: controlName,
      description: meta.description,
      zIndex,
      left,
      top,
      width: rw,
      height: rh,
      rgba: layerRgba,
      visible: true,
      uiControlId: controlId,
      uiControlName: controlName,
      uiControlType,
      ...(nineSliceBorders ? { nineSliceBorders } : {})
    },
    subParts,
    updatedBaseRgba
  }
}

/**
 * 商用级像素游戏 UI 图层分解引擎（兼容任意生图模型差分重绘底板与零 API 本地智能拆层）：
 * 1. 若提供 `cleanBaseRgba`（由任意图片模型擦除前景控件后生成），采用 `3×3` 邻域对齐最小色差（Patch-Aligned Diff）抵消重绘微漂移；
 * 2. 若未提供 `cleanBaseRgba`（本地零 API 拆层），自动建模多尺度背景底色定位独立 UI 控件岛；
 * 3. 支持「父容器 + 内部子控件」双层剥离（Hierarchical Parent-Child Peeling）：大弹窗/主面板内部的按钮与槽位自动剥离为上层独立图层，并在父面板底框上自动修补擦除子控件；
 * 4. 对每个前景控件执行全包围盒外部背景泛洪（Exterior Flood-Fill）+ 轮廓色彩反混合软抠图（Color Unmixing），使圆角按钮、圆形徽章四角 100% 纯净透明，内部文字不穿孔；
 * 5. 先识别标准 UI 控件类型（HTML5 / Unity UI Toolkit：Button、Slider、ProgressBar、ListView、TabBar、HUD、Panel），再将每个控件自动拆解为结构化子部件图层（如按钮文字、按钮图标、常态九宫格底板、悬停态、按下态）。
 */
export function decomposeRgbaBufferToUiLayers(input: {
  width: number
  height: number
  sourceRgba: Uint8Array | Uint8ClampedArray
  cleanBaseRgba?: Uint8Array | Uint8ClampedArray | null
  maxLayers?: number
  idPrefix?: string
  locale?: string
  /** 是否将每个识别出的 UI 控件拆解为标准子部件图层（默认 true） */
  decomposeControlParts?: boolean
  /** 可选：来自 AI 图层分解 API 的候选控件边界框与语义名称提示（用于辅助识别控件与拆解子结构） */
  apiLayerHints?: Array<{
    name?: string
    description?: string
    left: number
    top: number
    width: number
    height: number
  }>
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

  const maxDim = 320
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
            const aligned = computePatchAlignedDiff(src, baseRgba, width, height, px, py, true)
            rSum += aligned.bgR
            gSum += aligned.bgG
            bSum += aligned.bgB
            if (aligned.perceptualDiff > maxDiff) maxDiff = aligned.perceptualDiff
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

  // 合并同级碎片框（若一方已是大容器面板且另一方是独立小控件，则保留父子分离而不吞并）
  const mergedBoxes = [...rawBoxes]
  const totalGridCells = gw * gh
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
          const areaA = (a.gx1 - a.gx0 + 1) * (a.gy1 - a.gy0 + 1)
          const areaB = (b.gx1 - b.gx0 + 1) * (b.gy1 - b.gy0 + 1)
          const bigArea = Math.max(areaA, areaB)
          const smallArea = Math.min(areaA, areaB)
          // 若大框已是面板容器（>= 14% 画布）且小框是内部独立子控件（<= 大框 35%），保持父子分层不吞并
          if (bigArea >= totalGridCells * 0.14 && smallArea >= 4 && smallArea <= bigArea * 0.35) {
            continue
          }
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

  const maxControlCount = Math.max(1, Math.min(20, input.maxLayers ?? 12))
  const minPxSide = Math.max(4, Math.min(12, Math.floor(Math.min(width, height) * 0.025)))

  const candidateRects: Array<
    ImageLayerSplitRect & { score: number; hintName?: string; hintDescription?: string }
  > = []
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

  // 若提供了 AI 图层边界框提示（apiLayerHints），融合其语义信息与未检出的独立控件框
  if (input.apiLayerHints?.length) {
    for (const hint of input.apiLayerHints) {
      const hl = Math.max(0, Math.min(width - 1, Math.round(hint.left)))
      const ht = Math.max(0, Math.min(height - 1, Math.round(hint.top)))
      const hw = Math.max(1, Math.min(width - hl, Math.round(hint.width)))
      const hh = Math.max(1, Math.min(height - ht, Math.round(hint.height)))
      if (hw < minPxSide || hh < minPxSide) continue
      if (hw >= width * 0.94 && hh >= height * 0.94) continue
      const hintArea = hw * hh
      let matched = false
      for (const existing of candidateRects) {
        const ix0 = Math.max(existing.left, hl)
        const iy0 = Math.max(existing.top, ht)
        const ix1 = Math.min(existing.left + existing.width, hl + hw)
        const iy1 = Math.min(existing.top + existing.height, ht + hh)
        if (ix1 > ix0 && iy1 > iy0) {
          const inter = (ix1 - ix0) * (iy1 - iy0)
          const minArea = Math.min(existing.width * existing.height, hintArea)
          if (inter >= minArea * 0.45) {
            matched = true
            if (hint.name?.trim() && !existing.hintName) existing.hintName = hint.name.trim()
            if (hint.description?.trim() && !existing.hintDescription) {
              existing.hintDescription = hint.description.trim()
            }
            break
          }
        }
      }
      if (!matched) {
        candidateRects.push({
          left: hl,
          top: ht,
          width: hw,
          height: hh,
          score: 500 + hintArea * 0.05,
          ...(hint.name?.trim() ? { hintName: hint.name.trim() } : {}),
          ...(hint.description?.trim() ? { hintDescription: hint.description.trim() } : {})
        })
      }
    }
  }

  // 父子容器双层剥离（Hierarchical Peeling）：对大面积容器面板内部扫描高对比度子控件（按钮/道具格）
  const peeledChildren: Array<ImageLayerSplitRect & { score: number }> = []
  for (const rect of candidateRects) {
    const areaRatio = (rect.width * rect.height) / Math.max(1, totalPixels)
    if (areaRatio >= 0.12 && rect.width >= width * 0.28 && rect.height >= height * 0.22) {
      const innerKids = detectInnerChildWidgetsInContainer(src, width, height, rect, minPxSide)
      for (const kid of innerKids) {
        const duplicate = candidateRects.some(
          (existing) =>
            Math.abs(existing.left - kid.left) <= 6 &&
            Math.abs(existing.top - kid.top) <= 6 &&
            Math.abs(existing.width - kid.width) <= 8 &&
            Math.abs(existing.height - kid.height) <= 8
        )
        if (!duplicate) {
          peeledChildren.push(kid)
        }
      }
    }
  }
  candidateRects.push(...peeledChildren)

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

  // 先按显著度挑选前 maxControlCount 个控件，再按面积从大到小排序（大面板容器在下、内部子按钮与顶栏装饰在上）
  const topRects = candidateRects
    .sort((a, b) => b.score - a.score)
    .slice(0, maxControlCount)
    .sort((a, b) => b.width * b.height - a.width * a.height)

  // 若无外部 AI 底图，在本地对 baseRgba 执行边界色彩双线性修补（Inpainting），消除移动图层时的底图重影
  if (!hasExternalBase) {
    for (const rect of topRects) {
      inpaintRectBilinearInPlace(baseRgba, width, height, src, rect)
    }
  }

  // 提取每个前景 UI 控件的透明 PNG 像素，并按标准控件规范拆解为结构化子部件图层
  const idPrefix = input.idPrefix?.trim() || 'ui-slice'
  const shouldDecomposeParts = input.decomposeControlParts !== false
  const layers: ExtractedUiLayerBuffer[] = []
  let nextZIndex = 1

  for (const [idx, rect] of topRects.entries()) {
    const lw = Math.max(1, rect.width)
    const lh = Math.max(1, rect.height)

    // 查找完全落在该大容器内部的上层子控件（索引 > idx 即面积更小、zIndex 更高）
    const enclosedChildren = topRects.slice(idx + 1).filter((child) => {
      const cx0 = Math.max(rect.left, child.left)
      const cy0 = Math.max(rect.top, child.top)
      const cx1 = Math.min(rect.left + rect.width, child.left + child.width)
      const cy1 = Math.min(rect.top + rect.height, child.top + child.height)
      if (cx1 <= cx0 || cy1 <= cy0) return false
      const overlapArea = (cx1 - cx0) * (cy1 - cy0)
      const childArea = Math.max(1, child.width * child.height)
      return overlapArea >= childArea * 0.75 && childArea <= rect.width * rect.height * 0.55
    })

    // 若该层是包含子控件的父容器，先在局部源图副本上把子控件区域修补擦除为干净的面板底色
    let effectiveSrc = src
    let effectiveBase = baseRgba
    if (enclosedChildren.length > 0) {
      effectiveSrc = new Uint8ClampedArray(src)
      for (const child of enclosedChildren) {
        inpaintRectBilinearInPlace(effectiveSrc, width, height, src, child)
      }
    }

    // 若该层是位于父容器内部的子控件，其局部背景应当是父容器底板色而非最底层画布背景
    const parentContainer = topRects.slice(0, idx).find((parent) => {
      const cx0 = Math.max(parent.left, rect.left)
      const cy0 = Math.max(parent.top, rect.top)
      const cx1 = Math.min(parent.left + parent.width, rect.left + rect.width)
      const cy1 = Math.min(parent.top + parent.height, rect.top + rect.height)
      if (cx1 <= cx0 || cy1 <= cy0) return false
      const overlapArea = (cx1 - cx0) * (cy1 - cy0)
      return overlapArea >= lw * lh * 0.75
    })
    if (parentContainer) {
      const localParentBase = new Uint8ClampedArray(baseRgba)
      inpaintRectBilinearInPlace(localParentBase, width, height, src, rect)
      effectiveBase = localParentBase
    }

    const layerRgba = extractWidgetRgbaWithContourMatting({
      src: effectiveSrc,
      baseRgba: effectiveBase,
      canvasWidth: width,
      canvasHeight: height,
      rect,
      usePatchSearch: hasExternalBase && !parentContainer
    })

    const controlIndex = idx + 1
    const controlId = `${idPrefix}:ctrl:${controlIndex}`
    const inferredMeta = inferExtractedUiWidgetName(rect, width, height, controlIndex, input.locale)
    const controlName = rect.hintName || inferredMeta.name
    const controlDesc = rect.hintDescription || inferredMeta.description
    const nineSliceBorders = computeNineSliceFromRgbaBuffer(layerRgba, lw, lh)

    if (shouldDecomposeParts) {
      const parts = decomposeControlIntoStandardParts({
        nameHint: controlName,
        descriptionHint: controlDesc,
        left: rect.left,
        top: rect.top,
        width: lw,
        height: lh,
        canvasWidth: width,
        canvasHeight: height,
        rgba: layerRgba,
        nineSliceBorders,
        locale: input.locale
      })
      for (const part of parts) {
        if (layers.length >= LAYER_SPLIT_MAX_LAYERS - 1) break
        const z = nextZIndex++
        layers.push({
          id: `${controlId}:${part.idSuffix}`,
          name: part.name,
          description: part.description,
          zIndex: z,
          left: part.left,
          top: part.top,
          width: part.width,
          height: part.height,
          rgba: part.rgba,
          visible: part.visible,
          uiControlId: controlId,
          uiControlName: controlName,
          uiControlType: part.uiControlType,
          uiPartRole: part.uiPartRole,
          ...(part.nineSliceBorders ? { nineSliceBorders: part.nineSliceBorders } : {}),
          ...(part.editableText ? { editableText: part.editableText } : {})
        })
      }
    } else {
      const z = nextZIndex++
      layers.push({
        id: `${idPrefix}:layer:${z}`,
        name: controlName,
        description: controlDesc,
        zIndex: z,
        left: rect.left,
        top: rect.top,
        width: lw,
        height: lh,
        rgba: layerRgba,
        visible: true,
        uiControlId: controlId,
        uiControlName: controlName,
        ...(nineSliceBorders ? { nineSliceBorders } : {})
      })
    }
  }

  return {
    canvasWidth: width,
    canvasHeight: height,
    baseRgba,
    layers
  }
}
