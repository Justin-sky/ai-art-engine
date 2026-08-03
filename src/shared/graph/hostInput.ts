import type { AssetType } from '../domain'
import { isAssetHostNode, isAssetRefInputHostType } from './nodeRole'
import {
  collectScreenplayTextRelativePaths,
  resolveAssetTextFromGenParams
} from './assetText'
import { getNodePorts } from './ports'
import type { GraphAddScope } from './scopes'
import { resolveNodeTextContent } from './textOutput'
import {
  stringifyWorldElementGenResults,
  type WorldElementGenResult
} from './worldElementParse'
import type {
  GraphCatalogKind,
  GraphDocument,
  GraphEdge,
  GraphNode,
  GraphNodeParams,
  GraphPersistedRunState,
  GraphPortDataType
} from './types'
import { GraphPortType, isGraphCatalogKind, isGraphPortDataType } from './types'
import type { GraphValue } from './execute/types'
import {
  boundaryInputNodeId,
  boundaryOutputNodeId,
  defaultHostInterfaceForAssetType,
  isBoundaryInputNode,
  isBoundaryOutputNode,
  resolveNodeHostInterface,
  type HostInterfaceDocument
} from './hostInterface'
import { catalogValue } from './catalogValue'
import {
  resolveShotParamsBindingImageItems,
  SHOT_PARAMS_IMAGES_PORT_ID,
  type ShotParamsBindingImage
} from './shotParams'

export const GRAPH_INPUT_SLOT_TYPE_ID = 'graph.input.slot' as const

export interface HostInputSlotBinding {
  /** 外层宿主入端口 id（in / in-text / in-image …） */
  portId: string
  /** 在该端口展开后的稳定下标（0-based） */
  index: number
  /** 槽位数据类型 */
  dataType: GraphPortDataType
}

export interface HostInputSlotSpec extends HostInputSlotBinding {
  /** 若父图已有运行结果或源节点正文，可带预览文本 */
  text?: string
  title?: string
  previewRelativePath?: string
  previewDataUrl?: string
}

export interface ResolveHostInputSlotsOptions {
  resolveAssetText?: (assetId: string) => string | undefined
  resolveAssetGenParams?: (assetId: string) => Record<string, unknown> | undefined
  /** 已打开的源资产内图（优先于落盘 genParams.graphJson） */
  resolveLiveAssetGraph?: (assetId: string) => GraphDocument | undefined
  /** 分镜参数绑定图：按 boundShotId 取 live storyboard */
  resolveShotStoryboard?: (boundShotId?: string) => {
    storyboard: import('../domain').ShotStoryboard
  } | null
  /** 分镜参数 out-images：全部镜头绑定图（不运行即可 soft 输出） */
  resolveAllShotBindingImages?: () => ShotParamsBindingImage[] | null
}

/** 稳定节点 id：再打开不换号、不乱序 */
export function hostInputSlotNodeId(portId: string, index: number): string {
  const safePort = portId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `graph-input-${safePort}-${index}`
}

export function readHostInputSlot(
  node: Pick<GraphNode, 'typeId' | 'params'>
): HostInputSlotBinding | null {
  if (node.typeId !== GRAPH_INPUT_SLOT_TYPE_ID) return null
  const raw = node.params.hostInputSlot
  if (!raw || typeof raw !== 'object') return null
  const portId = typeof raw.portId === 'string' ? raw.portId.trim() : ''
  const index = typeof raw.index === 'number' && Number.isFinite(raw.index) ? raw.index : -1
  const dataType = raw.dataType
  if (!portId || index < 0) return null
  // boundary proxy 端口可为任意合法类型（含 images / texts 等复数口）
  if (!isGraphPortDataType(dataType)) return null
  return { portId, index, dataType }
}

export function isHostInputSlotNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === GRAPH_INPUT_SLOT_TYPE_ID
}

/**
 * HDA 内图只保留 boundary 入/出口；剥离存量 classic `graph.input.slot` 及其连线。
 */
export function stripHostInputSlotNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  runStates?: Record<string, GraphPersistedRunState>
): { nodes: GraphNode[]; edges: GraphEdge[]; runStates?: Record<string, GraphPersistedRunState> } {
  const removed = new Set(nodes.filter((n) => isHostInputSlotNode(n)).map((n) => n.id))
  if (!removed.size) return { nodes, edges, runStates }
  const nextNodes = nodes.filter((n) => !removed.has(n.id))
  const nextEdges = edges.filter((e) => !removed.has(e.source) && !removed.has(e.target))
  let nextStates = runStates
  if (runStates) {
    nextStates = { ...runStates }
    for (const id of removed) delete nextStates[id]
  }
  return { nodes: nextNodes, edges: nextEdges, runStates: nextStates }
}

/** 宿主资产类型 → 外层入端口列表（统一自 hostInterface 默认模板） */
export function listHostInputPortDefs(assetType: AssetType): Array<{
  id: string
  dataType: GraphPortDataType
}> {
  if (!isAssetRefInputHostType(assetType)) return []
  return defaultHostInterfaceForAssetType(assetType).inputs.map((port) => ({
    id: port.id,
    dataType: port.dataType
  }))
}

/**
 * 打开即同步「输入接口」的宿主资产编辑器 scope。
 * HDA 统一后宿主内图改用 boundary proxy，不再自动插入 graph.input.slot。
 */
export function isHostInputSlotEditorScope(_scope: GraphAddScope): boolean {
  return false
}

/** 通用保底：每个宿主入端口至少 1 个空槽（index=0） */
export function defaultHostInputSlots(
  assetType: string | null | undefined
): HostInputSlotSpec[] {
  if (!isAssetRefInputHostType(assetType)) return []
  return listHostInputPortDefs(assetType).map((port) => ({
    portId: port.id,
    index: 0,
    dataType: port.dataType
  }))
}

/**
 * 按端口合并：父图有展开则用父图槽；否则保留该端口保底 1 槽。
 * 端口顺序以 listHostInputPortDefs 为准。
 */
export function mergeHostInputSlotsWithDefaults(
  assetType: string | null | undefined,
  fromParent: HostInputSlotSpec[]
): HostInputSlotSpec[] {
  const defaults = defaultHostInputSlots(assetType)
  if (!defaults.length) return []
  if (!fromParent.length) return defaults

  const byPort = new Map<string, HostInputSlotSpec[]>()
  for (const slot of fromParent) {
    const list = byPort.get(slot.portId) ?? []
    list.push(slot)
    byPort.set(slot.portId, list)
  }

  const result: HostInputSlotSpec[] = []
  for (const def of defaults) {
    const parentSlots = byPort.get(def.portId)
    if (parentSlots?.length) {
      result.push(...parentSlots.slice().sort((a, b) => a.index - b.index))
    } else {
      result.push(def)
    }
  }
  return result
}

/**
 * 打开宿主编辑器的通用规则：
 * 1. 凡 isAssetRefInputHostType 宿主，按外层入端口各建至少 1 个输入接口；
 * 2. 若父图有入边，按边/数组展开覆盖对应端口槽，并带预览值。
 */
