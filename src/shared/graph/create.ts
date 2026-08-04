import type { AssetType } from '../domain'
import { tagAssetRef } from '../assetRef'
import './builtins'
import { ensureBuiltinNodeTypes } from './builtinState'
import {
  assetTypeToNodeTypeId,
  getNodeTypeOrThrow,
  inferNodeTypeId,
  outputKindToNodeTypeId,
  resolveNodeType
} from './registry'
import { getNodePorts } from './ports'
import type {
  GraphNode,
  GraphNodeCategory,
  GraphNodeTypeId,
  GraphOutputKind
} from './types'
import { graphOutputNodeId, graphOutputNodeIdForType, isCanonicalGraphOutputNodeId } from './types'

const ASSET_NODE_TITLES: Record<AssetType, string> = {
  image: 'Image',
  video: 'Video',
  voice: 'voice',
  motion: 'Director Deck',
  model: 'Model',
  screenplay: 'Screenplay',
  script: 'Shot',
  canvas: 'Canvas',
  world: 'World Elements',
  beat: 'Beat Units',
  subgraph: 'Host Asset'
}

export function assetTypeToGraphNodeTitle(type: AssetType, name?: string): string {
  return name?.trim() || ASSET_NODE_TITLES[type] || type
}

export function getNodeDefaultSize(categoryOrType: GraphNodeCategory | GraphNodeTypeId): {
  w: number
  h: number
} {
  ensureBuiltinNodeTypes()
  if (categoryOrType === 'output' || categoryOrType === 'asset' || categoryOrType === 'note') {
    const fallback =
      categoryOrType === 'output'
        ? 'output.video'
        : categoryOrType === 'note'
          ? 'note.text'
          : 'asset.image'
    return { ...getNodeTypeOrThrow(fallback).defaultSize }
  }
  return { ...getNodeTypeOrThrow(categoryOrType).defaultSize }
}

/**
 * 节点标题栏约占高度（与 GraphNodeCard `.node-head` / 收起高度相关）。
 * 端口纵向排布按整卡高度（含标题栏）均匀分布，不再从标题栏下方起算。
 */
export const GRAPH_NODE_HEAD_HEIGHT_PX = 30

/** 收起预览后的节点高度（约等于标题栏） */
export const GRAPH_NODE_COLLAPSED_HEIGHT_PX = 34

export function getNodeSize(node: GraphNode): { w: number; h: number } {
  ensureBuiltinNodeTypes()
  const def = resolveNodeType(node)
  const defaults = def?.defaultSize ?? getNodeDefaultSize(node.category)
  const w = node.size?.w ?? defaults.w
  const h = node.size?.h ?? defaults.h
  // 收起预览时高度压到标题栏；展开时仍用节点保存的 size.h
  // 输入接口 / boundary 默认折叠（仅 previewCollapsed === false 时展开）
  const collapsed =
    node.typeId === 'graph.input.slot' ||
    node.typeId === 'graph.boundary.input' ||
    node.typeId === 'graph.boundary.output'
      ? node.params?.previewCollapsed !== false
      : node.params?.previewCollapsed === true
  if (collapsed) {
    return { w, h: GRAPH_NODE_COLLAPSED_HEIGHT_PX }
  }
  return { w, h }
}

export function clampNodeSize(
  categoryOrNode: GraphNodeCategory | GraphNode,
  w: number,
  h: number
): { w: number; h: number } {
  ensureBuiltinNodeTypes()
  const def =
    typeof categoryOrNode === 'string'
      ? resolveNodeType({
          category: categoryOrNode,
          params: {},
          typeId: inferNodeTypeId({ category: categoryOrNode, params: {} })
        })
      : resolveNodeType(categoryOrNode)
  const limits = def?.sizeLimits ?? { minW: 120, minH: 72, maxW: 480, maxH: 400 }
  return {
    w: Math.round(Math.min(limits.maxW, Math.max(limits.minW, w))),
    h: Math.round(Math.min(limits.maxH, Math.max(limits.minH, h)))
  }
}

/**
 * 按预览图/视频像素比计算节点尺寸：横图锚默认宽、竖图锚默认高，再钳制到 sizeLimits。
 */
export function fitNodeSizeToMediaAspect(
  node: GraphNode,
  mediaW: number,
  mediaH: number
): { w: number; h: number } {
  if (!(mediaW > 0 && mediaH > 0) || !Number.isFinite(mediaW) || !Number.isFinite(mediaH)) {
    return getNodeSize(node)
  }
  ensureBuiltinNodeTypes()
  const def = resolveNodeType(node)
  const defaults = def?.defaultSize ?? getNodeDefaultSize(node.category)
  const limits = def?.sizeLimits ?? { minW: 120, minH: 72, maxW: 480, maxH: 400 }
  const aspect = mediaW / mediaH

  let w: number
  let h: number
  if (aspect >= 1) {
    w = defaults.w
    h = w / aspect
  } else {
    h = defaults.h
    w = h * aspect
  }

  if (w > limits.maxW) {
    w = limits.maxW
    h = w / aspect
  }
  if (h > limits.maxH) {
    h = limits.maxH
    w = h * aspect
  }
  if (w < limits.minW) {
    w = limits.minW
    h = w / aspect
  }
  if (h < limits.minH) {
    h = limits.minH
    w = h * aspect
  }

  return clampNodeSize(node, w, h)
}

