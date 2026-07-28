/**
 * 确保内图含有与 hostInterface 对应的 boundary proxy 节点（幂等），
 * 并把悬空业务链出口接到主 boundary.output；
 * 新建时可按 autoLinkHeadTypeIds 把 boundary.input 接到链首。
 */
import {
  boundaryInputNodeId,
  boundaryOutputNodeId,
  GRAPH_BOUNDARY_INPUT_TYPE_ID,
  GRAPH_BOUNDARY_OUTPUT_TYPE_ID,
  isBoundaryProxyNode,
  type HostInterfaceDocument
} from './hostInterface'
import type { GraphDocument, GraphEdge, GraphNode } from './types'
import { canConnectNodes, getNodePorts } from './ports'

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

/** 将无出边的业务节点接到主 boundary.output（新建默认图无 classic output 时使用） */
export function wireDanglingOutsToPrimaryBoundary(
  document: GraphDocument,
  iface: HostInterfaceDocument
): GraphDocument {
  const primary = iface.outputs[0]
  if (!primary) return document
  const boutId = boundaryOutputNodeId(primary.id)
  const bout = document.nodes.find((n) => n.id === boutId)
  if (!bout) return document

  const edges = document.edges.map((edge) => ({ ...edge }))
  if (edges.some((edge) => edge.target === boutId)) {
    return { ...document, edges }
  }

  const candidates = document.nodes
    .filter((node) => {
      if (isBoundaryProxyNode(node) || node.category === 'output') return false
      const hasOut = getNodePorts(node).some((p) => p.direction === 'out')
      if (!hasOut) return false
      if (edges.some((edge) => edge.source === node.id)) return false
      return canConnectNodes(node, bout, { sourcePort: 'out', targetPort: 'in' })
    })
    .sort((a, b) => b.position.x - a.position.x || a.position.y - b.position.y)

  const source = candidates[0]
  if (source) {
    pushEdge(edges, source.id, boutId, 'out', 'in')
  }
  return { ...document, edges }
}

/**
 * 按模板 inputLinkTo 对应的链首 typeId，把各 boundary.input 接到兼容入口。
 * 优先同名口；否则落同类型 `in`；已有占用的单值口不抢连。
 */
export function wireBoundaryInputsToHeads(
  document: GraphDocument,
  iface: HostInterfaceDocument,
  headTypeIds: string[]
): GraphDocument {
  if (!iface.inputs.length || !headTypeIds.length) return document
  const heads = document.nodes.filter((n) => !!n.typeId && headTypeIds.includes(n.typeId))
  if (!heads.length) return document

  const edges = document.edges.map((edge) => ({ ...edge }))
  for (const port of iface.inputs) {
    const sourceId = boundaryInputNodeId(port.id)
    const source = document.nodes.find((n) => n.id === sourceId)
    if (!source) continue

    let targetHead: GraphNode | undefined
    let targetPortId: string | undefined
    for (const head of heads) {
      const headInById = new Map(
        getNodePorts(head)
          .filter((p) => p.direction === 'in')
          .map((p) => [p.id, p] as const)
      )
      const sameId = headInById.get(port.id)
      if (sameId && canConnectNodes(source, head, { sourcePort: 'out', targetPort: port.id })) {
        targetHead = head
        targetPortId = port.id
        break
      }
    }
    if (!targetHead || !targetPortId) {
      for (const head of heads) {
        if (canConnectNodes(source, head, { sourcePort: 'out', targetPort: 'in' })) {
          targetHead = head
          targetPortId = 'in'
          break
        }
      }
    }
    if (!targetHead || !targetPortId) continue

    const exists = edges.some(
      (e) =>
        e.source === sourceId &&
        e.target === targetHead!.id &&
        (e.targetPort ?? 'in') === targetPortId
    )
    if (exists) continue

    const targetDef = getNodePorts(targetHead).find(
      (p) => p.direction === 'in' && p.id === targetPortId
    )
    if (targetDef && targetDef.multiple === false) {
      const occupied = edges.some(
        (e) => e.target === targetHead!.id && (e.targetPort ?? 'in') === targetPortId
      )
      if (occupied) continue
    }
    pushEdge(edges, sourceId, targetHead.id, 'out', targetPortId)
  }
  return { ...document, edges }
}

export function ensureBoundaryProxyNodes(
  document: GraphDocument,
  iface: HostInterfaceDocument,
  options?: { autoLinkHeadTypeIds?: string[] }
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

  let next: GraphDocument = {
    ...document,
    nodes: nextNodes,
    edges: nextEdges
  }
  next = wireDanglingOutsToPrimaryBoundary(next, iface)
  const headTypeIds = options?.autoLinkHeadTypeIds ?? []
  if (headTypeIds.length) {
    next = wireBoundaryInputsToHeads(next, iface, headTypeIds)
  }
  return next
}
