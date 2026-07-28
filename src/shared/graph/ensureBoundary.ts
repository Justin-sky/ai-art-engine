/**
 * 确保内图含有与 hostInterface 对应的 boundary proxy 节点（幂等）。
 */
import {
  boundaryInputNodeId,
  boundaryOutputNodeId,
  GRAPH_BOUNDARY_INPUT_TYPE_ID,
  GRAPH_BOUNDARY_OUTPUT_TYPE_ID,
  type HostInterfaceDocument
} from './hostInterface'
import type { GraphDocument, GraphEdge, GraphNode } from './types'
import { canConnectNodes } from './ports'

export function ensureBoundaryProxyNodes(
  document: GraphDocument,
  iface: HostInterfaceDocument
): GraphDocument {
  const nodes: GraphNode[] = document.nodes.map((node) => ({
    ...node,
    params: { ...node.params },
    position: { ...node.position },
    size: node.size ? { ...node.size } : undefined
  }))
  const edges = document.edges.map((edge) => ({ ...edge }))
  const byId = new Map(nodes.map((n) => [n.id, n]))

  let yIn = 40
  for (const port of iface.inputs) {
    const id = boundaryInputNodeId(port.id)
    if (!byId.has(id)) {
      const node: GraphNode = {
        id,
        typeId: GRAPH_BOUNDARY_INPUT_TYPE_ID,
        category: 'note',
        position: { x: 40, y: yIn },
        title: port.label || port.id,
        params: {
          previewCollapsed: true,
          hostBoundaryPort: {
            portId: port.id,
            dataType: port.dataType,
            multiple: port.multiple !== false
          }
        }
      }
      nodes.push(node)
      byId.set(id, node)
    } else {
      const existing = byId.get(id)!
      existing.params = {
        ...existing.params,
        hostBoundaryPort: {
          portId: port.id,
          dataType: port.dataType,
          multiple: port.multiple !== false
        }
      }
      existing.title = port.label || existing.title || port.id
    }
    yIn += 80
  }

  let yOut = 40
  for (const port of iface.outputs) {
    const id = boundaryOutputNodeId(port.id)
    if (!byId.has(id)) {
      const node: GraphNode = {
        id,
        typeId: GRAPH_BOUNDARY_OUTPUT_TYPE_ID,
        category: 'note',
        position: { x: 520, y: yOut },
        title: port.label || port.id,
        params: {
          previewCollapsed: true,
          hostBoundaryPort: {
            portId: port.id,
            dataType: port.dataType,
            multiple: port.multiple === true
          }
        }
      }
      nodes.push(node)
      byId.set(id, node)
    } else {
      const existing = byId.get(id)!
      existing.params = {
        ...existing.params,
        hostBoundaryPort: {
          portId: port.id,
          dataType: port.dataType,
          multiple: port.multiple === true
        }
      }
      existing.title = port.label || existing.title || port.id
    }
    yOut += 80
  }

  // 去掉接口中已删除的 boundary 节点及其边
  const keepIds = new Set([
    ...iface.inputs.map((p) => boundaryInputNodeId(p.id)),
    ...iface.outputs.map((p) => boundaryOutputNodeId(p.id))
  ])
  const nextNodes = nodes.filter((n) => {
    if (
      n.typeId !== GRAPH_BOUNDARY_INPUT_TYPE_ID &&
      n.typeId !== GRAPH_BOUNDARY_OUTPUT_TYPE_ID
    ) {
      return true
    }
    return keepIds.has(n.id)
  })
  const nodeIds = new Set(nextNodes.map((n) => n.id))
  const finalById = new Map(nextNodes.map((node) => [node.id, node]))
  const nextEdges: GraphEdge[] = edges.filter((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return false
    const source = finalById.get(edge.source)
    const target = finalById.get(edge.target)
    if (!source || !target) return false
    return canConnectNodes(source, target, {
      sourcePort: edge.sourcePort ?? 'out',
      targetPort: edge.targetPort ?? 'in'
    })
  })

  return {
    ...document,
    nodes: nextNodes,
    edges: nextEdges
  }
}