export function createNodeFromType(
  typeId: GraphNodeTypeId,
  position: { x: number; y: number },
  overrides?: Partial<
    Pick<GraphNode, 'id' | 'assetId' | 'assetRef' | 'assetType' | 'title' | 'params'>
  >
): GraphNode {
  ensureBuiltinNodeTypes()
  const def = getNodeTypeOrThrow(typeId)
  const id = overrides?.id ?? def.singletonId ?? `node-${crypto.randomUUID()}`
  const assetId = overrides?.assetId
  return {
    id,
    typeId: def.typeId,
    category: def.category,
    assetId,
    assetRef: overrides?.assetRef ?? (assetId ? tagAssetRef(assetId) : undefined),
    assetType: overrides?.assetType ?? def.assetType,
    position: { ...position },
    params: { ...def.defaultParams(), ...overrides?.params },
    title: overrides?.title ?? def.defaultTitle
  }
}

export function createAssetGraphNode(
  assetId: string,
  assetType: AssetType,
  name: string,
  position: { x: number; y: number },
  options?: {
    assetHost?: boolean
    hostInterfaceSnapshot?: GraphNode['params']['hostInterfaceSnapshot']
    hostSchemaVersion?: number
  }
): GraphNode {
  return createNodeFromType(assetTypeToNodeTypeId(assetType), position, {
    assetId,
    assetRef: tagAssetRef(assetId),
    assetType,
    title: assetTypeToGraphNodeTitle(assetType, name),
    params: {
      assetRef: true,
      ...(options?.assetHost ? { assetHost: true } : {}),
      ...(options?.hostInterfaceSnapshot
        ? { hostInterfaceSnapshot: options.hostInterfaceSnapshot }
        : {}),
      ...(typeof options?.hostSchemaVersion === 'number'
        ? { hostSchemaVersion: options.hostSchemaVersion }
        : {})
    }
  })
}

export function createNoteGraphNode(position: { x: number; y: number }): GraphNode {
  return createNodeFromType('note.text', position)
}

export function createOutputGraphNode(
  kind: GraphOutputKind,
  position: { x: number; y: number },
  options?: { id?: string; title?: string; params?: GraphNode['params'] }
): GraphNode {
  return createNodeFromType(outputKindToNodeTypeId(kind), position, {
    id: options?.id ?? graphOutputNodeId(kind),
    title: options?.title,
    params: { outputKind: kind, ...options?.params }
  })
}

/**
 * 端口纵向比例（相对节点总高）：在包含标题栏的整张卡片内均匀分布。
 * 与 GraphNodeCard `portWrapStyle` 使用同一公式，保证连线锚点对齐。
 * 收起（高度接近标题栏）时在整卡高度内额外留边。
 */
export function nodePortYRatio(
  portIndex: number,
  portCount: number,
  nodeHeight: number
): number {
  if (portCount <= 0) return 0.5
  const h = Math.max(1, nodeHeight)
  const frac = (portIndex + 1) / (portCount + 1)
  if (h <= GRAPH_NODE_COLLAPSED_HEIGHT_PX + 4) {
    const pad = 0.18
    return pad + (1 - 2 * pad) * frac
  }
  return frac
}

export function getNodePortCenter(
  node: GraphNode,
  side: 'left' | 'right',
  portId?: string
): { x: number; y: number } {
  const { w, h } = getNodeSize(node)
  // 必须用 getNodePorts（含动态首/尾帧口），与节点卡片 DOM 排布一致
  const ports = getNodePorts(node).filter((p) =>
    side === 'left' ? p.direction === 'in' : p.direction === 'out'
  )
  let yRatio = 0.5
  if (ports.length > 0) {
    const idx = portId ? ports.findIndex((p) => p.id === portId) : 0
    const i = idx >= 0 ? idx : 0
    yRatio = nodePortYRatio(i, ports.length, h)
  }
  return {
    x: node.position.x + (side === 'right' ? w : 0),
    y: node.position.y + h * yRatio
  }
}

export function isNodeDeletable(node: GraphNode): boolean {
  ensureBuiltinNodeTypes()
  const def = resolveNodeType(node)
  // 显式可删优先于单例 / 规范输出（如场链）
  if (def?.deletable === true) return true
  // 规范输出单例不可删；画布上额外添加的输出节点可删
  const canonicalId = graphOutputNodeIdForType(
    node.typeId,
    node.params.outputKind ?? def?.defaultParams().outputKind ?? 'video'
  )
  if (node.id === canonicalId || (isCanonicalGraphOutputNodeId(node.id) && node.category === 'output')) {
    return false
  }
  if (def?.singletonId != null && node.id === def.singletonId) {
    return false
  }
  if (def?.deletable === false) {
    if (def.category === 'output') return true
    return false
  }
  return true
}