export function resolveHostInputSlotsForHostOpen(
  assetType: string | null | undefined,
  parents: GraphDocument[],
  hostAssetId: string | null | undefined,
  options?: ResolveHostInputSlotsOptions
): HostInputSlotSpec[] {
  if (!isAssetRefInputHostType(assetType)) return []
  const fromParent =
    hostAssetId && parents.length
      ? resolveHostInputSlotsFromParents(parents, hostAssetId, options)
      : []
  return mergeHostInputSlotsWithDefaults(assetType, fromParent)
}

function expandValueToSlotCount(value: GraphValue | undefined): number {
  if (!value) return 1
  if (value.kind === 'texts') return Math.max(1, value.items.length)
  if (value.kind === 'images') return Math.max(1, value.items.length)
  if (value.kind === 'videos') return Math.max(1, value.items.length)
  if (value.kind === 'voices') return Math.max(1, value.items.length)
  if (value.kind === 'voice') return 1
  if (value.kind === 'output') {
    if (value.texts?.length) return Math.max(1, value.texts.length)
    if (value.images?.length) return Math.max(1, value.images.length)
    if (value.videos?.length) return Math.max(1, value.videos.length)
    if (value.voices?.length) return Math.max(1, value.voices.length)
    if (value.notes?.length) return Math.max(1, value.notes.length)
  }
  return 1
}

function slotPreviewFromValue(
  value: GraphValue | undefined,
  itemIndex: number
): Pick<HostInputSlotSpec, 'text' | 'title' | 'previewRelativePath' | 'previewDataUrl'> {
  if (!value) return {}
  if (value.kind === 'text') {
    return {
      text: value.text,
      previewRelativePath: value.relativePath
    }
  }
  if (value.kind === 'texts') {
    const item = value.items[itemIndex]
    return { text: item?.text, title: item?.title, previewRelativePath: item?.relativePath }
  }
  if (value.kind === 'image') {
    return {
      previewDataUrl: value.dataUrl || undefined,
      previewRelativePath: value.relativePath,
      text: value.relativePath || undefined
    }
  }
  if (value.kind === 'images') {
    const item = value.items[itemIndex]
    return {
      previewDataUrl: item?.dataUrl || undefined,
      previewRelativePath: item?.relativePath,
      text: item?.relativePath || undefined
    }
  }
  if (value.kind === 'video') {
    return {
      previewDataUrl: value.dataUrl || undefined,
      previewRelativePath: value.relativePath,
      text: value.relativePath || undefined
    }
  }
  if (value.kind === 'videos') {
    const item = value.items[itemIndex]
    return {
      previewDataUrl: item?.dataUrl || undefined,
      previewRelativePath: item?.relativePath,
      text: item?.relativePath || undefined
    }
  }
  if (value.kind === 'voices') {
    const item = value.items[itemIndex]
    return {
      previewRelativePath: item?.relativePath,
      text: item?.relativePath || undefined
    }
  }
  if (value.kind === 'voice') {
    return {
      previewRelativePath: value.relativePath,
      text: value.relativePath || undefined
    }
  }
  if (value.kind === 'output') {
    if (value.texts?.length) {
      const item = value.texts[itemIndex]
      return { text: item?.text, title: item?.title, previewRelativePath: item?.relativePath }
    }
    if (value.notes?.length) {
      const note = value.notes[itemIndex]
      return { text: note?.text }
    }
    if (value.images?.length) {
      const item = value.images[itemIndex]
      return {
        previewDataUrl: item?.dataUrl || undefined,
        previewRelativePath: item?.relativePath,
        text: item?.relativePath || undefined
      }
    }
    if (value.videos?.length) {
      const item = value.videos[itemIndex]
      return {
        previewDataUrl: item?.dataUrl || undefined,
        previewRelativePath: item?.relativePath,
        text: item?.relativePath || undefined
      }
    }
    if (value.voices?.length) {
      const item = value.voices[itemIndex]
      return {
        previewRelativePath: item?.relativePath,
        text: item?.relativePath || undefined
      }
    }
  }
  if (
    value.kind === 'world' ||
    value.kind === 'worldEntities' ||
    value.kind === 'shotEntities' ||
    value.kind === 'videoEntities' ||
    value.kind === 'beat' ||
    value.kind === 'shots'
  ) {
    return { text: value.text }
  }
  if (value.kind === 'asset') {
    return { text: value.notes || value.title || undefined }
  }
  return {}
}

export function graphValueHasPayload(value: GraphValue | undefined): value is GraphValue {
  if (!value) return false
  if (value.kind === 'text') {
    return !!value.text.trim() || !!value.relativePath?.trim()
  }
  if (
    value.kind === 'world' ||
    value.kind === 'worldEntities' ||
    value.kind === 'shotEntities' ||
    value.kind === 'videoEntities' ||
    value.kind === 'beat' ||
    value.kind === 'shots'
  ) {
    return !!value.text.trim() || !!value.relativePath?.trim()
  }
  if (value.kind === 'texts') return value.items.some((i) => !!i.text?.trim() || !!i.relativePath)
  if (value.kind === 'image') return !!(value.dataUrl?.trim() || value.relativePath?.trim())
  if (value.kind === 'images') {
    return value.items.some((i) => !!(i.dataUrl?.trim() || i.relativePath?.trim()))
  }
  if (value.kind === 'video') return !!(value.dataUrl?.trim() || value.relativePath?.trim())
  if (value.kind === 'videos') {
    return value.items.some((i) => !!(i.dataUrl?.trim() || i.relativePath?.trim()))
  }
  if (value.kind === 'voices') return value.items.some((i) => !!i.relativePath?.trim())
  if (value.kind === 'voice') return !!(value.relativePath?.trim() || value.id?.trim())
  if (value.kind === 'output') {
    return !!(
      value.texts?.length ||
      value.notes?.some((n) => !!n.text.trim()) ||
      value.images?.length ||
      value.videos?.length ||
      value.voices?.length
    )
  }
  if (value.kind === 'asset') return true
  return false
}

/**
 * 边界输出：按入边顺序软解析第一个有载荷的上游口（与 executeBoundaryOutputNode 口径一致）。
 * 优先本节点已有 runStates.out，否则 walk 直接上游（不 deep walk 整条链）。
 */
/** 边界输入：从 params 按 hostBoundaryPort.dataType 还原载荷（外层注入 / 分镜绑定图） */
export function softResolveBoundaryInputParams(node: GraphNode): GraphValue | undefined {
  if (!isBoundaryInputNode(node)) return undefined
  const dataType = node.params.hostBoundaryPort?.dataType ?? GraphPortType.text
  const path = node.params.previewRelativePath?.trim()
  const dataUrl = node.params.previewDataUrl?.trim() ?? ''
  const text = node.params.text?.trim() ?? ''

  if (dataType === GraphPortType.image || dataType === GraphPortType.images) {
    if (!path && !dataUrl) return undefined
    if (dataType === GraphPortType.images) {
      return { kind: 'images', items: [{ dataUrl, ...(path ? { relativePath: path } : {}) }] }
    }
    return {
      kind: 'image',
      dataUrl,
      ...(path ? { relativePath: path } : {})
    }
  }
  if (dataType === GraphPortType.video || dataType === GraphPortType.videos) {
    if (!path && !dataUrl) return undefined
    if (dataType === GraphPortType.videos) {
      return {
        kind: 'videos',
        items: [{ dataUrl: dataUrl || '', ...(path ? { relativePath: path } : {}) }]
      }
    }
    return {
      kind: 'video',
      ...(dataUrl ? { dataUrl } : {}),
      ...(path ? { relativePath: path } : {})
    }
  }
  if (dataType === GraphPortType.voice || dataType === GraphPortType.voices) {
    if (!path) return undefined
    return { kind: 'voices', items: [{ relativePath: path }] }
  }
  if (isGraphCatalogKind(dataType)) {
    if (!text && !path) return undefined
    return catalogValue(dataType, text, path)
  }
  if (!text && !path) return undefined
  if (dataType === GraphPortType.texts) {
    return {
      kind: 'texts',
      items: [{ text, ...(path ? { relativePath: path } : {}) }]
    }
  }
  return {
    kind: 'text',
    text,
    ...(path ? { relativePath: path } : {})
  }
}

