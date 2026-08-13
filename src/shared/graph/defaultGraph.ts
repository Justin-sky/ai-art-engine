import type { AssetType } from '../domain'
import { isMediaFileAsset, normalizeAssetType } from '../domain'
import { tagAssetRef } from '../assetRef'
import {
  assetTypeToGraphNodeTitle,
  createAssetGraphNode,
  createNodeFromType
} from './create'
import { getNodeTypeOrThrow } from './registry'
import { isProcessingAssetNode } from './nodeRole'
import type {
  GraphDocument,
  GraphEdge,
  GraphNode,
  GraphNodeParams,
  GraphNodeTypeId,
  GraphOutputKind,
  GraphPortDataType
} from './types'
import { GRAPH_OUTPUT_NODE_IDS } from './types'

/** 默认图节点：固定 typeId，或按角色解析（加工 / 作用域输出） */
export interface DefaultGraphNodeSpec {
  key: string
  typeId?: GraphNodeTypeId
  /** 可选稳定 id（空态默认链等）；缺省走类型 singletonId 或随机 */
  id?: string
  /** processing / scopeOutput 由 materialize 上下文解析 */
  role?: 'processing' | 'scopeOutput'
  x: number
  y: number
  title?: string
  params?: Partial<GraphNodeParams>
}

export interface DefaultGraphEdgeSpec {
  from: string
  to: string
  fromPort?: string
  toPort?: string
}

export interface DefaultGraphTemplate {
  nodes: DefaultGraphNodeSpec[]
  edges: DefaultGraphEdgeSpec[]
  /** 宿主输入接口自动挂到该 key 对应节点 */
  inputLinkTo?: string | string[]
}

export type DefaultGraphTemplateResolver = (ctx: {
  assetType?: string | null
}) => DefaultGraphTemplate | null

export interface DefaultGraphOutputConfig {
  kind: GraphOutputKind
  title: string
  inputDataType?: GraphPortDataType
  typeId?: GraphNodeTypeId
}

export interface MaterializeDefaultGraphContext {
  scope: string
  assetType?: string | null
  template: DefaultGraphTemplate | null
  output: DefaultGraphOutputConfig
  /** ensureOutput === false 时为 false */
  ensureOutput?: boolean
  processingTypeId?: GraphNodeTypeId | null
  hostAssetId?: string | null
  hasMediaFile?: boolean
}

function mediaProcessingTemplate(assetType: string | null | undefined): DefaultGraphTemplate | null {
  const type = assetType ? normalizeAssetType(assetType) : null
  if (!type || !isMediaFileAsset(type)) return null
  return {
    nodes: [{ key: 'gen', role: 'processing', x: 240, y: 160 }],
    edges: [],
    inputLinkTo: 'gen'
  }
}

/** 各作用域默认图模板（新建图唯一来源；出口由 HDA boundary 承担，不再插入 classic output.*） */
export const DEFAULT_GRAPH_TEMPLATES: Record<
  string,
  DefaultGraphTemplate | DefaultGraphTemplateResolver
> = {
  workflow: ({ assetType }) => mediaProcessingTemplate(assetType),
  screenplayAsset: {
    nodes: [{ key: 'gen', typeId: 'asset.screenplay', x: 240, y: 160 }],
    edges: [],
    inputLinkTo: 'gen'
  },
  directorAsset: {
    nodes: [{ key: 'gen', typeId: 'asset.motion', x: 240, y: 160 }],
    edges: []
  },
  beatUnit: {
    nodes: [{ key: 'gen', typeId: 'beat.unitGen', x: 300, y: 160 }],
    edges: []
  },
  worldAsset: {
    nodes: [
      { key: 'extract', typeId: 'world.extract', x: 120, y: 160 },
      { key: 'table', typeId: 'world.table', x: 340, y: 160 },
      { key: 'gen', typeId: 'world.gen', x: 560, y: 160 }
    ],
    edges: [
      { from: 'extract', to: 'table', fromPort: 'out', toPort: 'in' },
      { from: 'table', to: 'gen', fromPort: 'out', toPort: 'in' }
    ],
    inputLinkTo: 'extract'
  },
  beatAsset: {
    nodes: [
      { key: 'split', typeId: 'beat.split', x: 120, y: 160 },
      { key: 'table', typeId: 'beat.table', x: 340, y: 160 }
    ],
    edges: [{ from: 'split', to: 'table', fromPort: 'out', toPort: 'in' }],
    inputLinkTo: 'split'
  }
}

