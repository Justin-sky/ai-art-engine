/**
 * 分镜画面 visualGraphJson ↔ Shot.genRefs / 视频图桥接。
 * 纯图文档与 genRefs 变换；资产创建与跑图由渲染层完成。
 */
import {
  normalizeGenRefs,
  normalizeShotReviewStatus,
  reindexAllShotRefs,
  type Shot,
  type ShotGenRef,
  type ShotGenRefRole
} from '../domain'
import { flattenImagesValues, flattenVideosValues } from './execute/values'
import type { GraphImageItem, GraphVideoItem } from './execute/types'
import { findOutputNode } from './query'
import { VIDEO_FIRST_FRAME_PORT_ID } from './videoGenerateParams'
import {
  connectShotVideoReference,
  findAllShotWorkflowVideoNodes,
  findShotWorkflowVideoNode,
  setVideoFrameAsset
} from './shotVideoBridge'
import { createAssetGraphNode } from './create'
import { isProcessingAssetNode } from './nodeRole'
import type { GraphDocument, GraphEdge, GraphNode } from './types'
import type { AssetType } from '../domain'
import { cloneGraphDocument } from './document'
import type { ShotSplitRow } from './shotSplitParse'

export type ShotVisualImageAsset = {
  id: string
  type: AssetType
  name: string
  relativePath?: string
}

/** 从分镜画面图收集图片：以图片输出节点为准；输出为空时再回退上游生成节点 */
export function collectImagesFromVisualGraph(doc: GraphDocument | null | undefined): GraphImageItem[] {
  if (!doc?.nodes?.length) return []

  const output = findOutputNode(doc)
  const fromOutput = collectImagesFromNode(doc, output)
  if (fromOutput.length) return fromOutput

  // 输出尚未写入（只跑过生成、未跑到输出）时回退上游
  if (output) {
    const sourceIds = [
      ...new Set(doc.edges.filter((edge) => edge.target === output.id).map((edge) => edge.source))
    ]
    const fromSources = dedupeImageItems(
      sourceIds.flatMap((id) => {
        const node = doc.nodes.find((n) => n.id === id) ?? null
        return collectImagesFromNode(doc, node)
      })
    )
    if (fromSources.length) return fromSources
  }

  return dedupeImageItems(
    findAllShotVisualImageNodes(doc).flatMap((node) => collectImagesFromNode(doc, node))
  )
}

function collectGeneratedImagesParam(node: GraphNode | null): GraphImageItem[] {
  if (!node) return []
  const generated = node.params.generatedImages
  if (!Array.isArray(generated) || !generated.length) return []
  return dedupeImageItems(
    generated
      .map((shot, index) => ({
        id: shot.id ?? `visual-gen:${node.id}:${index}`,
        dataUrl: shot.dataUrl ?? '',
        createdAt: shot.createdAt,
        relativePath: shot.relativePath
      }))
      .filter((item) => item.relativePath || item.dataUrl)
  )
}