function looksLikeVideoRelativePath(path: string | undefined | null): boolean {
  const p = path?.trim() ?? ''
  if (!p) return false
  return /\.(mp4|webm|mov|mkv|avi|m4v)(\?|#|$)/i.test(p)
}

function videoPayloadIsReal(value: GraphValue): boolean {
  if (value.kind === 'video') {
    const data = value.dataUrl?.trim() ?? ''
    if (data.startsWith('data:video')) return true
    return looksLikeVideoRelativePath(value.relativePath) || (!!data && !value.relativePath?.trim())
  }
  if (value.kind === 'videos') {
    return value.items.some((item) => {
      const data = item.dataUrl?.trim() ?? ''
      if (data.startsWith('data:video')) return true
      return looksLikeVideoRelativePath(item.relativePath) || (!!data && !item.relativePath?.trim())
    })
  }
  return false
}

function graphValueMatchesBoundaryPort(
  value: GraphValue | undefined,
  dataType: GraphPortDataType | undefined
): boolean {
  if (!graphValueHasPayload(value) || !value) return false
  if (!dataType) return true
  // classic output.* 聚合口：按内嵌媒体判断
  if (value.kind === 'output') {
    if (dataType === GraphPortType.image || dataType === GraphPortType.images) {
      return !!value.images?.some((i) => !!(i.relativePath?.trim() || i.dataUrl?.trim()))
    }
    if (dataType === GraphPortType.video || dataType === GraphPortType.videos) {
      return !!value.videos?.some(
        (i) =>
          looksLikeVideoRelativePath(i.relativePath) ||
          !!i.dataUrl?.trim()?.startsWith('data:video')
      )
    }
    return false
  }
  const kindOk =
    value.kind === dataType ||
    (dataType === GraphPortType.image && value.kind === 'images') ||
    (dataType === GraphPortType.images && value.kind === 'image') ||
    (dataType === GraphPortType.video && value.kind === 'videos') ||
    (dataType === GraphPortType.videos && value.kind === 'video')
  if (!kindOk) return false
  // 视频口拒绝 jpg 等误标成 video 的预览路径（否则边界软透传会写假预览，批跑以为已完成）
  if (dataType === GraphPortType.video || dataType === GraphPortType.videos) {
    return videoPayloadIsReal(value)
  }
  return true
}

export function softResolveBoundaryOutputValue(
  doc: GraphDocument,
  boundaryNodeId: string,
  options?: ResolveHostInputSlotsOptions
): GraphValue | undefined {
  const node =
    doc.nodes.find((n) => n.id === boundaryNodeId) ??
    doc.nodes.find(
      (n) =>
        isBoundaryOutputNode(n) && n.params.hostBoundaryPort?.portId === boundaryNodeId
    )
  if (!node || !isBoundaryOutputNode(node)) return undefined

  const portType = node.params.hostBoundaryPort?.dataType
  const selfOut = doc.runStates?.[node.id]?.outputs?.out as GraphValue | undefined
  if (graphValueMatchesBoundaryPort(selfOut, portType)) return selfOut

  const incoming = doc.edges.filter((edge) => edge.target === node.id)
  for (const edge of incoming) {
    const value = softResolveSourceOutput(
      doc,
      edge.source,
      edge.sourcePort ?? 'out',
      options
    )
    if (graphValueMatchesBoundaryPort(value, portType)) return value
  }
  return undefined
}

/** 宿主实例：按出口 port dig 内图 boundary.output 的上游软值 */
function softResolveHostBoundaryOutput(
  node: GraphNode,
  sourcePort: string,
  options?: ResolveHostInputSlotsOptions
): GraphValue | undefined {
  if (!isAssetHostNode(node) || !node.assetId) return undefined
  const iface = resolveNodeHostInterface(node)
  const portId = sourcePort?.trim() || 'out'
  const port =
    iface.outputs.find((p) => p.id === portId) ??
    (portId === 'out' ? iface.outputs[0] : undefined)
  if (!port) return undefined

  const liveDoc = options?.resolveLiveAssetGraph?.(node.assetId)
  const gen = options?.resolveAssetGenParams?.(node.assetId)
  const graphJson =
    liveDoc ??
    (!!gen?.graphJson &&
    typeof gen.graphJson === 'object' &&
    Array.isArray((gen.graphJson as GraphDocument).nodes)
      ? (gen.graphJson as GraphDocument)
      : undefined)
  if (!graphJson) return undefined

  const boundaryId = boundaryOutputNodeId(port.id)
  return softResolveBoundaryOutputValue(graphJson, boundaryId, options)
}

/**
 * 从 runStates 或源节点参数软解析输出口值（父图未跑完也能拿到正文）。
 */
export function softResolveSourceOutput(
  parent: GraphDocument,
  sourceId: string,
  sourcePort: string,
  options?: ResolveHostInputSlotsOptions
): GraphValue | undefined {
  const runStates: Record<string, GraphPersistedRunState> = parent.runStates ?? {}
  const fromRun = runStates[sourceId]?.outputs?.[sourcePort] as GraphValue | undefined
  const node = parent.nodes.find((n) => n.id === sourceId)
  if (!node) {
    return graphValueHasPayload(fromRun) ? fromRun : undefined
  }

  // 边界输出本身：透传上游软值（不 deep walk）
  if (isBoundaryOutputNode(node) && (sourcePort === 'out' || !sourcePort)) {
    return softResolveBoundaryOutputValue(parent, node.id, options)
  }

  // 边界输入：按端口类型读节点上缓存的外层/绑定注入（对齐 executeBoundaryInputNode）
  if (isBoundaryInputNode(node) && (sourcePort === 'out' || !sourcePort)) {
    const fromBoundaryIn = softResolveBoundaryInputParams(node)
    if (graphValueHasPayload(fromBoundaryIn)) return fromBoundaryIn
    if (graphValueHasPayload(fromRun)) return fromRun
    return undefined
  }

  // 场表格 / 场输出：目录 JSON 必须保持 beat kind（勿经 resolveNodeTextContent 变成 text）
  if (
    (node.typeId === 'beat.table' || node.typeId === 'output.beat') &&
    (sourcePort === 'out' || !sourcePort)
  ) {
    const text = node.params.text?.trim() || node.params.resultText?.trim() || ''
    if (text) return { kind: 'beat', text }
    if (graphValueHasPayload(fromRun) && fromRun?.kind === 'beat') return fromRun
  }

  // 世界元素宿主 / 生成：实体先于文本图库，避免目录或正文冒充实体
  if (
    (node.typeId === 'world.gen' || node.assetType === 'world' || node.typeId === 'asset.world') &&
    (sourcePort === 'out' || !sourcePort)
  ) {
    const fromParams = Array.isArray(node.params.worldElementOutputs)
      ? (node.params.worldElementOutputs as WorldElementGenResult[])
      : []
    if (fromParams.length) {
      // 打开时预览允许尚无 imageUrl 的实体行
      const text = stringifyWorldElementGenResults(
        fromParams.filter((item) => item?.type && item?.name)
      )
      if (text.trim()) return { kind: 'worldEntities', text }
    }
    const local = worldEntitiesText(node.params.text) || worldEntitiesText(node.params.resultText)
    if (local) return { kind: 'worldEntities', text: local }
    if (node.assetId) {
      const liveDoc = options?.resolveLiveAssetGraph?.(node.assetId)
      const gen = options?.resolveAssetGenParams?.(node.assetId)
      for (const graphJson of [liveDoc, gen?.graphJson]) {
        const fromInner = textFromWorldEntitiesInGraph(graphJson)
        if (fromInner) return { kind: 'worldEntities', text: fromInner }
      }
    }
  }

  // 图库节点：优先按 selected*Id 从 params 重算，避免缓存 out 与 Inspector 选中不一致
  const generated = node.params.generatedTexts
  if (Array.isArray(generated) && generated.length) {
    const items = generated.map((item) => ({
      id: item.id,
      title: item.title,
      text: item.text ?? '',
      relativePath: item.relativePath,
      createdAt: item.createdAt
    }))
    if (sourcePort === 'out-all') {
      return { kind: 'texts', items }
    }
    if (sourcePort === 'out' || !sourcePort) {
      const selectedId = node.params.selectedTextId?.trim()
      const picked =
        (selectedId ? items.find((item) => item.id === selectedId) : undefined) ||
        items[items.length - 1]
      // 世界元素提取 / 场拆解：选中项输出目录口（与 table 相连）
      if (node.typeId === 'world.extract') {
        const text = picked?.text ?? ''
        return picked?.relativePath?.trim()
          ? { kind: 'world', text, relativePath: picked.relativePath.trim() }
          : { kind: 'world', text }
      }
      if (node.typeId === 'beat.split') {
        const text = picked?.text ?? ''
        return picked?.relativePath?.trim()
          ? { kind: 'beat', text, relativePath: picked.relativePath.trim() }
          : { kind: 'beat', text }
      }
      const galleryOut: GraphValue = {
        kind: 'text',
        text: picked?.text ?? '',
        id: picked?.id,
        ...(picked?.relativePath ? { relativePath: picked.relativePath } : {})
      }
      // 图库项正文与路径皆空时继续向下软解析（params / runStates）
      if (graphValueHasPayload(galleryOut)) return galleryOut
    }
  }

  const generatedImages = node.params.generatedImages
  if (Array.isArray(generatedImages) && generatedImages.length) {
    if (sourcePort === 'out-all') {
      return {
        kind: 'images',
        items: generatedImages.map((item) => ({
          id: item.id,
          dataUrl: item.dataUrl ?? '',
          relativePath: item.relativePath,
          createdAt: item.createdAt
        }))
      }
    }
    if (sourcePort === 'out' || !sourcePort) {
      const selectedId = node.params.selectedImageId?.trim()
      const picked =
        (selectedId ? generatedImages.find((item) => item.id === selectedId) : undefined) ||
        generatedImages[generatedImages.length - 1]
      return {
        kind: 'image',
        id: picked?.id,
        dataUrl: picked?.dataUrl ?? '',
        createdAt: picked?.createdAt,
        ...(picked?.relativePath ? { relativePath: picked.relativePath } : {})
      }
    }
  }

  const generatedVideos = node.params.generatedVideos
  if (Array.isArray(generatedVideos) && generatedVideos.length) {
    if (sourcePort === 'out-all') {
      return {
        kind: 'videos',
        items: generatedVideos.map((item) => ({
          id: item.id,
          dataUrl: item.dataUrl ?? '',
          relativePath: item.relativePath,
          createdAt: item.createdAt
        }))
      }
    }
    if (sourcePort === 'out' || !sourcePort) {
      const selectedId = node.params.selectedVideoId?.trim()
      const picked =
        (selectedId ? generatedVideos.find((item) => item.id === selectedId) : undefined) ||
        generatedVideos[generatedVideos.length - 1]
      return {
        kind: 'video',
        id: picked?.id,
        dataUrl: picked?.dataUrl ?? '',
        createdAt: picked?.createdAt,
        ...(picked?.relativePath ? { relativePath: picked.relativePath } : {})
      }
    }
  }

  const generatedVoices = node.params.generatedVoices
  if (Array.isArray(generatedVoices) && generatedVoices.length) {
    if (sourcePort === 'out-all') {
      return {
        kind: 'voices',
        items: generatedVoices.map((item) => ({
          id: item.id,
          relativePath: item.relativePath,
          createdAt: item.createdAt
        }))
      }
    }
    if (sourcePort === 'out' || !sourcePort) {
      const selectedId = node.params.selectedVoiceId?.trim()
      const picked =
        (selectedId ? generatedVoices.find((item) => item.id === selectedId) : undefined) ||
        generatedVoices[generatedVoices.length - 1]
      return {
        kind: 'voice',
        id: picked?.id,
        createdAt: picked?.createdAt,
        ...(picked?.relativePath ? { relativePath: picked.relativePath } : {})
      }
    }
  }

  const cameraShots = node.params.cameraShots
  if (Array.isArray(cameraShots) && cameraShots.length) {
    const items = cameraShots.map((shot) => ({
      id: shot.id,
      dataUrl: shot.dataUrl ?? '',
      relativePath: shot.relativePath,
      createdAt: shot.createdAt
    }))
    if (sourcePort === 'out-shots' || sourcePort === 'out-all') {
      return { kind: 'images', items }
    }
    if (sourcePort === 'out' || !sourcePort) {
      const selectedId = node.params.selectedImageId?.trim()
      const picked =
        (selectedId ? items.find((item) => item.id === selectedId) : undefined) ||
        items[items.length - 1]
      return {
        kind: 'image',
        id: picked?.id,
        dataUrl: picked?.dataUrl ?? '',
        createdAt: picked?.createdAt,
        ...(picked?.relativePath ? { relativePath: picked.relativePath } : {})
      }
    }
  }

  const cameraVideos = node.params.cameraVideos
  if (Array.isArray(cameraVideos) && cameraVideos.length) {
    const items = cameraVideos.map((video) => ({
      id: video.id,
      dataUrl: video.dataUrl ?? '',
      relativePath: video.relativePath,
      createdAt: video.createdAt
    }))
    if (sourcePort === 'out-actions') {
      return { kind: 'videos', items }
    }
  }

  // 场宿主：live 内图 / genParams.beatCatalog
  if (
    (node.assetType === 'beat' || node.typeId === 'asset.beat') &&
    (sourcePort === 'out' || !sourcePort) &&
    node.assetId
  ) {
    const liveDoc = options?.resolveLiveAssetGraph?.(node.assetId)
    const fromLive = textFromBeatCatalogInGraph(liveDoc)
    if (fromLive) return { kind: 'beat', text: fromLive }
    const gen = options?.resolveAssetGenParams?.(node.assetId)
    const raw = gen?.beatCatalog
    if (typeof raw === 'string' && raw.trim()) {
      return { kind: 'beat', text: raw }
    }
    if (Array.isArray(raw) && raw.length) {
      return { kind: 'beat', text: JSON.stringify(raw) }
    }
    const fromPersisted = textFromBeatCatalogInGraph(gen?.graphJson)
    if (fromPersisted) return { kind: 'beat', text: fromPersisted }
  }

  // 选择场：params.text 为可读普通文本
  if (node.typeId === 'beat.select' && (sourcePort === 'out' || !sourcePort)) {
    const text = node.params.text?.trim() || ''
    if (text) return { kind: 'text', text }
  }

  // 选择分镜实体：输出选中实体首图
  if (node.typeId === 'shotEntities.select' && (sourcePort === 'out' || !sourcePort)) {
    const path = node.params.previewRelativePath?.trim()
    if (path) return { kind: 'image', dataUrl: '', relativePath: path }
  }

  // 分镜参数：全部镜头绑定图口（不依赖 runStates，未运行也可输出）
  if (node.typeId === 'script.shotParams' && sourcePort === SHOT_PARAMS_IMAGES_PORT_ID) {
    const items = resolveShotParamsBindingImageItems({
      node,
      resolveAllShotBindingImages: options?.resolveAllShotBindingImages,
      resolveShotStoryboard: options?.resolveShotStoryboard
    }).map((item) => ({
      id: item.id,
      dataUrl: '',
      relativePath: item.relativePath
    }))
    return { kind: 'images', items }
  }

  if (graphValueHasPayload(fromRun)) return fromRun

  const runState = runStates[sourceId]
  const content = resolveNodeTextContent(node, runState ?? null)
  if (content?.text?.trim()) {
    return { kind: 'text', text: content.text }
  }

  const previewPath = node.params.previewRelativePath?.trim()
  const previewUrl = node.params.previewDataUrl?.trim()
  if (previewPath || previewUrl) {
    const typeId = node.typeId ?? ''
    const isVideoNode = node.assetType === 'video' || typeId.includes('video')
    if (isVideoNode) {
      // 首帧/参考图常写在 previewRelativePath，不得当成已生成视频
      if (
        looksLikeVideoRelativePath(previewPath) ||
        !!previewUrl?.startsWith('data:video')
      ) {
        return {
          kind: 'video',
          dataUrl: previewUrl,
          relativePath: looksLikeVideoRelativePath(previewPath) ? previewPath : undefined
        }
      }
      // 视频节点上的图片预览到此为止，勿落入下方 image 分支
    } else if (node.assetType === 'voice' || typeId.includes('voice')) {
      return {
        kind: 'voices',
        items: [{ relativePath: previewPath }]
      }
    } else {
      // 文本类节点的 previewRelativePath 是正文旁挂路径，勿当成图片
      const isTextLike =
        node.assetType === 'screenplay' ||
        typeId === 'asset.screenplay' ||
        typeId === 'text.select' ||
        typeId === 'note.text' ||
        typeId === 'play.script' ||
        typeId === GRAPH_INPUT_SLOT_TYPE_ID ||
        readHostInputSlot(node) != null
      if (isTextLike) {
        const localText = node.params.text?.trim() ?? ''
        if (localText || previewPath) {
          return {
            kind: 'text',
            text: localText,
            ...(previewPath ? { relativePath: previewPath } : {})
          }
        }
      } else if (
        node.assetType === 'image' ||
        typeId.includes('image') ||
        typeId === 'asset.motion' ||
        previewUrl
      ) {
        return {
          kind: 'image',
          dataUrl: previewUrl ?? '',
          relativePath: previewPath
        }
      }
    }
  }

  // 宿主出口：dig 内图 boundary.output 上游（未 cook 也能读到图库/缓存）
  if (isAssetHostNode(node)) {
    const fromHostBoundary = softResolveHostBoundaryOutput(node, sourcePort, options)
    if (graphValueHasPayload(fromHostBoundary)) return fromHostBoundary
  }

  // 资产引用：live 内图 → 同步正文 → genParams → 旁挂路径
  if (node.assetId) {
    const liveDoc = options?.resolveLiveAssetGraph?.(node.assetId)
    if (liveDoc) {
      const fromLive = resolveAssetTextFromGenParams({ graphJson: liveDoc }, node.params).trim()
      if (fromLive) return { kind: 'text', text: fromLive }
      if (node.assetType === 'screenplay' || node.typeId === 'asset.screenplay') {
        const fromSlots = textFromHostInputSlotsInGraph(liveDoc)
        if (fromSlots) return { kind: 'text', text: fromSlots }
        const livePath = collectScreenplayTextRelativePaths(liveDoc)[0]?.trim()
        if (livePath) return { kind: 'text', text: '', relativePath: livePath }
      }
    }
    const fromResolver = options?.resolveAssetText?.(node.assetId)?.trim()
    if (fromResolver) return { kind: 'text', text: fromResolver }
    const gen = options?.resolveAssetGenParams?.(node.assetId)
    const fromGen = resolveAssetTextFromGenParams(gen, node.params).trim()
    if (fromGen) return { kind: 'text', text: fromGen }
    // 剧本：内图输入接口正文（尚未生成时）+ 落盘路径
    if (node.assetType === 'screenplay' || node.typeId === 'asset.screenplay') {
      const fromSlots = textFromHostInputSlotsInGraph(gen?.graphJson)
      if (fromSlots) return { kind: 'text', text: fromSlots }
      const path = collectScreenplayTextRelativePaths(gen?.graphJson)[0]?.trim()
      if (path) return { kind: 'text', text: '', relativePath: path }
    }
  }

  // 仅在有有效载荷时返回 runStates；空 text 不得阻断后续 / 抹掉槽位缓存
  if (fromRun && graphValueHasPayload(fromRun)) return fromRun
  return undefined
}

/** 从世界元素内图表格 / 输出节点取实体目录 JSON */
/**
 * 仅接受世界元素实体数组文本。
 * 世界目录（`{"characters":[…]}`，带 prompt 无图）不是实体，不能冒充。
 */
function worldEntitiesText(raw: string | undefined | null): string {
  const text = raw?.trim() ?? ''
  if (!text.startsWith('[')) return ''
  try {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) return ''
    const hasEntity = parsed.some((row) => {
      if (!row || typeof row !== 'object') return false
      const item = row as Record<string, unknown>
      return typeof item.type === 'string' && typeof item.name === 'string' && !!item.name.trim()
    })
    return hasEntity ? text : ''
  } catch {
    return ''
  }
}