export function resolveDefaultGraphTemplate(
  scope: string,
  assetType?: string | null
): DefaultGraphTemplate | null {
  const entry = DEFAULT_GRAPH_TEMPLATES[scope]
  if (!entry) return null
  if (typeof entry === 'function') return entry({ assetType })
  return entry
}

function resolveNodeTypeId(
  spec: DefaultGraphNodeSpec,
  ctx: MaterializeDefaultGraphContext
): GraphNodeTypeId | null {
  if (spec.typeId) return spec.typeId
  if (spec.role === 'processing') return ctx.processingTypeId ?? null
  // classic scopeOutput 已废弃，模板中不应再出现
  if (spec.role === 'scopeOutput') return null
  return null
}

function createTemplateNode(
  spec: DefaultGraphNodeSpec,
  typeId: GraphNodeTypeId,
  _ctx: MaterializeDefaultGraphContext
): GraphNode {
  const position = { x: spec.x, y: spec.y }
  const typeDef = getNodeTypeOrThrow(typeId)
  const node = createNodeFromType(
    typeId,
    position,
    spec.id || typeDef.singletonId ? { id: spec.id ?? typeDef.singletonId } : undefined
  )
  if (spec.title) node.title = spec.title
  if (spec.params) node.params = { ...node.params, ...spec.params }
  return node
}

function pushEdge(
  edges: GraphEdge[],
  sourceId: string,
  targetId: string,
  sourcePort: string,
  targetPort: string
): void {
  const linked = edges.some(
    (edge) =>
      edge.source === sourceId &&
      edge.target === targetId &&
      (edge.sourcePort ?? 'out') === sourcePort &&
      (edge.targetPort ?? 'in') === targetPort
  )
  if (linked) return
  edges.push({
    id: `edge-${crypto.randomUUID()}`,
    source: sourceId,
    target: targetId,
    sourcePort,
    targetPort
  })
}

function shouldUseHostMediaRef(ctx: MaterializeDefaultGraphContext): boolean {
  if (ctx.scope !== 'workflow') return false
  if (!ctx.hostAssetId || !ctx.hasMediaFile) return false
  return isMediaFileAsset(ctx.assetType)
}

function bindNodeToHostMedia(
  node: GraphNode,
  hostAssetId: string,
  assetType: AssetType,
  title?: string
): void {
  node.assetId = hostAssetId
  node.assetRef = tagAssetRef(hostAssetId)
  node.assetType = assetType
  node.params = { ...node.params, assetRef: true }
  if (title?.trim()) node.title = title.trim()
}

/** 按模板物化整张默认图（新建路径） */
export function materializeDefaultGraph(ctx: MaterializeDefaultGraphContext): GraphDocument {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const keyToId = new Map<string, string>()
  const template = ctx.template

  if (!template) {
    return { nodes, edges, groups: [], viewport: { x: 0, y: 0, zoom: 1 } }
  }

  const useHostRef = shouldUseHostMediaRef(ctx)

  for (const spec of template.nodes) {
    const typeId = resolveNodeTypeId(spec, ctx)
    if (!typeId) continue

    if (useHostRef && (spec.role === 'processing' || spec.key === 'gen')) {
      const type = normalizeAssetType(ctx.assetType!)
      const host = createAssetGraphNode(ctx.hostAssetId!, type, assetTypeToGraphNodeTitle(type), {
        x: spec.x,
        y: spec.y
      })
      nodes.push(host)
      keyToId.set(spec.key, host.id)
      continue
    }

    const node = createTemplateNode(spec, typeId, ctx)
    nodes.push(node)
    keyToId.set(spec.key, node.id)
  }

  for (const edge of template.edges) {
    const sourceId = keyToId.get(edge.from)
    const targetId = keyToId.get(edge.to)
    if (!sourceId || !targetId) continue
    pushEdge(edges, sourceId, targetId, edge.fromPort ?? 'out', edge.toPort ?? 'in')
  }

  return { nodes, edges, groups: [], viewport: { x: 0, y: 0, zoom: 1 } }
}

