import { ensureBuiltinNodeTypes } from './builtinState'
import { isProcessingAssetNode } from './nodeRole'
import { sanitizeGraphGroups } from './groups'
import { canConnectNodes } from './ports'
import { inferNodeTypeId, resolveNodeType } from './registry'
import type { GraphAddScope } from './registry'
import {
  ensureDefaultGraphFromTemplate,
  resolveDefaultGraphTemplate
} from './defaultGraph'
import {
  assetTypeToGraphScope,
  createDefaultScopedGraph,
  getGraphScopeDefinition,
  isAssetEditorGraphScope,
  resolveAssetProcessingTypeId,
  resolveScopeOutput
} from './scopes'
import type {
  GraphDocument,
  GraphEdge,
  GraphNode,
  GraphOutputKind,
  GraphPersistedRunState,
  NormalizeGraphOptions
} from './types'
import {
  graphOutputNodeIdForType,
  isCanonicalGraphOutputNodeId
} from './types'
import { syncNodeAssetRefFields } from '../assetRef'
import { sanitizePersistedRunStates } from './runStatePersist'
import { stripHostInputSlotNodes, type HostInputSlotSpec } from './hostInput'
import { isAssetRefInputHostType } from './nodeRole'
import {
  defaultHostInterfaceForAssetType,
  type HostInterfaceDocument
} from './hostInterface'
import { ensureBoundaryProxyNodes } from './ensureBoundary'
import { inferElementWorkflowHostInterface } from './worldElementParams'

export {
  ASSET_DIRECTOR_OUTPUT_TITLE,
  ASSET_SCREENPLAY_OUTPUT_TITLE,
  SHOT_VISUAL_OUTPUT_TITLE
} from './scopes'

export function createDefaultGraph(_options?: NormalizeGraphOptions): GraphDocument {
  // 分镜默认图：仅加工链，不再插入 classic output.*
  return createDefaultScopedGraph('shotWorkflow')
}

function renameNodeIdInGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  runStates: Record<string, GraphPersistedRunState> | undefined,
  fromId: string,
  toId: string
): void {
  if (fromId === toId) return
  if (nodes.some((n) => n.id === toId)) return
  for (const node of nodes) {
    if (node.id === fromId) node.id = toId
  }
  for (const edge of edges) {
    if (edge.source === fromId) edge.source = toId
    if (edge.target === fromId) edge.target = toId
  }
  if (runStates && fromId in runStates) {
    runStates[toId] = runStates[fromId]!
    delete runStates[fromId]
  }
}

/**
 * 将与当前 type/kind 不符的规范输出 id 校正为 image-output / video-output / …。
 * 不识别历史非规范 id；非法边由 sanitizeEdges 丢弃。
 */
export function syncCanonicalOutputNodeIds(
  nodes: GraphNode[],
  edges: GraphEdge[],
  runStates?: Record<string, GraphPersistedRunState>
): void {
  for (const node of nodes) {
    if (node.category !== 'output') continue
    if (!isCanonicalGraphOutputNodeId(node.id)) continue
    const kind = node.params.outputKind ?? 'video'
    const desired = graphOutputNodeIdForType(node.typeId, kind)
    if (node.id === desired) continue
    renameNodeIdInGraph(nodes, edges, runStates, node.id, desired)
  }
}

function hydrateNode(raw: GraphNode): GraphNode {
  const typeId = inferNodeTypeId(raw)
  const def = resolveNodeType({ ...raw, typeId })
  const params = { ...raw.params }
  if (def?.category === 'output' && !params.outputKind) {
    const fromDef = def.defaultParams().outputKind
    const suffix = typeId.startsWith('output.') ? typeId.slice('output.'.length) : ''
    const fromSuffix =
      suffix === 'video' || suffix === 'image' || suffix === 'voice' || suffix === 'text'
        ? (suffix as GraphOutputKind)
        : undefined
    params.outputKind = fromDef ?? fromSuffix ?? 'video'
  }
  const node: GraphNode = {
    ...raw,
    typeId,
    category: def?.category ?? raw.category,
    params,
    position: { ...raw.position }
  }
  if (raw.size) node.size = { ...raw.size }
  if (def?.assetType && !node.assetType) node.assetType = def.assetType
  const synced = syncNodeAssetRefFields(node)
  // 有 assetId 即视为引用节点；补齐 params.assetRef，避免检查器/执行误走加工路径
  if (synced.category === 'asset' && synced.assetId && synced.params.assetRef !== true) {
    return { ...synced, params: { ...synced.params, assetRef: true } }
  }
  return synced
}