function textFromWorldEntitiesInGraph(graphJson: unknown): string {
  if (!graphJson || typeof graphJson !== 'object') return ''
  const nodes = (graphJson as GraphDocument).nodes
  if (!Array.isArray(nodes)) return ''
  // 实体缓存优先，避免按节点顺序先命中目录节点（world.table 在 world.gen 之前）
  for (const node of nodes) {
    const outputs = Array.isArray(node.params.worldElementOutputs)
      ? (node.params.worldElementOutputs as WorldElementGenResult[])
      : []
    if (!outputs.length) continue
    const text = stringifyWorldElementGenResults(
      outputs.filter((item) => item?.type && item?.name)
    )
    if (text.trim()) return text
  }
  for (const node of nodes) {
    if (node.typeId !== 'world.gen' && node.typeId !== 'output.world') continue
    const text =
      worldEntitiesText(node.params.text) || worldEntitiesText(node.params.resultText)
    if (text) return text
  }
  return ''
}

/** 从叙事内图表格 / 输出取目录 JSON */
function textFromBeatCatalogInGraph(graphJson: unknown): string {
  if (!graphJson || typeof graphJson !== 'object') return ''
  const nodes = (graphJson as GraphDocument).nodes
  if (!Array.isArray(nodes)) return ''
  for (const node of nodes) {
    if (
      node.typeId === 'beat.table' ||
      node.typeId === 'beat.split' ||
      node.typeId === 'output.beat'
    ) {
      const text = node.params.text?.trim() || node.params.resultText?.trim() || ''
      if (text && (text.startsWith('[') || text.startsWith('{'))) return text
    }
  }
  return textFromHostInputSlotsInGraph(graphJson)
}

