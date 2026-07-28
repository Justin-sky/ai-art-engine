/**
 * 将选中节点封装为宿主资产内图（纯函数）。
 * - 分析边界连线 → 自动创建 boundary input/output proxy
 * - 父图替换为单 host 实例并重连
 * - 稳定 port id，支持多入多出
 */

import { createAssetGraphNode } from './create'
import { cloneGraphDocument } from './document'
import { findOutPort, getNodePorts } from './ports'
import {
  boundaryInputNodeId,
  boundaryOutputNodeId,
  cloneHostInterface,
  GRAPH_BOUNDARY_INPUT_TYPE_ID,
  GRAPH_BOUNDARY_OUTPUT_TYPE_ID,
  HOST_INTERFACE_FORMAT_VERSION,
  HOST_INTERFACE_SCHEMA_VERSION,
  hostBoundaryPortLabel,
  type HostBoundaryPort,
  type HostInterfaceDocument
} from './hostInterface'
import type {
  GraphDocument,
  GraphEdge,
  GraphNode,
  GraphPortDataType
} from './types'
import { GraphPortType } from './types'

export interface EncapsulateSelectionInput {
  selectedNodeIds: string[]
  hostAssetId: string
  hostAssetName?: string
  /** 可选稳定 host 节点 id；缺省随机 */
  hostNodeId?: string
}

export interface EncapsulateSelectionResult {
  parentDocument: GraphDocument
  innerDocument: GraphDocument
  hostInterface: HostInterfaceDocument
  hostNodeId: string
}

interface CrossingIn {
  edge: GraphEdge
  dataType: GraphPortDataType
  multiple: boolean
  /** 选中侧目标端口 */
  targetPort: string
  targetNodeId: string
}

interface CrossingOut {
  edge: GraphEdge
  dataType: GraphPortDataType
  sourcePort: string
  sourceNodeId: string
}

function nodeById(nodes: GraphNode[], id: string): GraphNode | undefined {
  return nodes.find((n) => n.id === id)
}

function resolveEdgeDataType(
  nodes: GraphNode[],
  edge: GraphEdge
): GraphPortDataType {
  const source = nodeById(nodes, edge.source)
  if (!source) return GraphPortType.text
  const out = findOutPort(source, edge.sourcePort ?? 'out')
  return out?.dataType ?? GraphPortType.text
}

function centroid(nodes: GraphNode[]): { x: number; y: number } {
  if (!nodes.length) return { x: 200, y: 160 }
  let sx = 0
  let sy = 0
  for (const n of nodes) {
    sx += n.position?.x ?? 0
    sy += n.position?.y ?? 0
  }
  return { x: Math.round(sx / nodes.length), y: Math.round(sy / nodes.length) }
}

function sortNodesStable(nodes: GraphNode[]): GraphNode[] {
  return nodes.slice().sort((a, b) => {
    const dy = (a.position?.y ?? 0) - (b.position?.y ?? 0)
    if (dy !== 0) return dy
    const dx = (a.position?.x ?? 0) - (b.position?.x ?? 0)
    if (dx !== 0) return dx
    return a.id.localeCompare(b.id)
  })
}

/**
 * 将跨边界入边分组为输入端口：
 * 同一 (targetNodeId, targetPort) 合并为一个 port（允许多条边 → multiple）。
 */
function groupInputPorts(crossings: CrossingIn[]): Array<{
  port: HostBoundaryPort
  crossings: CrossingIn[]
}> {
  const groups = new Map<string, CrossingIn[]>()
  const order: string[] = []
  for (const c of crossings) {
    const key = `${c.targetNodeId}::${c.targetPort}`
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key)!.push(c)
  }
  const typeOrdinal = new Map<string, number>()
  return order.map((key, index) => {
    const list = groups.get(key)!
    const first = list[0]!
    const dataType = first.dataType
    const next = (typeOrdinal.get(dataType) ?? 0) + 1
    typeOrdinal.set(dataType, next)
    return {
      port: {
        id: `in-${index}`,
        label: hostBoundaryPortLabel(dataType, 'in', next),
        dataType,
        multiple: first.multiple || list.length > 1
      },
      crossings: list
    }
  })
}

/**
 * 将跨边界出边分组为输出端口：
 * 同一 (sourceNodeId, sourcePort) 合并为一个 port。
 */
function groupOutputPorts(crossings: CrossingOut[]): Array<{
  port: HostBoundaryPort
  crossings: CrossingOut[]
}> {
  const groups = new Map<string, CrossingOut[]>()
  const order: string[] = []
  for (const c of crossings) {
    const key = `${c.sourceNodeId}::${c.sourcePort}`
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key)!.push(c)
  }
  const typeOrdinal = new Map<string, number>()
  return order.map((key, index) => {
    const list = groups.get(key)!
    const first = list[0]!
    const dataType = first.dataType
    const next = (typeOrdinal.get(dataType) ?? 0) + 1
    typeOrdinal.set(dataType, next)
    return {
      port: {
        id: `out-${index}`,
        label: hostBoundaryPortLabel(dataType, 'out', next),
        dataType,
        multiple: false
      },
      crossings: list
    }
  })
}

