import type { AssetType } from '../domain'
import type { NodeExecuteFn } from './execute/types'
import { ensureBuiltinNodeTypes } from './builtinState'
import { isNodeAddableInScope } from './policy/engine'
import type { GraphAddScope } from './scopes'
import type {
  GraphCardKind,
  GraphInspectorKind,
  GraphNode,
  GraphNodeCategory,
  GraphNodeParams,
  GraphNodeTypeId,
  GraphPortDef
} from './types'

export type { GraphAddScope, BuiltinGraphAddScope } from './scopes'

export interface GraphNodePresentation {
  badgeKey?: string
  defaultTitleKey?: string
  textPlaceholderKey?: string
}

export interface NodeTypeDefinition {
  typeId: GraphNodeTypeId
  category: GraphNodeCategory
  label: string
  icon?: string
  defaultTitle: string
  defaultSize: { w: number; h: number }
  sizeLimits: { minW: number; minH: number; maxW: number; maxH: number }
  ports: GraphPortDef[]
  defaultParams: () => GraphNodeParams
  /** 右键菜单可添加（全局开关；scope 白名单见 graph-policy） */
  addable?: boolean
  /**
   * @deprecated 由 `default.graph-policy.json` 的 `addableNodeTypes` 取代；保留兼容旧插件读取
   */
  graphScopes?: GraphAddScope[]
  /** 从该资产类型拖入/创建时使用 */
  assetType?: AssetType
  /** 固定单例节点 id（如输出） */
  singletonId?: string
  deletable?: boolean
  inspector: GraphInspectorKind
  /** 覆盖默认检查器；指向已注册的 InspectorDefinition.id */
  inspectorId?: string
  card: GraphCardKind
  /** 覆盖默认卡片；指向已注册的 GraphCardDefinition.id */
  cardId?: string
  /** 备注类卡片 UI 文案（i18n 键） */
  presentation?: GraphNodePresentation
  /** 是否参与生成贡献（连到输出时） */
  contributeToGeneration?: boolean
  /** 节点执行器；缺省时引擎透传输入 */
  execute?: NodeExecuteFn
}

const registry = new Map<string, NodeTypeDefinition>()
const changeListeners = new Set<() => void>()

function notifyRegistryChanged(): void {
  for (const listener of changeListeners) listener()
}

export function registerNodeType(def: NodeTypeDefinition): void {
  registry.set(def.typeId, def)
  notifyRegistryChanged()
}

export function unregisterNodeType(typeId: string): void {
  if (registry.delete(typeId)) notifyRegistryChanged()
}

export function onNodeTypeRegistryChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

export function getNodeType(typeId: string | undefined | null): NodeTypeDefinition | undefined {
  if (!typeId) return undefined
  return registry.get(typeId)
}

export function getNodeTypeOrThrow(typeId: string): NodeTypeDefinition {
  ensureBuiltinNodeTypes()
  const def = registry.get(typeId)
  if (!def) throw new Error(`Unknown graph node type: ${typeId}`)
  return def
}

export function listNodeTypes(): NodeTypeDefinition[] {
  ensureBuiltinNodeTypes()
  return [...registry.values()]
}

export function listAddableNodeTypes(scope: GraphAddScope = 'workflow'): NodeTypeDefinition[] {
  return listNodeTypes().filter((d) => {
    if (!d.addable) return false
    return isNodeAddableInScope(scope, d.typeId)
  })
}

export function resolveNodeType(node: Pick<GraphNode, 'typeId' | 'category' | 'assetType' | 'params'>): NodeTypeDefinition | undefined {
  ensureBuiltinNodeTypes()
  if (node.typeId) {
    const byId = getNodeType(node.typeId)
    if (byId) return byId
  }
  return getNodeType(inferNodeTypeId(node))
}

export function inferNodeTypeId(
  node: Pick<GraphNode, 'category' | 'assetType' | 'params' | 'typeId'>
): GraphNodeTypeId {
  if (node.typeId && registry.has(node.typeId)) return node.typeId
  if (node.category === 'note') {
    if (node.typeId === 'play.script') return 'play.script'
    return 'note.text'
  }
  if (node.category === 'output') {
    const kind = node.params?.outputKind ?? 'video'
    return `output.${kind}`
  }
  const assetType = node.assetType ?? 'image'
  return `asset.${assetType}`
}

export function assetTypeToNodeTypeId(assetType: AssetType): GraphNodeTypeId {
  return `asset.${assetType}`
}

export function outputKindToNodeTypeId(
  kind: NonNullable<GraphNodeParams['outputKind']>
): GraphNodeTypeId {
  return `output.${kind}`
}