/** 剧本内图「输入接口」上已注入的外层正文 */
function textFromHostInputSlotsInGraph(graphJson: unknown): string {
  if (!graphJson || typeof graphJson !== 'object') return ''
  const nodes = (graphJson as GraphDocument).nodes
  if (!Array.isArray(nodes)) return ''
  return nodes
    .filter((n) => isHostInputSlotNode(n))
    .map((n) => n.params.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
}

function slotPreviewScore(slots: HostInputSlotSpec[]): number {
  let score = slots.length * 10
  for (const slot of slots) {
    if (slot.text?.trim()) score += 3
    if (slot.previewRelativePath?.trim() || slot.previewDataUrl?.trim()) score += 2
  }
  return score
}

/**
 * 从父图中解析指向某宿主资产节点的入边，展开为有序槽位。
 * 边顺序稳定；优先 runStates，缺省时软解析源节点正文 / 预览。
 */
export function resolveHostInputSlotsFromParentGraph(
  parent: GraphDocument,
  hostAssetId: string,
  options?: ResolveHostInputSlotsOptions
): HostInputSlotSpec[] {
  const hostNodes = parent.nodes.filter(
    (node) => node.assetId === hostAssetId && isAssetHostNode(node)
  )
  if (!hostNodes.length) return []

  // 多处引用同一资产时取第一个宿主节点（通常剧集画布上唯一）
  const hostNode = hostNodes[0]!
  const assetType = (hostNode.assetType ?? 'screenplay') as AssetType
  const inPorts = listHostInputPortDefs(assetType)
  if (!inPorts.length) return []

  const slots: HostInputSlotSpec[] = []

  for (const port of inPorts) {
    const edges = parent.edges
      .filter(
        (edge) => edge.target === hostNode.id && (edge.targetPort ?? 'in') === port.id
      )
      .slice()
      // 保持 edges 数组相对顺序（文档序）
      .sort((a, b) => parent.edges.indexOf(a) - parent.edges.indexOf(b))

    if (!edges.length) continue

    let nextIndex = 0
    for (const edge of edges) {
      const sourcePort = edge.sourcePort ?? 'out'
      const sourceOut = softResolveSourceOutput(parent, edge.source, sourcePort, options)
      const count = expandValueToSlotCount(sourceOut)
      for (let i = 0; i < count; i += 1) {
        const preview = slotPreviewFromValue(sourceOut, i)
        slots.push({
          portId: port.id,
          index: nextIndex,
          dataType: port.dataType,
          text: preview.text,
          title: preview.title,
          previewRelativePath: preview.previewRelativePath,
          previewDataUrl: preview.previewDataUrl
        })
        nextIndex += 1
      }
    }
  }

  return slots
}

/** 在多份父图中解析；优先槽位更多、且预览更完整的一份 */
export function resolveHostInputSlotsFromParents(
  parents: GraphDocument[],
  hostAssetId: string,
  options?: ResolveHostInputSlotsOptions
): HostInputSlotSpec[] {
  let best: HostInputSlotSpec[] = []
  let bestScore = -1
  for (const parent of parents) {
    const slots = resolveHostInputSlotsFromParentGraph(parent, hostAssetId, options)
    const score = slotPreviewScore(slots)
    if (score > bestScore) {
      best = slots
      bestScore = score
    }
  }
  return best
}

/**
 * 按槽位幂等同步输入接口节点：同 portId+index 复用稳定 id，删多余，按 index 排版。
 */
export function ensureHostInputSlotNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  slots: HostInputSlotSpec[],
  options?: { autoLinkHeadTypeIds?: string[] }
): void {
  const keepIds = new Set(slots.map((s) => hostInputSlotNodeId(s.portId, s.index)))

  // 移除不再存在的槽位节点及其边
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i]!
    if (!isHostInputSlotNode(node)) continue
    if (keepIds.has(node.id)) continue
    nodes.splice(i, 1)
    for (let e = edges.length - 1; e >= 0; e -= 1) {
      const edge = edges[e]!
      if (edge.source === node.id || edge.target === node.id) edges.splice(e, 1)
    }
  }

  const baseX = 40
  const baseY = 80
  const gapY = 120

  for (const slot of slots) {
    const id = hostInputSlotNodeId(slot.portId, slot.index)
    let node = nodes.find((n) => n.id === id)
    const title =
      slot.title?.trim() ||
      (slot.dataType === GraphPortType.text
        ? `输入·文本 ${slot.index + 1}`
        : slot.dataType === GraphPortType.image
          ? `输入·图片 ${slot.index + 1}`
          : slot.dataType === GraphPortType.video
            ? `输入·视频 ${slot.index + 1}`
            : slot.dataType === GraphPortType.voice
              ? `输入·声音 ${slot.index + 1}`
              : slot.dataType === GraphPortType.worldEntities
                ? `输入·世界元素 ${slot.index + 1}`
                : slot.dataType === GraphPortType.beat
                  ? `输入·场 ${slot.index + 1}`
                  : `输入 ${slot.index + 1}`)

    const incomingText = slot.text?.trim() ? slot.text : undefined
    const incomingPath = slot.previewRelativePath?.trim() || undefined
    const slotParams: GraphNodeParams = {
      hostInputSlot: {
        portId: slot.portId,
        index: slot.index,
        dataType: slot.dataType
      },
      ...(incomingText != null ? { text: incomingText } : {}),
      ...(incomingPath != null ? { previewRelativePath: incomingPath } : {}),
      ...(slot.previewDataUrl != null ? { previewDataUrl: slot.previewDataUrl } : {})
    }

    if (!node) {
      node = {
        id,
        typeId: GRAPH_INPUT_SLOT_TYPE_ID,
        category: 'note',
        position: { x: baseX, y: baseY + slot.index * gapY },
        params: { ...slotParams, previewCollapsed: true },
        title
      }
      nodes.push(node)
    } else {
      node.title = title
      // 有非空正文才覆盖；空串 / 仅路径时保留已有缓存，避免抹掉上次注入
      const nextText =
        incomingText != null
          ? incomingText
          : incomingPath != null
            ? node.params.text
            : slot.text?.trim()
              ? slot.text
              : node.params.text
      node.params = {
        ...node.params,
        ...slotParams,
        text: nextText,
        previewRelativePath:
          incomingPath != null
            ? incomingPath
            : slot.previewRelativePath != null
              ? slot.previewRelativePath
              : node.params.previewRelativePath,
        previewDataUrl:
          slot.previewDataUrl != null ? slot.previewDataUrl : node.params.previewDataUrl,
        // 未显式展开过的旧节点默认折叠
        previewCollapsed: node.params.previewCollapsed ?? true
      }
      // 仅当仍在默认列附近时校正 Y，避免打乱用户拖动过的位置过多；仍按 index 排 Y
      if (Math.abs(node.position.x - baseX) < 80) {
        node.position = { x: baseX, y: baseY + slot.index * gapY }
      }
    }
  }

  const headTypeIds = options?.autoLinkHeadTypeIds ?? []
  if (!headTypeIds.length || !slots.length) return

  const heads = nodes.filter((n) => !!n.typeId && headTypeIds.includes(n.typeId))
  if (!heads.length) return

  const sortedSlots = slots.slice().sort((a, b) => {
    if (a.portId === b.portId) return a.index - b.index
    return a.portId.localeCompare(b.portId)
  })
  for (const slot of sortedSlots) {
    // 优先同名口；否则仅在数据类型一致时回落到 in（避免 worldEntities 误进 text）
    let targetHead: GraphNode | undefined
    let targetPortId: string | undefined
    for (const head of heads) {
      const headInById = new Map(
        getNodePorts(head)
          .filter((port) => port.direction === 'in')
          .map((port) => [port.id, port] as const)
      )
      if (headInById.has(slot.portId)) {
        targetHead = head
        targetPortId = slot.portId
        break
      }
    }
    if (!targetHead || !targetPortId) {
      for (const head of heads) {
        const inDef = getNodePorts(head).find((port) => port.direction === 'in' && port.id === 'in')
        if (inDef?.dataType === slot.dataType) {
          targetHead = head
          targetPortId = 'in'
          break
        }
      }
    }
    if (!targetHead || !targetPortId) continue
    const targetDef = getNodePorts(targetHead).find(
      (port) => port.direction === 'in' && port.id === targetPortId
    )
    const sourceId = hostInputSlotNodeId(slot.portId, slot.index)
    const exists = edges.some(
      (e) =>
        e.source === sourceId &&
        e.target === targetHead!.id &&
        (e.targetPort ?? 'in') === targetPortId
    )
    if (exists) continue
    // 单值入口已被占用时不抢连；多值入口可挂多条
    if (targetDef && targetDef.multiple === false) {
      const portOccupied = edges.some(
        (e) => e.target === targetHead!.id && (e.targetPort ?? 'in') === targetPortId
      )
      if (portOccupied) continue
    }
    edges.push({
      id: `edge-${sourceId}-${targetHead.id}-${targetPortId}`,
      source: sourceId,
      target: targetHead.id,
      sourcePort: 'out',
      targetPort: targetPortId
    })
  }
}

