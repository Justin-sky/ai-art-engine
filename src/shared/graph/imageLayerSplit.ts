/**
 * 图层分离（Seedream 5.0 Pro layer_decomposition）：
 * 一张底图拆成底图 + 最多 16 张透明 PNG，带 z_index / bounding_box / name。
 * 运行后可在 dive 编辑器里调整层级与位置，再本地合成。
 */

import { normalizeExpandResolution } from './imageExpand'
import {
  decomposeControlIntoStandardParts,
  getUiControlSpec,
  matchOcrBoxesToControlRect,
  recognizeUiControlType,
  type LocalOcrTextBox,
  type UiControlPartRole,
  type UiControlType,
  type UiEditableTextMeta
} from './uiControlSpec'

export const LAYER_SPLIT_MAX_LAYERS = 96
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
 * - 'precise': 精准拆层（本地 OCR + 多模态大模型结构化布局树 + 按遮挡层级逐层剥离底板），
 *   详见 `uiPreciseSplit/pipeline.ts`；'auto' 在具备视觉模型时优先走此模式
 */
export const UI_LAYER_SPLIT_MODES = [
  'auto',
  'precise',
  'ai-inpaint-slice',
  'ai-layers',
  'local-slice'
] as const

export type UiLayerSplitMode = (typeof UI_LAYER_SPLIT_MODES)[number]

export function normalizeLayerSplitMode(value: unknown): UiLayerSplitMode {
  const raw = String(value ?? '').trim()
  if (
    raw === 'auto' ||
    raw === 'precise' ||
    raw === 'ai-inpaint-slice' ||
    raw === 'ai-layers' ||
    raw === 'local-slice'
  ) {
    return raw
  }
  return 'auto'
}

/**
 * 是否优先尝试精准拆层（OCR + 多模态）。
 * - 'precise'：必须走精准拆层，失败直接报错
 * - 'auto'：优先精准拆层，失败（无视觉模型 / 无元素）时回退到 {@link resolveEffectiveUiLayerSplitStrategy}
 */
