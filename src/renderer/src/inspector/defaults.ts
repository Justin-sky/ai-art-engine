import type { GraphInspectorKind, GraphNode, NodeTypeDefinition } from '@shared/graph'
import { isAssetRefNode } from '@shared/graph'

/** 内置检查器 id，与 inspector/builtins 保持一致 */
export const DEFAULT_GRAPH_INSPECTOR_IDS: Partial<Record<GraphInspectorKind, string>> = {
  output: 'studio.graph.output',
  note: 'studio.graph.note',
  camera: 'studio.graph.camera'
}

function isSubgraphHostNode(
  node: Pick<GraphNode, 'assetType' | 'params'>
): boolean {
  return node.assetType === 'subgraph' && node.params?.assetHost === true
}

export function resolveGraphInspectorId(
  typeDef: Pick<NodeTypeDefinition, 'inspector' | 'inspectorId'>,
  node: Pick<GraphNode, 'category' | 'params' | 'assetId' | 'assetType'>
): string | undefined {
  if (typeDef.inspectorId) return typeDef.inspectorId
  if (isSubgraphHostNode(node)) return 'studio.graph.host'
  if (typeDef.inspector === 'asset') {
    return isAssetRefNode(node) ? 'studio.graph.assetRef' : 'studio.graph.asset'
  }
  return DEFAULT_GRAPH_INSPECTOR_IDS[typeDef.inspector]
}