/** 同一入端口的多条入边合并成一个值（按端口数据类型聚合） */
export function mergeHostInputValues(
  values: GraphValue[],
  dataType: string
): GraphValue | null {
  if (!values.length) return null
  if (values.length === 1) return values[0]!
  if (dataType === GraphPortType.text || dataType === GraphPortType.texts) {
    const items = values.flatMap((v) => {
      if (v.kind === 'texts') return v.items
      if (v.kind === 'text') return [{ text: v.text, relativePath: v.relativePath }]
      return []
    })
    return { kind: 'texts', items }
  }
  if (dataType === GraphPortType.image || dataType === GraphPortType.images) {
    const items = values.flatMap((v) => {
      if (v.kind === 'images') return v.items
      if (v.kind === 'image') {
        return [{ dataUrl: v.dataUrl ?? '', relativePath: v.relativePath }]
      }
      return []
    })
    return { kind: 'images', items }
  }
  if (dataType === GraphPortType.video || dataType === GraphPortType.videos) {
    const items = values.flatMap((value) => {
      if (value.kind === 'videos') return value.items
      if (value.kind === 'video') {
        return [{
          dataUrl: value.dataUrl ?? '',
          relativePath: value.relativePath,
          id: value.id
        }]
      }
      return []
    })
    return { kind: 'videos', items }
  }
  if (dataType === GraphPortType.voice || dataType === GraphPortType.voices) {
    const items = values.flatMap((value) => {
      if (value.kind === 'voices') return value.items
      if (value.kind === 'voice') {
        return [{
          relativePath: value.relativePath,
          id: value.id,
          createdAt: value.createdAt
        }]
      }
      return []
    })
    return { kind: 'voices', items }
  }
  if (
    dataType === GraphPortType.world ||
    dataType === GraphPortType.worldEntities ||
    dataType === GraphPortType.shotEntities ||
    dataType === GraphPortType.videoEntities ||
    dataType === GraphPortType.beat ||
    dataType === GraphPortType.shots
  ) {
    const payloads = values.flatMap((value) => {
      if (value.kind !== dataType) return []
      try {
        const parsed = JSON.parse(value.text)
        return Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        return value.text.trim() ? [value.text] : []
      }
    })
    return catalogValue(dataType as GraphCatalogKind, JSON.stringify(payloads))
  }
  return values[0]!
}

