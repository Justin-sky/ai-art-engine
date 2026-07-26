import { computed, ref } from 'vue'
import type { AssetInfo, AssetType } from '@shared/domain'
import {
  isVideoFramePortId,
  type GraphEdge,
  type GraphGroup,
  type GraphNode,
  type GraphNodeParams,
  type GraphDocument
} from '@shared/graph'

export interface GraphIncomingEdgeRef {
  edgeId: string
  sourceNodeId: string
  /** 1-based，与 @ 引用编号一致；帧端口列表可为 0 */
  index: number
  sourcePort?: string
  targetPort?: string
}

export interface BuildIncomingEdgeRefsOptions {
  /** 排除首/尾帧口，使 @n 仅覆盖参考类入边 */
  excludeFramePorts?: boolean
}

export interface GraphEditorHostApi {
  getNode: (nodeId: string) => GraphNode | null
  findNode?: (predicate: (node: GraphNode) => boolean) => GraphNode | null
  /** 当前打开图画布的实时文档（含未落盘的边 / runStates） */
  getDocument?: () => GraphDocument
  getGroup?: (groupId: string) => GraphGroup | null
  getGroupMemberIds?: (groupId: string) => string[]
  listIncomingEdges?: (nodeId: string, portId?: string) => GraphIncomingEdgeRef[]
  removeEdge?: (edgeId: string) => void
  /** 按 orderedEdgeIds 重排指向 nodeId 的入边（影响 @n 编号顺序） */
  reorderIncomingEdges?: (nodeId: string, orderedEdgeIds: string[]) => void
  updateNode: (nodeId: string, params: Partial<GraphNodeParams>, title?: string) => void
  updateGroup?: (groupId: string, patch: { title?: string }) => void
  setNodeAsset: (
    nodeId: string,
    asset: { assetId: string; assetType: AssetType; name: string } | null
  ) => void
  /** 后台任务结果写回时，整图替换并刷新运行状态 */
  applyExternalGraph?: (document: GraphDocument) => void
  flush: () => Promise<void>
}

/** 从图 edges 列出指向 target 的入边；portId 省略时返回全部入边 */
export function buildIncomingEdgeRefs(
  edges: GraphEdge[],
  nodeId: string,
  portId?: string,
  options?: BuildIncomingEdgeRefsOptions
): GraphIncomingEdgeRef[] {
  const incoming = edges.filter(
    (edge) =>
      edge.target === nodeId &&
      (portId === undefined || (edge.targetPort ?? 'in') === portId) &&
      (!options?.excludeFramePorts || !isVideoFramePortId(edge.targetPort ?? 'in'))
  )
  return incoming.map((edge, i) => ({
    edgeId: edge.id,
    sourceNodeId: edge.source,
    index: i + 1,
    sourcePort: edge.sourcePort,
    targetPort: edge.targetPort
  }))
}

/** 仅首/尾帧入边（固定顺序：首帧 → 尾帧），不参与 @ 编号 */
export function buildFrameIncomingEdgeRefs(
  edges: GraphEdge[],
  nodeId: string
): GraphIncomingEdgeRef[] {
  const order = ['in-first-frame', 'in-last-frame'] as const
  const incoming = edges.filter(
    (edge) => edge.target === nodeId && isVideoFramePortId(edge.targetPort ?? 'in')
  )
  incoming.sort((a, b) => {
    const ai = order.indexOf((a.targetPort ?? '') as (typeof order)[number])
    const bi = order.indexOf((b.targetPort ?? '') as (typeof order)[number])
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
  })
  return incoming.map((edge) => ({
    edgeId: edge.id,
    sourceNodeId: edge.source,
    index: 0,
    sourcePort: edge.sourcePort,
    targetPort: edge.targetPort
  }))
}

/**
 * 按 orderedIncomingEdgeIds 重排指向 target 的入边，其它边相对位置不变。
 * 无效顺序或与当前一致时返回 null。
 */
export function reorderIncomingEdgesByIds(
  edges: GraphEdge[],
  targetNodeId: string,
  orderedIncomingEdgeIds: string[]
): GraphEdge[] | null {
  const incoming = edges.filter((edge) => edge.target === targetNodeId)
  if (incoming.length < 2) return null
  const incomingIds = new Set(incoming.map((edge) => edge.id))
  if (orderedIncomingEdgeIds.length !== incoming.length) return null
  if (orderedIncomingEdgeIds.some((id) => !incomingIds.has(id))) return null
  if (new Set(orderedIncomingEdgeIds).size !== orderedIncomingEdgeIds.length) return null
  if (incoming.every((edge, i) => edge.id === orderedIncomingEdgeIds[i])) return null

  const byId = new Map(incoming.map((edge) => [edge.id, edge]))
  const queue = orderedIncomingEdgeIds.map((id) => byId.get(id)!)
  let i = 0
  return edges.map((edge) => (edge.target === targetNodeId ? queue[i++]! : edge))
}

/**
 * 入边重排后，旧 @n → 新 @n（1-based）。
 * `indexBase`：风格图占用的编号数量，端口从 indexBase+1 起编。
 */
export function buildMentionIndexMapAfterReorder(
  oldEdgeIds: string[],
  newEdgeIds: string[],
  indexBase = 0
): Map<number, number> {
  const base = Math.max(0, Math.floor(indexBase))
  const newIndexById = new Map(newEdgeIds.map((id, i) => [id, base + i + 1]))
  const map = new Map<number, number>()
  oldEdgeIds.forEach((id, i) => {
    const next = newIndexById.get(id)
    if (next != null) map.set(base + i + 1, next)
  })
  return map
}

