/**
 * 分镜画面 visualGraphJson ↔ Shot.genRefs / 视频图桥接。
 * 纯图文档与 genRefs 变换；资产创建与跑图由渲染层完成。
 */
import {
  asWorldRefList,
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
import {
  boundaryInputNodeId,
  GRAPH_BOUNDARY_INPUT_TYPE_ID,
  isBoundaryInputNode,
  isBoundaryOutputNode
} from './hostInterface'
import {
  findAllShotWorkflowVideoNodes,
  findShotWorkflowVideoNode
} from './shotVideoBridge'
import { createAssetGraphNode, createNodeFromType } from './create'
import { isProcessingAssetNode } from './nodeRole'
import type { GraphDocument, GraphEdge, GraphNode } from './types'
import { GraphPortType } from './types'
import type { AssetType } from '../domain'
import { cloneGraphDocument } from './document'
import type { ShotSplitRow } from './shotSplitParse'

export type ShotVisualImageAsset = {
  id: string
  type: AssetType
  name: string
  relativePath?: string
}

function listImageOutputNodes(doc: GraphDocument): GraphNode[] {
  const boundaryOuts = doc.nodes.filter(
    (node) =>
      isBoundaryOutputNode(node) &&
      (node.params.hostBoundaryPort?.dataType === GraphPortType.image ||
        node.params.hostBoundaryPort?.dataType === GraphPortType.images ||
        !node.params.hostBoundaryPort?.dataType)
  )
  if (boundaryOuts.length) return boundaryOuts
  const outputs = doc.nodes.filter(
    (node) => node.category === 'output' || node.typeId === 'output.image'
  )
  if (outputs.length) return outputs
  // 无 classic output：从图片生成/加工节点收集
  const gens = doc.nodes.filter(
    (node) =>
      node.typeId === 'asset.image' ||
      (node.typeId?.startsWith('image.') ?? false) ||
      (node.category === 'asset' && node.assetType === 'image')
  )
  if (gens.length) return gens
  const single = findOutputNode(doc)
  return single ? [single] : []
}

/** 输出节点是否已跑完（仅 done 可收集；pending/running/idle/error/skipped 均跳过） */
export function isVisualOutputNodeComplete(
  doc: GraphDocument,
  outputNodeId: string
): boolean {
  return doc.runStates?.[outputNodeId]?.status === 'done'
}

/**
 * 从已完成的输出节点取图（runStates / cameraShots / 节点自身 generatedImages）。
 * 不回退上游生成节点。
 */
export function collectImagesFromCompletedOutputNode(
  doc: GraphDocument,
  output: GraphNode
): GraphImageItem[] {
  if (!isVisualOutputNodeComplete(doc, output.id)) return []

  const fromRun = doc.runStates?.[output.id]?.outputs?.out
  const fromValue = fromRun ? flattenImagesValues([fromRun]) : []
  if (fromValue.length) {
    return dedupeImageItems(fromValue.filter((item) => item.relativePath || item.dataUrl))
  }

  const shots = output.params.cameraShots
  if (Array.isArray(shots) && shots.length) {
    return dedupeImageItems(
      shots
        .map((shot, index) => ({
          id: shot.id ?? `visual:${output.id}:${index}`,
          dataUrl: shot.dataUrl ?? '',
          createdAt: shot.createdAt,
          relativePath: shot.relativePath
        }))
        .filter((item) => item.relativePath || item.dataUrl)
    )
  }

  return collectGeneratedImagesParam(output)
}

/**
 * 从分镜/元素图收集图片：只收全部输出节点中 status===done 且有可用图的结果；
 * 未完成输出跳过，不回退上游生成节点。
 */
export function collectImagesFromVisualGraph(doc: GraphDocument | null | undefined): GraphImageItem[] {
  if (!doc?.nodes?.length) return []
  const outputs = listImageOutputNodes(doc)
  return dedupeImageItems(
    outputs.flatMap((output) => collectImagesFromCompletedOutputNode(doc, output))
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

/** 视频生成节点是否已跑完（仅 done 可收集） */
export function isVideoGenNodeComplete(doc: GraphDocument, nodeId: string): boolean {
  return doc.runStates?.[nodeId]?.status === 'done'
}

/**
 * 从分镜视频图收集全部视频生成节点（asset.video processing）中
 * status===done 且有可用视频的结果。
 */
export function collectVideosFromVideoGenNodes(
  doc: GraphDocument | null | undefined
): GraphVideoItem[] {
  if (!doc?.nodes?.length) return []
  return dedupeVideoItems(
    findAllShotWorkflowVideoNodes(doc).flatMap((node) => {
      if (!isVideoGenNodeComplete(doc, node.id)) return []
      return collectVideosFromNode(doc, node)
    })
  )
}

/** 从分镜视频图收集视频：优先全部已完成视频生成节点；否则回退输出节点链路 */
export function collectVideosFromShotWorkflowGraph(
  doc: GraphDocument | null | undefined
): GraphVideoItem[] {
  if (!doc?.nodes?.length) return []

  const fromGens = collectVideosFromVideoGenNodes(doc)
  if (fromGens.length) return fromGens

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

  return []
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
    characters: asWorldRefList(sb?.characters),
    scenes: asWorldRefList(sb?.scenes),
    props: asWorldRefList(sb?.props),
    weapons: asWorldRefList(sb?.weapons),
    imageAssetIds: shotGenRefImageAssetIds(shot)
  }
}

export function stringifyShotImageAggregateRows(rows: ShotImageAggregateRow[]): string {
  return `${JSON.stringify(rows, null, 2)}\n`
}

/** 将分镜实体/ genRefs 图片放到视频图上，并连到视频生成参考图口 in-image */
export function materializeShotGenRefsOnVideoGraph(
  graph: GraphDocument,
  assets: ShotVisualImageAsset[],
  options?: { near?: GraphNode | null }
): GraphDocument {
  if (!assets.length) return graph
  const doc = cloneGraphDocument(graph)
  const video = findShotWorkflowVideoNode(doc)
  if (!video) return doc
  const near = options?.near ?? video

  for (const asset of assets) {
    if (asset.type !== 'image') continue
    const source = ensureImageRefNodeNear(doc, asset, near)
    ensureEdge(doc.edges, source.id, video.id, 'in-image')
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

function nextAssetRefPosition(doc: GraphDocument, near: GraphNode): { x: number; y: number } {
  const x = near.position.x - 220
  const stacked = doc.nodes.filter((node) => Math.abs(node.position.x - x) < 1).length
  return { x, y: near.position.y + stacked * 140 }
}

function ensureImageRefNodeNear(
  doc: GraphDocument,
  asset: ShotVisualImageAsset,
  near: GraphNode
): GraphNode {
  const existing = doc.nodes.find(
    (node) => node.assetId === asset.id && (node.params?.assetRef === true || !!node.assetId)
  )
  if (existing) return existing
  const node = createAssetGraphNode(asset.id, asset.type, asset.name, nextAssetRefPosition(doc, near))
  doc.nodes.push(node)
  return node
}

function findOrCreateImageRefNode(
  doc: GraphDocument,
  asset: ShotVisualImageAsset,
  near: GraphNode
): GraphNode {
  return ensureImageRefNodeNear(doc, asset, near)
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

/** 分镜 storyboard 绑定的一张实体图 */
export interface ShotBoundEntityImage {
  name: string
  relativePath: string
}

/** 分镜 storyboard 绑定的角色/场景/道具/武器图（按路径去重） */
export function collectStoryboardBindingImages(
  shot: Pick<Shot, 'storyboard'>
): ShotBoundEntityImage[] {
  const sb = shot.storyboard
  if (!sb) return []
  const lists = [sb.characters, sb.scenes, sb.props, sb.weapons]
  const seen = new Set<string>()
  const out: ShotBoundEntityImage[] = []
  for (const list of lists) {
    for (const ref of asWorldRefList(list)) {
      const url = (ref.imageUrl ?? '').trim().replace(/\\/g, '/')
      if (!url || url.startsWith('data:') || seen.has(url)) continue
      seen.add(url)
      out.push({ name: ref.name?.trim() || url, relativePath: url })
    }
  }
  return out
}

/** 分镜 storyboard 绑定角色/场景/道具/武器上的 imageUrl（去重） */
export function collectStoryboardBindingImageUrls(
  shot: Pick<Shot, 'storyboard'>
): string[] {
  return collectStoryboardBindingImages(shot).map((item) => item.relativePath)
}

/** 将 storyboard 绑定 imageUrl 解析为图片资产（按 relativePath） */
export function listImageAssetsFromStoryboardBindings(
  shot: Pick<Shot, 'storyboard'>,
  resolveAssetByRelativePath?: (relativePath: string) => ShotVisualImageAsset | null
): ShotVisualImageAsset[] {
  if (!resolveAssetByRelativePath) return []
  const seen = new Set<string>()
  const out: ShotVisualImageAsset[] = []
  for (const raw of collectStoryboardBindingImageUrls(shot)) {
    const asset = resolveAssetByRelativePath(raw)
    if (!asset || asset.type !== 'image' || seen.has(asset.id)) continue
    seen.add(asset.id)
    out.push(asset)
  }
  return out
}

function pushUniqueAssets(
  into: ShotVisualImageAsset[],
  seen: Set<string>,
  assets: ShotVisualImageAsset[]
): void {
  for (const asset of assets) {
    if (asset.type !== 'image' || seen.has(asset.id)) continue
    seen.add(asset.id)
    into.push(asset)
  }
}

/**
 * 分镜参考图资产：storyboard 绑定图 + genRefs（+ 可选实体 URL）。
 * 生成分镜图/视频前用其物化图片引用节点。
 */
export function listImageAssetsForShotReferences(
  shot: Pick<Shot, 'id' | 'storyboard' | 'genRefs' | 'audioRefs'>,
  resolveAsset: (assetId: string) => ShotVisualImageAsset | null,
  options?: {
    entityImageUrls?: string[]
    resolveAssetByRelativePath?: (relativePath: string) => ShotVisualImageAsset | null
  }
): ShotVisualImageAsset[] {
  const seen = new Set<string>()
  const out: ShotVisualImageAsset[] = []
  pushUniqueAssets(out, seen, listImageAssetsFromStoryboardBindings(shot, options?.resolveAssetByRelativePath))

  const byPath = options?.resolveAssetByRelativePath
  if (byPath) {
    for (const raw of options?.entityImageUrls ?? []) {
      const path = raw.trim().replace(/\\/g, '/')
      if (!path || path.startsWith('data:')) continue
      const asset = byPath(path)
      if (!asset || asset.type !== 'image' || seen.has(asset.id)) continue
      seen.add(asset.id)
      out.push(asset)
    }
  }

  pushUniqueAssets(out, seen, listImageAssetsFromShotGenRefs(shot, resolveAsset))
  return out
}

/**
 * 分镜实体对应的画面图资产：优先 style genRefs（分镜图收集写回），
 * 否则按 storyboard 绑定 / 实体 imageUrls 经 relativePath 解析。
 */
export function listImageAssetsFromShotEntity(
  shot: Pick<Shot, 'id' | 'storyboard' | 'genRefs' | 'audioRefs'>,
  resolveAsset: (assetId: string) => ShotVisualImageAsset | null,
  options?: {
    entityImageUrls?: string[]
    resolveAssetByRelativePath?: (relativePath: string) => ShotVisualImageAsset | null
  }
): ShotVisualImageAsset[] {
  const seen = new Set<string>()
  const out: ShotVisualImageAsset[] = []
  for (const ref of normalizeGenRefs(shot)) {
    if (ref.role !== 'style') continue
    if (seen.has(ref.assetId)) continue
    const asset = resolveAsset(ref.assetId)
    if (!asset || asset.type !== 'image') continue
    seen.add(ref.assetId)
    out.push(asset)
  }
  if (out.length) return out

  pushUniqueAssets(out, seen, listImageAssetsFromStoryboardBindings(shot, options?.resolveAssetByRelativePath))

  const urls = options?.entityImageUrls ?? []
  const byPath = options?.resolveAssetByRelativePath
  if (!urls.length || !byPath) return out
  for (const raw of urls) {
    const path = raw.trim().replace(/\\/g, '/')
    if (!path || path.startsWith('data:')) continue
    const asset = byPath(path)
    if (!asset || asset.type !== 'image' || seen.has(asset.id)) continue
    seen.add(asset.id)
    out.push(asset)
  }
  return out
}

/** 绑定图路径 → 稳定的 boundary 端口 id（避开中文路径导致的 id 冲突） */
function boundImagePortId(relativePath: string): string {
  let hash = 2166136261
  for (let i = 0; i < relativePath.length; i++) {
    hash ^= relativePath.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `bound-img-${(hash >>> 0).toString(36)}`
}

/**
 * storyboard 绑定图：用子图同款边界输入节点（image），携带 previewRelativePath。
 * Cache/ 下的图不进资产库，也不应伪装成图片生成节点。
 */
function ensureBoundImageInputNode(
  doc: GraphDocument,
  item: ShotBoundEntityImage,
  near: GraphNode
): GraphNode {
  const existing = doc.nodes.find(
    (node) =>
      isBoundaryInputNode(node) &&
      node.params.hostBoundaryPort?.dataType === GraphPortType.image &&
      node.params.previewRelativePath === item.relativePath
  )
  if (existing) {
    if (existing.title !== item.name) existing.title = item.name
    return existing
  }
  const portId = boundImagePortId(item.relativePath)
  const node = createNodeFromType(GRAPH_BOUNDARY_INPUT_TYPE_ID, nextAssetRefPosition(doc, near), {
    id: boundaryInputNodeId(portId),
    title: item.name,
    params: {
      previewCollapsed: true,
      previewRelativePath: item.relativePath,
      hostBoundaryPort: {
        portId,
        dataType: GraphPortType.image,
        multiple: false
      }
    }
  })
  doc.nodes.push(node)
  return node
}

/**
 * 在分镜画面/视频子图上为绑定实体创建图片输入节点并接到生成节点 in-image。
 * 绑定图一律用 graph.boundary.input（image）；genRefs 仍可建资产引用。
 * 不依赖分镜参数节点（批量跑图前也可调用）。
 */
export function materializeShotBoundEntityRefsOnGraph(
  graph: GraphDocument,
  shot: Pick<Shot, 'id' | 'storyboard' | 'genRefs' | 'audioRefs'>,
  target: ShotParamsDropTarget,
  resolveAsset: (assetId: string) => ShotVisualImageAsset | null,
  _options?: {
    entityImageUrls?: string[]
    resolveAssetByRelativePath?: (relativePath: string) => ShotVisualImageAsset | null
  }
): GraphDocument {
  const bound = collectStoryboardBindingImages(shot)
  const assets = listImageAssetsFromShotGenRefs(shot, resolveAsset)
  if (!bound.length && !assets.length) return graph

  const doc = cloneGraphDocument(graph)
  const gen =
    target === 'image' ? findShotVisualImageNode(doc) : findShotWorkflowVideoNode(doc)
  if (!gen) return graph

  for (const item of bound) {
    const source = ensureBoundImageInputNode(doc, item, gen)
    ensureEdge(doc.edges, source.id, gen.id, 'in-image')
  }
  for (const asset of assets) {
    if (asset.type !== 'image') continue
    const source = ensureImageRefNodeNear(doc, asset, gen)
    ensureEdge(doc.edges, source.id, gen.id, 'in-image')
  }
  return doc
}

export type ShotParamsDropTarget = 'video' | 'image'

/** 拖入分镜参数后：建参数节点旁的引用拓扑（返回新图；调用方负责替换） */
export function applyShotParamsDropMaterialization(
  graph: GraphDocument,
  shotParamsNode: GraphNode,
  shot: Pick<Shot, 'id' | 'storyboard' | 'genRefs' | 'audioRefs'>,
  resolveAsset: (assetId: string) => ShotVisualImageAsset | null,
  target: ShotParamsDropTarget = 'video',
  options?: {
    entityImageUrls?: string[]
    resolveAssetByRelativePath?: (relativePath: string) => ShotVisualImageAsset | null
  }
): GraphDocument {
  let doc = materializeShotBoundEntityRefsOnGraph(graph, shot, target, resolveAsset, options)
  // 视频窗还可补上 shotEntities 输出图（style genRefs 优先逻辑在 listImageAssetsFromShotEntity）
  if (target === 'video') {
    const entityAssets = listImageAssetsFromShotEntity(shot, resolveAsset, options)
    if (entityAssets.length) {
      doc = materializeShotGenRefsOnVideoGraph(doc, entityAssets, { near: shotParamsNode })
    }
  }
  if (target === 'image') {
    doc = ensureShotParamsLinkedToImage(doc, shotParamsNode.id)
  } else {
    doc = ensureShotParamsLinkedToVideo(doc, shotParamsNode.id)
  }
  return doc
}