/**
 * 从一张父图解析宿主实例各入端口的当前值（boundary proxy 用）。
 * 与执行期 executeAssetHostInnerGraph 的注入口径一致：按端口合并所有入边。
 */
export function resolveBoundaryInputValuesFromParentGraph(
  parent: GraphDocument,
  hostAssetId: string,
  options?: ResolveHostInputSlotsOptions
): Record<string, GraphValue> {
  const hostNode = parent.nodes.find(
    (node) => node.assetId === hostAssetId && isAssetHostNode(node)
  )
  if (!hostNode) return {}
  const iface = resolveNodeHostInterface(hostNode)
  const result: Record<string, GraphValue> = {}

  for (const port of iface.inputs) {
    const edges = parent.edges
      .filter((edge) => edge.target === hostNode.id && (edge.targetPort ?? 'in') === port.id)
      .slice()
      .sort((a, b) => parent.edges.indexOf(a) - parent.edges.indexOf(b))
    if (!edges.length) continue
    const values = edges
      .map((edge) => softResolveSourceOutput(parent, edge.source, edge.sourcePort ?? 'out', options))
      .filter((value): value is GraphValue => graphValueHasPayload(value))
    const merged = mergeHostInputValues(values, port.dataType)
    if (merged) result[port.id] = merged
  }
  return result
}