function makeBoundaryInputNode(
  port: HostBoundaryPort,
  position: { x: number; y: number }
): GraphNode {
  return {
    id: boundaryInputNodeId(port.id),
    typeId: GRAPH_BOUNDARY_INPUT_TYPE_ID,
    category: 'note',
    position: { ...position },
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
}

function makeBoundaryOutputNode(
  port: HostBoundaryPort,
  position: { x: number; y: number }
): GraphNode {
  return {
    id: boundaryOutputNodeId(port.id),
    typeId: GRAPH_BOUNDARY_OUTPUT_TYPE_ID,
    category: 'note',
    position: { ...position },
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
}

function newEdgeId(prefix: string, index: number): string {
  return `${prefix}-${index}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 分析选中节点边界并封装为宿主内图 + 父图 host 实例。
 * 无选中或不存在的 id 时抛错。
 */
export function encapsulateSelection(
  document: GraphDocument,
  input: EncapsulateSelectionInput
): EncapsulateSelectionResult {
  const selectedIds = [
    ...new Set(
      input.selectedNodeIds.map((id) => id?.trim()).filter((id): id is string => !!id)
    )
  ]
  if (!selectedIds.length) {
    throw new Error('GRAPH_ENCAPSULATE_EMPTY_SELECTION')
  }

  const selectedSet = new Set(selectedIds)
  const selectedNodes = sortNodesStable(
    document.nodes.filter((n) => selectedSet.has(n.id))
  )
  if (selectedNodes.length !== selectedIds.length) {
    throw new Error('GRAPH_ENCAPSULATE_MISSING_NODES')
  }

  const incoming: CrossingIn[] = []
  const outgoing: CrossingOut[] = []
  const internalEdges: GraphEdge[] = []

  for (const edge of document.edges) {
    const srcIn = selectedSet.has(edge.source)
    const tgtIn = selectedSet.has(edge.target)
    if (srcIn && tgtIn) {
      internalEdges.push({ ...edge })
      continue
    }
    if (!srcIn && tgtIn) {
      const target = nodeById(document.nodes, edge.target)
      const targetPort = edge.targetPort ?? 'in'
      incoming.push({
        edge,
        dataType: resolveEdgeDataType(document.nodes, edge),
        multiple:
          target
            ? getNodePorts(target).find(
                (port) => port.direction === 'in' && port.id === targetPort
              )?.multiple === true
            : false,
        targetPort,
        targetNodeId: edge.target
      })
      continue
    }
    if (srcIn && !tgtIn) {
      const source = nodeById(document.nodes, edge.source)
      const sourcePort = edge.sourcePort ?? 'out'
      const dataType = source
        ? findOutPort(source, sourcePort)?.dataType ?? GraphPortType.text
        : GraphPortType.text
      outgoing.push({
        edge,
        dataType,
        sourcePort,
        sourceNodeId: edge.source
      })
    }
  }

  // 稳定顺序：按目标/源节点位置
  incoming.sort((a, b) => {
    const na = nodeById(document.nodes, a.targetNodeId)
    const nb = nodeById(document.nodes, b.targetNodeId)
    const dy = (na?.position?.y ?? 0) - (nb?.position?.y ?? 0)
    if (dy !== 0) return dy
    return a.targetPort.localeCompare(b.targetPort)
  })
  outgoing.sort((a, b) => {
    const na = nodeById(document.nodes, a.sourceNodeId)
    const nb = nodeById(document.nodes, b.sourceNodeId)
    const dy = (na?.position?.y ?? 0) - (nb?.position?.y ?? 0)
    if (dy !== 0) return dy
    return a.sourcePort.localeCompare(b.sourcePort)
  })

  const inputGroups = groupInputPorts(incoming)
  const outputGroups = groupOutputPorts(outgoing)

  const hostInterface: HostInterfaceDocument = {
    version: HOST_INTERFACE_FORMAT_VERSION,
    inputs: inputGroups.map((g) => g.port),
    outputs: outputGroups.map((g) => g.port)
  }

  const center = centroid(selectedNodes)
  const minX = Math.min(...selectedNodes.map((n) => n.position?.x ?? 0))
  const maxX = Math.max(...selectedNodes.map((n) => n.position?.x ?? 0))

  const innerNodes: GraphNode[] = selectedNodes.map((n) => ({
    ...n,
    position: { ...n.position },
    params: { ...n.params },
    size: n.size ? { ...n.size } : undefined
  }))
  const innerEdges: GraphEdge[] = [...internalEdges]

  let edgeSeq = 0
  inputGroups.forEach((group, gi) => {
    const bNode = makeBoundaryInputNode(group.port, {
      x: minX - 220,
      y: center.y - 40 + gi * 80
    })
    innerNodes.push(bNode)
    for (const c of group.crossings) {
      innerEdges.push({
        id: newEdgeId('be-in', edgeSeq++),
        source: bNode.id,
        target: c.targetNodeId,
        sourcePort: 'out',
        targetPort: c.targetPort
      })
    }
  })

  outputGroups.forEach((group, gi) => {
    const bNode = makeBoundaryOutputNode(group.port, {
      x: maxX + 220,
      y: center.y - 40 + gi * 80
    })
    innerNodes.push(bNode)
    // 每组取第一条跨边界边的源作为内连（同组同源同口）
    const first = group.crossings[0]!
    innerEdges.push({
      id: newEdgeId('be-out', edgeSeq++),
      source: first.sourceNodeId,
      target: bNode.id,
      sourcePort: first.sourcePort,
      targetPort: 'in'
    })
  })

  const innerDocument: GraphDocument = {
    ...document,
    nodes: innerNodes,
    edges: innerEdges,
    groups: (document.groups ?? []).filter((group) =>
      selectedNodes.some((node) => node.groupId === group.id)
    ),
    viewport: document.viewport ? { ...document.viewport } : { x: 0, y: 0, zoom: 1 },
    runStates: document.runStates
      ? Object.fromEntries(
          Object.entries(document.runStates).filter(([nodeId]) => selectedSet.has(nodeId))
        )
      : undefined
  }

  const hostNodeId = input.hostNodeId?.trim() || `host-${input.hostAssetId.slice(0, 8)}`
  const hostNode = createAssetGraphNode(
    input.hostAssetId,
    'subgraph',
    input.hostAssetName ?? '',
    center,
    { assetHost: true }
  )
  hostNode.id = hostNodeId
  hostNode.params = {
    ...hostNode.params,
    hostInterfaceSnapshot: cloneHostInterface(hostInterface),
    hostSchemaVersion: HOST_INTERFACE_SCHEMA_VERSION
  }

  const remainingNodes = document.nodes.filter((n) => !selectedSet.has(n.id))
  const parentEdges: GraphEdge[] = []

  // 保留与选区无关的边
  for (const edge of document.edges) {
    if (selectedSet.has(edge.source) || selectedSet.has(edge.target)) continue
    parentEdges.push({ ...edge })
  }

  // 外→选区：接到 host 对应 in port
  inputGroups.forEach((group) => {
    for (const c of group.crossings) {
      parentEdges.push({
        id: newEdgeId('pe-in', edgeSeq++),
        source: c.edge.source,
        target: hostNodeId,
        sourcePort: c.edge.sourcePort ?? 'out',
        targetPort: group.port.id
      })
    }
  })

  // 选区→外：从 host 对应 out port 接出
  outputGroups.forEach((group) => {
    for (const c of group.crossings) {
      parentEdges.push({
        id: newEdgeId('pe-out', edgeSeq++),
        source: hostNodeId,
        target: c.edge.target,
        sourcePort: group.port.id,
        targetPort: c.edge.targetPort ?? 'in'
      })
    }
  })

  const parentDocument: GraphDocument = {
    ...document,
    nodes: [...remainingNodes, hostNode],
    edges: parentEdges,
    groups: (document.groups ?? []).filter((g) => {
      // 简单保留：组定义本身不绑节点列表时原样保留
      return !!g.id
    }),
    viewport: document.viewport ? { ...document.viewport } : { x: 0, y: 0, zoom: 1 },
    runStates: document.runStates
      ? Object.fromEntries(
          Object.entries(document.runStates).filter(([nodeId]) => !selectedSet.has(nodeId))
        )
      : undefined
  }

  return {
    parentDocument: cloneGraphDocument(parentDocument),
    innerDocument: cloneGraphDocument(innerDocument),
    hostInterface: cloneHostInterface(hostInterface),
    hostNodeId
  }
}

/**
 * 删除 / 改类型后清理与 host 端口不兼容的边。
 */
export function pruneEdgesForHostInterface(
  document: GraphDocument,
  hostNodeId: string,
  iface: HostInterfaceDocument
): GraphDocument {
  const doc = cloneGraphDocument(document)
  const host = doc.nodes.find((n) => n.id === hostNodeId)
  if (!host) return doc
  host.params = {
    ...host.params,
    hostInterfaceSnapshot: cloneHostInterface(iface)
  }
  const inIds = new Set(iface.inputs.map((p) => p.id))
  const outIds = new Set(iface.outputs.map((p) => p.id))
  const inType = new Map(iface.inputs.map((p) => [p.id, p.dataType]))
  const outType = new Map(iface.outputs.map((p) => [p.id, p.dataType]))

  doc.edges = doc.edges.filter((edge) => {
    if (edge.target === hostNodeId) {
      const port = edge.targetPort ?? 'in'
      if (!inIds.has(port)) return false
      const expected = inType.get(port)
      const actual = resolveEdgeDataType(doc.nodes, edge)
      return !expected || actual === expected
    }
    if (edge.source === hostNodeId) {
      const port = edge.sourcePort ?? 'out'
      if (!outIds.has(port)) return false
      const expected = outType.get(port)
      if (!expected) return true
      const target = nodeById(doc.nodes, edge.target)
      if (!target) return false
      const inPort = getNodePorts(target).find(
        (p) => p.direction === 'in' && p.id === (edge.targetPort ?? 'in')
      )
      return !inPort || inPort.dataType === expected
    }
    return true
  })
  return doc
}
