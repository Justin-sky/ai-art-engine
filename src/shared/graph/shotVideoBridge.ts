/**
 * 分镜 shotWorkflow ↔ asset.video 桥接：以视频生成节点为参考/首尾帧 SSOT。
 */
import type { AssetType, ShotAudioRef, ShotGenRef } from '../domain'
import { cloneGraphDocument } from './document'
import { createAssetGraphNode } from './create'
import { contributionFromAssets, nodeToAssetValue } from './execute/values'
import type { GraphAssetValue } from './execute/types'
import { isProcessingAssetNode } from './nodeRole'
import {
  VIDEO_FIRST_FRAME_PORT_ID,
  VIDEO_LAST_FRAME_PORT_ID,
  isVideoFramePortId,
  readVideoGenerateParamsFromNode,
  videoGenerateParamsToNodePatch,
  type VideoFrameMode
} from './videoGenerateParams'
import type { GraphDocument, GraphEdge, GraphNode } from './types'

export type VideoRefPortId = 'in-image' | 'in-video' | 'in-voice'
export type VideoFrameSlotPortId =
  | typeof VIDEO_FIRST_FRAME_PORT_ID
  | typeof VIDEO_LAST_FRAME_PORT_ID

export function findShotWorkflowVideoNode(doc: GraphDocument): GraphNode | null {
  return findAllShotWorkflowVideoNodes(doc)[0] ?? null
}

/** 分镜视频图中全部视频生成加工节点（多生成节点汇入同一输出时用） */
export function findAllShotWorkflowVideoNodes(doc: GraphDocument): GraphNode[] {
  return doc.nodes.filter((node) => node.typeId === 'asset.video' && isProcessingAssetNode(node))
}

export function targetPortForShotAssetType(type: AssetType): VideoRefPortId {
  if (type === 'video') return 'in-video'
  if (type === 'voice') return 'in-voice'
  return 'in-image'
}

function ensureEdge(
  edges: GraphEdge[],
  source: string,
  target: string,
  targetPort: string,
  sourcePort = 'out'
): GraphEdge {
  const existing = edges.find(
    (edge) =>
      edge.source === source &&
      edge.target === target &&
      (edge.sourcePort ?? 'out') === sourcePort &&
      (edge.targetPort ?? 'in') === targetPort
  )
  if (existing) return existing
  const edge: GraphEdge = {
    id: `edge-${crypto.randomUUID()}`,
    source,
    target,
    sourcePort,
    targetPort
  }
  edges.push(edge)
  return edge
}

function removeOrphanAssetRefNodes(doc: GraphDocument, candidateIds: string[]): void {
  const connected = new Set<string>()
  for (const edge of doc.edges) {
    connected.add(edge.source)
    connected.add(edge.target)
  }
  doc.nodes = doc.nodes.filter((node) => {
    if (!candidateIds.includes(node.id)) return true
    if (connected.has(node.id)) return true
    return !(node.params?.assetRef === true || !!node.assetId)
  })
}

function findOrCreateAssetRefNode(
  doc: GraphDocument,
  asset: { id: string; type: AssetType; name: string },
  near: GraphNode
): GraphNode {
  const existing = doc.nodes.find(
    (node) => node.assetId === asset.id && (node.params?.assetRef === true || !!node.assetId)
  )
  if (existing) return existing
  const refCount = doc.nodes.filter(
    (node) => node.category === 'asset' && (node.params?.assetRef === true || !!node.assetId)
  ).length
  const node = createAssetGraphNode(asset.id, asset.type, asset.name, {
    x: near.position.x - 220,
    y: near.position.y + refCount * 140
  })
  doc.nodes.push(node)
  return node
}

function setVideoFrameMode(video: GraphNode, mode: VideoFrameMode): void {
  const current = readVideoGenerateParamsFromNode(video.params ?? {})
  const patch = videoGenerateParamsToNodePatch({ ...current, frameMode: mode })
  video.params = { ...video.params, ...patch }
}

function requiredModeForFramePort(portId: VideoFrameSlotPortId): VideoFrameMode {
  return portId === VIDEO_LAST_FRAME_PORT_ID ? 'first_last' : 'first'
}

