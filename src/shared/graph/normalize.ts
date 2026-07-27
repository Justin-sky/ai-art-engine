import { ensureBuiltinNodeTypes } from './builtinState'
import { createOutputGraphNode } from './create'
import { isProcessingAssetNode } from './nodeRole'
import { sanitizeGraphGroups } from './groups'
import { canConnectNodes } from './ports'
import { inferNodeTypeId, resolveNodeType } from './registry'
import type { GraphAddScope } from './registry'
import {
  ensureDefaultGraphFromTemplate,
  resolveDefaultGraphTemplate,
  resolveInputLinkHeadTypeIds
} from './defaultGraph'
import {
  assetTypeToGraphScope,
  createDefaultScopedGraph,
  createScopeOutputNode,
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
  GraphPortType,
  graphOutputNodeId,
  graphOutputNodeIdForType,
  isCanonicalGraphOutputNodeId
} from './types'
import { syncNodeAssetRefFields } from '../assetRef'
import { sanitizePersistedRunStates } from './runStatePersist'
import {
  ensureHostInputSlotNodes,
  isHostInputSlotEditorScope,
  mergeHostInputSlotsWithDefaults,
  type HostInputSlotSpec
} from './hostInput'
import { isAssetRefInputHostType } from './nodeRole'
import type { AssetType } from '../domain'

export {
  ASSET_DIRECTOR_OUTPUT_TITLE,
  ASSET_SCREENPLAY_OUTPUT_TITLE,
  SHOT_VISUAL_OUTPUT_TITLE
} from './scopes'

