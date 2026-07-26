import type { AssetType } from '../domain'
import { isMediaFileAsset, normalizeAssetType } from '../domain'
import { tagAssetRef } from '../assetRef'
import {
  assetTypeToGraphNodeTitle,
  createAssetGraphNode,
  createNodeFromType,
  createOutputGraphNode
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
import { graphOutputNodeId, GraphPortType } from './types'

export type BuiltinGraphAddScope =
  | 'workflow'
  | 'shotWorkflow'
  | 'visual'
  | 'screenplayAsset'
  | 'directorAsset'
  | 'scriptAsset'
  | 'canvasAsset'
  | 'worldAsset'
  | 'narrativeAsset'
  | 'narrativeUnit'
  | 'elementWorkflow'

/** 内置或插件注册的画布作用域 id */
export type GraphAddScope = BuiltinGraphAddScope | (string & {})

/** 分镜画面画布输出节点默认标题（持久化；UI 映射为「图片输出」） */
export const SHOT_VISUAL_OUTPUT_TITLE = 'Image output'

/** 剧本资产图输出节点默认标题（持久化；UI 映射为「剧本输出」） */
export const ASSET_SCREENPLAY_OUTPUT_TITLE = 'Screenplay output'

/** 导演台资产图输出节点默认标题（持久化；UI 映射为「导演台输出」） */
export const ASSET_DIRECTOR_OUTPUT_TITLE = 'Director deck output'

/** 分镜资产图输出节点默认标题（持久化；UI 映射为「分镜输出」） */
export const ASSET_SCRIPT_OUTPUT_TITLE = 'Shot output'

/** 叙事单元资产图输出节点默认标题（持久化；UI 映射为「叙事单元输出」） */
export const ASSET_NARRATIVE_OUTPUT_TITLE = 'Narrative output'

/** 叙事单元细化画布输出节点默认标题（持久化；UI 映射为「叙事输出」） */
export const NARRATIVE_UNIT_OUTPUT_TITLE = 'Narrative unit output'

/** 世界元素资产图输出节点默认标题（持久化；UI 映射为「世界元素输出」） */
export const ASSET_WORLD_OUTPUT_TITLE = 'World element output'

export interface GraphScopeOutputConfig {
  kind: GraphOutputKind
  title: string
  inputDataType?: GraphPortDataType
  /** 专用输出 typeId（如 output.narrativeUnit）；缺省为 output.${kind} */
  typeId?: GraphNodeTypeId
}

export interface GraphScopeDragAssetsConfig {
  /** 默认 true；false 时禁止拖入资产引用 */
  enabled?: boolean
  /** 白名单；`all` 表示除 denyTypes 外均可 */
  allowTypes?: AssetType[] | 'all'
  /** 黑名单 */
  denyTypes?: AssetType[]
}

/** 分镜画布上持久化 graph 的字段名 */
export type ShotCanvasGraphField = 'graphJson' | 'visualGraphJson'

export interface GraphScopeDefinition {
  id: GraphAddScope
  /** 加载图时保留的节点；未设置表示不过滤 */
  persistNode?: (node: GraphNode) => boolean
  /** 空图与校正时使用的输出节点配置 */
  output: GraphScopeOutputConfig
  /** 输出节点在 UI 上的 i18n 标题键（持久化 title 为英文默认值） */
  outputTitleI18nKey?: string
  /** 加载时强制将所有输出节点校正为 scope 输出配置 */
  coerceOutput?: boolean
  /** 空图时是否自动补输出节点；默认 true */
  ensureOutput?: boolean
  /** 加载后确保存在的单例节点 typeId */
  ensureSingletonTypeIds?: GraphNodeTypeId[]
  /** 右键添加节点时的额外 params */
  createParams?: (typeId: GraphNodeTypeId) => Partial<GraphNodeParams> | undefined
  /** 拖入资产引用节点的规则 */
  dragAssets?: GraphScopeDragAssetsConfig
  /** 分镜 Shot.canvas 上的图字段；默认 graphJson */
  shotCanvasField?: ShotCanvasGraphField
  /** 分镜内多画布时 graphHostId 后缀 */
  hostIdSuffix?: string
}

const ASSET_OUTPUT_TITLES: Record<GraphOutputKind, string> = {
  image: 'Image output',
  video: 'Video output',
  voice: 'Voice output',
  text: 'Text output'
}

function assetOutputKind(assetType: AssetType | string | undefined): GraphOutputKind {
  if (assetType === 'voice') return 'voice'
  if (assetType === 'image') return 'image'
  return 'video'
}

const DEFAULT_SCOPE_DRAG_ASSETS: GraphScopeDragAssetsConfig = {
  allowTypes: 'all'
}

export const GRAPH_SCOPE_DEFINITIONS: Record<BuiltinGraphAddScope, GraphScopeDefinition> = {
  shotWorkflow: {
    id: 'shotWorkflow',
    outputTitleI18nKey: 'graph.titles.shotOutput',
    output: {
      kind: 'video',
      title: 'Shot video output',
      inputDataType: GraphPortType.video
    },
    dragAssets: DEFAULT_SCOPE_DRAG_ASSETS
  },
  workflow: {
    id: 'workflow',
    output: { kind: 'video', title: ASSET_OUTPUT_TITLES.video },
    coerceOutput: true,
    dragAssets: DEFAULT_SCOPE_DRAG_ASSETS,
    createParams: (typeId) =>
      typeId === 'asset.screenplay' ? { inputDataType: GraphPortType.text } : undefined
  },
  visual: {
    id: 'visual',
    coerceOutput: true,
    outputTitleI18nKey: 'graph.titles.shotVisualOutput',
    dragAssets: DEFAULT_SCOPE_DRAG_ASSETS,
    shotCanvasField: 'visualGraphJson',
    hostIdSuffix: 'visual',
    output: {
      kind: 'image',
      title: SHOT_VISUAL_OUTPUT_TITLE,
      inputDataType: GraphPortType.image
    }
  },
  screenplayAsset: {
    id: 'screenplayAsset',
    coerceOutput: true,
    outputTitleI18nKey: 'graph.titles.screenplayOutput',
    dragAssets: DEFAULT_SCOPE_DRAG_ASSETS,
    output: {
      kind: 'text',
      title: ASSET_SCREENPLAY_OUTPUT_TITLE,
      inputDataType: GraphPortType.text
    }
  },
  directorAsset: {
    id: 'directorAsset',
    coerceOutput: true,
    outputTitleI18nKey: 'graph.titles.directorOutput',
    dragAssets: DEFAULT_SCOPE_DRAG_ASSETS,
    output: {
      kind: 'image',
      title: ASSET_DIRECTOR_OUTPUT_TITLE,
      inputDataType: GraphPortType.image
    }
  },
  scriptAsset: {
    id: 'scriptAsset',
    coerceOutput: true,
    outputTitleI18nKey: 'graph.titles.scriptOutput',
    dragAssets: DEFAULT_SCOPE_DRAG_ASSETS,
    output: {
      kind: 'video',
      title: ASSET_SCRIPT_OUTPUT_TITLE,
      inputDataType: GraphPortType.video
    },
    ensureSingletonTypeIds: [
      'script.shotSplit',
      'script.shotTable',
      'script.shotImageGen',
      'script.shotVideoGen'
    ]
  },
  /** 空白节点画布：不强制输出节点，打开即为空图 */
  canvasAsset: {
    id: 'canvasAsset',
    ensureOutput: false,
    dragAssets: DEFAULT_SCOPE_DRAG_ASSETS,
    output: {
      kind: 'image',
      title: 'Canvas output'
    }
  },
  /** 世界元素资产图：提取 → 表格 → 生成 → 输出；不强制通用输出节点 */
  worldAsset: {
    id: 'worldAsset',
    ensureOutput: false,
    outputTitleI18nKey: 'graph.titles.worldOutput',
    dragAssets: DEFAULT_SCOPE_DRAG_ASSETS,
    ensureSingletonTypeIds: [
      'world.extract',
      'world.table',
      'world.gen',
      'output.world'
    ],
    output: {
      kind: 'image',
      title: ASSET_WORLD_OUTPUT_TITLE,
      inputDataType: GraphPortType.image
    }
  },
  /** 叙事单元资产图：拆解 → 表格 → 生成；不强制输出节点 */
  narrativeAsset: {
    id: 'narrativeAsset',
    ensureOutput: false,
    outputTitleI18nKey: 'graph.titles.narrativeOutput',
    dragAssets: DEFAULT_SCOPE_DRAG_ASSETS,
    ensureSingletonTypeIds: [
      'narrative.split',
      'narrative.table',
      'narrative.gen',
      'output.narrative'
    ],
    output: {
      kind: 'text',
      title: ASSET_NARRATIVE_OUTPUT_TITLE,
      inputDataType: GraphPortType.text
    }
  },
  /** 叙事单元细化图：叙事生成（文本模型）→ 叙事输出；参考节点从底栏拖入 */
  narrativeUnit: {
    id: 'narrativeUnit',
    coerceOutput: true,
    outputTitleI18nKey: 'graph.titles.narrativeUnitOutput',
    dragAssets: DEFAULT_SCOPE_DRAG_ASSETS,
    hostIdSuffix: 'narrative-unit',
    output: {
      typeId: 'output.narrativeUnit',
      kind: 'text',
      title: NARRATIVE_UNIT_OUTPUT_TITLE,
      inputDataType: GraphPortType.text
    }
  },
  /** 世界元素四类子画布：可添加图片加工节点等；不强制输出 */
  elementWorkflow: {
    id: 'elementWorkflow',
    ensureOutput: false,
    dragAssets: DEFAULT_SCOPE_DRAG_ASSETS,
    output: {
      kind: 'image',
      title: 'Element output'
    }
  }
}

const customScopeDefinitions = new Map<string, GraphScopeDefinition>()
const scopeChangeListeners = new Set<() => void>()

function notifyScopeRegistryChanged(): void {
  for (const listener of scopeChangeListeners) listener()
}

/** 注册或覆盖画布作用域（供插件扩展） */
export function registerGraphScope(definition: GraphScopeDefinition): () => void {
  customScopeDefinitions.set(definition.id, definition)
  notifyScopeRegistryChanged()
  return () => {
    if (customScopeDefinitions.delete(definition.id)) notifyScopeRegistryChanged()
  }
}

export function onGraphScopeRegistryChanged(listener: () => void): () => void {
  scopeChangeListeners.add(listener)
  return () => scopeChangeListeners.delete(listener)
}

export function listGraphScopes(): GraphScopeDefinition[] {
  const builtins = Object.values(GRAPH_SCOPE_DEFINITIONS)
  const custom = [...customScopeDefinitions.values()].filter(
    (def) => !(def.id in GRAPH_SCOPE_DEFINITIONS)
  )
  return [...builtins, ...custom]
}

export function getGraphScopeDefinition(scope: GraphAddScope): GraphScopeDefinition {
  const custom = customScopeDefinitions.get(scope)
  if (custom) return custom
  const builtin = GRAPH_SCOPE_DEFINITIONS[scope as BuiltinGraphAddScope]
  if (builtin) return builtin
  throw new Error(`Unknown graph scope: ${scope}`)
}

export interface GraphScopeHostBinding {
  /** 资产编辑器宿主；需同时有 assetId 与匹配的 assetType */
  assetType: string
  scope: GraphAddScope
  /** 数值越大越优先；默认 0 */
  priority?: number
}

const BUILTIN_SCOPE_HOST_BINDINGS: GraphScopeHostBinding[] = [
  { assetType: 'screenplay', scope: 'screenplayAsset', priority: 100 },
  { assetType: 'motion', scope: 'directorAsset', priority: 100 },
  { assetType: 'script', scope: 'scriptAsset', priority: 100 },
  { assetType: 'canvas', scope: 'canvasAsset', priority: 100 },
  { assetType: 'world', scope: 'worldAsset', priority: 100 },
  { assetType: 'narrative', scope: 'narrativeAsset', priority: 100 }
]

const customScopeHostBindings: GraphScopeHostBinding[] = []

export function registerGraphScopeHost(binding: GraphScopeHostBinding): () => void {
  customScopeHostBindings.push(binding)
  notifyScopeRegistryChanged()
  return () => {
    const index = customScopeHostBindings.indexOf(binding)
    if (index >= 0) {
      customScopeHostBindings.splice(index, 1)
      notifyScopeRegistryChanged()
    }
  }
}

export function listGraphScopeHosts(): GraphScopeHostBinding[] {
  return [...BUILTIN_SCOPE_HOST_BINDINGS, ...customScopeHostBindings]
}

function resolveScopeFromHosts(options: {
  assetId?: string | null
  assetType?: string | null
}): GraphAddScope | undefined {
  const bindings = listGraphScopeHosts()
    .filter(
      (binding) => !!options.assetId && options.assetType === binding.assetType
    )
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  return bindings[0]?.scope
}

/** 根据编辑器宿主解析图作用域 */
export function resolveGraphScope(options: {
  assetId?: string | null
  assetType?: string | null
}): GraphAddScope {
  const fromHost = resolveScopeFromHosts(options)
  if (fromHost) return fromHost
  if (options.assetId) return 'workflow'
  return 'shotWorkflow'
}

export function assetTypeToGraphScope(assetType?: string | null): GraphAddScope {
  const fromHost = resolveScopeFromHosts({
    assetId: '__asset__',
    assetType
  })
  return fromHost ?? 'workflow'
}

export function resolveScopeOutput(
  scope: GraphAddScope,
  assetType?: string | null
): GraphScopeOutputConfig {
  const def = getGraphScopeDefinition(scope)
  if (scope !== 'workflow' || !assetType) return def.output
  const kind = assetOutputKind(assetType)
  return { kind, title: ASSET_OUTPUT_TITLES[kind] }
}

export function createParamsForScope(
  scope: GraphAddScope,
  typeId: GraphNodeTypeId
): Partial<GraphNodeParams> | undefined {
  return getGraphScopeDefinition(scope).createParams?.(typeId)
}

/** 当前画布作用域是否允许拖入该类型资产 */
export function canScopeAcceptDraggedAsset(
  scope: GraphAddScope,
  assetType: string
): boolean {
  const drag = getGraphScopeDefinition(scope).dragAssets ?? DEFAULT_SCOPE_DRAG_ASSETS
  if (drag.enabled === false) return false
  const type = normalizeAssetType(assetType)
  if (drag.denyTypes?.includes(type)) return false
  if (!drag.allowTypes || drag.allowTypes === 'all') return true
  return drag.allowTypes.includes(type)
}

export const DEFAULT_SHOT_CANVAS_FIELD: ShotCanvasGraphField = 'graphJson'

export function getScopeShotCanvasField(scope: GraphAddScope): ShotCanvasGraphField {
  return getGraphScopeDefinition(scope).shotCanvasField ?? DEFAULT_SHOT_CANVAS_FIELD
}

export function getScopeHostIdSuffix(scope: GraphAddScope): string | undefined {
  return getGraphScopeDefinition(scope).hostIdSuffix
}

const ASSET_EDITOR_SCOPES = new Set<GraphAddScope>(['workflow', 'screenplayAsset', 'directorAsset'])

export function isAssetEditorGraphScope(scope: GraphAddScope): boolean {
  return ASSET_EDITOR_SCOPES.has(scope)
}

/** 资产编辑器内与宿主资产类型对应的加工节点 typeId */
export function resolveAssetProcessingTypeId(
  scope: GraphAddScope,
  assetType?: string | null
): GraphNodeTypeId | null {
  if (scope === 'screenplayAsset') return 'asset.screenplay'
  if (scope === 'directorAsset') return 'asset.motion'
  const type = assetType ? normalizeAssetType(assetType) : null
  if (!type) return null
  if (scope === 'workflow' && isMediaFileAsset(type)) {
    return `asset.${type}` as GraphNodeTypeId
  }
  return null
}

function findProcessingGenerateNode(nodes: GraphNode[], typeId: GraphNodeTypeId): GraphNode | undefined {
  return nodes.find((node) => node.typeId === typeId && isProcessingAssetNode(node))
}

/** 拖入真实媒体的 image/video/audio：编辑器主节点绑定宿主，无输入口 */
export interface AssetEditorChainOptions {
  /** 资产编辑器宿主 id */
  hostAssetId?: string | null
  /** 宿主已关联真实媒体文件（如拖入导入） */
  hasMediaFile?: boolean
}

function shouldUseHostMediaRef(
  scope: GraphAddScope,
  assetType?: string | null,
  options?: AssetEditorChainOptions
): options is AssetEditorChainOptions & { hostAssetId: string } {
  if (scope !== 'workflow') return false
  if (!options?.hostAssetId || !options.hasMediaFile) return false
  return isMediaFileAsset(assetType)
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

function ensureLinkedToOutput(
  edges: GraphEdge[],
  sourceId: string,
  outputId: string
): void {
  const linked = edges.some((edge) => edge.target === outputId && edge.source === sourceId)
  if (linked) return
  edges.push({
    id: `edge-${crypto.randomUUID()}`,
    source: sourceId,
    target: outputId,
    sourcePort: 'out',
    targetPort: 'in'
  })
}

function ensureGraphEdge(
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

/** 世界元素资产图默认链：提取 → 表格 → 生成 → 输出（仅新建图时调用） */
export function ensureWorldAssetDefaultChain(nodes: GraphNode[], edges: GraphEdge[]): void {
  const extract = nodes.find((node) => node.typeId === 'world.extract')
  const table = nodes.find((node) => node.typeId === 'world.table')
  const gen = nodes.find((node) => node.typeId === 'world.gen')
  const output = nodes.find((node) => node.typeId === 'output.world')
  if (!extract || !table || !gen) return
  ensureGraphEdge(edges, extract.id, table.id, 'out', 'in')
  ensureGraphEdge(edges, table.id, gen.id, 'out', 'in')
  if (output) ensureGraphEdge(edges, gen.id, output.id, 'out', 'in')
}

/** 分镜资产图默认链：拆分 → 表格 → 分镜图 / 分镜视频 → 输出（仅新建图时调用） */
export function ensureScriptAssetDefaultChain(nodes: GraphNode[], edges: GraphEdge[]): void {
  const split = nodes.find((node) => node.typeId === 'script.shotSplit')
  const table = nodes.find((node) => node.typeId === 'script.shotTable')
  const imageGen = nodes.find((node) => node.typeId === 'script.shotImageGen')
  const videoGen = nodes.find((node) => node.typeId === 'script.shotVideoGen')
  const outputNode = nodes.find((node) => node.category === 'output')
  if (!split || !table || !imageGen || !videoGen) return
  ensureGraphEdge(edges, split.id, table.id, 'out', 'in')
  ensureGraphEdge(edges, table.id, imageGen.id, 'out', 'in')
  ensureGraphEdge(edges, table.id, videoGen.id, 'out', 'in-text')
  ensureGraphEdge(edges, imageGen.id, videoGen.id, 'out', 'in-image')
  if (outputNode) ensureGraphEdge(edges, videoGen.id, outputNode.id, 'out', 'in')
}

/** 叙事单元资产图默认链：拆解 → 表格 → 生成 → 输出 */
export function ensureNarrativeAssetDefaultChain(nodes: GraphNode[], edges: GraphEdge[]): void {
  const split = nodes.find((node) => node.typeId === 'narrative.split')
  const table = nodes.find((node) => node.typeId === 'narrative.table')
  const gen = nodes.find((node) => node.typeId === 'narrative.gen')
  const output = nodes.find((node) => node.typeId === 'output.narrative')
  if (!split || !table || !gen) return
  ensureGraphEdge(edges, split.id, table.id, 'out', 'in')
  ensureGraphEdge(edges, table.id, gen.id, 'out', 'in')
  if (output) ensureGraphEdge(edges, gen.id, output.id, 'out', 'in')
}

/** 分镜工作流：仅在「仅有视频输出」的遗留空图上补齐视频链；不再强制插入分镜参数 */
export function ensureShotWorkflowDefaultChain(nodes: GraphNode[], edges: GraphEdge[]): void {
  const hasVideo = nodes.some((node) => node.typeId === 'asset.video' && isProcessingAssetNode(node))
  let output = nodes.find(
    (node) =>
      node.category === 'output' &&
      (node.typeId === 'output.video' || node.params.outputKind === 'video')
  )
  if (!output) {
    output = createOutputGraphNode('video', { x: 520, y: 160 }, {
      id: graphOutputNodeId('video'),
      title: 'Shot video output'
    })
    nodes.push(output)
  }

  if (hasVideo) {
    const video = nodes.find(
      (node) => node.typeId === 'asset.video' && isProcessingAssetNode(node)
    )!
    ensureGraphEdge(edges, video.id, output.id, 'out', 'in')
    return
  }

  const nonOutputCount = nodes.filter((node) => node.category !== 'output').length
  if (nonOutputCount > 0) return

  // 遗留：仅视频输出 → 补齐 视频生成 → 输出（分镜参数由用户从分镜栏拖入）
  const video = createNodeFromType('asset.video', { x: 300, y: 160 })
  nodes.push(video)
  ensureGraphEdge(edges, video.id, output.id, 'out', 'in')
}

/** 分镜画面：仅在「仅有图片输出」的遗留空图上补齐图片链 */
export function ensureVisualDefaultChain(nodes: GraphNode[], edges: GraphEdge[]): void {
  const hasImage = nodes.some((node) => node.typeId === 'asset.image' && isProcessingAssetNode(node))
  let output = nodes.find(
    (node) =>
      node.category === 'output' &&
      (node.typeId === 'output.image' || node.params.outputKind === 'image')
  )
  if (!output) {
    output = createOutputGraphNode('image', { x: 520, y: 160 }, {
      id: graphOutputNodeId('image'),
      title: SHOT_VISUAL_OUTPUT_TITLE,
      params: { outputKind: 'image', inputDataType: GraphPortType.image }
    })
    nodes.push(output)
  }

  if (hasImage) {
    const image = nodes.find(
      (node) => node.typeId === 'asset.image' && isProcessingAssetNode(node)
    )!
    ensureGraphEdge(edges, image.id, output.id, 'out', 'in')
    return
  }

  const nonOutputCount = nodes.filter((node) => node.category !== 'output').length
  if (nonOutputCount > 0) return

  const image = createNodeFromType('asset.image', { x: 300, y: 160 })
  nodes.push(image)
  ensureGraphEdge(edges, image.id, output.id, 'out', 'in')
}

/** 叙事单元细化：仅在「仅有叙事输出」的空图上补齐生成链 */
export function ensureNarrativeUnitDefaultChain(nodes: GraphNode[], edges: GraphEdge[]): void {
  const hasGen = nodes.some((node) => node.typeId === 'narrative.unitGen')
  let output = nodes.find((node) => node.typeId === 'output.narrativeUnit')
  if (!output) {
    output = createNodeFromType('output.narrativeUnit', { x: 520, y: 160 }, {
      id: graphOutputNodeId('narrativeUnit'),
      title: NARRATIVE_UNIT_OUTPUT_TITLE,
      params: { outputKind: 'text', inputDataType: GraphPortType.text }
    })
    nodes.push(output)
  }

  if (hasGen) {
    const gen = nodes.find((node) => node.typeId === 'narrative.unitGen')!
    ensureGraphEdge(edges, gen.id, output.id, 'out', 'in')
    return
  }

  const nonOutputCount = nodes.filter((node) => node.category !== 'output').length
  if (nonOutputCount > 0) return

  const gen = createNodeFromType('narrative.unitGen', { x: 300, y: 160 })
  nodes.push(gen)
  ensureGraphEdge(edges, gen.id, output.id, 'out', 'in')
}

/** 资产编辑器：确保加工节点（或宿主媒体引用节点）存在并默认连到输出 */
export function ensureAssetEditorProcessingChain(
  nodes: GraphNode[],
  edges: GraphEdge[],
  scope: GraphAddScope,
  assetType?: string | null,
  options?: AssetEditorChainOptions
): void {
  if (!isAssetEditorGraphScope(scope)) return
  const processingTypeId = resolveAssetProcessingTypeId(scope, assetType)
  if (!processingTypeId) return

  const outputNode = nodes.find((node) => node.category === 'output')
  if (!outputNode) return

  if (shouldUseHostMediaRef(scope, assetType, options)) {
    const type = normalizeAssetType(assetType!)
    const hostAssetId = options.hostAssetId
    const title = assetTypeToGraphNodeTitle(type)
    let hostNode =
      nodes.find((node) => node.typeId === processingTypeId && node.assetId === hostAssetId) ??
      undefined
    if (!hostNode) {
      const processing = findProcessingGenerateNode(nodes, processingTypeId)
      if (processing) {
        bindNodeToHostMedia(processing, hostAssetId, type, processing.title || title)
        hostNode = processing
      }
    }
    if (!hostNode) {
      hostNode = createAssetGraphNode(hostAssetId, type, title, { x: 240, y: 160 })
      nodes.push(hostNode)
    } else {
      bindNodeToHostMedia(hostNode, hostAssetId, type, hostNode.title || title)
    }
    ensureLinkedToOutput(edges, hostNode.id, outputNode.id)
    return
  }

  let processing = findProcessingGenerateNode(nodes, processingTypeId)
  if (!processing) {
    processing = createNodeFromType(processingTypeId, { x: 240, y: 160 })
    nodes.push(processing)
  }

  ensureLinkedToOutput(edges, processing.id, outputNode.id)
}

export function createScopeSingletonNode(
  typeId: GraphNodeTypeId,
  position: { x: number; y: number }
): GraphNode {
  const def = getNodeTypeOrThrow(typeId)
  return createNodeFromType(typeId, position, def.singletonId ? { id: def.singletonId } : undefined)
}

/** 按 scope 输出配置创建输出节点 */
export function createScopeOutputNode(
  output: GraphScopeOutputConfig,
  position: { x: number; y: number }
): GraphNode {
  if (output.typeId) {
    const def = getNodeTypeOrThrow(output.typeId)
    return createNodeFromType(output.typeId, position, {
      id: def.singletonId ?? graphOutputNodeId(output.kind),
      title: output.title,
      params: {
        outputKind: output.kind,
        ...(output.inputDataType ? { inputDataType: output.inputDataType } : {})
      }
    })
  }
  return createOutputGraphNode(output.kind, position, {
    id: graphOutputNodeId(output.kind),
    title: output.title,
    params: {
      outputKind: output.kind,
      ...(output.inputDataType ? { inputDataType: output.inputDataType } : {})
    }
  })
}

export function createDefaultScopedGraph(
  scope: GraphAddScope,
  assetType?: string | null,
  options?: AssetEditorChainOptions
): GraphDocument {
  if (scope === 'shotWorkflow') {
    return createDefaultShotWorkflowGraph()
  }
  if (scope === 'visual') {
    return createDefaultVisualGraph()
  }
  if (scope === 'narrativeUnit') {
    return createDefaultNarrativeUnitGraph()
  }

  const def = getGraphScopeDefinition(scope)
  const output = resolveScopeOutput(scope, assetType)
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  for (const [index, typeId] of (def.ensureSingletonTypeIds ?? []).entries()) {
    const position =
      scope === 'scriptAsset' || scope === 'worldAsset' || scope === 'narrativeAsset'
        ? { x: 120 + index * 220, y: 160 }
        : { x: 120, y: 80 + index * 160 }
    nodes.push(createScopeSingletonNode(typeId, position))
  }

  if (def.ensureOutput !== false) {
    nodes.push(
      createScopeOutputNode(output, {
        x: scope === 'scriptAsset' ? 1000 : 480,
        y: 160
      })
    )
  }

  if (scope === 'scriptAsset') {
    ensureScriptAssetDefaultChain(nodes, edges)
  }

  if (scope === 'worldAsset') {
    ensureWorldAssetDefaultChain(nodes, edges)
  }

  if (scope === 'narrativeAsset') {
    ensureNarrativeAssetDefaultChain(nodes, edges)
  }

  ensureAssetEditorProcessingChain(nodes, edges, scope, assetType, options)

  return {
    nodes,
    edges,
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

/** 分镜编辑默认图：视频生成 → 视频输出（分镜参数从分镜栏拖入） */
function createDefaultShotWorkflowGraph(): GraphDocument {
  const video = createNodeFromType('asset.video', { x: 300, y: 160 })
  const output = createOutputGraphNode('video', { x: 520, y: 160 }, {
    id: graphOutputNodeId('video'),
    title: 'Shot video output'
  })
  const edges: GraphEdge[] = [
    {
      id: `edge-${crypto.randomUUID()}`,
      source: video.id,
      target: output.id,
      sourcePort: 'out',
      targetPort: 'in'
    }
  ]
  return {
    nodes: [video, output],
    edges,
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

/** 分镜画面默认图：图片生成 → 图片输出 */
function createDefaultVisualGraph(): GraphDocument {
  const image = createNodeFromType('asset.image', { x: 300, y: 160 })
  const output = createOutputGraphNode('image', { x: 520, y: 160 }, {
    id: graphOutputNodeId('image'),
    title: SHOT_VISUAL_OUTPUT_TITLE,
    params: { outputKind: 'image', inputDataType: GraphPortType.image }
  })
  const edges: GraphEdge[] = [
    {
      id: `edge-${crypto.randomUUID()}`,
      source: image.id,
      target: output.id,
      sourcePort: 'out',
      targetPort: 'in'
    }
  ]
  return {
    nodes: [image, output],
    edges,
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

/** 叙事单元细化默认图：叙事生成 → 叙事输出 */
function createDefaultNarrativeUnitGraph(): GraphDocument {
  const gen = createNodeFromType('narrative.unitGen', { x: 300, y: 160 })
  const output = createNodeFromType('output.narrativeUnit', { x: 520, y: 160 }, {
    id: graphOutputNodeId('narrativeUnit'),
    title: NARRATIVE_UNIT_OUTPUT_TITLE,
    params: { outputKind: 'text', inputDataType: GraphPortType.text }
  })
  const edges: GraphEdge[] = [
    {
      id: `edge-${crypto.randomUUID()}`,
      source: gen.id,
      target: output.id,
      sourcePort: 'out',
      targetPort: 'in'
    }
  ]
  return {
    nodes: [gen, output],
    edges,
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}