function reconcileFrameMode(video: GraphNode, edges: GraphEdge[]): void {
  const hasFirst = edges.some(
    (edge) =>
      edge.target === video.id && (edge.targetPort ?? '') === VIDEO_FIRST_FRAME_PORT_ID
  )
  const hasLast = edges.some(
    (edge) => edge.target === video.id && (edge.targetPort ?? '') === VIDEO_LAST_FRAME_PORT_ID
  )
  if (hasLast) setVideoFrameMode(video, 'first_last')
  else if (hasFirst) setVideoFrameMode(video, 'first')
  else setVideoFrameMode(video, 'none')
}

/** 从视频节点非帧、非文本入边收集 @n 引用 */
export function listVideoMentionContribution(graph: GraphDocument): {
  genRefs: ShotGenRef[]
  audioRefs: ShotAudioRef[]
} {
  const video = findShotWorkflowVideoNode(graph)
  if (!video) return { genRefs: [], audioRefs: [] }
  const values: GraphAssetValue[] = []
  for (const edge of graph.edges) {
    if (edge.target !== video.id) continue
    const port = edge.targetPort ?? 'in'
    if (port === 'in-text' || isVideoFramePortId(port)) continue
    const source = graph.nodes.find((node) => node.id === edge.source)
    if (!source) continue
    const value = nodeToAssetValue(source)
    if (value) values.push(value)
  }
  return contributionFromAssets(values)
}

export function getVideoFrameAssetId(
  graph: GraphDocument,
  portId: VideoFrameSlotPortId
): string | null {
  const video = findShotWorkflowVideoNode(graph)
  if (!video) return null
  const edge = graph.edges.find(
    (item) => item.target === video.id && (item.targetPort ?? '') === portId
  )
  if (!edge) return null
  return graph.nodes.find((node) => node.id === edge.source)?.assetId ?? null
}

export function setVideoFrameAsset(
  graph: GraphDocument,
  portId: VideoFrameSlotPortId,
  asset: { id: string; type: AssetType; name: string } | null
): GraphDocument {
  const doc = cloneGraphDocument(graph)
  const video = findShotWorkflowVideoNode(doc)
  if (!video) return doc

  const oldEdges = doc.edges.filter(
    (edge) => edge.target === video.id && (edge.targetPort ?? '') === portId
  )
  const orphanIds = oldEdges.map((edge) => edge.source)
  doc.edges = doc.edges.filter((edge) => !oldEdges.includes(edge))

  if (asset) {
    if (asset.type !== 'image') return doc
    setVideoFrameMode(video, requiredModeForFramePort(portId))
    const source = findOrCreateAssetRefNode(doc, asset, video)
    ensureEdge(doc.edges, source.id, video.id, portId)
  } else {
    reconcileFrameMode(video, doc.edges)
  }

  removeOrphanAssetRefNodes(doc, orphanIds)
  return doc
}

export function connectShotVideoReference(
  graph: GraphDocument,
  asset: { id: string; type: AssetType; name: string }
): GraphDocument {
  const doc = cloneGraphDocument(graph)
  const video = findShotWorkflowVideoNode(doc)
  if (!video) return doc
  const port = targetPortForShotAssetType(asset.type)
  const source = findOrCreateAssetRefNode(doc, asset, video)
  ensureEdge(doc.edges, source.id, video.id, port)
  return doc
}

export function disconnectShotVideoReference(
  graph: GraphDocument,
  assetId: string
): GraphDocument {
  const doc = cloneGraphDocument(graph)
  const video = findShotWorkflowVideoNode(doc)
  if (!video) return doc

  const sourceIds = new Set(
    doc.nodes.filter((node) => node.assetId === assetId).map((node) => node.id)
  )
  const removedSources: string[] = []
  doc.edges = doc.edges.filter((edge) => {
    if (edge.target !== video.id) return true
    if (isVideoFramePortId(edge.targetPort ?? 'in')) return true
    if (!sourceIds.has(edge.source)) return true
    removedSources.push(edge.source)
    return false
  })
  removeOrphanAssetRefNodes(doc, removedSources)
  return doc
}