/** 风格占位数量变化时，把端口 `@n` 整体平移 */
export function buildMentionIndexMapForStyleReserveChange(
  oldReserve: number,
  newReserve: number,
  portCount: number
): Map<number, number> {
  const fromBase = Math.max(0, Math.floor(oldReserve))
  const toBase = Math.max(0, Math.floor(newReserve))
  const count = Math.max(0, Math.floor(portCount))
  const map = new Map<number, number>()
  if (fromBase === toBase || count === 0) return map
  for (let i = 0; i < count; i++) {
    map.set(fromBase + i + 1, toBase + i + 1)
  }
  return map
}

/** 按 indexMap 重写指令中的 @n，使引用仍指向同一入边 */
export function remapInstructionMentions(
  text: string,
  indexMap: Map<number, number>
): string {
  if (!text || indexMap.size === 0) return text
  let changed = false
  for (const [from, to] of indexMap) {
    if (from !== to) {
      changed = true
      break
    }
  }
  if (!changed) return text
  return text
    .replace(/@(\d+)/g, (_m, n: string) => {
      const old = Number(n)
      const next = indexMap.get(old)
      return next != null ? `@\uE000${next}` : `@${n}`
    })
    .replace(/@\uE000(\d+)/g, '@$1')
}

/** Graph Feature 自有端口注册表，避免把领域编辑 API 放进 workspace UI store。 */
class GraphEditorHostRegistry {
  private readonly hosts = new Map<string, GraphEditorHostApi>()
  /** 边 / 节点结构变化时递增，供 Inspector 订阅刷新 */
  readonly revision = ref(0)

  bumpRevision(): void {
    this.revision.value += 1
  }

  register(hostId: string, api: GraphEditorHostApi): () => void {
    this.hosts.set(hostId, api)
    this.bumpRevision()
    return () => {
      if (this.hosts.get(hostId) === api) this.hosts.delete(hostId)
      this.bumpRevision()
    }
  }

  getNode(hostId: string | null | undefined, nodeId: string): GraphNode | null {
    void this.revision.value
    return hostId ? this.hosts.get(hostId)?.getNode(nodeId) ?? null : null
  }

  findNode(
    hostId: string | null | undefined,
    predicate: (node: GraphNode) => boolean
  ): GraphNode | null {
    void this.revision.value
    return hostId ? this.hosts.get(hostId)?.findNode?.(predicate) ?? null : null
  }

  getGroup(hostId: string | null | undefined, groupId: string): GraphGroup | null {
    return hostId ? this.hosts.get(hostId)?.getGroup?.(groupId) ?? null : null
  }

  getGroupMemberIds(hostId: string | null | undefined, groupId: string): string[] {
    return hostId ? this.hosts.get(hostId)?.getGroupMemberIds?.(groupId) ?? [] : []
  }

  /** 列出指向 node 的入边；省略 portId 时返回全部入边 */
  listIncomingEdges(
    hostId: string | null | undefined,
    nodeId: string,
    portId?: string
  ): GraphIncomingEdgeRef[] {
    void this.revision.value
    return hostId ? this.hosts.get(hostId)?.listIncomingEdges?.(nodeId, portId) ?? [] : []
  }

  removeEdge(hostId: string | null | undefined, edgeId: string): void {
    if (hostId) this.hosts.get(hostId)?.removeEdge?.(edgeId)
  }

  reorderIncomingEdges(
    hostId: string | null | undefined,
    nodeId: string,
    orderedEdgeIds: string[]
  ): void {
    if (hostId) this.hosts.get(hostId)?.reorderIncomingEdges?.(nodeId, orderedEdgeIds)
  }

  updateGroup(
    hostId: string | null | undefined,
    groupId: string,
    patch: { title?: string }
  ): void {
    if (hostId) this.hosts.get(hostId)?.updateGroup?.(groupId, patch)
  }

  updateNode(
    hostId: string | null | undefined,
    nodeId: string,
    params: Partial<GraphNodeParams>,
    title?: string
  ): void {
    if (!hostId) return
    const host = this.hosts.get(hostId)
    if (!host) return
    host.updateNode(nodeId, params, title)
    // 参数变更（含本地风格图）需通知 Inspector / 指令编辑器重新解析
    this.bumpRevision()
  }

  setNodeAsset(
    hostId: string | null | undefined,
    nodeId: string,
    asset: AssetInfo | null
  ): void {
    if (!hostId) return
    this.hosts.get(hostId)?.setNodeAsset(
      nodeId,
      asset ? { assetId: asset.id, assetType: asset.type, name: asset.name } : null
    )
  }

  applyExternalGraph(hostId: string | null | undefined, document: GraphDocument): void {
    if (!hostId) return
    this.hosts.get(hostId)?.applyExternalGraph?.(document)
    this.bumpRevision()
  }

  async flush(hostId: string | null | undefined): Promise<void> {
    if (hostId) await this.hosts.get(hostId)?.flush()
  }

  /** 所有已注册打开画布的实时文档（用于跨编辑器解析父图入边） */
  listLiveDocuments(): GraphDocument[] {
    void this.revision.value
    const docs: GraphDocument[] = []
    for (const api of this.hosts.values()) {
      const doc = api.getDocument?.()
      if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) continue
      docs.push(doc)
    }
    return docs
  }

  reset(): void {
    this.hosts.clear()
    this.bumpRevision()
  }
}

export const graphEditorHosts = new GraphEditorHostRegistry()

export function useGraphEditorRevision() {
  return computed(() => graphEditorHosts.revision.value)
}