function dedupeImageItems(items: GraphImageItem[]): GraphImageItem[] {
  const seen = new Set<string>()
  const out: GraphImageItem[] = []
  for (const item of items) {
    const key =
      item.relativePath?.trim() ||
      item.id?.trim() ||
      (item.dataUrl?.trim() ? `data:${item.dataUrl.slice(0, 64)}` : '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function collectImagesFromNode(
  doc: GraphDocument,
  node: GraphNode | null
): GraphImageItem[] {
  if (!node) return []

  // 生成节点：累计历史优先于当次 runStates（out 仅含本批）
  const fromGenerated = collectGeneratedImagesParam(node)
  if (fromGenerated.length) return fromGenerated

  const fromRun = doc.runStates?.[node.id]?.outputs?.out
  const fromValue = fromRun ? flattenImagesValues([fromRun]) : []
  if (fromValue.length) {
    return dedupeImageItems(fromValue.filter((item) => item.relativePath || item.dataUrl))
  }

  const shots = node.params.cameraShots
  if (Array.isArray(shots) && shots.length) {
    return dedupeImageItems(
      shots
        .map((shot, index) => ({
          id: shot.id ?? `visual:${node.id}:${index}`,
          dataUrl: shot.dataUrl ?? '',
          createdAt: shot.createdAt,
          relativePath: shot.relativePath
        }))
        .filter((item) => item.relativePath || item.dataUrl)
    )
  }

  const previewPath = node.params.previewRelativePath?.trim()
  const previewData = node.params.previewDataUrl?.trim()
  if (previewPath || previewData) {
    return [
      {
        id: `visual-preview:${node.id}`,
        dataUrl: previewData ?? '',
        relativePath: previewPath
      }
    ]
  }
  return []
}

/** 从分镜视频图收集视频：以视频输出节点为准；输出为空时再回退上游生成节点 */
export function collectVideosFromShotWorkflowGraph(
  doc: GraphDocument | null | undefined
): GraphVideoItem[] {
  if (!doc?.nodes?.length) return []

  const output = findOutputNode(doc)
  const fromOutput = collectVideosFromNode(doc, output ?? null)
  if (fromOutput.length) return fromOutput

  if (output) {
    const sourceIds = [
      ...new Set(doc.edges.filter((edge) => edge.target === output.id).map((edge) => edge.source))
    ]
    const fromSources = dedupeVideoItems(
      sourceIds.flatMap((id) => {
        const node = doc.nodes.find((n) => n.id === id) ?? null
        return collectVideosFromNode(doc, node)
      })
    )
    if (fromSources.length) return fromSources
  }

  return dedupeVideoItems(
    findAllShotWorkflowVideoNodes(doc).flatMap((node) => collectVideosFromNode(doc, node))
  )
}

function collectGeneratedVideosParam(node: GraphNode | null): GraphVideoItem[] {
  if (!node) return []
  const generated = node.params.generatedVideos
  if (!Array.isArray(generated) || !generated.length) return []
  return dedupeVideoItems(
    generated
      .map((item, index) => ({
        id: item.id ?? `video-gen:${node.id}:${index}`,
        dataUrl: item.dataUrl,
        createdAt: item.createdAt,
        relativePath: item.relativePath
      }))
      .filter((item) => item.relativePath || item.dataUrl)
  )
}

function dedupeVideoItems(items: GraphVideoItem[]): GraphVideoItem[] {
  const seen = new Set<string>()
  const out: GraphVideoItem[] = []
  for (const item of items) {
    const key =
      item.relativePath?.trim() ||
      item.id?.trim() ||
      (item.dataUrl?.trim() ? `data:${item.dataUrl.slice(0, 64)}` : '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function collectVideosFromNode(
  doc: GraphDocument,
  node: GraphNode | null
): GraphVideoItem[] {
  if (!node) return []

  const fromGenerated = collectGeneratedVideosParam(node)
  if (fromGenerated.length) return fromGenerated

  const fromRun = doc.runStates?.[node.id]?.outputs?.out
  const fromValue = fromRun ? flattenVideosValues([fromRun]) : []
  if (fromValue.length) {
    return dedupeVideoItems(fromValue.filter((item) => item.relativePath || item.dataUrl))
  }

  const previewPath = node.params.previewRelativePath?.trim()
  const previewData = node.params.previewDataUrl?.trim()
  if (previewPath || previewData) {
    return [
      {
        id: `video-preview:${node.id}`,
        dataUrl: previewData,
        relativePath: previewPath
      }
    ]
  }
  return []
}

/**
 * 用画面输出资产重写分镜 genRefs（style，可被 normalize 保留）。
 * 首图额外保留为后续拖入时的首帧候选（仍用 style 存库，拖入时设 firstFrame）。
 */
export function mergeVisualOutputGenRefs(
  existing: ShotGenRef[] | undefined,
  imageAssetIds: string[],
  role: ShotGenRefRole = 'style'
): ShotGenRef[] {
  const kept = (existing ?? []).filter(
    (ref) => ref.role !== role && ref.role !== 'firstFrame'
  )
  const next: ShotGenRef[] = [
    ...kept,
    ...imageAssetIds.map((assetId) => ({
      role,
      assetId,
      refIndex: 0
    }))
  ]
  return reindexAllShotRefs(next, []).genRefs
}

/** 用视频输出资产重写分镜 genRefs（motion） */
export function mergeVideoOutputGenRefs(
  existing: ShotGenRef[] | undefined,
  videoAssetIds: string[],
  role: ShotGenRefRole = 'motion'
): ShotGenRef[] {
  const kept = (existing ?? []).filter((ref) => ref.role !== role)
  const next: ShotGenRef[] = [
    ...kept,
    ...videoAssetIds.map((assetId) => ({
      role,
      assetId,
      refIndex: 0
    }))
  ]
  return reindexAllShotRefs(next, []).genRefs
}

export function shotGenRefImageAssetIds(shot: Pick<Shot, 'genRefs' | 'audioRefs'>): string[] {
  return normalizeGenRefs(shot)
    .filter((ref) => ref.role === 'style' || ref.role === 'character' || ref.role === 'firstFrame')
    .map((ref) => ref.assetId)
}

/** 聚合行：分镜拆分行 + 画面资产 id */
export type ShotImageAggregateRow = ShotSplitRow & {
  imageAssetIds: string[]
}

export function shotToImageAggregateRow(shot: Shot, index: number): ShotImageAggregateRow {
  const sb = shot.storyboard
  return {
    title: shot.title?.trim() || `分镜 ${index + 1}`,
    durationSec: Math.min(60, Math.max(1, Math.round(shot.camera?.durationSec ?? 5))),
    visualDescription: sb?.visualDescription?.trim() ?? '',
    shotSize: sb?.shotSize?.trim() ?? '',
    lighting: sb?.lighting?.trim() ?? '',
    dialogue: sb?.dialogue?.trim() ?? '',
    soundFx: sb?.soundFx?.trim() ?? '',
    cameraMove: sb?.cameraMove?.trim() ?? '',
    status: normalizeShotReviewStatus(shot.reviewStatus),
    imageAssetIds: shotGenRefImageAssetIds(shot)
  }
}

export function stringifyShotImageAggregateRows(rows: ShotImageAggregateRow[]): string {
  return `${JSON.stringify(rows, null, 2)}\n`
}

/** 将分镜 genRefs 中的图片挂到视频生成节点（首张为首帧，其余为 in-image 参考） */
export function materializeShotGenRefsOnVideoGraph(
  graph: GraphDocument,
  assets: ShotVisualImageAsset[]
): GraphDocument {
  if (!assets.length) return graph
  let doc = cloneGraphDocument(graph)
  if (!findShotWorkflowVideoNode(doc)) return doc

  const [first, ...rest] = assets
  if (first?.type === 'image') {
    doc = setVideoFrameAsset(doc, VIDEO_FIRST_FRAME_PORT_ID, first)
  }
  for (const asset of rest) {
    if (asset.type !== 'image') continue
    doc = connectShotVideoReference(doc, asset)
  }
  // 仅一张时：既作首帧，也挂 in-image 参考，便于 @ 引用
  if (assets.length === 1 && first?.type === 'image') {
    doc = connectShotVideoReference(doc, first)
  }
  return doc
}

/** 确保分镜参数文本口连到视频生成 in-text */
export function ensureShotParamsLinkedToVideo(
  graph: GraphDocument,
  shotParamsNodeId: string
): GraphDocument {
  const doc = cloneGraphDocument(graph)
  const video = findShotWorkflowVideoNode(doc)
  const params = doc.nodes.find((node) => node.id === shotParamsNodeId)
  if (!video || !params) return doc
  const linked = doc.edges.some(
    (edge) =>
      edge.source === params.id &&
      edge.target === video.id &&
      (edge.sourcePort ?? 'out') === 'out' &&
      (edge.targetPort ?? 'in') === 'in-text'
  )
  if (linked) return doc
  doc.edges.push({
    id: `edge-${crypto.randomUUID()}`,
    source: params.id,
    target: video.id,
    sourcePort: 'out',
    targetPort: 'in-text'
  })
  return doc
}

/** 分镜画面图中的图片生成加工节点 */
export function findShotVisualImageNode(doc: GraphDocument): GraphNode | null {
  return findAllShotVisualImageNodes(doc)[0] ?? null
}

/** 分镜画面图中全部图片生成加工节点（多生成节点汇入同一输出时用） */
export function findAllShotVisualImageNodes(doc: GraphDocument): GraphNode[] {
  return doc.nodes.filter((node) => node.typeId === 'asset.image' && isProcessingAssetNode(node))
}

function ensureEdge(
  edges: GraphEdge[],
  source: string,
  target: string,
  targetPort: string,
  sourcePort = 'out'
): void {
  const linked = edges.some(
    (edge) =>
      edge.source === source &&
      edge.target === target &&
      (edge.sourcePort ?? 'out') === sourcePort &&
      (edge.targetPort ?? 'in') === targetPort
  )
  if (linked) return
  edges.push({
    id: `edge-${crypto.randomUUID()}`,
    source,
    target,
    sourcePort,
    targetPort
  })
}

function findOrCreateImageRefNode(
  doc: GraphDocument,
  asset: ShotVisualImageAsset,
  near: GraphNode
): GraphNode {
  const existing = doc.nodes.find(
    (node) => node.assetId === asset.id && (node.params?.assetRef === true || !!node.assetId)
  )
  if (existing) return existing
  const node = createAssetGraphNode(asset.id, asset.type, asset.name, {
    x: near.position.x - 220,
    y: near.position.y + doc.nodes.filter((n) => n.assetId === asset.id).length * 24
  })
  doc.nodes.push(node)
  return node
}

/** 将分镜 genRefs 图片挂到画面图的图片生成 in-image */
export function materializeShotGenRefsOnImageGraph(
  graph: GraphDocument,
  assets: ShotVisualImageAsset[]
): GraphDocument {
  if (!assets.length) return graph
  const doc = cloneGraphDocument(graph)
  const image = findShotVisualImageNode(doc)
  if (!image) return doc
  for (const asset of assets) {
    if (asset.type !== 'image') continue
    const source = findOrCreateImageRefNode(doc, asset, image)
    ensureEdge(doc.edges, source.id, image.id, 'in-image')
  }
  return doc
}

/** 确保分镜参数文本口连到图片生成 in-text */
export function ensureShotParamsLinkedToImage(
  graph: GraphDocument,
  shotParamsNodeId: string
): GraphDocument {
  const doc = cloneGraphDocument(graph)
  const image = findShotVisualImageNode(doc)
  const params = doc.nodes.find((node) => node.id === shotParamsNodeId)
  if (!image || !params) return doc
  ensureEdge(doc.edges, params.id, image.id, 'in-text')
  return doc
}

export function listImageAssetsFromShotGenRefs(
  shot: Pick<Shot, 'genRefs' | 'audioRefs'>,
  resolveAsset: (assetId: string) => ShotVisualImageAsset | null
): ShotVisualImageAsset[] {
  const seen = new Set<string>()
  const out: ShotVisualImageAsset[] = []
  for (const ref of normalizeGenRefs(shot)) {
    if (seen.has(ref.assetId)) continue
    const asset = resolveAsset(ref.assetId)
    if (!asset || asset.type !== 'image') continue
    seen.add(ref.assetId)
    out.push(asset)
  }
  return out
}

export type ShotParamsDropTarget = 'video' | 'image'

/** 拖入分镜参数后：建参数节点旁的引用拓扑（返回新图；调用方负责替换） */
export function applyShotParamsDropMaterialization(
  graph: GraphDocument,
  shotParamsNode: GraphNode,
  shot: Pick<Shot, 'genRefs' | 'audioRefs'>,
  resolveAsset: (assetId: string) => ShotVisualImageAsset | null,
  target: ShotParamsDropTarget = 'video'
): GraphDocument {
  const assets = listImageAssetsFromShotGenRefs(shot, resolveAsset)
  if (target === 'image') {
    let doc = materializeShotGenRefsOnImageGraph(graph, assets)
    doc = ensureShotParamsLinkedToImage(doc, shotParamsNode.id)
    return doc
  }
  let doc = materializeShotGenRefsOnVideoGraph(graph, assets)
  doc = ensureShotParamsLinkedToVideo(doc, shotParamsNode.id)
  return doc
}