/** 旧 motion 口 out / out-all → 站位复数口 out-shots */
function remapLegacyMotionSourcePort(source: GraphNode, sourcePort?: string): string {
  const isMotion =
    source.typeId === 'asset.motion' ||
    source.assetType === 'motion' ||
    resolveNodeType(source)?.assetType === 'motion'
  if (!isMotion) return sourcePort ?? 'out'
  if (!sourcePort || sourcePort === 'out' || sourcePort === 'out-all') return 'out-shots'
  return sourcePort
}

function sanitizeEdges(
  nodes: GraphNode[],
  edges: GraphEdge[],
  scope: GraphAddScope
): GraphEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  const next: GraphEdge[] = []
  for (const edge of edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) continue
    const sourcePort = remapLegacyMotionSourcePort(source, edge.sourcePort)
    if (!canConnectNodes(source, target, {
      scope,
      sourcePort,
      targetPort: edge.targetPort
    })) {
      continue
    }
    const key = `${edge.source}:${sourcePort}->${edge.target}:${edge.targetPort ?? 'in'}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push({
      id: edge.id || `edge-${crypto.randomUUID()}`,
      source: edge.source,
      target: edge.target,
      sourcePort,
      targetPort: edge.targetPort ?? 'in'
    })
  }
  return next
}

/** 去掉 classic output.*（不兼容旧工程；出口改由 boundary 承担）。剧集 canvas 保留 timeline。 */
function stripClassicOutputNodes(
  scope: GraphAddScope,
  nodes: GraphNode[],
  edges: GraphEdge[],
  runStates?: Record<string, GraphPersistedRunState>
): { nodes: GraphNode[]; edges: GraphEdge[]; runStates?: Record<string, GraphPersistedRunState> } {
  if (scope === 'canvasAsset') {
    return { nodes, edges, runStates }
  }
  const removed = new Set(
    nodes
      .filter((n) => n.category === 'output' || (n.typeId?.startsWith('output.') ?? false))
      .map((n) => n.id)
  )
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

function ensureDirectorProcessingDefaults(nodes: GraphNode[]): void {
  for (const node of nodes) {
    if (node.typeId !== 'asset.motion' || !isProcessingAssetNode(node)) continue
    if (node.params.viewer) continue
    node.params = {
      ...node.params,
      viewer: {
        position: { x: 0, y: 2.2, z: 10 },
        rotation: { x: (5.71 * Math.PI) / 180, y: Math.PI, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        target: { x: 0, y: 1.2, z: 0 },
        fov: 50
      }
    }
  }
}

function finalizeGraph(
  nodes: GraphNode[],
  raw: GraphDocument,
  scope: GraphAddScope
): GraphDocument {
  const edges = Array.isArray(raw.edges) ? raw.edges.map((e) => ({ ...e })) : []
  const runStates = raw.runStates ? { ...raw.runStates } : undefined
  const stripped = stripClassicOutputNodes(scope, nodes, edges, runStates)
  syncCanonicalOutputNodeIds(stripped.nodes, stripped.edges, stripped.runStates)
  const sanitizedEdges = sanitizeEdges(stripped.nodes, stripped.edges, scope)
  return {
    nodes: stripped.nodes,
    edges: sanitizedEdges,
    groups: sanitizeGraphGroups({
      nodes: stripped.nodes,
      edges: sanitizedEdges,
      groups: raw.groups,
      viewport: raw.viewport ?? { x: 0, y: 0, zoom: 1 }
    }),
    viewport: raw.viewport ?? { x: 0, y: 0, zoom: 1 },
    runStates: sanitizePersistedRunStates(
      stripped.runStates,
      stripped.nodes.map((node) => node.id)
    )
  }
}

/** 按作用域规范化图：过滤节点、校正输出、确保单例 */
export function normalizeScopedGraph(
  scope: GraphAddScope,
  raw: GraphDocument | null | undefined,
  options?: {
    assetType?: string | null
    hostAssetId?: string | null
    hasMediaFile?: boolean
    /** 外层宿主入边展开的输入接口槽位；打开宿主编辑器时传入 */
    parentHostInputSlots?: HostInputSlotSpec[]
    /**
     * 该宿主资产已保存的接口（genParams.hostInterface）。
     * 必须传入，否则封装出的自定义端口会被默认模板剪掉。
     */
    hostInterface?: HostInterfaceDocument | null
  }
): GraphDocument {
  ensureBuiltinNodeTypes()
  const scopeDef = getGraphScopeDefinition(scope)
  const chainOptions = {
    hostAssetId: options?.hostAssetId,
    hasMediaFile: options?.hasMediaFile
  }
  const hostInterface = (): HostInterfaceDocument => {
    if (options?.hostInterface) return options.hostInterface
    // elementWorkflow 不能用 world 宿主默认接口（text 入 / worldEntities 出），
    // 否则会注入错误的边界输入，并剪掉元素图的 image 边界输出。
    if (scope === 'elementWorkflow') {
      return inferElementWorkflowHostInterface(raw)
    }
    return defaultHostInterfaceForAssetType(options?.assetType)
  }
  if (!raw?.nodes?.length) {
    let created = createDefaultScopedGraph(scope, options?.assetType, chainOptions)
    // HDA：可宿主类型默认图只补 boundary 入/出口
    if (scope === 'elementWorkflow' || isAssetRefInputHostType(options?.assetType)) {
      created = ensureBoundaryProxyNodes(created, hostInterface())
    }
    return created
  }

  const doc = {
    ...raw,
    nodes: raw.nodes.map((node) => ({ ...node }))
  }

  const edges = Array.isArray(doc.edges) ? doc.edges.map((edge) => ({ ...edge })) : []
  const runStates = doc.runStates ? { ...doc.runStates } : undefined

  let nodes = doc.nodes.map(hydrateNode)
  if (scopeDef.persistNode) {
    nodes = nodes.filter(scopeDef.persistNode)
  }

  if (scope === 'directorAsset') {
    ensureDirectorProcessingDefaults(nodes)
  }

  // 仅资产编辑器在打开已有图时按模板补齐加工节点（导入媒体宿主绑定）；
  // 分镜/世界/叙事长链不在加载时回插已删节点。
  if (isAssetEditorGraphScope(scope)) {
    ensureDefaultGraphFromTemplate(nodes, edges, {
      scope,
      assetType: options?.assetType,
      template: resolveDefaultGraphTemplate(scope, options?.assetType),
      output: resolveScopeOutput(scope, options?.assetType),
      ensureOutput: false,
      processingTypeId: resolveAssetProcessingTypeId(scope, options?.assetType),
      hostAssetId: chainOptions.hostAssetId,
      hasMediaFile: chainOptions.hasMediaFile
    })
  }

  let workingEdges = edges
  let workingStates = runStates
  // HDA：去掉 classic「文本输入/图片输入」槽，只保留 boundary
  if (scope === 'elementWorkflow' || isAssetRefInputHostType(options?.assetType)) {
    const strippedSlots = stripHostInputSlotNodes(nodes, workingEdges, workingStates)
    nodes = strippedSlots.nodes
    workingEdges = strippedSlots.edges
    workingStates = strippedSlots.runStates
  }

  let result = finalizeGraph(nodes, { ...doc, edges: workingEdges, runStates: workingStates }, scope)
  if (scope === 'elementWorkflow' || isAssetRefInputHostType(options?.assetType)) {
    result = ensureBoundaryProxyNodes(result, hostInterface())
  }
  return result
}

export function normalizeGraph(
  raw: GraphDocument | null | undefined,
  _options?: NormalizeGraphOptions
): GraphDocument {
  ensureBuiltinNodeTypes()
  if (!raw?.nodes?.length) {
    return createDefaultGraph()
  }

  const doc = {
    ...raw,
    nodes: raw.nodes.map((node) => ({ ...node }))
  }

  const hydrated = doc.nodes.map(hydrateNode)
  return finalizeGraph(hydrated, doc, 'shotWorkflow')
}

/** 资产宿主：按资产类型校正输出节点语义 */
export function normalizeAssetGraph(
  raw: GraphDocument | null | undefined,
  assetType?: string | null,
  options?: {
    hostAssetId?: string | null
    hasMediaFile?: boolean
    parentHostInputSlots?: HostInputSlotSpec[]
    hostInterface?: HostInterfaceDocument | null
  }
): GraphDocument {
  return normalizeScopedGraph(assetTypeToGraphScope(assetType), raw, {
    assetType,
    hostAssetId: options?.hostAssetId,
    hasMediaFile: options?.hasMediaFile,
    parentHostInputSlots: options?.parentHostInputSlots,
    hostInterface: options?.hostInterface
  })
}