export function createDefaultGraph(options?: NormalizeGraphOptions): GraphDocument {
  ensureBuiltinNodeTypes()
  const kind: GraphOutputKind = options?.outputKind ?? 'video'
  const title = options?.outputTitle ?? (kind === 'video' ? 'Shot video output' : undefined)
  return {
    nodes: [
      createOutputGraphNode(kind, { x: 480, y: 160 }, {
        id: options?.outputNodeId ?? graphOutputNodeId(kind),
        title
      })
    ],
    edges: [],
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
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
 * 将遗留 `shot-output` 及与当前 type/kind 不符的规范输出 id 校正为
 * image-output / video-output / …。
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
    if (!canConnectNodes(source, target, {
      scope,
      sourcePort: edge.sourcePort,
      targetPort: edge.targetPort
    })) {
      continue
    }
    const key = `${edge.source}:${edge.sourcePort ?? 'out'}->${edge.target}:${edge.targetPort ?? 'in'}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push({
      id: edge.id || `edge-${crypto.randomUUID()}`,
      source: edge.source,
      target: edge.target,
      sourcePort: edge.sourcePort ?? 'out',
      targetPort: edge.targetPort ?? 'in'
    })
  }
  return next
}

function applyScopeOutput(
  nodes: GraphNode[],
  scope: GraphAddScope,
  assetType?: string | null
): void {
  const output = resolveScopeOutput(scope, assetType)
  const targetTypeId = output.typeId ?? (`output.${output.kind}` as const)
  for (const node of nodes) {
    if (node.category !== 'output') continue
    node.params = {
      ...node.params,
      outputKind: output.kind,
      ...(output.inputDataType ? { inputDataType: output.inputDataType } : {})
    }
    node.typeId = targetTypeId
    if (output.title) node.title = output.title
  }
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

function ensureScopeOutput(nodes: GraphNode[], scope: GraphAddScope, assetType?: string | null): void {
  const scopeDef = getGraphScopeDefinition(scope)
  if (scopeDef.ensureOutput === false) return
  const output = resolveScopeOutput(scope, assetType)
  const hasOutput = nodes.some((node) => node.category === 'output')
  if (hasOutput) return
  nodes.push(createScopeOutputNode(output, { x: 480, y: 160 }))
}

/** 世界元素输出：强制入端口为 worldEntities（旧图可能仍是 image） */
function migrateWorldOutputEntities(nodes: GraphNode[]): void {
  for (const node of nodes) {
    if (node.typeId !== 'output.world') continue
    node.params = {
      ...node.params,
      outputKind: 'text',
      inputDataType: GraphPortType.worldEntities
    }
  }
}

/** 分镜输出 / 成片时间线：入端口迁为 videoEntities（旧图可能仍是 video） */
function migrateVideoEntitiesInputs(nodes: GraphNode[], scope: GraphAddScope): void {
  for (const node of nodes) {
    if (node.typeId === 'output.timeline') {
      node.params = {
        ...node.params,
        outputKind: 'video',
        inputDataType: GraphPortType.videoEntities
      }
      continue
    }
    if (scope === 'scriptAsset' && node.typeId === 'output.video') {
      node.params = {
        ...node.params,
        outputKind: 'video',
        inputDataType: GraphPortType.videoEntities
      }
    }
  }
}

function migrateImageGenerateLegacyPorts(nodes: GraphNode[], edges: GraphEdge[]): void {
  const imageProcessingIds = new Set(
    nodes
      .filter(
        (node) =>
          (node.typeId === 'asset.image' || node.assetType === 'image') &&
          isProcessingAssetNode(node)
      )
      .map((node) => node.id)
  )
  for (const edge of edges) {
    if (!imageProcessingIds.has(edge.target)) continue
    const port = edge.targetPort ?? 'in'
    if (port === 'in') edge.targetPort = 'in-image'
  }
}

/** 叙事单元生成：旧 out 整包 texts → 现 Selected text；连到 text.select 时迁到 out-all */
function migrateNarrativeGenDualPorts(nodes: GraphNode[], edges: GraphEdge[]): void {
  const genIds = new Set(nodes.filter((node) => node.typeId === 'narrative.gen').map((node) => node.id))
  const selectIds = new Set(
    nodes.filter((node) => node.typeId === 'text.select').map((node) => node.id)
  )
  for (const edge of edges) {
    if (!genIds.has(edge.source) || !selectIds.has(edge.target)) continue
    const sourcePort = edge.sourcePort ?? 'out'
    if (sourcePort === 'out') edge.sourcePort = 'out-all'
  }
}

/**
 * 剧集链：旧 world → script.in-image / narrative.in-worldEntities 迁为 script.in-worldEntities；
 * 并丢掉指向分镜宿主 in-image 的残留边。
 */
function migrateSeriesWorldEntitiesToScript(nodes: GraphNode[], edges: GraphEdge[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const scriptHosts = nodes.filter(
    (node) =>
      node.assetType === 'script' &&
      (node.params.assetHost === true || node.params.assetRef === true)
  )
  const narrativeHosts = nodes.filter(
    (node) =>
      node.assetType === 'narrative' &&
      (node.params.assetHost === true || node.params.assetRef === true)
  )
  for (const edge of edges) {
    const target = byId.get(edge.target)
    if (!target) continue
    const port = edge.targetPort ?? 'in'
    const source = byId.get(edge.source)
    const fromWorld =
      !!source &&
      (source.assetType === 'world' || source.typeId === 'asset.world' || source.typeId === 'world.gen')
    if (!fromWorld) continue

    // 旧：world → script.in-image / narrative.in-worldEntities → 统一到 script.in-worldEntities
    const toScriptImage =
      port === 'in-image' && (target.assetType === 'script' || target.typeId === 'asset.script')
    const toNarrativeWorld =
      port === 'in-worldEntities' &&
      (target.assetType === 'narrative' || target.typeId === 'asset.narrative')
    if (!toScriptImage && !toNarrativeWorld) continue

    if (scriptHosts.length === 1) {
      edge.target = scriptHosts[0]!.id
      edge.targetPort = 'in-worldEntities'
      continue
    }
    if (toScriptImage && narrativeHosts.length === 1) {
      // 无分镜宿主时的旧回退：保留叙事口，避免丢边
      edge.target = narrativeHosts[0]!.id
      edge.targetPort = 'in-worldEntities'
    }
  }
}

/** 旧「分镜编辑」入口迁移为「生成分镜视频」（文本口改为 in-text） */
function migrateLegacyShotEditorNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  runStates?: Record<string, GraphPersistedRunState>
): void {
  for (const node of nodes) {
    if (node.typeId !== 'script.shotEditor') continue
    node.typeId = 'script.shotVideoGen'
    if (node.title === 'Shot edit' || node.title === '分镜编辑') {
      node.title = 'Shot video gen'
    }
  }
  for (const node of nodes) {
    if (node.typeId === 'script.shotVideoGen' && node.id === 'script-shot-editor') {
      renameNodeIdInGraph(nodes, edges, runStates, 'script-shot-editor', 'script-shot-video-gen')
    }
  }
  const videoGenIds = new Set(
    nodes.filter((node) => node.typeId === 'script.shotVideoGen').map((node) => node.id)
  )
  const imageGenIds = new Set(
    nodes.filter((node) => node.typeId === 'script.shotImageGen').map((node) => node.id)
  )
  for (const edge of edges) {
    if (!videoGenIds.has(edge.target)) continue
    const port = edge.targetPort ?? 'in'
    if (port === 'in') edge.targetPort = 'in-text'
    // 分镜图 → 分镜视频：旧 in-image 迁为分镜实体口
    if (port === 'in-image' && imageGenIds.has(edge.source)) {
      edge.targetPort = 'in-entities'
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
  syncCanonicalOutputNodeIds(nodes, edges, runStates)
  migrateLegacyShotEditorNodes(nodes, edges, runStates)
  migrateImageGenerateLegacyPorts(nodes, edges)
  migrateNarrativeGenDualPorts(nodes, edges)
  migrateSeriesWorldEntitiesToScript(nodes, edges)
  migrateWorldOutputEntities(nodes)
  migrateVideoEntitiesInputs(nodes, scope)
  const sanitizedEdges = sanitizeEdges(nodes, edges, scope)
  return {
    nodes,
    edges: sanitizedEdges,
    groups: sanitizeGraphGroups({
      nodes,
      edges: sanitizedEdges,
      groups: raw.groups,
      viewport: raw.viewport ?? { x: 0, y: 0, zoom: 1 }
    }),
    viewport: raw.viewport ?? { x: 0, y: 0, zoom: 1 },
    runStates: sanitizePersistedRunStates(
      runStates,
      nodes.map((node) => node.id)
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
  }
): GraphDocument {
  ensureBuiltinNodeTypes()
  const scopeDef = getGraphScopeDefinition(scope)
  const chainOptions = {
    hostAssetId: options?.hostAssetId,
    hasMediaFile: options?.hasMediaFile
  }
  if (!raw?.nodes?.length) {
    const created = createDefaultScopedGraph(scope, options?.assetType, chainOptions)
    syncHostInputSlots(scope, created.nodes, created.edges, options)
    return created
  }

  const doc = {
    ...raw,
    nodes: raw.nodes.map((node) => ({ ...node }))
  }

  const edges = Array.isArray(doc.edges) ? doc.edges.map((edge) => ({ ...edge })) : []
  const runStates = doc.runStates ? { ...doc.runStates } : undefined
  // 须在 hydrate 前改写 typeId：未注册的 script.shotEditor 会被收成 note.text
  migrateLegacyShotEditorNodes(doc.nodes, edges, runStates)

  let nodes = doc.nodes.map(hydrateNode)
  if (scopeDef.persistNode) {
    nodes = nodes.filter(scopeDef.persistNode)
  }

  if (scopeDef.coerceOutput) {
    applyScopeOutput(nodes, scope, options?.assetType)
  }
  if (scope === 'directorAsset') {
    ensureDirectorProcessingDefaults(nodes)
  }
  ensureScopeOutput(nodes, scope, options?.assetType)

  // 仅资产编辑器在打开已有图时按模板补齐加工/输出（导入媒体宿主绑定）；
  // 分镜/世界/叙事长链不在加载时回插已删节点。
  if (isAssetEditorGraphScope(scope)) {
    ensureDefaultGraphFromTemplate(nodes, edges, {
      scope,
      assetType: options?.assetType,
      template: resolveDefaultGraphTemplate(scope, options?.assetType),
      output: resolveScopeOutput(scope, options?.assetType),
      ensureOutput: scopeDef.ensureOutput,
      processingTypeId: resolveAssetProcessingTypeId(scope, options?.assetType),
      hostAssetId: chainOptions.hostAssetId,
      hasMediaFile: chainOptions.hasMediaFile
    })
  }

  syncHostInputSlots(scope, nodes, edges, options)

  return finalizeGraph(nodes, { ...doc, edges, runStates }, scope)
}

/**
 * 宿主资产编辑器通用规则：有 hostAssetId 即按端口同步输入接口
 *（父图展开优先，缺省端口保底 1 槽）。
 */
function syncHostInputSlots(
  scope: GraphAddScope,
  nodes: GraphNode[],
  edges: GraphEdge[],
  options?: {
    assetType?: string | null
    hostAssetId?: string | null
    parentHostInputSlots?: HostInputSlotSpec[]
  }
): void {
  if (!isHostInputSlotEditorScope(scope)) return
  if (!isAssetRefInputHostType(options?.assetType)) return
  // 未打开具体宿主资产时不插槽（避免无关 workflow 规范化误建）
  if (!options?.hostAssetId && options?.parentHostInputSlots === undefined) return

  const slots = mergeHostInputSlotsWithDefaults(
    options.assetType,
    options.parentHostInputSlots ?? []
  )
  if (!slots.length) return
  ensureHostInputSlotNodes(nodes, edges, slots, {
    autoLinkHeadTypeIds: resolveInputLinkHeadTypeIds(
      scope,
      options.assetType,
      resolveAssetProcessingTypeId(scope, options.assetType)
    )
  })
}

export function normalizeGraph(
  raw: GraphDocument | null | undefined,
  options?: NormalizeGraphOptions
): GraphDocument {
  ensureBuiltinNodeTypes()
  const ensureOutput = options?.ensureOutput !== false
  if (!raw?.nodes?.length) {
    return createDefaultGraph(options)
  }

  const doc = {
    ...raw,
    nodes: raw.nodes.map((node) => ({ ...node }))
  }

  const hydrated = doc.nodes.map(hydrateNode)
  const hasOutput = hydrated.some((n) => n.category === 'output')
  const kind = options?.outputKind ?? 'video'
  if (ensureOutput && !hasOutput) {
    hydrated.push(
      createOutputGraphNode(kind, { x: 480, y: 160 }, {
        id: options?.outputNodeId ?? graphOutputNodeId(kind),
        title: options?.outputTitle ?? 'Shot video output'
      })
    )
  }

  if (options?.outputKind) {
    for (const node of hydrated) {
      if (node.category !== 'output') continue
      node.params = { ...node.params, outputKind: options.outputKind }
      node.typeId = `output.${options.outputKind}`
      if (options.outputTitle) node.title = options.outputTitle
    }
  }

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
  }
): GraphDocument {
  return normalizeScopedGraph(assetTypeToGraphScope(assetType), raw, {
    assetType,
    hostAssetId: options?.hostAssetId,
    hasMediaFile: options?.hasMediaFile,
    parentHostInputSlots: options?.parentHostInputSlots
  })
}