/** 在多份父图中解析边界输入值；取覆盖端口最多的一份 */
export function resolveBoundaryInputValuesFromParents(
  parents: GraphDocument[],
  hostAssetId: string,
  options?: ResolveHostInputSlotsOptions
): Record<string, GraphValue> {
  let best: Record<string, GraphValue> = {}
  for (const parent of parents) {
    const values = resolveBoundaryInputValuesFromParentGraph(parent, hostAssetId, options)
    if (Object.keys(values).length > Object.keys(best).length) best = values
  }
  return best
}

/**
 * 将父图入端口值写回内图 boundary 输入节点 params（正文 / 预览路径）。
 * 内图独立打开（dive）时执行仍走节点缓存，因此必须落到 params。
 * @returns 是否有节点被更新
 */
export function applyBoundaryInputValues(
  nodes: GraphNode[],
  valuesByPort: Record<string, GraphValue>,
  iface?: HostInterfaceDocument
): boolean {
  let changed = false
  for (const [portId, value] of Object.entries(valuesByPort)) {
    const id = boundaryInputNodeId(portId)
    const node =
      nodes.find((n) => n.id === id) ??
      nodes.find(
        (n) => isBoundaryInputNode(n) && n.params.hostBoundaryPort?.portId === portId
      )
    if (!node) continue
    const dataType =
      node.params.hostBoundaryPort?.dataType ??
      iface?.inputs.find((port) => port.id === portId)?.dataType ??
      GraphPortType.text
    const preview = slotPreviewFromValue(value, 0)
    const nextText =
      dataType === GraphPortType.text || dataType === GraphPortType.texts
        ? textFromBoundaryValue(value) || preview.text
        : preview.text
    const nextParams: GraphNodeParams = { ...node.params }
    if (nextText?.trim()) nextParams.text = nextText
    if (preview.previewRelativePath?.trim()) {
      nextParams.previewRelativePath = preview.previewRelativePath.trim()
    }
    if (preview.previewDataUrl?.trim()) nextParams.previewDataUrl = preview.previewDataUrl
    if (
      nextParams.text !== node.params.text ||
      nextParams.previewRelativePath !== node.params.previewRelativePath ||
      nextParams.previewDataUrl !== node.params.previewDataUrl
    ) {
      node.params = nextParams
      changed = true
    }
  }
  // 旧图脏值：实体入口曾被写入世界目录（带 prompt 的对象），清掉以免绑定读到错数据
  for (const node of nodes) {
    if (!isBoundaryInputNode(node)) continue
    const portId = node.params.hostBoundaryPort?.portId
    const dataType =
      node.params.hostBoundaryPort?.dataType ??
      (portId ? iface?.inputs.find((port) => port.id === portId)?.dataType : undefined)
    if (dataType !== GraphPortType.worldEntities) continue
    if (!node.params.text?.trim() || worldEntitiesText(node.params.text)) continue
    const nextParams: GraphNodeParams = { ...node.params }
    delete nextParams.text
    node.params = nextParams
    changed = true
  }
  return changed
}

/** 多值文本合并成一段正文，避免只注入首项 */
function textFromBoundaryValue(value: GraphValue): string {
  if (value.kind === 'text') return value.text
  if (value.kind === 'texts') {
    return value.items.map((item) => item.text ?? '').filter(Boolean).join('\n')
  }
  if (value.kind === 'beat') {
    return value.text
  }
  return ''
}

/** 从宿主实时入端口值展开槽位（父图执行时用） */
export function resolveHostInputSlotsFromInputs(
  hostNode: GraphNode,
  inputs: Record<string, GraphValue[]>
): HostInputSlotSpec[] {
  const assetType = (hostNode.assetType ?? 'screenplay') as AssetType
  const inPorts = listHostInputPortDefs(assetType)
  const slots: HostInputSlotSpec[] = []

  for (const port of inPorts) {
    const values = inputs[port.id] ?? []
    let nextIndex = 0
    for (const value of values) {
      const count = expandValueToSlotCount(value)
      for (let i = 0; i < count; i += 1) {
        const preview = slotPreviewFromValue(value, i)
        slots.push({
          portId: port.id,
          index: nextIndex,
          dataType: port.dataType,
          text: preview.text,
          title: preview.title,
          previewRelativePath: preview.previewRelativePath,
          previewDataUrl: preview.previewDataUrl
        })
        nextIndex += 1
      }
    }
  }
  return slots
}

/** 将父图宿主入端口上的 GraphValue[] 展开为槽位种子输出 */
export function buildHostInputSlotSeedOutputs(
  hostNode: GraphNode,
  inputs: Record<string, GraphValue[]>
): Record<string, Record<string, GraphValue>> {
  const seeds: Record<string, Record<string, GraphValue>> = {}
  const assetType = (hostNode.assetType ?? 'screenplay') as AssetType
  const inPorts = listHostInputPortDefs(assetType)

  for (const port of inPorts) {
    const values = inputs[port.id] ?? []
    let nextIndex = 0
    for (const value of values) {
      const count = expandValueToSlotCount(value)
      for (let i = 0; i < count; i += 1) {
        const id = hostInputSlotNodeId(port.id, nextIndex)
        let out: GraphValue
        if (value.kind === 'texts') {
          const item = value.items[i]
          out = {
            kind: 'text',
            text: item?.text ?? '',
            id: item?.id,
            ...(item?.relativePath ? { relativePath: item.relativePath } : {})
          }
        } else if (value.kind === 'text') {
          out = value
        } else if (value.kind === 'beat') {
          out = value
        } else if (value.kind === 'images') {
          const item = value.items[i]
          out = item
            ? { kind: 'image', dataUrl: item.dataUrl, relativePath: item.relativePath, id: item.id }
            : { kind: 'image', dataUrl: '' }
        } else if (value.kind === 'image') {
          out = value
        } else if (value.kind === 'voices') {
          const item = value.items[i]
          out = item
            ? { kind: 'voice', id: item.id, relativePath: item.relativePath, createdAt: item.createdAt }
            : { kind: 'voice' }
        } else if (value.kind === 'voice') {
          out = value
        } else if (value.kind === 'videos') {
          const item = value.items[i]
          out = item
            ? {
                kind: 'video',
                dataUrl: item.dataUrl,
                relativePath: item.relativePath,
                id: item.id
              }
            : { kind: 'video' }
        } else if (value.kind === 'video') {
          out = value
        } else {
          out = value
        }
        seeds[id] = { out }
        nextIndex += 1
      }
    }
  }
  return seeds
}

/**
 * 按 relativePath 补全槽位正文（生成落盘后 text 常被 strip，打开/执行前需读文件）。
 */
export async function hydrateHostInputSlotSpecs(
  slots: HostInputSlotSpec[],
  readRunText?: (relativePath: string) => Promise<string>
): Promise<HostInputSlotSpec[]> {
  if (!slots.length || !readRunText) return slots
  return Promise.all(
    slots.map(async (slot) => {
      if (slot.text?.trim()) return slot
      const path = slot.previewRelativePath?.trim()
      if (!path) return slot
      try {
        const text = (await readRunText(path))?.trim() ?? ''
        return text ? { ...slot, text } : slot
      } catch {
        return slot
      }
    })
  )
}

