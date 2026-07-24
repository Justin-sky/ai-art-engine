import type { Component } from 'vue'
import type { AssetInfo, ProjectConfig, Shot } from '@shared/domain'
import type { GraphGroup, GraphInspectorKind, GraphNode } from '@shared/graph'
import type { NodeTypeDefinition } from '@shared/graph'

/**
 * Inspector 只关心“当前检查的对象”，不关心对象是从哪个视图选中的。
 * 新对象类型可通过字符串扩展，无需修改 InspectorPanel。
 */
export type InspectorTargetKind =
  | 'project'
  | 'shot'
  | 'asset'
  | 'asset.multi'
  | 'graph.node'
  | 'graph.group'
  | 'stage.object'
  | 'stage.camera'
  | 'stage.scene'
  | 'stage.panorama'
  | 'none'
  | (string & {})

export interface InspectorTarget<T = unknown> {
  kind: InspectorTargetKind
  /** 对象稳定标识；可用于缓存编辑器状态。 */
  key: string
  subject: T | null
  graphNodeType?: NodeTypeDefinition
  meta?: Record<string, unknown>
}

export interface ProjectInspectorTarget extends InspectorTarget<ProjectConfig> {
  kind: 'project'
}

export interface ShotInspectorTarget extends InspectorTarget<Shot> {
  kind: 'shot'
}

export interface AssetInspectorTarget extends InspectorTarget<AssetInfo> {
  kind: 'asset'
}

export interface GraphNodeInspectorTarget extends InspectorTarget<GraphNode> {
  kind: 'graph.node'
  graphNodeType?: NodeTypeDefinition
}

export interface GraphGroupInspectorTarget extends InspectorTarget<GraphGroup> {
  kind: 'graph.group'
  memberCount?: number
}

export interface InspectorContext {
  target: InspectorTarget
  exportCanvas: () => Promise<string | null>
  useGraphRefs: boolean
}

/**
 * 类似 Unity CustomEditor：定义目标匹配规则和对应编辑器。
 * 同一目标可以命中多个定义，按 order 依次堆叠，便于插件追加区块。
 */
export interface InspectorDefinition {
  id: string
  component: Component
  order?: number
  /**
   * 通用匹配；图节点也可改用 nodeTypeId / nodeInspectorKind 声明式匹配。
   * 当设置了 nodeTypeId 或 nodeInspectorKind 时可省略。
   */
  match?: (target: InspectorTarget) => boolean
  props?: (context: InspectorContext) => Record<string, unknown>
  /** 图节点：按 typeId 精确匹配 */
  nodeTypeId?: string
  /** 图节点：按 NodeTypeDefinition.inspector 匹配 */
  nodeInspectorKind?: GraphInspectorKind
  /** 仅 nodeInspectorKind === 'asset' 时：true=仅引用，false=仅加工 */
  nodeAssetRef?: boolean
}

export interface ResolvedInspector {
  definition: InspectorDefinition
  props: Record<string, unknown>
}