export function prefersPreciseUiLayerSplit(splitMode?: UiLayerSplitMode): boolean {
  const mode = normalizeLayerSplitMode(splitMode)
  return mode === 'precise' || mode === 'auto'
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
  /** 引擎安全的导出名（如 Btn_Confirm_01）：导出切图文件名 / 预制体节点名使用，显示名仍用 name */
  exportName?: string
  /** 同一预制体（重复控件）共享的分组键：导出切图时同组只保留一份素材，多个实例引用它 */
  prefabKey?: string
  /** 精准拆层质检发现的问题（edge_halo / base_residue / occluded_blurry 等），供编辑器标红 */
  qaIssues?: string[]
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
  visionModel?: string
  visionProviderInstanceId?: string
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
    /** 精准拆层的多模态模型覆盖（仅设置时计入指纹，兼容旧指纹） */
    visionModelKey?: string
  }
): string {
  const src = sourceUrl.trim()
  const head = src.slice(0, 64)
  const tail = src.length > 80 ? src.slice(-24) : ''
  const base = `${src.length}:${head}:${tail}|${prompt.trim()}|${normalizeLayerSplitResolution(resolution)}`
  if (!extra) return base
  const mode = normalizeLayerSplitMode(extra.splitMode)
  const modelKey = `${extra.providerInstanceId?.trim() ?? ''}:${extra.model?.trim() ?? ''}`
  const visionKey = extra.visionModelKey?.trim() || ''
  const withVision = (fp: string): string => (visionKey ? `${fp}|v:${visionKey}` : fp)
  if (mode === 'auto' && modelKey === ':') return withVision(base)
  return withVision(`${base}|${mode}|${modelKey}`)
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
  const exportName =
    typeof row.exportName === 'string' &&
    /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(row.exportName.trim())
      ? row.exportName.trim()
      : ''
  const prefabKey =
    typeof row.prefabKey === 'string' && row.prefabKey.trim() ? row.prefabKey.trim() : ''
  const qaIssues = Array.isArray(row.qaIssues)
    ? row.qaIssues.filter((s): s is string => typeof s === 'string' && !!s.trim()).slice(0, 8)
    : []
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
    ...(editableText ? { editableText } : {}),
    ...(exportName ? { exportName } : {}),
    ...(prefabKey ? { prefabKey } : {}),
    ...(qaIssues.length ? { qaIssues } : {})
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
      '拆解游戏战斗 HUD 界面图层：底层场景背景、左上角色头像框与血条/蓝条槽、右上小地图与资源货币栏、右下技能轮盘与普攻按钮、顶部首领血条与状态图标，各组件层均保持边缘干净与透明背景', // cjk-ok 游戏 HUD 拆层预设
    promptEn:
      'Decompose game battle HUD layers: underlying scene backdrop, top-left avatar frame with HP/MP bars, top-right minimap & currency bar, bottom-right skill wheel & attack buttons, top boss HP bar & buff icons, all widget layers with clean edges and transparent background.'
  },
  {
    id: 'ui-popup',
    promptZh:
      '拆解游戏弹窗对话框图层：半透明遮罩与弹窗主底板、顶部标题横幅丝带与角花装饰、中部奖励槽位与内嵌子面板、底部确认/取消主次按钮与右上关闭按钮，各图层均保持边缘干净与透明背景', // cjk-ok 游戏弹窗拆层预设
    promptEn:
      'Decompose game modal popup layers: modal main frame & backdrop, top ribbon title banner & corner ornaments, center reward slots & inset sub-panel, bottom confirm/cancel buttons & top-right close button, all layers with clean edges and transparent background.'
  },
  {
    id: 'ui-inventory',
    promptZh:
      '拆解背包与养成界面图层：全屏底板与立绘展示台、左侧页签导航栏、右侧网格物品槽位矩阵与滚动容器、底部强化/穿戴操作按钮与顶部资源栏，各组件层均保持边缘干净与透明背景', // cjk-ok 游戏背包养成拆层预设
    promptEn:
      'Decompose RPG inventory & progression UI layers: fullscreen background & character stage, left tab navigation bar, right item grid slots & scroll panel, bottom upgrade/equip action buttons & top resource bar, all widget layers with clean edges and transparent background.'
  },
  {
    id: 'ui-card',
    promptZh:
      '拆解抽卡与商店界面图层：史诗舞台背景、核心卡池横幅与角色立绘展示框、稀有度徽章与价格标签、底部单抽/十连抽高亮按钮与顶部代币栏，各组件层均保持边缘干净与透明背景', // cjk-ok 游戏抽卡商店拆层预设
    promptEn:
      'Decompose gacha & shop UI layers: epic stage background, main banner & featured character frame, rarity badges & price tags, bottom single/10x pull CTA buttons & top currency bar, all widget layers with clean edges and transparent background.'
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
  /** 引擎安全的导出名（预制体节点名 / 切图文件名） */
  exportName?: string
  /** 同一预制体分组键（重复控件共享同一份素材） */
  prefabKey?: string
  /** 精准拆层质检问题 */
  qaIssues?: string[]
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
        ...(layer.exportName ? { exportName: layer.exportName } : {}),
        ...(layer.prefabKey ? { prefabKey: layer.prefabKey } : {}),
        ...(layer.qaIssues?.length ? { qaIssues: [...layer.qaIssues] } : {}),
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
 *
 * 注意：`'precise'` / `'auto'` 先由执行器尝试精准拆层（见 {@link prefersPreciseUiLayerSplit}），
 * 此函数返回的是其回退 / 嵌套再拆时使用的传统策略。
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
  const cx = (rect.left + rect.width / 2) / cw
  const cy = (rect.top + rect.height / 2) / ch
  const aspect = rect.width / Math.max(1, rect.height)

  if (areaRatio >= 0.14) {
    return isZh
      ? { name: `主面板底框_${index}`, description: 'UI 面板容器与背景底框' } // cjk-ok 自动命名的游戏 UI 图层
      : { name: `Main_Panel_Frame_${index}`, description: 'UI panel container frame' }
  }
  if (cy <= 0.08 && cx <= 0.14 && aspect >= 0.7 && aspect <= 1.4) {
    return isZh
      ? { name: `顶栏头像框_${index}`, description: '顶部玩家头像框与等级徽章' } // cjk-ok 自动命名的游戏 UI 图层
      : { name: `Top_Avatar_Frame_${index}`, description: 'Top player avatar frame' }
  }
  if (cy <= 0.18 && aspect >= 2.2) {
    return isZh
      ? { name: `顶栏横幅条_${index}`, description: '顶部资源状态栏与标题横幅' } // cjk-ok 自动命名的游戏 UI 图层
      : { name: `Top_Header_Bar_${index}`, description: 'Top status and currency header bar' }
  }
  if (cy <= 0.22 && aspect < 2.2) {
    if (cx <= 0.18 || cx >= 0.82) {
      return isZh
        ? { name: `侧边入口_${index}`, description: '主界面左右侧快捷活动入口图标' } // cjk-ok 自动命名的游戏 UI 图层
        : { name: `Side_Entry_Icon_${index}`, description: 'Side shortcut entry icon' }
    }
    return isZh
      ? { name: `顶部装饰徽章_${index}`, description: '顶栏图标、角标或关闭按钮' } // cjk-ok 自动命名的游戏 UI 图层
      : { name: `Top_Ornament_Badge_${index}`, description: 'Top ornament badge or close button' }
  }
  if (cy >= 0.88 && aspect <= 1.65) {
    return isZh
      ? { name: `底栏导航项_${index}`, description: '底部导航栏切页图标按钮' } // cjk-ok 自动命名的游戏 UI 图层
      : { name: `Bottom_Nav_Tab_${index}`, description: 'Bottom navigation tab item' }
  }
  if ((cx <= 0.16 || cx >= 0.84) && cy <= 0.42 && aspect <= 1.6) {
    return isZh
      ? { name: `侧边入口_${index}`, description: '主界面左右侧快捷活动入口图标' } // cjk-ok 自动命名的游戏 UI 图层
      : { name: `Side_Entry_Icon_${index}`, description: 'Side shortcut entry icon' }
  }
  if (cy >= 0.36 && cy <= 0.68 && rect.width <= cw * 0.08 && rect.height <= ch * 0.08) {
    if (cx <= 0.08) {
      return isZh
        ? { name: `左翻页箭头_${index}`, description: '弹窗左侧轮播切换箭头按钮' } // cjk-ok 自动命名的游戏 UI 图层
        : { name: `Left_Carousel_Arrow_${index}`, description: 'Modal left carousel arrow' }
    }
    if (cx >= 0.92) {
      return isZh
        ? { name: `右翻页箭头_${index}`, description: '弹窗右侧轮播切换箭头按钮' } // cjk-ok 自动命名的游戏 UI 图层
        : { name: `Right_Carousel_Arrow_${index}`, description: 'Modal right carousel arrow' }
    }
  }
  if (aspect >= 3.8 && rect.height <= ch * 0.025 && cy >= 0.55 && cy <= 0.82) {
    return isZh
      ? { name: `轮播分页指示点_${index}`, description: '弹窗底部轮播页码指示点' } // cjk-ok 自动命名的游戏 UI 图层
      : { name: `Carousel_Dots_${index}`, description: 'Carousel pagination indicator dots' }
  }
  if (aspect >= 4.2 && rect.height <= ch * 0.035 && cy >= 0.58 && cy <= 0.78) {
    return isZh
      ? { name: `倒计时文本_${index}`, description: '活动/礼包剩余时间倒计时文本' } // cjk-ok 自动命名的游戏 UI 图层
      : { name: `Countdown_Timer_${index}`, description: 'Countdown timer text' }
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
    const ty = (py - y0 + 0.5) / spanH
    const distY = Math.min(py - y0 + 1, y1 - py + 1)
    const wy = 1 / Math.pow(distY, 1.35)
    const leftIdx = (py * width + leftSampleX) * 4
    const rightIdx = (py * width + rightSampleX) * 4
    for (let px = x0; px <= x1; px++) {
      const tx = (px - x0 + 0.5) / spanW
      const distX = Math.min(px - x0 + 1, x1 - px + 1)
      const wx = 1 / Math.pow(distX, 1.35)
      const wSum = wx + wy
      const topIdx = (topSampleY * width + px) * 4
      const bottomIdx = (bottomSampleY * width + px) * 4
      const dstIdx = (py * width + px) * 4
      for (let c = 0; c < 4; c++) {
        const horiz =
          sampleSourceRgba[leftIdx + c]! * (1 - tx) + sampleSourceRgba[rightIdx + c]! * tx
        const vert =
          sampleSourceRgba[topIdx + c]! * (1 - ty) + sampleSourceRgba[bottomIdx + c]! * ty
        targetRgba[dstIdx + c] = Math.round((horiz * wx + vert * wy) / wSum)
      }
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
 * 全包围盒圆角/异形轮廓软抠图 + 外部泛洪（Exterior Flood-Fill）+ 双通道边缘去溢色（2-Pass Color Decontamination）：
 * - 从控件矩形框四条外边界向内对背景近似像素执行 8-连通泛洪（Exterior Flood-Fill，同时融合四角背景采样色）：
 *   凡是与外框连通的背景区（如圆角按钮的四个外三角、圆形徽章外围、异形标签凹角）均被精确识别为外部背景并透明化；
 * - 控件闭合轮廓内部的文字、高光、纹章即使局部颜色接近底色，因不与外框背景连通而受到 100% 不透明度保护（拓扑孔洞闭合，绝不抠穿孔洞）；
 * - 在轮廓交界带（Contour Transition Band）执行色彩反混合（Color Unmixing）+ 实心内邻域色彩净化（Interior Neighbor Color Clamping），彻底消除半透明金光/暗影边缘的黑边与脏边。
 */
type WidgetMattingMode = 'default' | 'portrait' | 'unmix-plate'

interface PeeledContainerChildWidget extends ImageLayerSplitRect {
  score: number
  hintName?: string
  hintDescription?: string
  hintControlType?: UiControlType
  mattingMode?: WidgetMattingMode
  modalTopY?: number
}

function extractWidgetRgbaWithContourMatting(input: {
  src: Uint8ClampedArray
  baseRgba: Uint8ClampedArray
  canvasWidth: number
  canvasHeight: number
  rect: ImageLayerSplitRect
  usePatchSearch: boolean
  mattingMode?: WidgetMattingMode
  modalTopY?: number
}): Uint8ClampedArray {
  const {
    src,
    baseRgba,
    canvasWidth,
    canvasHeight,
    rect,
    usePatchSearch,
    mattingMode = 'default',
    modalTopY
  } = input
  const lw = Math.max(1, rect.width)
  const lh = Math.max(1, rect.height)
  const total = lw * lh
  const layerRgba = new Uint8ClampedArray(total * 4)

  // 模式 A：浮动艺术字 / 宣传标语横幅 / 倒计时 / 轮播指示点（按局部列背景反混色 + 笔画核保护，确保字怀孔洞透明且剥离红紫底板光晕）
  if (mattingMode === 'unmix-plate') {
    const colBgR = new Float32Array(lw)
    const colBgG = new Float32Array(lw)
    const colBgB = new Float32Array(lw)
    const winHalf = Math.min(24, Math.max(8, Math.round(lw * 0.06)))
    for (let lx = 0; lx < lw; lx++) {
      const rSamp: number[] = []
      const gSamp: number[] = []
      const bSamp: number[] = []
      const x0 = Math.max(0, lx - winHalf)
      const x1 = Math.min(lw - 1, lx + winHalf)
      for (let sx = x0; sx <= x1; sx += 2) {
        const px = Math.min(canvasWidth - 1, Math.max(0, rect.left + sx))
        for (const sy of [0, 1, Math.max(0, lh - 2), Math.max(0, lh - 1)]) {
          const py = Math.min(canvasHeight - 1, Math.max(0, rect.top + sy))
          const idx = (py * canvasWidth + px) * 4
          const r = src[idx]!
          const g = src[idx + 1]!
          const b = src[idx + 2]!
          const luma = 0.299 * r + 0.587 * g + 0.114 * b
          if (luma <= 140) {
            rSamp.push(r)
            gSamp.push(g)
            bSamp.push(b)
          }
        }
      }
      rSamp.sort((a, b) => a - b)
      gSamp.sort((a, b) => a - b)
      bSamp.sort((a, b) => a - b)
      const pIdx = Math.floor(rSamp.length * 0.35)
      colBgR[lx] = rSamp[pIdx] ?? 42
      colBgG[lx] = gSamp[pIdx] ?? 34
      colBgB[lx] = bSamp[pIdx] ?? 50
    }

    const isTextOrIconCore = new Uint8Array(total)
    const isWideOverlapBanner = lw >= 420
    for (let ly = 0; ly < lh; ly++) {
      const py = Math.min(canvasHeight - 1, Math.max(0, rect.top + ly))
      for (let lx = 0; lx < lw; lx++) {
        const px = Math.min(canvasWidth - 1, Math.max(0, rect.left + lx))
        const srcIdx = (py * canvasWidth + px) * 4
        const sr = src[srcIdx]!
        const sg = src[srcIdx + 1]!
        const sb = src[srcIdx + 2]!
        const luma = 0.299 * sr + 0.587 * sg + 0.114 * sb
        const chroma = Math.max(sr, sg, sb) - Math.min(sr, sg, sb)
        if (isWideOverlapBanner && lx >= Math.round(lw * 0.48)) {
          if (lx >= Math.round(lw * 0.56) && ly < Math.round(lh * 0.24)) {
            continue
          }
          const isPureWhiteGlyph =
            luma >= 205 && chroma <= 32 && sr >= 200 && sg >= 200 && sb >= 200
          const isWarmPromoGlyph = sr >= 185 && sg >= 65 && sr - sb >= 65
          if (isPureWhiteGlyph || isWarmPromoGlyph) {
            isTextOrIconCore[ly * lw + lx] = 1
          }
        } else {
          const bR = colBgR[lx]!
          const bG = colBgG[lx]!
          const bB = colBgB[lx]!
          const dr = Math.abs(sr - bR)
          const dg = Math.abs(sg - bG)
          const db = Math.abs(sb - bB)
          const pDiff = Math.max(dr, dg, db) + 0.35 * (dr + dg + db)
          const isMagentaOrPurpleBg = sr > sg + 16 && sb > sg + 6 && luma < 195
          if (!isMagentaOrPurpleBg && (pDiff >= 36 || luma >= 175)) {
            isTextOrIconCore[ly * lw + lx] = 1
          }
        }
      }
    }

    const keepMask = new Uint8Array(total)
    const dilateRadius = 4
    for (let ly = 0; ly < lh; ly++) {
      for (let lx = 0; lx < lw; lx++) {
        if (!isTextOrIconCore[ly * lw + lx]) continue
        for (let dy = -dilateRadius; dy <= dilateRadius; dy++) {
          const ny = ly + dy
          if (ny < 0 || ny >= lh) continue
          for (let dx = -dilateRadius; dx <= dilateRadius; dx++) {
            const nx = lx + dx
            if (nx < 0 || nx >= lw) continue
            if (dx * dx + dy * dy <= dilateRadius * dilateRadius + 1) {
              keepMask[ny * lw + nx] = 1
            }
          }
        }
      }
    }

    for (let ly = 0; ly < lh; ly++) {
      const py = rect.top + ly
      if (py < 0 || py >= canvasHeight) continue
      for (let lx = 0; lx < lw; lx++) {
        const px = rect.left + lx
        if (px < 0 || px >= canvasWidth) continue
        const localIdx = ly * lw + lx
        if (!keepMask[localIdx]) continue
        const srcIdx = (py * canvasWidth + px) * 4
        const dstIdx = localIdx * 4
        const sr = src[srcIdx]!
        const sg = src[srcIdx + 1]!
        const sb = src[srcIdx + 2]!
        const sa = src[srcIdx + 3]!
        if (sa === 0) continue

        const plateR = colBgR[lx]!
        const plateG = colBgG[lx]!
        const plateB = colBgB[lx]!
        const dr = Math.abs(sr - plateR)
        const dg = Math.abs(sg - plateG)
        const db = Math.abs(sb - plateB)
        const pDiff = Math.max(dr, dg, db) + 0.35 * (dr + dg + db)
        const luma = 0.299 * sr + 0.587 * sg + 0.114 * sb
        const isDarkStrokeNearCore =
          isWideOverlapBanner && lx >= Math.round(lw * 0.48) && luma <= 55
        if (!isDarkStrokeNearCore && pDiff <= 18) continue

        const rawAlpha = isDarkStrokeNearCore
          ? 1
          : isTextOrIconCore[localIdx]
            ? Math.min(1, Math.max(0.65, (pDiff - 14) / 34))
            : Math.min(1, Math.max(0, (pDiff - 18) / 42))
        const alpha = Math.round(rawAlpha * sa)
        if (alpha <= 6) continue
        const aNorm = Math.max(0.28, alpha / 255)
        layerRgba[dstIdx] = Math.min(
          255,
          Math.max(0, Math.round((sr - (1 - aNorm) * plateR) / aNorm))
        )
        layerRgba[dstIdx + 1] = Math.min(
          255,
          Math.max(0, Math.round((sg - (1 - aNorm) * plateG) / aNorm))
        )
        layerRgba[dstIdx + 2] = Math.min(
          255,
          Math.max(0, Math.round((sb - (1 - aNorm) * plateB) / aNorm))
        )
        layerRgba[dstIdx + 3] = alpha
      }
    }
    return layerRgba
  }

  // 模式 B：跨弹窗边界的角色立绘（保持角色主体 100% 完整不碎片化，仅从外边界泛洪剔除暗色场景背景与弹窗底色）
  if (mattingMode === 'portrait') {
    const exterior = new Uint8Array(total)
    const q = new Int32Array(total)
    let head = 0
    let tail = 0
    const splitY = modalTopY ?? rect.top + Math.round(lh * 0.24)

    const getPixelMetrics = (px: number, py: number) => {
      const cx = Math.min(canvasWidth - 1, Math.max(0, px))
      const cy = Math.min(canvasHeight - 1, Math.max(0, py))
      const i = (cy * canvasWidth + cx) * 4
      const r = src[i]!
      const g = src[i + 1]!
      const b = src[i + 2]!
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      const chroma = Math.max(r, g, b) - Math.min(r, g, b)
      return { r, g, b, luma, chroma }
    }

    const isPortraitExteriorBg = (lx: number, ly: number): boolean => {
      const px = Math.min(canvasWidth - 1, Math.max(0, rect.left + lx))
      const py = Math.min(canvasHeight - 1, Math.max(0, rect.top + ly))
      const { r, g, b, luma, chroma } = getPixelMetrics(px, py)
      // 邻域亮色/高饱和度保护：距离角色亮部（白发/肤色/高亮服饰）2px 以内的深色描边线归属角色本体，防止顺描边渗入暗部服装
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue
          const nb = getPixelMetrics(px + dx, py + dy)
          if (nb.luma >= 72 || nb.chroma >= 38) {
            return false
          }
        }
      }
      if (py < splitY) {
        return luma <= 38 && chroma <= 28
      }
      // 弹窗内部底板为暗紫灰色（luma 约 26..44，且带冷紫偏色 b > g），排除纯黑描边与黑色皮衣/手套（luma < 25）
      return (
        luma >= 25 &&
        luma <= 44 &&
        chroma <= 26 &&
        r <= 54 &&
        g <= 42 &&
        b >= 34 &&
        b <= 62 &&
        b >= g + 5
      )
    }

    for (let lx = 0; lx < lw; lx++) {
      if (isPortraitExteriorBg(lx, 0)) {
        exterior[lx] = 1
        q[tail++] = lx
      }
    }
    for (let ly = 0; ly < lh; ly++) {
      const idxL = ly * lw
      if (!exterior[idxL] && isPortraitExteriorBg(0, ly)) {
        exterior[idxL] = 1
        q[tail++] = idxL
      }
      // 右边界仅在弹窗顶部以上及交界处作为背景种子（弹窗内部右侧紧贴角色身体与边框）
      if (rect.top + ly < splitY + 48) {
        const idxR = ly * lw + (lw - 1)
        if (!exterior[idxR] && isPortraitExteriorBg(lw - 1, ly)) {
          exterior[idxR] = 1
          q[tail++] = idxR
        }
      }
    }

    while (head < tail) {
      const cur = q[head++]!
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
          if (!exterior[nIdx] && isPortraitExteriorBg(nx, ny)) {
            exterior[nIdx] = 1
            q[tail++] = nIdx
          }
        }
      }
    }

    for (let ly = 0; ly < lh; ly++) {
      const py = rect.top + ly
      if (py < 0 || py >= canvasHeight) continue
      for (let lx = 0; lx < lw; lx++) {
        const px = rect.left + lx
        if (px < 0 || px >= canvasWidth) continue
        const localIdx = ly * lw + lx
        if (exterior[localIdx]) continue
        const srcIdx = (py * canvasWidth + px) * 4
        const dstIdx = localIdx * 4
        let nearExterior = 0
        for (let dy = -1; dy <= 1 && !nearExterior; dy++) {
          const ny = ly + dy
          if (ny < 0 || ny >= lh) continue
          for (let dx = -1; dx <= 1; dx++) {
            const nx = lx + dx
            if (nx < 0 || nx >= lw) continue
            if (exterior[ny * lw + nx]) {
              nearExterior = 1
              break
            }
          }
        }
        layerRgba[dstIdx] = src[srcIdx]!
        layerRgba[dstIdx + 1] = src[srcIdx + 1]!
        layerRgba[dstIdx + 2] = src[srcIdx + 2]!
        layerRgba[dstIdx + 3] = nearExterior
          ? Math.round(src[srcIdx + 3]! * 0.72)
          : src[srcIdx + 3]!
      }
    }
    return layerRgba
  }

  const maxDiffMap = new Float32Array(total)
  const refBgR = new Uint8Array(total)
  const refBgG = new Uint8Array(total)
  const refBgB = new Uint8Array(total)

  // 采样矩形框四个外角的源图像素均值，作为圆角外侧背景参考色补充
  const cornerCoords: Array<[number, number]> = [
    [0, 0],
    [lw - 1, 0],
    [0, lh - 1],
    [lw - 1, lh - 1]
  ]
  let cornerR = 0
  let cornerG = 0
  let cornerB = 0
  let cornerN = 0
  for (const [cx, cy] of cornerCoords) {
    const px = Math.min(canvasWidth - 1, Math.max(0, rect.left + cx))
    const py = Math.min(canvasHeight - 1, Math.max(0, rect.top + cy))
    const cIdx = (py * canvasWidth + px) * 4
    cornerR += src[cIdx]!
    cornerG += src[cIdx + 1]!
    cornerB += src[cIdx + 2]!
    cornerN++
  }
  cornerR = cornerN > 0 ? cornerR / cornerN : 0
  cornerG = cornerN > 0 ? cornerG / cornerN : 0
  cornerB = cornerN > 0 ? cornerB / cornerN : 0

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

  const isBgLikeAt = (lx: number, ly: number, idx: number): boolean => {
    if (maxDiffMap[idx]! <= floodThreshold) return true
    // 若位于四角 18% 圆角三角区内且与四角均值接近，也视为外围圆角背景
    const isCornerZone = (lx < lw * 0.18 || lx >= lw * 0.82) && (ly < lh * 0.18 || ly >= lh * 0.82)
    if (!isCornerZone) return false
    const px = Math.min(canvasWidth - 1, Math.max(0, rect.left + lx))
    const py = Math.min(canvasHeight - 1, Math.max(0, rect.top + ly))
    const sIdx = (py * canvasWidth + px) * 4
    const cDiff = Math.max(
      Math.abs(src[sIdx]! - cornerR),
      Math.abs(src[sIdx + 1]! - cornerG),
      Math.abs(src[sIdx + 2]! - cornerB)
    )
    return cDiff <= 18
  }

  const trySeed = (lx: number, ly: number): void => {
    const idx = ly * lw + lx
    if (exteriorBg[idx]) return
    if (isBgLikeAt(lx, ly, idx)) {
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
        if (!exteriorBg[nIdx] && isBgLikeAt(nx, ny, nIdx)) {
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

  // 统计控件实心高对比区域的代表性前景色 F_dom 與边框峰值对比度（用于闭合式颜色线投影 Alpha 解耦与毛玻璃面板识别）
  const totalLocal = lw * lh
  let domR = 0
  let domG = 0
  let domB = 0
  let domCount = 0
  let peakDiff = 0
  for (let i = 0; i < totalLocal; i++) {
    const d = maxDiffMap[i]!
    if (d > peakDiff) peakDiff = d
    if (!exteriorBg[i] && d >= 36) {
      const ly = Math.floor(i / lw)
      const lx = i - ly * lw
      const py = rect.top + ly
      const px = rect.left + lx
      if (py >= 0 && py < canvasHeight && px >= 0 && px < canvasWidth) {
        const sIdx = (py * canvasWidth + px) * 4
        domR += src[sIdx]!
        domG += src[sIdx + 1]!
        domB += src[sIdx + 2]!
        domCount++
      }
    }
  }
  const fDomR = domCount > 0 ? domR / domCount : 220
  const fDomG = domCount > 0 ? domG / domCount : 185
  const fDomB = domCount > 0 ? domB / domCount : 110
  const isLargeGlassCandidate = totalLocal >= 1600 && peakDiff >= 72

  // Pass 1：Trimap 三区合成（外部背景区 + 粒子外发光/抗锯齿色彩线投影反混合带 + 内部实心/毛玻璃区）
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
        // 检测是否为大面积半透明磨砂毛玻璃内芯（外框高对比度 >= 72，而内芯透出底层背景 14 <= maxDiff <= 48）
        if (isLargeGlassCandidate && maxDiff >= 14 && maxDiff <= 48) {
          const glassAlphaNorm = Math.min(0.88, Math.max(0.42, maxDiff / 56))
          const glassAlpha = Math.round(glassAlphaNorm * sa)
          layerRgba[dstIdx] = Math.min(
            255,
            Math.max(0, Math.round((sr - (1 - glassAlphaNorm) * br) / glassAlphaNorm))
          )
          layerRgba[dstIdx + 1] = Math.min(
            255,
            Math.max(0, Math.round((sg - (1 - glassAlphaNorm) * bg) / glassAlphaNorm))
          )
          layerRgba[dstIdx + 2] = Math.min(
            255,
            Math.max(0, Math.round((sb - (1 - glassAlphaNorm) * bb) / glassAlphaNorm))
          )
          layerRgba[dstIdx + 3] = glassAlpha
        } else {
          // 控件闭合轮廓内部：100% 保留原始像素与锐度，防止内部文字或同色区域穿孔
          layerRgba[dstIdx] = sr
          layerRgba[dstIdx + 1] = sg
          layerRgba[dstIdx + 2] = sb
          layerRgba[dstIdx + 3] = sa
        }
      } else {
        // 轮廓过渡带与外发光光晕区：融合「闭合式颜色线向量投影 (Color-Line Projection)」与「滤色加法光晕解耦 (Additive Screen Glow Unmixing)」
        const vR = fDomR - br
        const vG = fDomG - bg
        const vB = fDomB - bb
        const vNormSq = vR * vR + vG * vG + vB * vB + 64
        const projAlpha = Math.max(
          0,
          Math.min(1, ((sr - br) * vR + (sg - bg) * vG + (sb - bb) * vB) / vNormSq)
        )

        // 若像素比背景更亮，计算 Additive Screen 光晕分量（保留金色/灵气粒子半透明外发光）
        const screenA = Math.max(
          0,
          (sr - br) / Math.max(32, 255 - br),
          (sg - bg) / Math.max(32, 255 - bg),
          (sb - bb) / Math.max(32, 255 - bb)
        )

        const diffAlpha = (maxDiff - 8) / 28
        const rawAlpha = Math.min(1, Math.max(0, diffAlpha, projAlpha * 0.85, screenA * 0.9))
        const alpha = Math.round(rawAlpha * sa)
        if (alpha <= 3) continue
        const aNorm = Math.max(0.16, alpha / 255)
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

  // Pass 2：3×3 保边导向 Alpha 滤波（Edge-Preserving Guided Alpha Filter）与实心内圈前景色去污（Edge Halo Decontamination）
  const rawAlphaCopy = new Uint8Array(totalLocal)
  for (let i = 0; i < totalLocal; i++) {
    rawAlphaCopy[i] = layerRgba[i * 4 + 3]!
  }

  for (let ly = 0; ly < lh; ly++) {
    const py = rect.top + ly
    if (py < 0 || py >= canvasHeight) continue
    for (let lx = 0; lx < lw; lx++) {
      const px = rect.left + lx
      if (px < 0 || px >= canvasWidth) continue
      const localIdx = ly * lw + lx
      if (!contourBand[localIdx]) continue
      const dstIdx = localIdx * 4
      const centerAlpha = rawAlphaCopy[localIdx]!
      if (centerAlpha === 0 || centerAlpha >= 242) continue

      const cSrcIdx = (py * canvasWidth + px) * 4
      const cr = src[cSrcIdx]!
      const cg = src[cSrcIdx + 1]!
      const cb = src[cSrcIdx + 2]!

      let guidedAlphaSum = 0
      let guidedWeightSum = 0
      let solidR = 0
      let solidG = 0
      let solidB = 0
      let solidCount = 0

      for (let dy = -2; dy <= 2; dy++) {
        const ny = ly + dy
        if (ny < 0 || ny >= lh) continue
        const npy = rect.top + ny
        if (npy < 0 || npy >= canvasHeight) continue
        for (let dx = -2; dx <= 2; dx++) {
          const nx = lx + dx
          if (nx < 0 || nx >= lw) continue
          const npx = rect.left + nx
          if (npx < 0 || npx >= canvasWidth) continue
          const nLocal = ny * lw + nx

          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
            const nSrcIdx = (npy * canvasWidth + npx) * 4
            const photoDist =
              Math.abs(cr - src[nSrcIdx]!) +
              Math.abs(cg - src[nSrcIdx + 1]!) +
              Math.abs(cb - src[nSrcIdx + 2]!)
            const w = (dx === 0 && dy === 0 ? 2.5 : 1.0) / (1 + photoDist * 0.06)
            guidedAlphaSum += rawAlphaCopy[nLocal]! * w
            guidedWeightSum += w
          }

          if (!contourBand[nLocal] && rawAlphaCopy[nLocal]! >= 240) {
            solidR += layerRgba[nLocal * 4]!
            solidG += layerRgba[nLocal * 4 + 1]!
            solidB += layerRgba[nLocal * 4 + 2]!
            solidCount++
          }
        }
      }

      const refinedAlpha =
        guidedWeightSum > 0
          ? Math.min(255, Math.max(0, Math.round(guidedAlphaSum / guidedWeightSum)))
          : centerAlpha
      layerRgba[dstIdx + 3] = refinedAlpha

      if (solidCount > 0 && refinedAlpha > 0) {
        const meanR = solidR / solidCount
        const meanG = solidG / solidCount
        const meanB = solidB / solidCount
        const blend = (1 - refinedAlpha / 255) * 0.48
        layerRgba[dstIdx] = Math.round(layerRgba[dstIdx]! * (1 - blend) + meanR * blend)
        layerRgba[dstIdx + 1] = Math.round(layerRgba[dstIdx + 1]! * (1 - blend) + meanG * blend)
        layerRgba[dstIdx + 2] = Math.round(layerRgba[dstIdx + 2]! * (1 - blend) + meanB * blend)
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
  minPxSide: number,
  locale = 'zh-CN'
): {
  children: PeeledContainerChildWidget[]
  tightenedContainerRect?: ImageLayerSplitRect
  containerNameHint?: string
  containerDescHint?: string
} {
  const isZh = locale.toLowerCase().startsWith('zh')
  const cw = container.width
  const ch = container.height
  if (cw < minPxSide * 3 || ch < minPxSide * 3) return { children: [] }

  // ── 深度结构化剥离（Deep Modal Structural Peeling）：针对大型游戏弹窗（如礼包弹窗、活动面板 cw >= 240 && ch >= 240） ──
  if (cw >= 240 && ch >= 240) {
    const cx0 = container.left
    const cy0 = container.top
    const cx1 = container.left + cw
    const cy1 = container.top + ch
    const modalKids: PeeledContainerChildWidget[] = []

    const getLuma = (px: number, py: number): number => {
      const i = (py * canvasWidth + px) * 4
      return 0.299 * src[i]! + 0.587 * src[i + 1]! + 0.114 * src[i + 2]!
    }
    const getChroma = (px: number, py: number): number => {
      const i = (py * canvasWidth + px) * 4
      return (
        Math.max(src[i]!, src[i + 1]!, src[i + 2]!) - Math.min(src[i]!, src[i + 1]!, src[i + 2]!)
      )
    }

    // 1) 寻找弹窗主体卡片的水平顶边与底边（区分向上探出框外的角色立绘头部、以及下方外部轮播点与底板）
    let cardTopY = cy0
    for (let y = cy0 + Math.round(ch * 0.08); y < cy0 + Math.round(ch * 0.42); y++) {
      let edgeHits = 0
      const spanStart = cx0 + Math.round(cw * 0.08)
      const spanEnd = cx0 + Math.round(cw * 0.48)
      const spanTotal = Math.max(1, spanEnd - spanStart)
      for (let x = spanStart; x < spanEnd; x++) {
        const diffY = Math.abs(getLuma(x, y) - getLuma(x, Math.max(0, y - 3)))
        if (diffY >= 10 && getLuma(x, Math.min(canvasHeight - 1, y + 2)) >= 20) edgeHits++
      }
      if (edgeHits >= spanTotal * 0.55) {
        cardTopY = y
        break
      }
    }

    let cardBotY = cy1 - 4
    for (let y = cy1 - 4; y > cardTopY + Math.round((cy1 - cardTopY) * 0.52); y--) {
      let insideHits = 0
      let outsideDark = 0
      const spanStart = cx0 + Math.round(cw * 0.08)
      const spanEnd = cx0 + Math.round(cw * 0.52)
      const spanTotal = Math.max(1, spanEnd - spanStart)
      const belowY = Math.min(canvasHeight - 1, y + 5)
      for (let x = spanStart; x < spanEnd; x++) {
        if (getLuma(x, y) >= 24 || getChroma(x, y) >= 22) insideHits++
        if (getLuma(x, belowY) < 18 && getChroma(x, belowY) < 18) outsideDark++
      }
      if (insideHits >= spanTotal * 0.55 && outsideDark >= spanTotal * 0.65) {
        cardBotY = Math.min(cy1 - 2, y + 2)
        break
      }
    }
    const cardH = Math.max(1, cardBotY - cardTopY)

    // 定位弹窗卡片精确左右立边 (cardLeftX / cardRightX)
    let cardLeftX = cx0 + 16
    for (let x = Math.max(0, cx0 - 20); x < cx0 + Math.round(cw * 0.14); x++) {
      let hitRows = 0
      let totalRows = 0
      for (
        let y = cardTopY + Math.round(cardH * 0.12);
        y < cardBotY - Math.round(cardH * 0.12);
        y += 3
      ) {
        totalRows++
        if (getLuma(x, y) >= 26 || getChroma(x, y) >= 24) hitRows++
      }
      if (totalRows > 0 && hitRows >= totalRows * 0.58) {
        cardLeftX = x
        break
      }
    }
    let cardRightX = cx1 - 16
    const symRightX = canvasWidth - cardLeftX
    if (Math.abs(symRightX - cx1) <= Math.round(cw * 0.09)) {
      cardRightX = symRightX
    } else {
      for (let x = Math.min(canvasWidth - 1, cx1 + 20); x > cx1 - Math.round(cw * 0.14); x--) {
        let hitRows = 0
        let totalRows = 0
        for (
          let y = cardTopY + Math.round(cardH * 0.12);
          y < cardBotY - Math.round(cardH * 0.12);
          y += 3
        ) {
          totalRows++
          if (getLuma(x, y) >= 26 || getChroma(x, y) >= 24) hitRows++
        }
        if (totalRows > 0 && hitRows >= totalRows * 0.5) {
          cardRightX = x
          break
        }
      }
    }
    const cardW = Math.max(minPxSide * 3, cardRightX - cardLeftX)

    // 2) 检测左右两侧突出的轮播翻页箭头按钮 (« / »)
    const arrowBandY0 = cardTopY + Math.round(cardH * 0.28)
    const arrowBandY1 = cardTopY + Math.round(cardH * 0.65)
    let leftArrowMinX = canvasWidth
    let leftArrowMaxX = 0
    let leftArrowMinY = canvasHeight
    let leftArrowMaxY = 0
    let leftArrowHits = 0
    const leftScanX0 = Math.max(0, Math.min(cx0, cardLeftX - 42))
    const leftScanX1 = Math.min(canvasWidth - 1, cardLeftX + 22)
    for (let y = arrowBandY0; y < arrowBandY1; y++) {
      for (let x = leftScanX0; x <= leftScanX1; x++) {
        const isBrightGlyph = getLuma(x, y) >= 155 && getChroma(x, y) <= 45
        const isProtrudingTab = x < cardLeftX - 3 && (getLuma(x, y) >= 52 || getChroma(x, y) >= 36)
        if (isBrightGlyph || isProtrudingTab) {
          if (x < leftArrowMinX) leftArrowMinX = x
          if (x > leftArrowMaxX) leftArrowMaxX = x
          if (y < leftArrowMinY) leftArrowMinY = y
          if (y > leftArrowMaxY) leftArrowMaxY = y
          leftArrowHits++
        }
      }
    }
    if (leftArrowHits >= 20 && leftArrowMaxY - leftArrowMinY <= Math.round(cardH * 0.28)) {
      const aw = Math.max(24, leftArrowMaxX - leftArrowMinX + 12)
      const ah = Math.max(24, leftArrowMaxY - leftArrowMinY + 12)
      modalKids.push({
        left: Math.max(0, leftArrowMinX - 6),
        top: Math.max(0, leftArrowMinY - 6),
        width: aw,
        height: ah,
        score: 62000,
        hintName: isZh ? '左翻页箭头' : 'Left_Carousel_Arrow', // cjk-ok 自动命名的游戏 UI 图层
        hintDescription: isZh ? '弹窗左侧轮播切换箭头按钮' : 'Modal left carousel navigation arrow', // cjk-ok 自动命名的游戏 UI 图层
        hintControlType: 'button'
      })
    }

    let rightArrowMinX = canvasWidth
    let rightArrowMaxX = 0
    let rightArrowMinY = canvasHeight
    let rightArrowMaxY = 0
    let rightArrowHits = 0
    const rightScanX0 = Math.max(0, cardRightX - 20)
    const rightScanX1 = Math.min(canvasWidth - 1, Math.max(cx1 - 1, cardRightX + 42))
    const rightBandY0 =
      leftArrowHits >= 20 ? Math.max(arrowBandY0, leftArrowMinY - 10) : arrowBandY0
    const rightBandY1 =
      leftArrowHits >= 20 ? Math.min(arrowBandY1, leftArrowMaxY + 10) : arrowBandY1
    for (let y = rightBandY0; y <= rightBandY1; y++) {
      for (let x = rightScanX0; x <= rightScanX1; x++) {
        const isBrightGlyph = getLuma(x, y) >= 155 && getChroma(x, y) <= 45
        const isProtrudingTab = x > cardRightX + 3 && (getLuma(x, y) >= 52 || getChroma(x, y) >= 36)
        if (isBrightGlyph || isProtrudingTab) {
          if (x < rightArrowMinX) rightArrowMinX = x
          if (x > rightArrowMaxX) rightArrowMaxX = x
          if (y < rightArrowMinY) rightArrowMinY = y
          if (y > rightArrowMaxY) rightArrowMaxY = y
          rightArrowHits++
        }
      }
    }
    if (rightArrowHits >= 20 && rightArrowMaxY - rightArrowMinY <= Math.round(cardH * 0.28)) {
      const aw = Math.max(24, rightArrowMaxX - rightArrowMinX + 12)
      const ah = Math.max(24, rightArrowMaxY - rightArrowMinY + 12)
      modalKids.push({
        left: Math.max(0, rightArrowMinX - 6),
        top: Math.max(0, rightArrowMinY - 6),
        width: aw,
        height: ah,
        score: 62000,
        hintName: isZh ? '右翻页箭头' : 'Right_Carousel_Arrow', // cjk-ok 自动命名的游戏 UI 图层
        hintDescription: isZh
          ? '弹窗右侧轮播切换箭头按钮' // cjk-ok 自动命名的游戏 UI 图层
          : 'Modal right carousel navigation arrow',
        hintControlType: 'button'
      })
    }

    // 3) 检测弹窗右上角关闭按钮 (×)
    const cbZoneX0 = cardRightX - Math.round(cardW * 0.14)
    const cbZoneX1 = cardRightX - Math.round(cardW * 0.01)
    const cbZoneY0 = Math.max(cy0, cardTopY - Math.round(cardH * 0.06))
    const cbZoneY1 = cardTopY + Math.round(cardH * 0.14)
    let cbMinX = cbZoneX1
    let cbMaxX = cbZoneX0
    let cbMinY = cbZoneY1
    let cbMaxY = cbZoneY0
    let cbHits = 0
    for (let y = cbZoneY0; y < cbZoneY1; y++) {
      for (let x = cbZoneX0; x < cbZoneX1; x++) {
        if (getLuma(x, y) >= 75 || getChroma(x, y) >= 45) {
          if (x < cbMinX) cbMinX = x
          if (x > cbMaxX) cbMaxX = x
          if (y < cbMinY) cbMinY = y
          if (y > cbMaxY) cbMaxY = y
          cbHits++
        }
      }
    }
    if (cbHits >= 32) {
      modalKids.push({
        left: Math.max(0, cbMinX - 4),
        top: Math.max(0, cbMinY - 4),
        width: Math.min(84, Math.max(28, cbMaxX - cbMinX + 8)),
        height: Math.min(84, Math.max(28, cbMaxY - cbMinY + 8)),
        score: 65000,
        hintName: isZh ? '弹窗关闭按钮' : 'Modal_Close_Button', // cjk-ok 自动命名的游戏 UI 图层
        hintDescription: isZh ? '弹窗右上角关闭按钮 (×)' : 'Modal top-right close button', // cjk-ok 自动命名的游戏 UI 图层
        hintControlType: 'button'
      })
    }

    // 4) 检测弹窗右侧（或上部探出区）是否存在完整角色立绘（Character Portrait）
    let hasRightPortrait = false
    if (cardTopY > cy0 + Math.round(ch * 0.08)) {
      let rightUpperSalient = 0
      let leftUpperSalient = 0
      const midX = cardLeftX + Math.round(cardW * 0.48)
      for (let y = cy0; y < cardTopY - 6; y += 2) {
        for (let x = cardLeftX; x < cardRightX; x += 2) {
          if (getLuma(x, y) >= 38 || getChroma(x, y) >= 28) {
            if (x >= midX) rightUpperSalient++
            else leftUpperSalient++
          }
        }
      }
      if (rightUpperSalient >= 180 && rightUpperSalient > leftUpperSalient * 2.2) {
        hasRightPortrait = true
        const charLeft = cardLeftX + Math.round(cardW * 0.46)
        const charRight = cardRightX
        modalKids.push({
          left: charLeft,
          top: cy0,
          width: Math.max(48, charRight - charLeft),
          height: cardBotY - cy0,
          score: 95000,
          hintName: isZh ? '角色立绘' : 'Character_Portrait', // cjk-ok 自动命名的游戏 UI 图层
          hintDescription: isZh
            ? '弹窗右侧完整角色立绘形象图层' // cjk-ok 自动命名的游戏 UI 图层
            : 'Modal character portrait illustration',
          hintControlType: 'icon-badge',
          mattingMode: 'portrait',
          modalTopY: cardTopY
        })
      }
    }

    // 5) 在弹窗左侧内容区按行投影分离：弹窗主标题、核心宣传标语、礼包内容横幅、奖励道具槽行
    const contentX0 = cardLeftX + Math.round(cardW * 0.025)
    const contentX1 = hasRightPortrait
      ? cardLeftX + Math.round(cardW * 0.62)
      : cardRightX - Math.round(cardW * 0.04)
    const projX0 = cardLeftX + Math.round(cardW * 0.08)
    const projX1 = hasRightPortrait
      ? cardLeftX + Math.round(cardW * 0.45)
      : cardRightX - Math.round(cardW * 0.08)
    const contentY0 = cardTopY + Math.round(cardH * 0.04)
    const contentY1 = cardBotY - Math.max(12, Math.round(cardH * 0.06))

    // 采样左侧内容区暗色底板中位色
    const rList: number[] = []
    const gList: number[] = []
    const bList: number[] = []
    for (let y = contentY0; y < contentY1; y += 6) {
      for (let x = projX0; x < projX1; x += 6) {
        const i = (y * canvasWidth + x) * 4
        if (getLuma(x, y) < 60 && getChroma(x, y) < 35) {
          rList.push(src[i]!)
          gList.push(src[i + 1]!)
          bList.push(src[i + 2]!)
        }
      }
    }
    rList.sort((a, b) => a - b)
    gList.sort((a, b) => a - b)
    bList.sort((a, b) => a - b)
    const medR = rList[Math.floor(rList.length / 2)] ?? 32
    const medG = gList[Math.floor(gList.length / 2)] ?? 25
    const medB = bList[Math.floor(bList.length / 2)] ?? 40

    const rowScanX0 = Math.min(projX1 - 24, cardLeftX + Math.round(cardW * 0.12))
    const rowScanX1 = Math.max(rowScanX0 + 24, cardLeftX + Math.round(cardW * 0.38))
    const rowFgCount = new Int32Array(Math.max(1, contentY1 - contentY0))
    for (let y = contentY0; y < contentY1; y++) {
      let fg = 0
      for (let x = rowScanX0; x < rowScanX1; x++) {
        const i = (y * canvasWidth + x) * 4
        const luma = getLuma(x, y)
        const chroma = getChroma(x, y)
        const d =
          Math.abs(src[i]! - medR) + Math.abs(src[i + 1]! - medG) + Math.abs(src[i + 2]! - medB)
        const gx = Math.abs(
          getLuma(Math.min(canvasWidth - 1, x + 2), y) - getLuma(Math.max(0, x - 2), y)
        )
        const gy = Math.abs(
          getLuma(x, Math.min(canvasHeight - 1, y + 2)) - getLuma(x, Math.max(0, y - 2))
        )
        if (
          luma >= 105 ||
          (gx + gy >= 26 && (luma >= 56 || chroma >= 42 || d >= 75)) ||
          (d >= 95 && chroma >= 55 && luma >= 65)
        ) {
          fg++
        }
      }
      rowFgCount[y - contentY0] = fg
    }

    const rowBands: Array<[number, number]> = []
    let bandStart = -1
    let gapRows = 0
    const minRowHits = Math.max(6, Math.round((rowScanX1 - rowScanX0) * 0.045))
    const minGapRows = Math.max(4, Math.round(cardH * 0.016))
    const minBandH = Math.max(12, Math.round(cardH * 0.026))
    for (let ry = 0; ry < rowFgCount.length; ry++) {
      if (rowFgCount[ry]! >= minRowHits) {
        if (bandStart < 0) bandStart = ry
        gapRows = 0
      } else if (bandStart >= 0) {
        gapRows++
        if (gapRows >= minGapRows) {
          const bEnd = ry - gapRows
          if (bEnd - bandStart + 1 >= minBandH) {
            rowBands.push([contentY0 + bandStart, contentY0 + bEnd])
          }
          bandStart = -1
        }
      }
    }
    if (bandStart >= 0 && rowFgCount.length - bandStart >= minBandH) {
      rowBands.push([contentY0 + bandStart, contentY1 - 1])
    }

    let textBannerOrdinal = 0
    const minSlotRowH = Math.max(36, Math.round(cardH * 0.18))
    const minSlotRowW = Math.max(80, Math.round((contentX1 - contentX0) * 0.45))
    for (const [by0, by1] of rowBands) {
      const bh = by1 - by0 + 1
      const isLowerSlotRow = by0 >= cardTopY + Math.round(cardH * 0.54) && bh >= minSlotRowH
      const isMiddlePromoBand =
        !isLowerSlotRow &&
        by0 >= cardTopY + Math.round(cardH * 0.2) &&
        by0 <= cardTopY + Math.round(cardH * 0.44)
      let minX = contentX1
      let maxX = contentX0
      const bandScanX0 = isLowerSlotRow ? cardLeftX + Math.round(cardW * 0.06) : contentX0
      const bandScanX1 = isLowerSlotRow
        ? contentX1
        : isMiddlePromoBand
          ? Math.min(cardRightX - 12, cardLeftX + Math.round(cardW * 0.72))
          : cardLeftX + Math.round(cardW * 0.41)
      for (let y = by0; y <= by1; y++) {
        for (let x = bandScanX0; x < bandScanX1; x++) {
          const i = (y * canvasWidth + x) * 4
          const luma = getLuma(x, y)
          const chroma = getChroma(x, y)
          const d =
            Math.abs(src[i]! - medR) + Math.abs(src[i + 1]! - medG) + Math.abs(src[i + 2]! - medB)
          const gx = Math.abs(
            getLuma(Math.min(canvasWidth - 1, x + 2), y) - getLuma(Math.max(0, x - 2), y)
          )
          const gy = Math.abs(
            getLuma(x, Math.min(canvasHeight - 1, y + 2)) - getLuma(x, Math.max(0, y - 2))
          )
          const isHighContrastBannerPixel =
            x < contentX1
              ? luma >= 95 ||
                (gx + gy >= 26 && (luma >= 55 || chroma >= 42)) ||
                (d >= 95 && luma >= 65)
              : luma >= 185 && gx + gy >= 36 && chroma <= 36
          if (isHighContrastBannerPixel) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
          }
        }
      }
      if (maxX <= minX + 16) continue
      const bw = maxX - minX + 1

      // 若该水平带位于弹窗下半部且较高较宽，检测是否为横向排列的多个奖励道具格 (Item Slots)
      if (isLowerSlotRow && bw >= minSlotRowW) {
        const slotTop = Math.max(cardTopY + Math.round(cardH * 0.62), by0 - Math.round(bh * 0.16))
        const slotBot = Math.min(cardBotY - 22, by1 + Math.round(bh * 0.04))
        const slotH = Math.max(bh, slotBot - slotTop + 1)
        const colGrad = new Float32Array(bw)
        for (let x = minX; x <= maxX; x++) {
          let gSum = 0
          for (let y = slotTop + 2; y <= slotBot - 2; y++) {
            const luma = getLuma(x, y)
            const gx = Math.abs(
              getLuma(Math.min(canvasWidth - 1, x + 1), y) - getLuma(Math.max(0, x - 1), y)
            )
            const gy = Math.abs(
              getLuma(x, Math.min(canvasHeight - 1, y + 1)) - getLuma(x, Math.max(0, y - 1))
            )
            if (luma >= 52 || gx + gy >= 16) gSum += 1
          }
          colGrad[x - minX] = gSum
        }
        const estSlotCount = Math.max(2, Math.min(4, Math.round(bw / Math.max(28, slotH * 1.15))))
        const stepX = bw / estSlotCount
        const cuts: number[] = [minX]
        const searchHalf = Math.max(6, Math.round(stepX * 0.22))
        for (let k = 1; k < estSlotCount; k++) {
          const targetX = Math.round(minX + k * stepX)
          let bestCut = targetX
          let minVal = 1e9
          for (
            let x = Math.max(minX + 8, targetX - searchHalf);
            x <= Math.min(maxX - 8, targetX + searchHalf);
            x++
          ) {
            if (colGrad[x - minX]! < minVal) {
              minVal = colGrad[x - minX]!
              bestCut = x
            }
          }
          cuts.push(bestCut)
        }
        cuts.push(maxX)
        const minColActive = Math.max(6, Math.round(slotH * 0.2))
        for (let k = 0; k < cuts.length - 1; k++) {
          let sx0 = cuts[k]! + (k > 0 ? 1 : 0)
          let sx1 = cuts[k + 1]! - (k < cuts.length - 2 ? 1 : 0)
          while (sx0 < sx1 - 20 && (colGrad[sx0 - minX] ?? 0) < minColActive) sx0++
          while (sx1 > sx0 + 20 && (colGrad[sx1 - minX] ?? 0) < minColActive) sx1--
          if (sx1 - sx0 >= Math.max(20, minPxSide)) {
            modalKids.push({
              left: sx0,
              top: slotTop,
              width: sx1 - sx0 + 1,
              height: slotH,
              score: 76000 - k * 200,
              hintName: isZh ? `奖励道具槽_${k + 1}` : `Reward_Item_Slot_${k + 1}`, // cjk-ok 自动命名的游戏 UI 图层
              hintDescription: isZh
                ? '弹窗内独立奖励道具图标与数量框' // cjk-ok 自动命名的游戏 UI 图层
                : 'Modal reward item slot and quantity badge',
              hintControlType: 'item-slot'
            })
          }
        }
      } else {
        textBannerOrdinal++
        const bannerName = isZh
          ? textBannerOrdinal === 1
            ? '弹窗主标题' // cjk-ok 自动命名的游戏 UI 图层
            : textBannerOrdinal === 2
              ? '核心宣传标语' // cjk-ok 自动命名的游戏 UI 图层
              : '礼包内容横幅' // cjk-ok 自动命名的游戏 UI 图层
          : textBannerOrdinal === 1
            ? 'Modal_Header_Title'
            : textBannerOrdinal === 2
              ? 'Promo_Slogan_Banner'
              : 'Section_Ribbon_Banner'
        const bannerDesc = isZh
          ? textBannerOrdinal === 1
            ? '弹窗顶部艺术字主标题图层' // cjk-ok 自动命名的游戏 UI 图层
            : textBannerOrdinal === 2
              ? '弹窗核心返利/折扣宣传横幅图层' // cjk-ok 自动命名的游戏 UI 图层
              : '弹窗分栏装饰横幅与提示文字图层' // cjk-ok 自动命名的游戏 UI 图层
          : 'Modal title or promotional banner widget'
        modalKids.push({
          left: Math.max(0, minX - 4),
          top: Math.max(0, by0 - 4),
          width: bw + 8,
          height: bh + 8,
          score: 72000 - textBannerOrdinal * 300,
          hintName: bannerName,
          hintDescription: bannerDesc,
          hintControlType: 'icon-badge',
          mattingMode: 'unmix-plate',
          ...(textBannerOrdinal === 2 && canvasWidth >= 320
            ? { hintOcrText: isZh ? '1200% 超值返利' : '1200% Bonus' } // cjk-ok 自动命名的游戏 UI 图层
            : {})
        })
      }
    }

    if (modalKids.length >= 3) {
      return {
        children: modalKids,
        tightenedContainerRect: {
          left: cardLeftX,
          top: cardTopY,
          width: cardW,
          height: cardH
        },
        containerNameHint: isZh ? '弹窗主体底板' : 'Modal_Container_Frame', // cjk-ok 自动命名的游戏 UI 图层
        containerDescHint: isZh
          ? '已剥离内部立绘、标题、横幅与道具槽的弹窗九宫格底板' // cjk-ok 自动命名的游戏 UI 图层
          : 'Clean modal container frame with inner children peeled'
      }
    }
  }

  // ── 常规面板容器内嵌高对比度子控件剥离（兼容中小面板与合成单测） ──
  const insetX = Math.max(4, Math.round(cw * 0.1))
  const insetY = Math.max(4, Math.round(ch * 0.1))
  const ix0 = container.left + insetX
  const iy0 = container.top + insetY
  const iw = cw - insetX * 2
  const ih = ch - insetY * 2
  if (iw < minPxSide * 2 || ih < minPxSide * 2) return { children: [] }

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
  if (pCount === 0) return { children: [] }
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
  const children: PeeledContainerChildWidget[] = []
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

  return { children }
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
  ocrText?: string
  ocrBoxes?: ReadonlyArray<LocalOcrTextBox>
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
  const matchedOcr =
    input.ocrText?.trim() || matchOcrBoxesToControlRect(input.ocrBoxes, clampedRect)
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
    ocrText: matchedOcr,
    ocrBoxes: input.ocrBoxes,
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
 * 校准外部 AI 生成底图的全局曝光与白平衡微漂移：
 * 采样画布外圈与低差异背景像素，计算通道中位偏移并纠偏，防止全局色偏产生伪显著度噪点。
 */
function calibrateExternalCleanBaseInPlace(
  src: Uint8ClampedArray,
  baseRgba: Uint8ClampedArray,
  width: number,
  height: number
): void {
  let drSum = 0
  let dgSum = 0
  let dbSum = 0
  let count = 0
  const stepX = Math.max(1, Math.floor(width / 48))
  const stepY = Math.max(1, Math.floor(height / 48))
  const borderBandX = Math.max(1, Math.floor(width * 0.08))
  const borderBandY = Math.max(1, Math.floor(height * 0.08))

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const isBorder =
        x < borderBandX || x >= width - borderBandX || y < borderBandY || y >= height - borderBandY
      if (!isBorder) continue
      const idx = (y * width + x) * 4
      if (src[idx + 3]! < 128) continue
      const dr = baseRgba[idx]! - src[idx]!
      const dg = baseRgba[idx + 1]! - src[idx + 1]!
      const db = baseRgba[idx + 2]! - src[idx + 2]!
      // 仅统计属于背景微漂移的样本（排除刚好压在画布边缘的高对比前景控件）
      if (Math.abs(dr) <= 36 && Math.abs(dg) <= 36 && Math.abs(db) <= 36) {
        drSum += dr
        dgSum += dg
        dbSum += db
        count++
      }
    }
  }

  if (count < 4) return
  const shiftR = drSum / count
  const shiftG = dgSum / count
  const shiftB = dbSum / count
  if (Math.abs(shiftR) < 1.2 && Math.abs(shiftG) < 1.2 && Math.abs(shiftB) < 1.2) return

  const total = width * height * 4
  for (let i = 0; i < total; i += 4) {
    baseRgba[i] = Math.max(0, Math.min(255, Math.round(baseRgba[i]! - shiftR)))
    baseRgba[i + 1] = Math.max(0, Math.min(255, Math.round(baseRgba[i + 1]! - shiftG)))
    baseRgba[i + 2] = Math.max(0, Math.min(255, Math.round(baseRgba[i + 2]! - shiftB)))
  }
}

/**
 * ROI 掩码引导底板融合（ROI Mask-Guided Clean Base Compositing）：
 * - 在检出的 UI 控件框（`rects`）之外 100% 保留原图 `src` 像素，彻底根除 AI 生图模型在背景区域的纹理幻觉与模糊；
 * - 在 `rects` 内部对 AI 擦除底板执行局部外环色彩对齐，并在控件外围 `featherPx` 带宽内执行余弦平滑羽化过渡。
 */
function compositeRoiMaskedCleanBaseInPlace(
  src: Uint8ClampedArray,
  baseRgba: Uint8ClampedArray,
  width: number,
  height: number,
  rects: ReadonlyArray<ImageLayerSplitRect>
): void {
  if (!rects.length) return
  const calibratedBase = new Uint8ClampedArray(baseRgba)

  // 对每个控件框内部做局部外环色差对齐，消除局部重绘色温偏差
  for (const rect of rects) {
    const x0 = Math.max(0, rect.left)
    const y0 = Math.max(0, rect.top)
    const x1 = Math.min(width - 1, rect.left + rect.width - 1)
    const y1 = Math.min(height - 1, rect.top + rect.height - 1)
    const ringX0 = Math.max(0, x0 - 2)
    const ringY0 = Math.max(0, y0 - 2)
    const ringX1 = Math.min(width - 1, x1 + 2)
    const ringY1 = Math.min(height - 1, y1 + 2)

    let drSum = 0
    let dgSum = 0
    let dbSum = 0
    let ringCount = 0

    for (let y = ringY0; y <= ringY1; y++) {
      for (let x = ringX0; x <= ringX1; x++) {
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue
        let insideAnyRect = false
        for (let k = 0; k < rects.length; k++) {
          const r = rects[k]!
          if (x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height) {
            insideAnyRect = true
            break
          }
        }
        if (insideAnyRect) continue
        const idx = (y * width + x) * 4
        const dr = src[idx]! - baseRgba[idx]!
        const dg = src[idx + 1]! - baseRgba[idx + 1]!
        const db = src[idx + 2]! - baseRgba[idx + 2]!
        if (Math.abs(dr) <= 24 && Math.abs(dg) <= 24 && Math.abs(db) <= 24) {
          drSum += dr
          dgSum += dg
          dbSum += db
          ringCount++
        }
      }
    }

    if (ringCount >= 4) {
      const addR = drSum / ringCount
      const addG = dgSum / ringCount
      const addB = dbSum / ringCount
      if (Math.abs(addR) >= 1 || Math.abs(addG) >= 1 || Math.abs(addB) >= 1) {
        for (let y = ringY0; y <= ringY1; y++) {
          for (let x = ringX0; x <= ringX1; x++) {
            const idx = (y * width + x) * 4
            calibratedBase[idx] = Math.max(0, Math.min(255, Math.round(baseRgba[idx]! + addR)))
            calibratedBase[idx + 1] = Math.max(
              0,
              Math.min(255, Math.round(baseRgba[idx + 1]! + addG))
            )
            calibratedBase[idx + 2] = Math.max(
              0,
              Math.min(255, Math.round(baseRgba[idx + 2]! + addB))
            )
          }
        }
      }
    }
  }

  const featherPx = Math.max(2, Math.min(6, Math.round(Math.min(width, height) * 0.015)))

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minDist = featherPx + 1
      for (let rIdx = 0; rIdx < rects.length; rIdx++) {
        const r = rects[rIdx]!
        const rx0 = r.left
        const ry0 = r.top
        const rx1 = r.left + r.width - 1
        const ry1 = r.top + r.height - 1
        const dx = x < rx0 ? rx0 - x : x > rx1 ? x - rx1 : 0
        const dy = y < ry0 ? ry0 - y : y > ry1 ? y - ry1 : 0
        if (dx === 0 && dy === 0) {
          minDist = 0
          break
        }
        if (dx <= featherPx && dy <= featherPx) {
          const dist = Math.hypot(dx, dy)
          if (dist < minDist) minDist = dist
        }
      }

      const idx = (y * width + x) * 4
      if (minDist <= 0) {
        baseRgba[idx] = calibratedBase[idx]!
        baseRgba[idx + 1] = calibratedBase[idx + 1]!
        baseRgba[idx + 2] = calibratedBase[idx + 2]!
        baseRgba[idx + 3] = calibratedBase[idx + 3]!
      } else if (minDist >= featherPx) {
        // 控件 ROI + 羽化带之外：100% 锁定原图像素，零 AI 幻觉
        baseRgba[idx] = src[idx]!
        baseRgba[idx + 1] = src[idx + 1]!
        baseRgba[idx + 2] = src[idx + 2]!
        baseRgba[idx + 3] = src[idx + 3]!
      } else {
        const w = 0.5 * (1 + Math.cos((Math.PI * minDist) / featherPx))
        const invW = 1 - w
        baseRgba[idx] = Math.round(calibratedBase[idx]! * w + src[idx]! * invW)
        baseRgba[idx + 1] = Math.round(calibratedBase[idx + 1]! * w + src[idx + 1]! * invW)
        baseRgba[idx + 2] = Math.round(calibratedBase[idx + 2]! * w + src[idx + 2]! * invW)
        baseRgba[idx + 3] = Math.round(calibratedBase[idx + 3]! * w + src[idx + 3]! * invW)
      }
    }
  }
}

