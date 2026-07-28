import { isAssetRefNode, type GraphNode } from '@shared/graph'
import type { InspectorDefinition, InspectorTarget } from './types'

function isSubgraphHostNode(node: GraphNode): boolean {
  return node.assetType === 'subgraph' && node.params?.assetHost === true
}

export function matchesInspectorTarget(
  definition: InspectorDefinition,
  target: InspectorTarget
): boolean {
  if (definition.nodeTypeId || definition.nodeInspectorKind) {
    if (target.kind !== 'graph.node') return false
    const node = target.subject as GraphNode | null
    if (!node) return false
    if (definition.nodeTypeId && node.typeId !== definition.nodeTypeId) return false
    if (
      definition.nodeInspectorKind &&
      target.graphNodeType?.inspector !== definition.nodeInspectorKind
    ) {
      return false
    }
    if (definition.nodeAssetRef === true && !isAssetRefNode(node)) return false
    if (definition.nodeAssetRef === false && isAssetRefNode(node)) return false
    // 宿主实例只走 GraphHostInspector，不叠 AssetInspector 资产参数
    if (definition.nodeAssetRef === true && isSubgraphHostNode(node)) return false
    return true
  }
  return definition.match?.(target) === true
}
