/**
 * 节点图选区复制 / 粘贴（纯函数）。
 * 可删节点 + 内部边；完整组重映射；宿主 assetId 画布唯一。
 */
import { isNodeDeletable } from './create'
import { createGraphGroupId } from './groups'
import { isAssetHostNode } from './nodeRole'
import type { GraphDocument, GraphEdge, GraphGroup, GraphNode } from './types'

export const GRAPH_CLIPBOARD_VERSION = 1
export const GRAPH_CLIPBOARD_TEXT_PREFIX = 'AIARTENGINE_GRAPH_CLIPBOARD_V1'
export const GRAPH_CLIPBOARD_PASTE_OFFSET = 40

export interface GraphClipboardPayload {
  version: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  groups: GraphGroup[]
}

export interface BuildGraphClipboardResult {
  payload: GraphClipboardPayload | null
  /** 选中但因不可删被跳过的节点数 */
  skippedCount: number
}

export interface ApplyGraphClipboardResult {
  document: GraphDocument
  pastedNodeIds: string[]
  /** 因画布已有同资产宿主而跳过 */
  skippedHostCount: number
  /** 因不可删等原因跳过（防御非法剪贴板） */
  skippedCount: number
}

function clonePlain<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
}

function cloneNode(node: GraphNode): GraphNode {
  return {
    ...node,
    position: { ...node.position },
    size: node.size ? { ...node.size } : undefined,
    assetRef: node.assetRef ? clonePlain(node.assetRef) : undefined,
    params: clonePlain(node.params ?? {})
  }
}

function newNodeId(): string {
  return `node-${crypto.randomUUID()}`
}

function newEdgeId(): string {
  return `edge-${crypto.randomUUID()}`
}

/** 从选区构建剪贴板；无可复制节点时 payload 为 null */
export function buildGraphClipboardPayload(
  doc: GraphDocument,
  selectedIds: Iterable<string>
): BuildGraphClipboardResult {
  const selected = new Set(
    [...selectedIds].map((id) => id?.trim()).filter((id): id is string => !!id)
  )
  if (!selected.size) {
    return { payload: null, skippedCount: 0 }
  }

  let skippedCount = 0
  const copyable: GraphNode[] = []
  for (const node of doc.nodes) {
    if (!selected.has(node.id)) continue
    if (!isNodeDeletable(node)) {
      skippedCount += 1
      continue
    }
    copyable.push(cloneNode(node))
  }
  if (!copyable.length) {
    return { payload: null, skippedCount }
  }

  const copyableIds = new Set(copyable.map((n) => n.id))
  const edges = doc.edges
    .filter((edge) => copyableIds.has(edge.source) && copyableIds.has(edge.target))
    .map((edge) => ({ ...edge }))

  // 组内成员须全部在可复制集合内才带上组
  const groupMemberCount = new Map<string, number>()
  for (const node of doc.nodes) {
    if (!node.groupId) continue
    groupMemberCount.set(node.groupId, (groupMemberCount.get(node.groupId) ?? 0) + 1)
  }
  const copyableInGroup = new Map<string, number>()
  for (const node of copyable) {
    if (!node.groupId) continue
    copyableInGroup.set(node.groupId, (copyableInGroup.get(node.groupId) ?? 0) + 1)
  }
  const intactGroupIds = new Set<string>()
  for (const [groupId, count] of copyableInGroup) {
    if (count === (groupMemberCount.get(groupId) ?? 0)) {
      intactGroupIds.add(groupId)
    }
  }
  for (const node of copyable) {
    if (node.groupId && !intactGroupIds.has(node.groupId)) {
      delete node.groupId
    }
  }
  const groups = (doc.groups ?? [])
    .filter((g) => intactGroupIds.has(g.id))
    .map((g) => ({ ...g }))

  return {
    payload: {
      version: GRAPH_CLIPBOARD_VERSION,
      nodes: copyable,
      edges,
      groups
    },
    skippedCount
  }
}

export function serializeGraphClipboardPayload(payload: GraphClipboardPayload): string {
  return `${GRAPH_CLIPBOARD_TEXT_PREFIX}\n${JSON.stringify(payload)}`
}