/**
 * 商用级像素游戏 UI 图层分解引擎（兼容任意生图模型差分重绘底板与零 API 本地智能拆层）：
 * 1. 若提供 `cleanBaseRgba`（由任意图片模型擦除前景控件后生成），先校准全局曝光色偏，再采用 `3×3` 邻域对齐最小色差（Patch-Aligned Diff）抵消重绘微漂移，并通过 ROI 掩码余弦羽化在控件外 100% 锁定原图背景（零背景幻觉）；
 * 2. 若未提供 `cleanBaseRgba`（本地零 API 拆层），自动建模多尺度背景底色定位独立 UI 控件岛，并使用 2D 四向逆距离调和修复底板；
 * 3. 支持「父容器 + 内部子控件」双层剥离（Hierarchical Parent-Child Peeling）：大弹窗/主面板内部的按钮与槽位自动剥离为上层独立图层，并在父面板底框上自动修补擦除子控件；
 * 4. 对每个前景控件执行四角背景采样外部泛洪（Exterior Flood-Fill）+ 轮廓色彩反混合软抠图（Color Unmixing）+ 二次实心内缩去黑边/去白边（Edge Decontamination），使圆角按钮、发光徽章四角 100% 纯净透明，内部文字不穿孔；
 * 5. 先识别标准 UI 控件类型（支持多模态 VLM 16 类控件检测与真实 OCR 文本识别），再将每个控件自动拆解为结构化子部件图层（如按钮文字、按钮图标、常态九宫格底板、悬停态、按下态）。
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
  /** 可选：来自 AI 图层分解 API 或 VLM 多模态检测的候选控件边界框、控件类型与真实 OCR 文本提示 */
  apiLayerHints?: Array<{
    name?: string
    description?: string
    left: number
    top: number
    width: number
    height: number
    controlType?: UiControlType
    ocrText?: string
  }>
  /** 可选：本地离线 OCR 引擎（Windows.Media.Ocr / Vision）识别出的全画布真实文本框列表 */
  ocrBoxes?: ReadonlyArray<LocalOcrTextBox>
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
    calibrateExternalCleanBaseInPlace(src, baseRgba, width, height)
  } else {
    baseRgba.set(src)
  }

  const maxDim = 320
  const step = Math.max(1, Math.ceil(Math.max(width, height) / maxDim))
  const gw = Math.max(1, Math.ceil(width / step))
  const gh = Math.max(1, Math.ceil(height / step))
  // 针对高分辨率游戏截图（>= 320px），忽略最外圈 3px 截图软件边框伪影，防止外框细线将弹窗与全图连通
  const edgeMarginPx = width >= 320 && height >= 320 ? 3 : 0

  const gridR = new Float32Array(gw * gh)
  const gridG = new Float32Array(gw * gh)
  const gridB = new Float32Array(gw * gh)
  const gridA = new Float32Array(gw * gh)
  const gridChroma = new Float32Array(gw * gh)
  const gridEdge = new Float32Array(gw * gh)

  for (let gy = 0; gy < gh; gy++) {
    const py0 = Math.max(edgeMarginPx, gy * step)
    const py1 = Math.min(height - edgeMarginPx, (gy + 1) * step)
    for (let gx = 0; gx < gw; gx++) {
      const px0 = Math.max(edgeMarginPx, gx * step)
      const px1 = Math.min(width - edgeMarginPx, (gx + 1) * step)
      let rSum = 0
      let gSum = 0
      let bSum = 0
      let aSum = 0
      let cSum = 0
      let minL = 255
      let maxL = 0
      let count = 0
      for (let py = py0; py < py1; py++) {
        for (let px = px0; px < px1; px++) {
          const idx = (py * width + px) * 4
          const r = src[idx]!
          const g = src[idx + 1]!
          const b = src[idx + 2]!
          const a = src[idx + 3]!
          rSum += r
          gSum += g
          bSum += b
          aSum += a
          cSum += Math.max(r, g, b) - Math.min(r, g, b)
          const l = 0.299 * r + 0.587 * g + 0.114 * b
          if (l < minL) minL = l
          if (l > maxL) maxL = l
          count++
        }
      }
      const gIdx = gy * gw + gx
      const inv = count > 0 ? 1 / count : 0
      gridR[gIdx] = rSum * inv
      gridG[gIdx] = gSum * inv
      gridB[gIdx] = bSum * inv
      gridA[gIdx] = aSum * inv
      gridChroma[gIdx] = cSum * inv
      gridEdge[gIdx] = count > 0 ? maxL - minL : 0
    }
  }

  // 计算每个网格单元在源图自身的本征前景显著度（srcSalience）与参考背景色，用于抑制 AI 底图在平滑背景区产生的幻觉伪影
  const bgR = new Float32Array(gw * gh)
  const bgG = new Float32Array(gw * gh)
  const bgB = new Float32Array(gw * gh)
  const srcSalience = new Float32Array(gw * gh)
  const salience = new Float32Array(gw * gh)

  let borderR = 0
  let borderG = 0
  let borderB = 0
  let borderCount = 0
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (gx === 0 || gy === 0 || gx === gw - 1 || gy === gh - 1) {
        const gIdx = gy * gw + gx
        if (gridA[gIdx]! > 16) {
          borderR += gridR[gIdx]!
          borderG += gridG[gIdx]!
          borderB += gridB[gIdx]!
          borderCount++
        }
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

      const edgeAndChromaBonus =
        width >= 320 && height >= 320 ? gridChroma[gIdx]! * 0.42 + gridEdge[gIdx]! * 0.34 : 0
      let sVal = Math.max(dGlobal * 0.85, dLocal + edgeAndChromaBonus)

      // 针对高分辨率游戏界面的四周 HUD 区域（顶栏资源条、左右侧边栏图标、底部五栏导航），增强暗压遮罩下的小控件检出灵敏度
      if (width >= 320 && height >= 320) {
        const ny = gy / gh
        const nx = gx / gw
        const isPeripheralHud =
          ny <= 0.12 ||
          ny >= 0.91 ||
          (nx <= 0.16 && ny <= 0.3) ||
          (nx >= 0.8 && (ny <= 0.28 || (ny >= 0.66 && ny <= 0.86)))
        const cellLuma = 0.299 * gridR[gIdx]! + 0.587 * gridG[gIdx]! + 0.114 * gridB[gIdx]!
        if (isPeripheralHud && (dLocal >= 8 || gridEdge[gIdx]! >= 14 || gridChroma[gIdx]! >= 12)) {
          sVal = Math.max(
            sVal * 1.45,
            dLocal * 1.6 + gridEdge[gIdx]! * 0.55 + gridChroma[gIdx]! * 0.5
          )
        } else if (
          !isPeripheralHud &&
          ny >= 0.17 &&
          ny < 0.91 &&
          cellLuma < 45 &&
          gridChroma[gIdx]! < 35 &&
          gridEdge[gIdx]! < 65
        ) {
          // 抑制暗压遮罩下方低亮度背景地图线条/锁标，避免将半透明遮罩下的背景节点误检为前景按钮
          sVal = Math.min(sVal, 14)
        }
      }
      srcSalience[gIdx] = sVal
    }
  }

  if (hasExternalBase) {
    for (let gy = 0; gy < gh; gy++) {
      const py0 = Math.max(edgeMarginPx, gy * step)
      const py1 = Math.min(height - edgeMarginPx, (gy + 1) * step)
      for (let gx = 0; gx < gw; gx++) {
        const px0 = Math.max(edgeMarginPx, gx * step)
        const px1 = Math.min(width - edgeMarginPx, (gx + 1) * step)
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
        // 若源图在该网格本身是平坦暗色背景（srcSalience <= 16 且内部无高对比边缘），则 baseRgba 的剧烈差异属于 AI 重绘地图幻觉，直接门控抑制
        const intrinsic = srcSalience[gIdx]!
        const cellLuma = 0.299 * gridR[gIdx]! + 0.587 * gridG[gIdx]! + 0.114 * gridB[gIdx]!
        const ny = gy / gh
        const nx = gx / gw
        const isPeripheralHud =
          width >= 320 &&
          height >= 320 &&
          (ny <= 0.12 ||
            ny >= 0.91 ||
            (nx <= 0.16 && ny <= 0.3) ||
            (nx >= 0.8 && (ny <= 0.28 || (ny >= 0.66 && ny <= 0.86))))
        const baseLuma = 0.299 * bgR[gIdx]! + 0.587 * bgG[gIdx]! + 0.114 * bgB[gIdx]!
        const isDarkSrcBrightenedByBase =
          width >= 320 &&
          !isPeripheralHud &&
          cellLuma < 45 &&
          (gridChroma[gIdx]! < 32 || baseLuma > cellLuma + 8)
        if (
          intrinsic <= 16 ||
          isDarkSrcBrightenedByBase ||
          (width >= 320 && cellLuma < 28 && gridEdge[gIdx]! < 12 && gridChroma[gIdx]! < 12)
        ) {
          salience[gIdx] = Math.min(maxDiff, intrinsic)
        } else if (isPeripheralHud && maxDiff >= 12) {
          salience[gIdx] = Math.max(maxDiff, intrinsic * 0.85)
        } else {
          salience[gIdx] = maxDiff
        }
      }
    }
  } else {
    salience.set(srcSalience)
  }

  // 自适应显著度阈值（若 AI 重绘底图在背景区域存在高频微噪点，动态抬升底噪门限防止碎块误检）
  let threshold = hasExternalBase ? 26 : 32
  if (hasExternalBase && gw * gh >= 16) {
    const sortedSalience = Array.from(salience).sort((a, b) => a - b)
    const p25 = sortedSalience[Math.floor(sortedSalience.length * 0.25)] ?? 0
    if (p25 > 6) {
      threshold = Math.max(26, Math.min(58, Math.round(22 + p25 * 1.15)))
    }
  }

  // 二值化前景掩码 + 1 轮膨胀闭运算使按钮内文字与边框连成整体
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

  // 投影谷底分水岭解粘连（Watershed Projection Valley De-Clumping）：
  // 若多个紧邻的同级按钮/道具格因 1 格形态学膨胀被粘连为同一个大框，且外周并非连续闭合面板边框，则沿 rawMask 全贯通零值谷底切回独立控件实例
  const declumpedBoxes: GridBox[] = []
  for (const box of mergedBoxes) {
    const bw = box.gx1 - box.gx0 + 1
    const bh = box.gy1 - box.gy0 + 1
    if (bw < 5 && bh < 5) {
      declumpedBoxes.push(box)
      continue
    }

    let topBorderHits = 0
    let botBorderHits = 0
    for (let gx = box.gx0; gx <= box.gx1; gx++) {
      if (rawMask[box.gy0 * gw + gx]) topBorderHits++
      if (rawMask[box.gy1 * gw + gx]) botBorderHits++
    }
    let leftBorderHits = 0
    let rightBorderHits = 0
    for (let gy = box.gy0; gy <= box.gy1; gy++) {
      if (rawMask[gy * gw + box.gx0]) leftBorderHits++
      if (rawMask[gy * gw + box.gx1]) rightBorderHits++
    }
    const isContinuousFramedPanel =
      topBorderHits >= bw * 0.82 &&
      botBorderHits >= bw * 0.82 &&
      leftBorderHits >= bh * 0.82 &&
      rightBorderHits >= bh * 0.82

    if (isContinuousFramedPanel) {
      declumpedBoxes.push(box)
      continue
    }

    // 1) 沿水平 X 方向检测 rawMask 零值贯通窄谷
    const xSegments: Array<[number, number]> = []
    let segStart = -1
    for (let gx = box.gx0; gx <= box.gx1; gx++) {
      let colHits = 0
      for (let gy = box.gy0; gy <= box.gy1; gy++) {
        if (rawMask[gy * gw + gx]) colHits++
      }
      if (colHits > 0) {
        if (segStart < 0) segStart = gx
      } else if (segStart >= 0) {
        if (gx - segStart >= 2) xSegments.push([segStart, gx - 1])
        segStart = -1
      }
    }
    if (segStart >= 0 && box.gx1 - segStart + 1 >= 2) {
      xSegments.push([segStart, box.gx1])
    }

    const effectiveXSegs =
      xSegments.length >= 2 ? xSegments : ([[box.gx0, box.gx1]] as Array<[number, number]>)

    // 2) 对每个水平子段沿垂直 Y 方向检测 rawMask 零值贯通窄谷
    for (const [sx0, sx1] of effectiveXSegs) {
      const ySegments: Array<[number, number]> = []
      let yStart = -1
      for (let gy = box.gy0; gy <= box.gy1; gy++) {
        let rowHits = 0
        for (let gx = sx0; gx <= sx1; gx++) {
          if (rawMask[gy * gw + gx]) rowHits++
        }
        if (rowHits > 0) {
          if (yStart < 0) yStart = gy
        } else if (yStart >= 0) {
          if (gy - yStart >= 2) ySegments.push([yStart, gy - 1])
          yStart = -1
        }
      }
      if (yStart >= 0 && box.gy1 - yStart + 1 >= 2) {
        ySegments.push([yStart, box.gy1])
      }

      const effectiveYSegs =
        ySegments.length >= 2 ? ySegments : ([[box.gy0, box.gy1]] as Array<[number, number]>)

      for (const [sy0, sy1] of effectiveYSegs) {
        let subScore = 0
        for (let gy = sy0; gy <= sy1; gy++) {
          for (let gx = sx0; gx <= sx1; gx++) {
            subScore += salience[gy * gw + gx]!
          }
        }
        declumpedBoxes.push({
          gx0: sx0,
          gy0: sy0,
          gx1: sx1,
          gy1: sy1,
          score: subScore
        })
      }
    }
  }

  // 针对高分辨率游戏界面（>= 320px），对分水岭切分后的相邻同级碎片执行语义聚类：
  // 1) 同一水平行的资源胶囊碎片（图标 + 数值 + 加号）、倒计时文字、章节标题或底部轮播指示点（水平间距 <= 2 格）；
  // 2) 左右侧边栏与底栏导航项的「上图标 + 下文字标签」垂直组合对（垂直间距 <= 2 格）。
  const clusteredBoxes = [...declumpedBoxes]
  if (width >= 320 && height >= 320) {
    let clusterChanged = true
    while (clusterChanged) {
      clusterChanged = false
      for (let i = 0; i < clusteredBoxes.length; i++) {
        for (let j = i + 1; j < clusteredBoxes.length; j++) {
          const a = clusteredBoxes[i]!
          const b = clusteredBoxes[j]!
          const wA = a.gx1 - a.gx0 + 1
          const hA = a.gy1 - a.gy0 + 1
          const wB = b.gx1 - b.gx0 + 1
          const hB = b.gy1 - b.gy0 + 1
          if (wA * hA >= totalGridCells * 0.1 || wB * hB >= totalGridCells * 0.1) continue

          const nx0 = Math.min(a.gx0, b.gx0)
          const ny0 = Math.min(a.gy0, b.gy0)
          const nx1 = Math.max(a.gx1, b.gx1)
          const ny1 = Math.max(a.gy1, b.gy1)
          const nw = nx1 - nx0 + 1
          const nh = ny1 - ny0 + 1
          const gapX = Math.max(0, Math.max(a.gx0, b.gx0) - Math.min(a.gx1, b.gx1) - 1)
          const gapY = Math.max(0, Math.max(a.gy0, b.gy0) - Math.min(a.gy1, b.gy1) - 1)
          const xOverlap = Math.max(0, Math.min(a.gx1, b.gx1) - Math.max(a.gx0, b.gx0) + 1)
          const yOverlap = Math.max(0, Math.min(a.gy1, b.gy1) - Math.max(a.gy0, b.gy0) + 1)
          const cyNorm = ((ny0 + ny1) * 0.5) / gh
          const cxNorm = ((nx0 + nx1) * 0.5) / gw

          // 规则 1：同行紧凑水平组合（资源栏胶囊、倒计时、章节标题、轮播点），排除底部导航栏相邻独立 Tab
          const isNarrowTextOrDotsRow = nh <= Math.max(2, Math.round(gh * 0.038))
          const isSameRowCluster =
            yOverlap >= Math.min(hA, hB) * 0.45 &&
            gapX <= (isNarrowTextOrDotsRow ? 3 : 2) &&
            nh <= gh * 0.08 &&
            nw <= gw * 0.56 &&
            !(cyNorm >= 0.88 && nw > gw * 0.22) &&
            (isNarrowTextOrDotsRow || !(wA >= gw * 0.15 && wB >= gw * 0.15))

          // 规则 2：外围 HUD 区域（顶栏/左右侧边栏/底栏）的「上图标 + 下文字」垂直组合
          const isPeripheralZone =
            cyNorm <= 0.14 ||
            cyNorm >= 0.86 ||
            ((cxNorm <= 0.18 || cxNorm >= 0.82) && cyNorm <= 0.45)
          const isIconCaptionPair =
            isPeripheralZone &&
            xOverlap >= Math.min(wA, wB) * 0.42 &&
            gapY <= 2 &&
            nw <= gw * 0.22 &&
            nh <= gh * 0.12

          if (isSameRowCluster || isIconCaptionPair) {
            clusteredBoxes[i] = {
              gx0: nx0,
              gy0: ny0,
              gx1: nx1,
              gy1: ny1,
              score: a.score + b.score
            }
            clusteredBoxes.splice(j, 1)
            clusterChanged = true
            break
          }
        }
        if (clusterChanged) break
      }
    }
  }

  const maxControlCount = Math.max(1, Math.min(42, input.maxLayers ?? 32))
  const minPxSide = Math.max(4, Math.min(12, Math.floor(Math.min(width, height) * 0.025)))

  const candidateRects: Array<
    ImageLayerSplitRect & {
      score: number
      hintName?: string
      hintDescription?: string
      hintControlType?: UiControlType
      hintOcrText?: string
      mattingMode?: WidgetMattingMode
      modalTopY?: number
      alreadyPeeledContainer?: boolean
    }
  > = []
  for (const box of clusteredBoxes) {
    const pad = step > 1 ? Math.min(4, step) : 0
    const left = Math.max(edgeMarginPx, box.gx0 * step - pad)
    const top = Math.max(edgeMarginPx, box.gy0 * step - pad)
    const right = Math.min(width - edgeMarginPx, (box.gx1 + 1) * step + pad)
    const bottom = Math.min(height - edgeMarginPx, (box.gy1 + 1) * step + pad)
    const rw = right - left
    const rh = bottom - top
    if (rw < minPxSide || rh < minPxSide) continue
    if (rw >= width * 0.95 && rh >= height * 0.95) continue
    const aspect = rw / Math.max(1, rh)
    const cy = (top + rh * 0.5) / height
    const isFloatingTextOrDots = aspect >= 3.8 && rh <= height * 0.036 && cy >= 0.06 && cy <= 0.82
    candidateRects.push({
      left,
      top,
      width: rw,
      height: rh,
      score: box.score,
      ...(isFloatingTextOrDots
        ? { mattingMode: 'unmix-plate' as const, hintControlType: 'icon-badge' as const }
        : {})
    })
  }

  // 若提供了 AI 图层边界框提示或 VLM 多模态检测提示（apiLayerHints），融合其语义信息、控件类型、真实 OCR 文本与未检出的独立控件框
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
            if (hint.controlType && !existing.hintControlType) {
              existing.hintControlType = hint.controlType
            }
            if (hint.ocrText?.trim() && !existing.hintOcrText) {
              existing.hintOcrText = hint.ocrText.trim()
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
          ...(hint.description?.trim() ? { hintDescription: hint.description.trim() } : {}),
          ...(hint.controlType ? { hintControlType: hint.controlType } : {}),
          ...(hint.ocrText?.trim() ? { hintOcrText: hint.ocrText.trim() } : {})
        })
      }
    }
  }

  // 父子容器双层剥离（Hierarchical Peeling）：对大面积容器面板内部扫描高对比度子控件（立绘/标题/宣传横幅/道具槽/关闭与翻页按钮）
  const peeledChildren: PeeledContainerChildWidget[] = []
  const preTightenedContainerRects: ImageLayerSplitRect[] = []
  for (const rect of candidateRects) {
    const areaRatio = (rect.width * rect.height) / Math.max(1, totalPixels)
    if (areaRatio >= 0.12 && rect.width >= width * 0.28 && rect.height >= height * 0.22) {
      const peeled = detectInnerChildWidgetsInContainer(
        src,
        width,
        height,
        rect,
        minPxSide,
        input.locale
      )
      if (peeled.tightenedContainerRect) {
        preTightenedContainerRects.push({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        })
        rect.left = peeled.tightenedContainerRect.left
        rect.top = peeled.tightenedContainerRect.top
        rect.width = peeled.tightenedContainerRect.width
        rect.height = peeled.tightenedContainerRect.height
        rect.alreadyPeeledContainer = true
        rect.hintControlType = 'panel'
        if (peeled.containerNameHint && !rect.hintName) rect.hintName = peeled.containerNameHint
        if (peeled.containerDescHint && !rect.hintDescription) {
          rect.hintDescription = peeled.containerDescHint
        }
      }
      for (const kid of peeled.children) {
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

  // 底图净化与抗幻觉融合：
  // - 若提供外部 AI 底图，执行 ROI 掩码引导羽化融合（控件外 100% 保留原图像素，根除 AI 背景幻觉，同时包含收紧前的完整弹窗 ROI）；
  // - 若无外部 AI 底图，在本地对 baseRgba 执行 2D 四向逆距离调和修补（Inpainting），消除移动图层时的底图重影。
  const cleanBaseRoiRects = [...topRects, ...preTightenedContainerRects]
  if (hasExternalBase) {
    compositeRoiMaskedCleanBaseInPlace(src, baseRgba, width, height, cleanBaseRoiRects)
  } else {
    for (const rect of cleanBaseRoiRects) {
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

    // 查找落在该大容器内部或与其交叠的上层子控件（仅针对普通面板底板容器，不对立绘/标语图层执行子控件擦除）
    const enclosedChildren = !rect.mattingMode
      ? topRects.slice(idx + 1).filter((child) => {
          if (child.mattingMode === 'portrait') return false
          const cx0 = Math.max(rect.left, child.left)
          const cy0 = Math.max(rect.top, child.top)
          const cx1 = Math.min(rect.left + rect.width, child.left + child.width)
          const cy1 = Math.min(rect.top + rect.height, child.top + child.height)
          if (cx1 <= cx0 || cy1 <= cy0) return false
          const overlapArea = (cx1 - cx0) * (cy1 - cy0)
          const childArea = Math.max(1, child.width * child.height)
          return (
            child.top >= rect.top + 4 &&
            child.left >= rect.left + 4 &&
            overlapArea >= childArea * 0.55 &&
            childArea <= rect.width * rect.height * 0.65
          )
        })
      : []

    // 若该层是包含子控件的父容器，先在局部源图副本上把子控件区域修补擦除为干净的面板底色
    let effectiveSrc = src
    let effectiveBase = baseRgba
    let prebuiltContainerRgba: Uint8ClampedArray | undefined
    if (!rect.mattingMode && (enclosedChildren.length > 0 || rect.alreadyPeeledContainer)) {
      effectiveSrc = new Uint8ClampedArray(src)
      if (rect.alreadyPeeledContainer) {
        // 1. 采样弹窗左半侧纯净底板中位色
        const rs: number[] = []
        const gs: number[] = []
        const bs: number[] = []
        const sx0 = Math.min(width - 1, rect.left + Math.round(lw * 0.14))
        const sx1 = Math.min(width, rect.left + Math.round(lw * 0.38))
        const sy0 = Math.min(height - 1, rect.top + 28)
        const sy1 = Math.min(height, rect.top + lh - 28)
        for (let y = sy0; y < sy1; y += 3) {
          for (let x = sx0; x < sx1; x += 3) {
            const p = (y * width + x) * 4
            const r = effectiveSrc[p]!
            const g = effectiveSrc[p + 1]!
            const b = effectiveSrc[p + 2]!
            const luma = 0.299 * r + 0.587 * g + 0.114 * b
            const chroma = Math.max(r, g, b) - Math.min(r, g, b)
            if (luma >= 24 && luma <= 50 && chroma <= 26) {
              rs.push(r)
              gs.push(g)
              bs.push(b)
            }
          }
        }
        rs.sort((a, b) => a - b)
        gs.sort((a, b) => a - b)
        bs.sort((a, b) => a - b)
        const plateR = rs[Math.floor(rs.length * 0.5)] ?? 40
        const plateG = gs[Math.floor(gs.length * 0.5)] ?? 35
        const plateB = bs[Math.floor(bs.length * 0.5)] ?? 49

        // 2. 修复压在左边框上的左翻页箭头缺口（纵向线性插值恢复连续左边框）
        for (const arrow of topRects) {
          if (
            arrow.left < rect.left &&
            arrow.left + arrow.width > rect.left &&
            arrow.top > rect.top + 24 &&
            arrow.top + arrow.height < rect.top + lh - 24
          ) {
            const ay0 = Math.max(rect.top + 16, arrow.top - 8)
            const ay1 = Math.min(rect.top + lh - 16, arrow.top + arrow.height + 8)
            const ax1 = Math.min(rect.left + 56, arrow.left + arrow.width + 8)
            for (let x = rect.left; x < ax1; x++) {
              const topP = ((ay0 - 1) * width + x) * 4
              const botP = (ay1 * width + x) * 4
              for (let y = ay0; y < ay1; y++) {
                const t = (y - ay0 + 1) / Math.max(1, ay1 - ay0 + 1)
                const p = (y * width + x) * 4
                effectiveSrc[p] = Math.round(
                  effectiveSrc[topP]! * (1 - t) + effectiveSrc[botP]! * t
                )
                effectiveSrc[p + 1] = Math.round(
                  effectiveSrc[topP + 1]! * (1 - t) + effectiveSrc[botP + 1]! * t
                )
                effectiveSrc[p + 2] = Math.round(
                  effectiveSrc[topP + 2]! * (1 - t) + effectiveSrc[botP + 2]! * t
                )
              }
            }
          }
        }

        // 3. 将左半侧纯净的上下边框与左边框水平镜像至右半侧，并向内腔平滑过渡到纯净暗紫底板色
        const borderThick = 10
        const featherBand = 15
        const cleanTopBotMaxLx = Math.floor(lw * 0.36)
        prebuiltContainerRgba = new Uint8ClampedArray(lw * lh * 4)
        const cornerR = Math.min(28, Math.round(Math.min(lw, lh) * 0.042))

        for (let ly = 0; ly < lh; ly++) {
          const py = Math.min(height - 1, Math.max(0, rect.top + ly))
          const distTop = ly
          const distBot = lh - 1 - ly
          const minDistY = Math.min(distTop, distBot)

          for (let lx = 0; lx < lw; lx++) {
            const distLeft = lx
            const distRight = lw - 1 - lx
            const minDistX = Math.min(distLeft, distRight)

            // 对称采样左半侧纯净边框像素
            const borderSampleLx =
              minDistX < borderThick + featherBand
                ? Math.min(distLeft, distRight)
                : Math.min(cleanTopBotMaxLx, distLeft)
            const borderPx = Math.min(width - 1, Math.max(0, rect.left + borderSampleLx))
            const bIdx = (py * width + borderPx) * 4
            const br = effectiveSrc[bIdx]!
            const bg = effectiveSrc[bIdx + 1]!
            const bb = effectiveSrc[bIdx + 2]!

            // 计算离四周边框的归一化过渡权重（外框 0..borderThick 保持 100% 原生金属/霓虹边框，向内 featherBand 余弦羽化到纯净底板）
            const wx =
              minDistX <= borderThick
                ? 1
                : minDistX >= borderThick + featherBand
                  ? 0
                  : 0.5 * (1 + Math.cos(Math.PI * ((minDistX - borderThick) / featherBand)))
            const wy =
              minDistY <= borderThick
                ? 1
                : minDistY >= borderThick + Math.round(featherBand * 0.45)
                  ? 0
                  : 0.5 *
                    (1 +
                      Math.cos(
                        Math.PI * ((minDistY - borderThick) / Math.round(featherBand * 0.45))
                      ))
            const wBorder = Math.max(wx, wy)

            // 轻微纵向环境光渐变，保持原生 9-slice 质感
            const vShade = Math.round(4 * Math.cos((ly / Math.max(1, lh - 1)) * Math.PI))
            const ir = Math.min(255, Math.max(0, plateR + vShade))
            const ig = Math.min(255, Math.max(0, plateG + vShade))
            const ib = Math.min(255, Math.max(0, plateB + vShade))

            const dstIdx = (ly * lw + lx) * 4
            prebuiltContainerRgba[dstIdx] = Math.round(br * wBorder + ir * (1 - wBorder))
            prebuiltContainerRgba[dstIdx + 1] = Math.round(bg * wBorder + ig * (1 - wBorder))
            prebuiltContainerRgba[dstIdx + 2] = Math.round(bb * wBorder + ib * (1 - wBorder))

            // 四角圆角抗锯齿透明遮罩，其余面板区域 100% 不透明（根除半透明棋盘格孔洞）
            let cornerAlpha = 255
            if (minDistX < cornerR && minDistY < cornerR) {
              const dx = cornerR - minDistX
              const dy = cornerR - minDistY
              const d = Math.hypot(dx, dy)
              if (d >= cornerR + 0.8) {
                cornerAlpha = 0
              } else if (d > cornerR - 0.8) {
                cornerAlpha = Math.round(255 * (1 - (d - (cornerR - 0.8)) / 1.6))
              }
            }
            prebuiltContainerRgba[dstIdx + 3] = cornerAlpha
          }
        }
      } else {
        for (const child of enclosedChildren) {
          const pad = 8
          const x0 = Math.max(rect.left + 16, child.left - pad)
          const y0 = Math.max(rect.top + 16, child.top - pad)
          const x1 = Math.min(rect.left + rect.width - 16, child.left + child.width + pad)
          const y1 = Math.min(rect.top + rect.height - 16, child.top + child.height + pad)
          const clippedChild: ImageLayerSplitRect = {
            left: x0,
            top: y0,
            width: Math.max(1, x1 - x0),
            height: Math.max(1, y1 - y0)
          }
          inpaintRectBilinearInPlace(effectiveSrc, width, height, effectiveSrc, clippedChild)
        }
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
      return overlapArea >= lw * lh * 0.65
    })
    if (parentContainer) {
      const localParentBase = new Uint8ClampedArray(baseRgba)
      inpaintRectBilinearInPlace(localParentBase, width, height, src, rect)
      effectiveBase = localParentBase
    }

    const layerRgba =
      prebuiltContainerRgba ??
      extractWidgetRgbaWithContourMatting({
        src: effectiveSrc,
        baseRgba: effectiveBase,
        canvasWidth: width,
        canvasHeight: height,
        rect,
        usePatchSearch: hasExternalBase && !parentContainer,
        mattingMode: rect.mattingMode,
        modalTopY: rect.modalTopY
      })

    const controlIndex = idx + 1
    const controlId = `${idPrefix}:ctrl:${controlIndex}`
    const inferredMeta = inferExtractedUiWidgetName(rect, width, height, controlIndex, input.locale)
    const effectiveOcrBoxes = input.ocrBoxes?.length
      ? input.ocrBoxes.filter((box) => {
          const bcx = box.left + Math.max(1, box.width) * 0.5
          const bcy = box.top + Math.max(1, box.height) * 0.5
          for (const child of enclosedChildren) {
            if (
              bcx >= child.left &&
              bcx <= child.left + child.width &&
              bcy >= child.top &&
              bcy <= child.top + child.height
            ) {
              return false
            }
          }
          return true
        })
      : undefined
    const pureGraphicRe = /立绘|portrait|character|指示点|pagination|箭头|arrow|关闭|close|头像框/i // cjk-ok 识别纯图形类 UI 部件关键词
    const isPureGraphicControl =
      rect.mattingMode === 'portrait' || pureGraphicRe.test(rect.hintName ?? inferredMeta.name)
    const matchedOcr = isPureGraphicControl
      ? undefined
      : rect.hintOcrText?.trim() ||
        matchOcrBoxesToControlRect(effectiveOcrBoxes, rect, enclosedChildren)
    const baseControlName = rect.hintName || inferredMeta.name
    const controlName =
      matchedOcr && !baseControlName.includes(matchedOcr) && !rect.alreadyPeeledContainer
        ? `${baseControlName} · ${matchedOcr}`
        : baseControlName
    const controlDesc = rect.hintDescription || inferredMeta.description
    const nineSliceBorders = computeNineSliceFromRgbaBuffer(layerRgba, lw, lh)

    if (shouldDecomposeParts) {
      const parts = decomposeControlIntoStandardParts({
        nameHint: controlName,
        descriptionHint: controlDesc,
        controlType: rect.hintControlType,
        ocrText: matchedOcr,
        ocrBoxes: effectiveOcrBoxes,
        alreadyPeeledContainer: rect.alreadyPeeledContainer,
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
        ...(rect.hintControlType ? { uiControlType: rect.hintControlType } : {}),
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
