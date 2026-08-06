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
import { isPluralGraphPortDataType, toSingularGraphPortDataType } from './types'
import { canConnectNodes, getNodePorts, GRAPH_OUT_ALL_PORT_ID } from './ports'

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

/** 接复数边界口时优先 out-all（图库节点禁止 out→复数） */
function preferredSourcePort(node: GraphNode, targetIsPlural: boolean): string {
  if (
    targetIsPlural &&
    getNodePorts(node).some((p) => p.id === GRAPH_OUT_ALL_PORT_ID && p.direction === 'out')
  ) {
    return GRAPH_OUT_ALL_PORT_ID
  }
  return 'out'
}

/**
 * 将各悬空业务链出口接到对应 boundary.output。
 * - 单数口：1:1（优先同名标题 / 偏好类型）
 * - 复数口（图片组/视频组…）：同类悬空汇点全部接入该口
 * 优先无出边汇节点；某出口仍悬空时，再从兼容的加工节点补一条（即便它已有其它出边）。
 * 避免旧图拆掉 classic output 后边界永远无入边，导致选中边界输出入队只跑空透传。
 */
export function wireDanglingOutsToBoundaryOutputs(
  document: GraphDocument,
  iface: HostInterfaceDocument
): GraphDocument {
  if (!iface.outputs.length) return document

  const nodes = document.nodes.map((node) => ({
    ...node,
    params: { ...node.params },
    position: { ...node.position },
    size: node.size ? { ...node.size } : undefined
  }))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges = document.edges.map((edge) => ({ ...edge }))
  const usedSources = new Set<string>()

  const byTopThenRight = (a: GraphNode, b: GraphNode): number =>
    a.position.y - b.position.y || b.position.x - a.position.x

  for (const port of iface.outputs) {
    const boutId = boundaryOutputNodeId(port.id)
    const bout = byId.get(boutId)
    if (!bout) continue

    const alreadyWired = edges.some((edge) => edge.target === boutId)
    const aggregate = port.multiple === true || isPluralGraphPortDataType(port.dataType)
    // 复数口允许补接更多源；单数口已有入边则跳过
    if (alreadyWired && !aggregate) continue

    const connectable = (node: GraphNode): boolean => {
      if (isBoundaryProxyNode(node) || node.category === 'output') return false
      if (node.typeId === 'note.text') return false
      const sourcePort = preferredSourcePort(node, aggregate)
      const hasOut = getNodePorts(node).some(
        (p) => p.direction === 'out' && p.id === sourcePort
      )
      if (!hasOut) return false
      return canConnectNodes(node, bout, { sourcePort, targetPort: 'in' })
    }

    const hasOutEdgeIgnoringBoundary = (node: GraphNode): boolean =>
      edges.some(
        (edge) =>
          edge.source === node.id &&
          !isBoundaryProxyNode(byId.get(edge.target) ?? ({ typeId: '' } as GraphNode))
      )

    const singularType = toSingularGraphPortDataType(port.dataType)
    const preferredType =
      singularType === 'video'
        ? 'asset.video'
        : singularType === 'image'
          ? 'asset.image'
          : singularType === 'voice'
            ? 'asset.voice'
            : null

    const dangling = nodes
      .filter(
        (node) =>
          connectable(node) &&
          !usedSources.has(node.id) &&
          !hasOutEdgeIgnoringBoundary(node)
      )
      .sort(byTopThenRight)

    if (aggregate) {
      // 悬空且可连的源全部接入复数口；若无悬空，再补接尚未连到本 boundary 的同类源
      const extra =
        dangling.length > 0
          ? []
          : nodes
              .filter((node) => {
                if (!connectable(node) || usedSources.has(node.id)) return false
                if (
                  edges.some(
                    (e) =>
                      e.source === node.id &&
                      e.target === boutId &&
                      (e.sourcePort ?? 'out') === preferredSourcePort(node, true)
                  )
                ) {
                  return false
                }
                if (preferredType) return node.typeId === preferredType
                return (
                  (node.category === 'asset' && node.assetType === singularType) ||
                  node.typeId === `asset.${singularType}`
                )
              })
              .sort(byTopThenRight)

      const toWire = dangling.length ? dangling : extra
      let firstY: number | null = null
      for (const source of toWire) {
        const sourcePort = preferredSourcePort(source, true)
        pushEdge(edges, source.id, boutId, sourcePort, 'in')
        usedSources.add(source.id)
        if (firstY == null) firstY = source.position.y
      }
      if (firstY != null && toWire[0]) {
        bout.position = {
          x: Math.max(bout.position.x, toWire[0].position.x + 280),
          y: firstY
        }
      }
      continue
    }

    let source =
      dangling.find((n) => {
        const title = n.title?.trim()
        return title && title === port.label
      }) ??
      dangling.find((n) => (preferredType ? n.typeId === preferredType : true)) ??
      dangling[0]

    if (!source) {
      const fallback = nodes
        .filter((node) => {
          if (!connectable(node) || usedSources.has(node.id)) return false
          if (preferredType) return node.typeId === preferredType
          return (
            (node.category === 'asset' && node.assetType === singularType) ||
            node.typeId === `asset.${singularType}`
          )
        })
        .sort(byTopThenRight)
      source = fallback[0]
    }

    if (!source) continue
    const sourcePort = preferredSourcePort(source, false)
    pushEdge(edges, source.id, boutId, sourcePort, 'in')
    usedSources.add(source.id)
    // 出口节点靠齐对应汇点右侧，便于三路立绘各自成对
    bout.position = {
      x: Math.max(bout.position.x, source.position.x + 280),
      y: source.position.y
    }
  }

  return { ...document, nodes, edges }
}

/** @deprecated 使用 wireDanglingOutsToBoundaryOutputs */
export function wireDanglingOutsToPrimaryBoundary(
  document: GraphDocument,
  iface: HostInterfaceDocument
): GraphDocument {
  return wireDanglingOutsToBoundaryOutputs(document, iface)
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
  options?: {
    autoLinkHeadTypeIds?: string[]
    /**
     * 为 true 时只补齐/更新 iface 中的 boundary，不删除图上其它 boundary
 *（绑定实体会动态建 boundary.input，不能按空 inputs 剪掉）。
     */
    preserveUnlistedBoundaryNodes?: boolean
  }
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

  // 去掉接口中已删除的 boundary 节点及其边（可保留未列出的绑定输入）
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
    if (options?.preserveUnlistedBoundaryNodes) return true
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
  next = wireDanglingOutsToBoundaryOutputs(next, iface)
  const headTypeIds = options?.autoLinkHeadTypeIds ?? []
  if (headTypeIds.length) {
    next = wireBoundaryInputsToHeads(next, iface, headTypeIds)
  }
  return next
}