export function parseGraphClipboardPayload(text: string): GraphClipboardPayload | null {
  const raw = text?.trim()
  if (!raw) return null
  const prefix = `${GRAPH_CLIPBOARD_TEXT_PREFIX}\n`
  if (!raw.startsWith(GRAPH_CLIPBOARD_TEXT_PREFIX)) return null
  const json = raw.startsWith(prefix)
    ? raw.slice(prefix.length)
    : raw.slice(GRAPH_CLIPBOARD_TEXT_PREFIX.length).replace(/^\n/, '')
  try {
    const parsed = JSON.parse(json) as GraphClipboardPayload
    if (!parsed || parsed.version !== GRAPH_CLIPBOARD_VERSION) return null
    if (!Array.isArray(parsed.nodes) || !parsed.nodes.length) return null
    return {
      version: GRAPH_CLIPBOARD_VERSION,
      nodes: parsed.nodes,
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : []
    }
  } catch {
    return null
  }
}

/**
 * 将剪贴板内容粘贴进文档副本。
 * 生成新 id、应用偏移；跳过不可删节点与重复宿主。
 */
export function applyGraphClipboardPayload(
  doc: GraphDocument,
  payload: GraphClipboardPayload,
  options: { offset: { x: number; y: number } }
): ApplyGraphClipboardResult {
  const offsetX = options.offset?.x ?? GRAPH_CLIPBOARD_PASTE_OFFSET
  const offsetY = options.offset?.y ?? GRAPH_CLIPBOARD_PASTE_OFFSET

  const existingHostAssetIds = new Set(
    doc.nodes
      .filter((n) => isAssetHostNode(n) && !!n.assetId)
      .map((n) => n.assetId as string)
  )
  const pastedHostAssetIds = new Set<string>()

  let skippedHostCount = 0
  let skippedCount = 0
  const idMap = new Map<string, string>()
  const pastedNodes: GraphNode[] = []

  for (const raw of payload.nodes) {
    if (!raw?.id) {
      skippedCount += 1
      continue
    }
    const node = cloneNode(raw)
    if (!isNodeDeletable(node)) {
      skippedCount += 1
      continue
    }
    if (isAssetHostNode(node) && node.assetId) {
      if (existingHostAssetIds.has(node.assetId) || pastedHostAssetIds.has(node.assetId)) {
        skippedHostCount += 1
        continue
      }
      pastedHostAssetIds.add(node.assetId)
    }
    const nextId = newNodeId()
    idMap.set(raw.id, nextId)
    node.id = nextId
    node.position = {
      x: node.position.x + offsetX,
      y: node.position.y + offsetY
    }
    pastedNodes.push(node)
  }

  if (!pastedNodes.length) {
    return {
      document: {
        nodes: [...doc.nodes],
        edges: [...doc.edges],
        groups: [...(doc.groups ?? [])],
        viewport: { ...doc.viewport },
        runStates: doc.runStates
      },
      pastedNodeIds: [],
      skippedHostCount,
      skippedCount
    }
  }

  const groupIdMap = new Map<string, string>()
  const pastedGroups: GraphGroup[] = []
  for (const group of payload.groups ?? []) {
    if (!group?.id) continue
    // 仅保留至少有一个粘贴节点引用的组
    const used = pastedNodes.some((n) => n.groupId === group.id)
    if (!used) continue
    const nextId = createGraphGroupId()
    groupIdMap.set(group.id, nextId)
    pastedGroups.push({
      id: nextId,
      ...(group.title != null ? { title: group.title } : {})
    })
  }
  for (const node of pastedNodes) {
    if (!node.groupId) continue
    const mapped = groupIdMap.get(node.groupId)
    if (mapped) node.groupId = mapped
    else delete node.groupId
  }

  const pastedEdges: GraphEdge[] = []
  for (const edge of payload.edges ?? []) {
    const source = idMap.get(edge.source)
    const target = idMap.get(edge.target)
    if (!source || !target) continue
    pastedEdges.push({
      id: newEdgeId(),
      source,
      target,
      ...(edge.sourcePort != null ? { sourcePort: edge.sourcePort } : {}),
      ...(edge.targetPort != null ? { targetPort: edge.targetPort } : {})
    })
  }

  return {
    document: {
      nodes: [...doc.nodes, ...pastedNodes],
      edges: [...doc.edges, ...pastedEdges],
      groups: [...(doc.groups ?? []), ...pastedGroups],
      viewport: { ...doc.viewport },
      runStates: doc.runStates
    },
    pastedNodeIds: pastedNodes.map((n) => n.id),
    skippedHostCount,
    skippedCount
  }
}
