import type { AssetType } from '../domain'
import { isAssetRefInputHostType } from './nodeRole'
import { resolveAssetTextFromGenParams } from './assetText'
import { getNodePorts } from './ports'
import type { GraphAddScope } from './scopes'
import { resolveNodeTextContent, textFromGraphValue } from './textOutput'
import {
  stringifyWorldElementGenResults,
  type WorldElementGenResult
} from './worldElementParse'
import type {
  GraphDocument,
  GraphEdge,
  GraphNode,
  GraphNodeParams,
  GraphPersistedRunState,
  GraphPortDataType
} from './types'
import { GraphPortType } from './types'
import type { GraphValue } from './execute/types'

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
  if (
    dataType !== GraphPortType.text &&
    dataType !== GraphPortType.image &&
    dataType !== GraphPortType.video &&
    dataType !== GraphPortType.voice &&
    dataType !== GraphPortType.model &&
    dataType !== GraphPortType.worldEntities &&
    dataType !== GraphPortType.narrative
  ) {
    return null
  }
  return { portId, index, dataType }
}

export function isHostInputSlotNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === GRAPH_INPUT_SLOT_TYPE_ID
}

/** 宿主资产类型 → 外层入端口列表（与 builtins 宿主口一致，避免循环依赖探测节点） */
export function listHostInputPortDefs(assetType: AssetType): Array<{
  id: string
  dataType: GraphPortDataType
}> {
  if (!isAssetRefInputHostType(assetType)) return []
  switch (assetType) {
    case 'screenplay':
    case 'world':
      return [{ id: 'in', dataType: GraphPortType.text }]
    case 'narrative':
      return [{ id: 'in', dataType: GraphPortType.text }]
    case 'script':
      // 叙事目录由 sync 物化为 unitRef 链，编辑图内不建 in-narrative 输入槽
      return [{ id: 'in-worldEntities', dataType: GraphPortType.worldEntities }]
    case 'image':
    case 'voice':
      return [
        { id: 'in-text', dataType: GraphPortType.text },
        { id: 'in-image', dataType: GraphPortType.image }
      ]
    case 'video':
      return [
        { id: 'in-text', dataType: GraphPortType.text },
        { id: 'in-image', dataType: GraphPortType.image },
        { id: 'in-video', dataType: GraphPortType.video },
        { id: 'in-voice', dataType: GraphPortType.voice }
      ]
    default:
      return []
  }
}

/**
 * 打开即同步「输入接口」的宿主资产编辑器 scope。
 * 子图（shotWorkflow / visual / narrativeUnit / elementWorkflow）不参与。
 */
export function isHostInputSlotEditorScope(scope: GraphAddScope): boolean {
  return (
    scope === 'screenplayAsset' ||
    scope === 'scriptAsset' ||
    scope === 'worldAsset' ||
    scope === 'narrativeAsset' ||
    scope === 'workflow'
  )
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
  if (value.kind === 'text') return { text: value.text }
  if (value.kind === 'narrative') return { text: value.text }
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
    value.kind === 'narrative' ||
    value.kind === 'shots'
  ) {
    return { text: value.text }
  }
  if (value.kind === 'asset') {
    return { text: value.notes || value.title || undefined }
  }
  return {}
}

