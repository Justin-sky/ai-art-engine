import type { AssetType } from '../domain'
import { isMediaFileAsset, normalizeAssetType } from '../domain'
import { createNodeFromType, createOutputGraphNode } from './create'
import {
  materializeDefaultGraph,
  resolveDefaultGraphTemplate,
  resolveInputLinkHeadTypeIds
} from './defaultGraph'
import { getNodeTypeOrThrow } from './registry'
import { ensureBoundaryProxyNodes } from './ensureBoundary'
import {
  defaultHostInterfaceForAssetType,
  HOST_INTERFACE_FORMAT_VERSION,
  type HostInterfaceDocument
} from './hostInterface'
import { isAssetRefInputHostType } from './nodeRole'
import type {
  GraphDocument,
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
  | 'subgraphAsset'

/** 内置或插件注册的画布作用域 id */
export type GraphAddScope = BuiltinGraphAddScope | (string & {})

/** 分镜画面画布输出节点默认标题（持久化；UI 映射为「图片输出」） */
export const SHOT_VISUAL_OUTPUT_TITLE = 'Image output'

/** 剧本资产图输出节点默认标题（持久化；UI 映射为「剧本输出」） */
export const ASSET_SCREENPLAY_OUTPUT_TITLE = 'Screenplay output'

/** 导演台资产图输出节点默认标题（持久化；UI 映射为「导演台输出」） */
export const ASSET_DIRECTOR_OUTPUT_TITLE = 'Director deck output'

/** 成片时间线输出节点默认标题（持久化；UI 映射为「成片时间线」；挂在剧集画布） */
export const ASSET_TIMELINE_OUTPUT_TITLE = 'Cut timeline'

/** 分镜资产图「分镜输出」默认标题（持久化；UI 映射为「分镜输出」） */
export const ASSET_SCRIPT_SHOT_OUTPUT_TITLE = 'Shot video output'

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
    ensureOutput: false,
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
    ensureOutput: false,
    dragAssets: DEFAULT_SCOPE_DRAG_ASSETS,
    createParams: (typeId) =>
      typeId === 'asset.screenplay' ? { inputDataType: GraphPortType.text } : undefined
  },
  visual: {
    id: 'visual',
    ensureOutput: false,
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
    ensureOutput: false,
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
    ensureOutput: false,
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
    ensureOutput: false,
    outputTitleI18nKey: 'graph.titles.shotOutput',
    dragAssets: DEFAULT_SCOPE_DRAG_ASSETS,
    output: {
      typeId: 'output.video',
      kind: 'video',
      title: ASSET_SCRIPT_SHOT_OUTPUT_TITLE,
      inputDataType: GraphPortType.videoEntities
    }
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
    output: {
      kind: 'text',
      title: ASSET_WORLD_OUTPUT_TITLE,
      typeId: 'output.world',
      inputDataType: GraphPortType.worldEntities
    }
  },
  /** 叙事单元资产图：拆解 → 表格 → 生成 → 选择文本 → 输出；不强制通用输出节点 */
  narrativeAsset: {
    id: 'narrativeAsset',
    ensureOutput: false,
    outputTitleI18nKey: 'graph.titles.narrativeOutput',
    dragAssets: DEFAULT_SCOPE_DRAG_ASSETS,
    output: {
      kind: 'text',
      title: ASSET_NARRATIVE_OUTPUT_TITLE,
      inputDataType: GraphPortType.narrative
    }
  },
  /** 叙事单元细化图：叙事生成（文本模型）→ 叙事输出；参考节点从底栏拖入 */
  narrativeUnit: {
    id: 'narrativeUnit',
    ensureOutput: false,
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
  },
  /** 通用宿主资产内图：不强制输出；由 boundary proxy 定义接口 */
  subgraphAsset: {
    id: 'subgraphAsset',
    ensureOutput: false,
    dragAssets: DEFAULT_SCOPE_DRAG_ASSETS,
    output: {
      kind: 'text',
      title: 'Host output',
      inputDataType: GraphPortType.text
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
  { assetType: 'narrative', scope: 'narrativeAsset', priority: 100 },
  { assetType: 'subgraph', scope: 'subgraphAsset', priority: 100 }
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

/** 拖入真实媒体的 image/video/audio：编辑器主节点绑定宿主，无输入口 */
export interface AssetEditorChainOptions {
  /** 资产编辑器宿主 id */
  hostAssetId?: string | null
  /** 宿主已关联真实媒体文件（如拖入导入） */
  hasMediaFile?: boolean
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

/** 分镜画面 / 分镜视频：每镜默认一个边界输出（无固定边界输入；绑定实体可动态加 input） */
export function hostInterfaceForShotScope(
  scope: 'visual' | 'shotWorkflow'
): HostInterfaceDocument {
  if (scope === 'visual') {
    return {
      version: HOST_INTERFACE_FORMAT_VERSION,
      inputs: [],
      outputs: [
        {
          id: 'out',
          label: SHOT_VISUAL_OUTPUT_TITLE,
          dataType: GraphPortType.image,
          multiple: false
        }
      ]
    }
  }
  return {
    version: HOST_INTERFACE_FORMAT_VERSION,
    inputs: [],
    outputs: [
      {
        id: 'out',
        label: ASSET_SCRIPT_SHOT_OUTPUT_TITLE,
        dataType: GraphPortType.video,
        multiple: false
      }
    ]
  }
}

/** 确保分镜子图有主边界输出，并把悬空 gen 接到该出口；保留绑定用 boundary.input */
export function ensureShotScopeBoundaryOutput(
  document: GraphDocument,
  scope: 'visual' | 'shotWorkflow'
): GraphDocument {
  if (!document.nodes.length) return document
  return ensureBoundaryProxyNodes(document, hostInterfaceForShotScope(scope), {
    preserveUnlistedBoundaryNodes: true
  })
}

export function createDefaultScopedGraph(
  scope: GraphAddScope,
  assetType?: string | null,
  options?: AssetEditorChainOptions
): GraphDocument {
  const def = getGraphScopeDefinition(scope)
  const processingTypeId = resolveAssetProcessingTypeId(scope, assetType)
  const document = materializeDefaultGraph({
    scope,
    assetType,
    template: resolveDefaultGraphTemplate(scope, assetType),
    output: resolveScopeOutput(scope, assetType),
    ensureOutput: def.ensureOutput,
    processingTypeId,
    hostAssetId: options?.hostAssetId,
    hasMediaFile: options?.hasMediaFile
  })
  // 分镜图 / 分镜视频：默认补边界输出并接线
  if (scope === 'visual' || scope === 'shotWorkflow') {
    return ensureShotScopeBoundaryOutput(document, scope)
  }
  if (!isAssetRefInputHostType(assetType)) return document
  // 元素子图：无边界输入；边界输出由 syncWorldElementKindGraph 按目录物化
  if (scope === 'elementWorkflow') {
    return ensureBoundaryProxyNodes(document, {
      version: HOST_INTERFACE_FORMAT_VERSION,
      inputs: [],
      outputs: []
    })
  }
  // 新建宿主内图：boundary 入/出口一并按模板 inputLinkTo 接到链首
  return ensureBoundaryProxyNodes(document, defaultHostInterfaceForAssetType(assetType), {
    autoLinkHeadTypeIds: resolveInputLinkHeadTypeIds(scope, assetType, processingTypeId)
  })
}