/** 打开已有图：按模板补齐缺失关键节点与边（不再补 classic output.*） */
export function ensureDefaultGraphFromTemplate(
  nodes: GraphNode[],
  edges: GraphEdge[],
  ctx: MaterializeDefaultGraphContext
): void {
  const template = ctx.template
  if (!template) return

  if (shouldUseHostMediaRef(ctx)) {
    ensureHostMediaRefGraph(nodes, edges, ctx)
    return
  }

  const keyToId = new Map<string, string>()
  for (const spec of template.nodes) {
    const typeId = resolveNodeTypeId(spec, ctx)
    if (!typeId || typeId.startsWith('output.')) continue
    let node = nodes.find(
      (n) =>
        n.typeId === typeId && (spec.role !== 'processing' || isProcessingAssetNode(n))
    )
    if (!node) {
      node = createTemplateNode(spec, typeId, ctx)
      nodes.push(node)
    }
    keyToId.set(spec.key, node.id)
  }

  for (const edge of template.edges) {
    const sourceId = keyToId.get(edge.from)
    const targetId = keyToId.get(edge.to)
    if (!sourceId || !targetId) continue
    pushEdge(edges, sourceId, targetId, edge.fromPort ?? 'out', edge.toPort ?? 'in')
  }
}

function ensureHostMediaRefGraph(
  nodes: GraphNode[],
  _edges: GraphEdge[],
  ctx: MaterializeDefaultGraphContext
): void {
  const processingTypeId = ctx.processingTypeId
  if (!processingTypeId || !ctx.hostAssetId) return
  const type = normalizeAssetType(ctx.assetType!)
  const title = assetTypeToGraphNodeTitle(type)
  let hostNode =
    nodes.find((node) => node.typeId === processingTypeId && node.assetId === ctx.hostAssetId) ??
    undefined
  if (!hostNode) {
    const processing = nodes.find(
      (node) => node.typeId === processingTypeId && isProcessingAssetNode(node)
    )
    if (processing) {
      bindNodeToHostMedia(processing, ctx.hostAssetId, type, processing.title || title)
      hostNode = processing
    }
  }
  if (!hostNode) {
    hostNode = createAssetGraphNode(ctx.hostAssetId, type, title, { x: 240, y: 160 })
    nodes.push(hostNode)
  } else {
    bindNodeToHostMedia(hostNode, ctx.hostAssetId, type, hostNode.title || title)
  }
}

/** 输入接口自动连接的链首 typeId（来自模板 inputLinkTo） */
export function resolveInputLinkHeadTypeIds(
  scope: string,
  assetType?: string | null,
  processingTypeId?: GraphNodeTypeId | null
): string[] {
  const template = resolveDefaultGraphTemplate(scope, assetType)
  if (!template?.inputLinkTo) return []
  const keys = Array.isArray(template.inputLinkTo)
    ? template.inputLinkTo
    : [template.inputLinkTo]
  const typeIds: string[] = []
  for (const key of keys) {
    const spec = template.nodes.find((n) => n.key === key)
    if (!spec) continue
    if (spec.typeId) {
      typeIds.push(spec.typeId)
      continue
    }
    if (spec.role === 'processing' && processingTypeId) {
      typeIds.push(processingTypeId)
    }
  }
  return typeIds
}

/** 新建画布默认图：预置成片时间线输出节点（资产库新建画布不调用） */
export function buildCanvasStarterGraph(): GraphDocument {
  const timeline = createNodeFromType(
    'output.timeline',
    { x: 240, y: 160 },
    { id: GRAPH_OUTPUT_NODE_IDS.timeline }
  )
  return {
    nodes: [timeline],
    edges: [],
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}