function graphValueHasPayload(value: GraphValue | undefined): boolean {
  if (!value) return false
  if (value.kind === 'text') return !!value.text.trim()
  if (
    value.kind === 'world' ||
    value.kind === 'worldEntities' ||
    value.kind === 'shotEntities' ||
    value.kind === 'videoEntities' ||
    value.kind === 'narrative' ||
    value.kind === 'shots'
  ) {
    return !!value.text.trim()
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
 * 从 runStates 或源节点参数软解析输出口值（父图未跑完也能拿到正文）。
 */
function softResolveSourceOutput(
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
      // 世界元素提取 / 叙事单元拆解：选中项输出目录口（与 table 相连）
      if (node.typeId === 'world.extract') {
        const text = picked?.text ?? ''
        return picked?.relativePath?.trim()
          ? { kind: 'world', text, relativePath: picked.relativePath.trim() }
          : { kind: 'world', text }
      }
      if (node.typeId === 'narrative.split') {
        const text = picked?.text ?? ''
        return picked?.relativePath?.trim()
          ? { kind: 'narrative', text, relativePath: picked.relativePath.trim() }
          : { kind: 'narrative', text }
      }
      return {
        kind: 'text',
        text: picked?.text ?? '',
        id: picked?.id,
        ...(picked?.relativePath ? { relativePath: picked.relativePath } : {})
      }
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
    if (sourcePort === 'out-all') {
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

  // 世界元素宿主 / 生成：优先实体目录 JSON
  if (
    (node.typeId === 'world.gen' || node.assetType === 'world' || node.typeId === 'asset.world') &&
    (sourcePort === 'out' || !sourcePort)
  ) {
    const fromParams = Array.isArray(node.params.worldElementOutputs)
      ? (node.params.worldElementOutputs as WorldElementGenResult[])
      : []
    if (fromParams.length) {
      const text = stringifyWorldElementGenResults(
        fromParams.filter((item) => item?.type && item?.name && item?.imageUrl)
      )
      if (text.trim()) return { kind: 'worldEntities', text }
    }
    const local = node.params.text?.trim() || node.params.resultText?.trim() || ''
    if (local && (local.startsWith('[') || local.startsWith('{'))) {
      return { kind: 'worldEntities', text: local }
    }
  }

  // 叙事宿主：读 genParams.narrativeCatalog
  if (
    (node.assetType === 'narrative' || node.typeId === 'asset.narrative') &&
    (sourcePort === 'out' || !sourcePort) &&
    node.assetId
  ) {
    const gen = options?.resolveAssetGenParams?.(node.assetId)
    const raw = gen?.narrativeCatalog
    if (typeof raw === 'string' && raw.trim()) {
      return { kind: 'narrative', text: raw }
    }
    if (Array.isArray(raw) && raw.length) {
      return { kind: 'narrative', text: JSON.stringify(raw) }
    }
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
    if (node.assetType === 'video' || node.typeId.includes('video')) {
      return {
        kind: 'video',
        dataUrl: previewUrl,
        relativePath: previewPath
      }
    }
    if (node.assetType === 'voice' || node.typeId.includes('voice')) {
      return {
        kind: 'voices',
        items: [{ relativePath: previewPath }]
      }
    }
    return {
      kind: 'image',
      dataUrl: previewUrl ?? '',
      relativePath: previewPath
    }
  }

  // 资产引用：读资产正文 / genParams
  if (node.assetId) {
    const fromResolver = options?.resolveAssetText?.(node.assetId)?.trim()
    if (fromResolver) return { kind: 'text', text: fromResolver }
    const gen = options?.resolveAssetGenParams?.(node.assetId)
    const fromGen = resolveAssetTextFromGenParams(gen, node.params).trim()
    if (fromGen) return { kind: 'text', text: fromGen }
  }

  const live = textFromGraphValue(fromRun)
  if (live.trim()) return fromRun
  return fromRun
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
    (node) =>
      node.assetId === hostAssetId &&
      (node.params.assetHost === true || node.params.assetRef === true)
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
                : slot.dataType === GraphPortType.narrative
                  ? `输入·叙事 ${slot.index + 1}`
                  : `输入 ${slot.index + 1}`)

    const slotParams: GraphNodeParams = {
      hostInputSlot: {
        portId: slot.portId,
        index: slot.index,
        dataType: slot.dataType
      },
      ...(slot.text != null ? { text: slot.text } : {}),
      ...(slot.previewRelativePath != null
        ? { previewRelativePath: slot.previewRelativePath }
        : {}),
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
      node.params = {
        ...node.params,
        ...slotParams,
        // 有外层预览时覆盖；否则保留节点上已有缓存
        text: slot.text != null ? slot.text : node.params.text,
        previewRelativePath:
          slot.previewRelativePath != null
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

  const heads = nodes.filter((n) => headTypeIds.includes(n.typeId))
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
          out = { kind: 'text', text: item?.text ?? '' }
        } else if (value.kind === 'text') {
          out = value
        } else if (value.kind === 'narrative') {
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

