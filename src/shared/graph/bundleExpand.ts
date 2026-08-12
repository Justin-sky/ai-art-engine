/**
 * 束结点（media.bundle）：入边展开与类型锁定。
 * 下游指令 / cook 把「束」展开为真实上游，画布只保留束到下游的一条线。
 */
import { isVideoFramePortId } from './videoGenerateParams'
import {
  GraphPortType,
  toSingularGraphPortDataType,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
  type GraphPortDataType
} from './types'

export const MEDIA_BUNDLE_TYPE_ID = 'media.bundle' as const

export function isBundleNode(node: Pick<GraphNode, 'typeId'> | null | undefined): boolean {
  return node?.typeId === MEDIA_BUNDLE_TYPE_ID
}

/** 束结是否锁定为图片类型（指令框对束引入的图片自动插入强制参考） */
export function isImageBundle(
  node: Pick<GraphNode, 'typeId' | 'params'> | null | undefined
): boolean {
  if (!isBundleNode(node)) return false
  const locked = node?.params?.bundleDataType
  return locked === 'image' || locked === 'images'
}

/** 束结可锁定的端口族（含单/复数） */
export function isBundleAcceptableDataType(dataType: GraphPortDataType): boolean {
  const singular = toSingularGraphPortDataType(dataType)
  switch (singular) {
    case GraphPortType.image:
    case GraphPortType.video:
    case GraphPortType.voice:
    case GraphPortType.text:
    case GraphPortType.beat:
    case GraphPortType.world:
    case GraphPortType.worldEntities:
    case GraphPortType.model:
      return true
    default:
      return false
  }
}

/** 逻辑入边：指令芯片 / @n / 断线换序共用 */
export type BundleExpandedIncoming = {
  /** 真实可断线/换序的边 id（指向 ownerNodeId） */
  edgeId: string
  /** 该边的目标节点（束或消费者） */
  ownerNodeId: string
  sourceNodeId: string
  sourcePort: string
}

function incomingNonFrameEdges(graph: GraphDocument, nodeId: string): GraphEdge[] {
  return graph.edges.filter(
    (edge) => edge.target === nodeId && !isVideoFramePortId(edge.targetPort ?? 'in')
  )
}

/**
 * 展开 nodeId 的入边：源为束结时递归展开其入边（防环）。
 * 束结本身不占逻辑槽位。
 */
export function expandIncomingThroughBundles(
  graph: GraphDocument,
  nodeId: string,
  seen: Set<string> = new Set()
): BundleExpandedIncoming[] {
  if (!nodeId || seen.has(nodeId)) return []
  seen.add(nodeId)
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const result: BundleExpandedIncoming[] = []
  for (const edge of incomingNonFrameEdges(graph, nodeId)) {
    const source = byId.get(edge.source)
    if (source && isBundleNode(source)) {
      result.push(...expandIncomingThroughBundles(graph, source.id, seen))
      continue
    }
    result.push({
      edgeId: edge.id,
      ownerNodeId: nodeId,
      sourceNodeId: edge.source,
      sourcePort: edge.sourcePort ?? 'out'
    })
  }
  return result
}

/** 写入首条入边锁定的单数类型；已锁定则不变 */
export function lockBundleDataType(
  node: GraphNode,
  dataType: GraphPortDataType
): GraphPortDataType | null {
  if (!isBundleNode(node)) return null
  if (!isBundleAcceptableDataType(dataType)) return null
  const singular = toSingularGraphPortDataType(dataType)
  if (node.params.bundleDataType === singular) return singular
  if (node.params.bundleDataType) return node.params.bundleDataType
  node.params = { ...node.params, bundleDataType: singular }
  return singular
}

/** 入边清空时解锁；仍有入边则保持锁定 */
export function syncBundleDataTypeAfterEdgeChange(
  graph: GraphDocument,
  nodeId: string
): void {
  const node = graph.nodes.find((item) => item.id === nodeId)
  if (!node || !isBundleNode(node)) return
  const incoming = incomingNonFrameEdges(graph, nodeId)
  if (incoming.length === 0) {
    if (!node.params.bundleDataType) return
    const { bundleDataType: _removed, ...rest } = node.params
    node.params = rest
    return
  }
  if (node.params.bundleDataType) return
  const byId = new Map(graph.nodes.map((item) => [item.id, item]))
  for (const edge of incoming) {
    const source = byId.get(edge.source)
    if (!source) continue
    // 无端口解析时：用已有锁定或跳过；锁定由 connect 路径负责
    void source
  }
}
