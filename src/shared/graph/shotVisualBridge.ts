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
import { graphValueHasPayload, softResolveBoundaryOutputValue } from './hostInput'
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
import { isGenerateLocked, isProcessingAssetNode } from './nodeRole'
import type { GraphDocument, GraphEdge, GraphNode } from './types'
import { GraphPortType } from './types'
import type { AssetType } from '../domain'
import { cloneGraphDocument } from './document'
import type { ShotSplitRow } from './shotSplitParse'
import {
  parseShotEntities,
  stringifyShotEntities,
  type ShotEntityResult
} from './shotEntitiesParse'

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

/** 输出节点是否已跑完，或边界输出已有可 soft-resolve 的图像载荷 */
export function isVisualOutputNodeComplete(
  doc: GraphDocument,
  outputNodeId: string
): boolean {
  if (doc.runStates?.[outputNodeId]?.status === 'done') return true
  const node = doc.nodes.find((n) => n.id === outputNodeId)
  if (!node || !isBoundaryOutputNode(node)) return false
  // 落盘竞态 / 仅有 preview 时：有有效图像也视为可收集
  return collectImagesFromOutputNodeLoose(doc, node).length > 0
}

function collectImagesFromOutputNodeLoose(
  doc: GraphDocument,
  output: GraphNode
): GraphImageItem[] {
  const fromRun = doc.runStates?.[output.id]?.outputs?.out
  const fromValue = fromRun ? flattenImagesValues([fromRun]) : []
  if (fromValue.length) {
    return dedupeImageItems(fromValue.filter((item) => item.relativePath || item.dataUrl))
  }

  const previewRel = output.params.previewRelativePath?.trim()
  const previewData = output.params.previewDataUrl?.trim()
  if (previewRel || previewData) {
    return [
      {
        id: `preview:${output.id}`,
        dataUrl: previewData || '',
        relativePath: previewRel
      }
    ]
  }

  if (isBoundaryOutputNode(output)) {
    const soft = softResolveBoundaryOutputValue(doc, output.id)
    if (graphValueHasPayload(soft) && soft) {
      const fromSoft = flattenImagesValues([soft])
      if (fromSoft.length) {
        return dedupeImageItems(
          fromSoft.filter((item) => item.relativePath || item.dataUrl)
        )
      }
    }
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
 * 从已完成的输出节点取图（runStates / preview / soft-resolve / cameraShots / generatedImages）。
 */
export function collectImagesFromCompletedOutputNode(
  doc: GraphDocument,
  output: GraphNode
): GraphImageItem[] {
  if (!isVisualOutputNodeComplete(doc, output.id)) return []
  return collectImagesFromOutputNodeLoose(doc, output)
}

/** 视觉图中的图片出口节点（优先 boundary.output / 宿主输出端口） */
export function listVisualOutputNodes(doc: GraphDocument): GraphNode[] {
  return listImageOutputNodes(doc)
}

/** 边界出口的直接图片上游（elementWorkflow: asset.image → boundary.output） */
function resolveDirectImageGenUpstream(
  doc: GraphDocument,
  output: GraphNode
): GraphNode | null {
  for (const edge of doc.edges) {
    if (edge.target !== output.id) continue
    const source = doc.nodes.find((node) => node.id === edge.source)
    if (!source) continue
    if (
      source.typeId === 'asset.image' ||
      (source.typeId?.startsWith('image.') ?? false) ||
      (source.category === 'asset' && source.assetType === 'image')
    ) {
      return source
    }
  }
  return null
}

/** 尚未可 soft-collect 的出口节点 id */
export function listIncompleteVisualOutputNodeIds(doc: GraphDocument): string[] {
  return listImageOutputNodes(doc)
    .filter((node) => !isVisualOutputNodeComplete(doc, node.id))
    .map((node) => node.id)
}

/**
 * 世界元素批跑需要 cook 的出口：
 * - 缺图 → 入队生成
 * - 有图且上游生成未锁定 → 入队重新 cook
 * - 有图且上游生成已锁定 → 跳过，collect 时 soft-resolve
 */
export function listVisualOutputNodeIdsNeedingCook(doc: GraphDocument): string[] {
  return listImageOutputNodes(doc)
    .filter((output) => {
      const complete = isVisualOutputNodeComplete(doc, output.id)
      const gen = resolveDirectImageGenUpstream(doc, output)
      if (!complete) return true
      if (!gen) return false
      return !isGenerateLocked(gen)
    })
    .map((node) => node.id)
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

/** 路径是否像视频文件（避免把边界上误写入的 jpg 预览当成已有视频） */
function looksLikeVideoPath(path: string | undefined | null): boolean {
  const p = path?.trim() ?? ''
  if (!p) return false
  return /\.(mp4|webm|mov|mkv|avi|m4v)(\?|#|$)/i.test(p)
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
    return dedupeVideoItems(
      fromValue.filter(
        (item) =>
          !!(item.dataUrl?.trim() || looksLikeVideoPath(item.relativePath))
      )
    )
  }

  const previewPath = node.params.previewRelativePath?.trim()
  const previewData = node.params.previewDataUrl?.trim()
  // 仅承认视频扩展名 / data:video；图片路径不得冒充已完成视频（否则批跑 onlyMissing 会跳过入队）
  if (looksLikeVideoPath(previewPath) || !!previewData?.startsWith('data:video')) {
    return [
      {
        id: `video-preview:${node.id}`,
        dataUrl: previewData,
        relativePath: looksLikeVideoPath(previewPath) ? previewPath : undefined
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
function boundImagesFromEntityUrls(entityImageUrls?: string[]): ShotBoundEntityImage[] {
  const seen = new Set<string>()
  const out: ShotBoundEntityImage[] = []
  for (const raw of entityImageUrls ?? []) {
    const path = raw.trim().replace(/\\/g, '/')
    if (!path || path.startsWith('data:') || seen.has(path)) continue
    seen.add(path)
    const name = path.split('/').filter(Boolean).pop() || path
    out.push({ name, relativePath: path })
  }
  return out
}

/**
 * 分镜成片图：与 ShotStrip 同源（thumbnailPath），再补 style genRefs。
 * 视频图边界输入应包含这套，并与角色/场景等实体边界并存。
 */
export function collectShotVisualBoundImages(
  shot: Pick<Shot, 'title' | 'thumbnailPath' | 'genRefs'>,
  resolveAsset: (assetId: string) => ShotVisualImageAsset | null
): ShotBoundEntityImage[] {
  const seen = new Set<string>()
  const out: ShotBoundEntityImage[] = []
  const push = (path: string, name: string): void => {
    const normalized = path.trim().replace(/\\/g, '/')
    if (!normalized || normalized.startsWith('data:') || seen.has(normalized)) return
    seen.add(normalized)
    out.push({ name: name.trim() || normalized, relativePath: normalized })
  }
  const thumb = shot.thumbnailPath?.trim()
  if (thumb) push(thumb, shot.title?.trim() || 'Shot')
  for (const ref of normalizeGenRefs(shot)) {
    if (ref.role !== 'style') continue
    const asset = resolveAsset(ref.assetId)
    const path = asset?.relativePath?.trim()
    if (path) push(path, asset?.name?.trim() || shot.title?.trim() || 'Shot')
  }
  return out
}

/** 按 relativePath 去重合并绑定图（保留先出现的名称） */
function mergeBoundEntityImages(
  ...lists: ShotBoundEntityImage[][]
): ShotBoundEntityImage[] {
  const seen = new Set<string>()
  const out: ShotBoundEntityImage[] = []
  for (const list of lists) {
    for (const item of list) {
      const path = item.relativePath.trim().replace(/\\/g, '/')
      if (!path || path.startsWith('data:') || seen.has(path)) continue
      seen.add(path)
      out.push({ name: item.name.trim() || path, relativePath: path })
    }
  }
  return out
}

/** 去掉不再属于当前绑定集合的 bound-img 边界输入（上层实体更新后避免残留旧图） */
function pruneStaleBoundImageInputs(doc: GraphDocument, keepPaths: Set<string>): void {
  const removeIds = new Set<string>()
  for (const node of doc.nodes) {
    if (!isBoundaryInputNode(node)) continue
    const portId = node.params.hostBoundaryPort?.portId?.trim() ?? ''
    if (!portId.startsWith('bound-img-')) continue
    const path = node.params.previewRelativePath?.trim().replace(/\\/g, '/') ?? ''
    if (path && keepPaths.has(path)) continue
    removeIds.add(node.id)
  }
  if (!removeIds.size) return
  doc.nodes = doc.nodes.filter((node) => !removeIds.has(node.id))
  doc.edges = doc.edges.filter(
    (edge) => !removeIds.has(edge.source) && !removeIds.has(edge.target)
  )
}

/** @deprecated 旧版 image.select 标记；物化时会清理 */
export const SHOT_ENTITY_PICKER_PARAM = 'shotEntityPicker'

export function isShotEntityPickerNode(node: Pick<GraphNode, 'typeId' | 'params'>): boolean {
  return node.typeId === 'image.select' && node.params?.[SHOT_ENTITY_PICKER_PARAM] === true
}

export function isShotEntitiesSelectNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'shotEntities.select'
}

/** 整表分镜实体数组边界：固定单端口 id */
export const SHOT_ENTITIES_CATALOG_PORT_ID = 'bound-shot-ent-all'

/** 去掉旧的「每实体一条」分镜实体边界，只保留整表边界 */
function pruneStaleShotEntityCatalogInputs(doc: GraphDocument, keepAll: boolean): void {
  const removeIds = new Set<string>()
  for (const node of doc.nodes) {
    if (!isBoundaryInputNode(node)) continue
    const portId = node.params.hostBoundaryPort?.portId?.trim() ?? ''
    const dataType = node.params.hostBoundaryPort?.dataType
    const isShotEntBound =
      portId.startsWith('bound-shot-ent-') || dataType === GraphPortType.shotEntities
    if (!isShotEntBound) continue
    if (keepAll && portId === SHOT_ENTITIES_CATALOG_PORT_ID) continue
    removeIds.add(node.id)
  }
  if (!removeIds.size) return
  doc.nodes = doc.nodes.filter((node) => !removeIds.has(node.id))
  doc.edges = doc.edges.filter(
    (edge) => !removeIds.has(edge.source) && !removeIds.has(edge.target)
  )
}

/** 确保唯一的整表分镜实体边界输入（shotEntities 数组） */
function ensureShotEntitiesCatalogInputNode(
  doc: GraphDocument,
  catalog: ShotEntityResult[],
  near: GraphNode,
  options?: { title?: string }
): GraphNode {
  const portId = SHOT_ENTITIES_CATALOG_PORT_ID
  const nodeId = boundaryInputNodeId(portId)
  const previewRelativePath =
    catalog[0]?.imageUrls[0]?.trim().replace(/\\/g, '/') || undefined
  const text = stringifyShotEntities(catalog)
  const title = options?.title?.trim() || '分镜实体'
  const existing = doc.nodes.find(
    (node) =>
      node.id === nodeId ||
      (isBoundaryInputNode(node) && node.params.hostBoundaryPort?.portId === portId)
  )
  if (existing) {
    existing.title = title
    existing.params = {
      ...existing.params,
      text,
      previewRelativePath,
      previewCollapsed: existing.params.previewCollapsed ?? true,
      hostBoundaryPort: {
        portId,
        dataType: GraphPortType.shotEntities,
        multiple: false
      }
    }
    return existing
  }
  const node = createNodeFromType(GRAPH_BOUNDARY_INPUT_TYPE_ID, nextAssetRefPosition(doc, near), {
    id: nodeId,
    title,
    params: {
      text,
      previewCollapsed: true,
      previewRelativePath,
      hostBoundaryPort: {
        portId,
        dataType: GraphPortType.shotEntities,
        multiple: false
      }
    }
  })
  doc.nodes.push(node)
  return node
}

/** 确保选择分镜实体节点，并把整表 shotEntities 边界接到其 in（不接到视频生成） */
export function ensureShotEntitiesSelectOnGraph(
  graph: GraphDocument,
  catalogSourceNodeId: string,
  options?: { near?: GraphNode | null; title?: string }
): GraphDocument {
  const doc = cloneGraphDocument(graph)
  const near =
    options?.near ??
    findShotWorkflowVideoNode(doc) ??
    doc.nodes[0]
  if (!near) return doc

  // 清理旧版 image.select 伪选择节点
  for (const legacy of doc.nodes.filter((n) => isShotEntityPickerNode(n))) {
    doc.nodes = doc.nodes.filter((n) => n.id !== legacy.id)
    doc.edges = doc.edges.filter((e) => e.source !== legacy.id && e.target !== legacy.id)
  }

  let picker = doc.nodes.find((node) => isShotEntitiesSelectNode(node))
  if (!picker) {
    picker = createNodeFromType('shotEntities.select', {
      x: near.position.x - 220,
      y: near.position.y + 160
    }, {
      title: options?.title?.trim() || 'Select shot entity'
    })
    doc.nodes.push(picker)
  } else if (options?.title?.trim() && picker.title !== options.title.trim()) {
    picker.title = options.title.trim()
  }

  const pickerId = picker.id
  doc.edges = doc.edges.filter((edge) => {
    if (edge.target !== pickerId || (edge.targetPort ?? 'in') !== 'in') return true
    return edge.source === catalogSourceNodeId
  })
  if (doc.nodes.some((n) => n.id === catalogSourceNodeId)) {
    ensureEdge(doc.edges, catalogSourceNodeId, pickerId, 'in')
  }

  // 默认选中首个实体并写入图片预览，便于 Inspector 立刻显示输出
  const catalogNode = doc.nodes.find((n) => n.id === catalogSourceNodeId)
  const catalog = parseShotEntities(catalogNode?.params.text)
  if (catalog.length) {
    const selectedId = picker.params.selectedShotEntityId?.trim()
    const picked =
      (selectedId ? catalog.find((row) => row.id === selectedId) : undefined) ?? catalog[0]
    if (picked) {
      const previewRelativePath = picked.imageUrls[0]?.trim().replace(/\\/g, '/') || undefined
      picker.params = {
        ...picker.params,
        selectedShotEntityId: picked.id,
        text: stringifyShotEntities([picked]),
        previewRelativePath,
        previewDataUrl: undefined
      }
    }
  }
  return doc
}

function removeShotEntitiesSelect(doc: GraphDocument): void {
  const pickers = doc.nodes.filter(
    (node) => isShotEntitiesSelectNode(node) || isShotEntityPickerNode(node)
  )
  if (!pickers.length) return
  const ids = new Set(pickers.map((n) => n.id))
  doc.nodes = doc.nodes.filter((node) => !ids.has(node.id))
  doc.edges = doc.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target))
}

export function materializeShotBoundEntityRefsOnGraph(
  graph: GraphDocument,
  shot: Pick<Shot, 'id' | 'title' | 'storyboard' | 'genRefs' | 'audioRefs' | 'thumbnailPath'>,
  target: ShotParamsDropTarget,
  resolveAsset: (assetId: string) => ShotVisualImageAsset | null,
  options?: {
    /** 当前镜实体图 URL（接到生成节点的 image 边界） */
    entityImageUrls?: string[]
    /** @deprecated 改用 shotEntitiesCatalog */
    entityBoundImages?: ShotBoundEntityImage[]
    /** 整表分镜实体 → shotEntities 类型边界 + 选择节点 */
    shotEntitiesCatalog?: ShotEntityResult[]
    resolveAssetByRelativePath?: (relativePath: string) => ShotVisualImageAsset | null
    /** video 是否合并 thumbnail/style；默认 true */
    includeShotVisualBoundImages?: boolean
    /** 当前镜绑定图是否接到生成节点 in-image；默认 true */
    wireBoundImagesToGenerate?: boolean
    /** 是否物化整表分镜实体边界并接到 shotEntities.select（默认 false） */
    wireShotEntitiesToSelect?: boolean
    /** @deprecated 改用 wireShotEntitiesToSelect */
    wireBoundImagesToSelect?: boolean
    selectNodeTitle?: string
  }
): GraphDocument {
  const wireCatalogSelect =
    options?.wireShotEntitiesToSelect === true || options?.wireBoundImagesToSelect === true
  const catalog = options?.shotEntitiesCatalog ?? []

  const fromStoryboard = collectStoryboardBindingImages(shot)
  const fromUpper = boundImagesFromEntityUrls(options?.entityImageUrls)
  // 当前镜绑定图：storyboard + 当前镜实体图合并（不再把整表展平为 image）
  const fromCurrentShot = mergeBoundEntityImages(fromUpper, fromStoryboard)
  const includeVisual =
    target === 'video' && options?.includeShotVisualBoundImages !== false
  const fromShotVisual = includeVisual ? collectShotVisualBoundImages(shot, resolveAsset) : []
  const bound =
    target === 'video'
      ? mergeBoundEntityImages(fromShotVisual, fromCurrentShot)
      : options?.entityBoundImages?.length
        ? mergeBoundEntityImages(options.entityBoundImages)
        : fromUpper.length
          ? fromUpper
          : fromStoryboard
  const assets = listImageAssetsFromShotGenRefs(shot, resolveAsset)
  const wireGen = options?.wireBoundImagesToGenerate !== false
  if (!bound.length && !assets.length && !(wireCatalogSelect && catalog.length)) {
    return graph
  }

  let doc = cloneGraphDocument(graph)
  const gen =
    target === 'image' ? findShotVisualImageNode(doc) : findShotWorkflowVideoNode(doc)
  if (!gen) return graph

  if (fromShotVisual.length || fromCurrentShot.length || options?.entityBoundImages?.length) {
    pruneStaleBoundImageInputs(
      doc,
      new Set(bound.map((item) => item.relativePath.replace(/\\/g, '/')))
    )
  }

  for (const item of bound) {
    const source = ensureBoundImageInputNode(doc, item, gen)
    if (wireGen) {
      ensureEdge(doc.edges, source.id, gen.id, 'in-image')
    } else {
      doc.edges = doc.edges.filter(
        (edge) =>
          !(
            edge.source === source.id &&
            edge.target === gen.id &&
            (edge.targetPort ?? 'in') === 'in-image'
          )
      )
    }
  }
  for (const asset of assets) {
    if (asset.type !== 'image') continue
    const source = ensureImageRefNodeNear(doc, asset, gen)
    if (wireGen) {
      ensureEdge(doc.edges, source.id, gen.id, 'in-image')
    }
  }

  if (wireCatalogSelect && target === 'video') {
    const validCatalog = catalog.filter((e) => e.id.trim() && e.imageUrls.length)
    pruneStaleShotEntityCatalogInputs(doc, validCatalog.length > 0)
    if (validCatalog.length) {
      const source = ensureShotEntitiesCatalogInputNode(doc, validCatalog, gen, {
        title: '分镜实体'
      })
      // 目录边界默认不接到视频生成
      doc.edges = doc.edges.filter(
        (edge) =>
          !(
            edge.source === source.id &&
            edge.target === gen.id &&
            (edge.targetPort ?? 'in') === 'in-image'
          )
      )
      doc = ensureShotEntitiesSelectOnGraph(doc, source.id, {
        near: gen,
        title: options?.selectNodeTitle
      })
    } else {
      removeShotEntitiesSelect(doc)
    }
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
    entityBoundImages?: ShotBoundEntityImage[]
    shotEntitiesCatalog?: ShotEntityResult[]
    resolveAssetByRelativePath?: (relativePath: string) => ShotVisualImageAsset | null
    includeShotVisualBoundImages?: boolean
    wireBoundImagesToGenerate?: boolean
    wireShotEntitiesToSelect?: boolean
    wireBoundImagesToSelect?: boolean
    selectNodeTitle?: string
  }
): GraphDocument {
  let doc = materializeShotBoundEntityRefsOnGraph(graph, shot, target, resolveAsset, options)
  // 视频窗还可补资产引用；已有目录选择 / 当前镜 image 边界时不再重复自动接
  const hasCatalogSelect =
    options?.wireShotEntitiesToSelect === true || options?.wireBoundImagesToSelect === true
  if (target === 'video' && !hasCatalogSelect) {
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
