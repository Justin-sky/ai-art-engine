/**
 * 分镜图/视频管道：从各镜 visual / shotWorkflow 的输出节点收集结果 → 物化资产 → 写回 genRefs。
 * 不级联跑分镜画面/视频图中的生成节点链；需在对应分镜窗口内先行跑完，或走 Inspector 批量入队。
 */
import {
  collectImagesFromVisualGraph,
  collectVideosFromShotWorkflowGraph,
  collectVideosFromVideoGenNodes,
  entityImageUrlsByShotId,
  imageUrlFromGraphImageItem,
  materializeShotBoundEntityRefsOnGraph,
  mergeVideoOutputGenRefs,
  mergeVisualOutputGenRefs,
  normalizeScopedGraph,
  resolveAllShotEntitiesFromGraphs,
  resolveShotEntityImageUrlsFromGraphs,
  shotToImageAggregateRow,
  stringifyShotImageAggregateRows,
  videoUrlFromGraphVideoItem,
  type GraphDocument,
  type GraphImageItem,
  type GraphVideoItem,
  type ShotEntityResult,
  type ShotVisualImageAsset,
  type VideoEntityResult
} from '@shared/graph'
import {
  isDraftAssetId,
  isDraftShotId,
  shotScriptAssetId,
  type Shot
} from '@shared/domain'
import { useProjectStore } from '../../stores/project'
import { useDraftStore } from '../../stores/drafts'
import { toPlain } from '../../utils/toPlain'

function normalizeRel(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

/** 画面图是否尚无可用图片输出 */
export function shotNeedsVisualCascade(shot: Shot): boolean {
  const visual = normalizeScopedGraph('visual', shot.canvas.visualGraphJson ?? null)
  return collectImagesFromVisualGraph(visual).length === 0
}

/** 视频图是否尚无可用视频输出 */
export function shotNeedsVideoCascade(shot: Shot): boolean {
  const workflow = normalizeScopedGraph('shotWorkflow', shot.canvas.graphJson ?? null)
  return collectVideosFromShotWorkflowGraph(workflow).length === 0
}

async function ensureMediaAssetForPath(
  relativePath: string,
  name: string,
  type: 'image' | 'video'
): Promise<{ id: string; name: string; relativePath: string } | null> {
  const project = useProjectStore()
  await project.refreshAssets()
  const key = normalizeRel(relativePath)
  const existing = project.assets.find(
    (asset) =>
      asset.type === type &&
      !!asset.relativePath &&
      normalizeRel(asset.relativePath) === key
  )
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      relativePath: existing.relativePath ?? relativePath
    }
  }
  try {
    const created = await window.studio.createAsset({
      type,
      name: name || (type === 'video' ? 'Shot video' : 'Shot image')
    })
    const linked = await window.studio.attachAssetRelative({
      assetId: created.id,
      relativePath
    })
    await project.refreshAssets()
    return {
      id: linked.id,
      name: linked.name,
      relativePath: linked.relativePath ?? relativePath
    }
  } catch (error) {
    console.error('[shotVisualPipeline] ensureMediaAssetForPath failed', type, error)
    return null
  }
}

async function ensureImageAssetForItem(
  item: GraphImageItem,
  name: string
): Promise<{ id: string; name: string; relativePath?: string } | null> {
  const project = useProjectStore()
  const existingId = item.id?.trim()
  if (existingId) {
    const hit = project.assets.find((asset) => asset.id === existingId && asset.type === 'image')
    if (hit) {
      return {
        id: hit.id,
        name: hit.name,
        relativePath: hit.relativePath ?? item.relativePath
      }
    }
  }

  let relativePath = item.relativePath?.trim() || ''
  if (!relativePath && item.dataUrl?.trim()) {
    try {
      relativePath = await window.studio.saveGraphRunMedia({
        dataUrl: item.dataUrl,
        key: `${name || 'Shot image'}_${Date.now()}`,
        outputDir: undefined
      })
    } catch (error) {
      console.error('[shotVisualPipeline] saveGraphRunMedia failed', error)
      return null
    }
  }
  if (!relativePath) return null
  return ensureMediaAssetForPath(relativePath, name, 'image')
}

function resolveShotRecord(shotId: string, scriptAssetId: string): Shot | null {
  const project = useProjectStore()
  const fromProject = project.shots.find((s) => s.id === shotId)
  if (fromProject) return fromProject
  if (isDraftAssetId(scriptAssetId)) {
    return useDraftStore().getDraft(scriptAssetId)?.shots?.find((s) => s.id === shotId) ?? null
  }
  return null
}

async function persistShotRecord(shot: Shot): Promise<void> {
  const project = useProjectStore()
  project.persistShotLocal(shot)
  const ownerId = shotScriptAssetId(shot)
  if (ownerId && isDraftAssetId(ownerId)) return
  if (isDraftShotId(shot.id)) return
  await project.persistShot(shot)
}

function resolveImageAssetById(assetId: string): ShotVisualImageAsset | null {
  const asset = useProjectStore().assets.find((item) => item.id === assetId)
  if (!asset || asset.type !== 'image') return null
  return {
    id: asset.id,
    type: 'image',
    name: asset.name,
    relativePath: asset.relativePath
  }
}

function resolveImageAssetByRelativePath(relativePath: string): ShotVisualImageAsset | null {
  const key = normalizeRel(relativePath)
  if (!key) return null
  const asset = useProjectStore().assets.find(
    (item) =>
      item.type === 'image' &&
      !!item.relativePath &&
      normalizeRel(item.relativePath) === key
  )
  if (!asset) return null
  return {
    id: asset.id,
    type: 'image',
    name: asset.name,
    relativePath: asset.relativePath
  }
}

function readScriptGraphDocs(scriptAssetId: string): GraphDocument[] {
  const docs: GraphDocument[] = []
  const seen = new WeakSet<object>()
  const pushRaw = (raw: unknown): void => {
    if (!raw || typeof raw !== 'object' || seen.has(raw)) return
    const doc = raw as GraphDocument
    if (!Array.isArray(doc.nodes)) return
    seen.add(raw)
    docs.push(doc)
  }
  if (isDraftAssetId(scriptAssetId)) {
    pushRaw(useDraftStore().getDraft(scriptAssetId)?.genParams?.graphJson)
  } else {
    pushRaw(
      useProjectStore().assets.find((a) => a.id === scriptAssetId)?.genParams?.graphJson
    )
  }
  return docs
}

/**
 * 跑分镜图/视频前：在各镜子图上物化绑定实体边界。
 * 分镜图接到图片生成；分镜视频为整表 shotEntities + 选择节点，当前镜绑定图接到视频生成。
 */
export async function materializeBoundEntityRefsOnScriptShots(input: {
  scriptAssetId: string
  shots: Shot[]
  kind: 'visual' | 'shotWorkflow'
  signal?: AbortSignal
  /** 执行时刚解析的实体表（优先于剧本图落盘缓存） */
  shotEntities?: ShotEntityResult[]
}): Promise<void> {
  const target = input.kind === 'visual' ? 'image' : 'video'
  const fromLiveEntities = entityImageUrlsByShotId(input.shotEntities)
  const scriptDocs = readScriptGraphDocs(input.scriptAssetId)
  const catalog =
    input.kind === 'shotWorkflow'
      ? input.shotEntities?.length
        ? input.shotEntities
        : resolveAllShotEntitiesFromGraphs(scriptDocs)
      : []
  for (const shot of input.shots) {
    assertNotAborted(input.signal)
    const live = resolveShotRecord(shot.id, input.scriptAssetId) ?? shot

    const raw =
      input.kind === 'visual' ? live.canvas.visualGraphJson : live.canvas.graphJson
    const before = normalizeScopedGraph(
      input.kind === 'visual' ? 'visual' : 'shotWorkflow',
      raw ?? null
    )
    const entityImageUrls =
      fromLiveEntities[live.id] ??
      resolveShotEntityImageUrlsFromGraphs(scriptDocs, live.id)
    const next =
      input.kind === 'shotWorkflow'
        ? materializeShotBoundEntityRefsOnGraph(
            before,
            live,
            target,
            resolveImageAssetById,
            {
              resolveAssetByRelativePath: resolveImageAssetByRelativePath,
              shotEntitiesCatalog: catalog,
              wireShotEntitiesToSelect: true,
              selectNodeTitle: '选择分镜实体',
              entityImageUrls
            }
          )
        : materializeShotBoundEntityRefsOnGraph(
            before,
            live,
            target,
            resolveImageAssetById,
            {
              resolveAssetByRelativePath: resolveImageAssetByRelativePath,
              entityImageUrls
            }
          )
    if (JSON.stringify(next) === JSON.stringify(before)) continue

    const patched: Shot = {
      ...live,
      canvas: {
        ...live.canvas,
        ...(input.kind === 'visual'
          ? { visualGraphJson: toPlain(next) as GraphDocument }
          : { graphJson: toPlain(next) as GraphDocument })
      },
      updatedAt: new Date().toISOString()
    }
    await persistShotRecord(patched)
  }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('GRAPH_CANCELLED')
    err.name = 'AbortError'
    throw err
  }
}

export type CollectScriptShotImagesResult = {
  images: GraphImageItem[]
  aggregateJson: string
  entities: ShotEntityResult[]
}

export type CollectScriptShotVideosResult = {
  videos: GraphVideoItem[]
  entities: VideoEntityResult[]
}

/** 将已跑完的 visual 图输出写回该镜 genRefs / 缩略图（不重新跑图） */
export async function applyVisualGraphGenRefsToShot(
  shot: Shot,
  visualGraph: GraphDocument
): Promise<Shot> {
  const images = collectImagesFromVisualGraph(visualGraph)
  const assetIds: string[] = []
  for (let i = 0; i < images.length; i++) {
    const asset = await ensureImageAssetForItem(images[i]!, `${shot.title || 'Shot'} · ${i + 1}`)
    if (asset) assetIds.push(asset.id)
  }
  const previewPath =
    images.find((item) => item.relativePath?.trim())?.relativePath?.trim() ||
    undefined
  return {
    ...shot,
    genRefs: assetIds.length
      ? mergeVisualOutputGenRefs(shot.genRefs, assetIds, 'style')
      : shot.genRefs,
    thumbnailPath: previewPath || shot.thumbnailPath
  }
}

/**
 * 对脚本下可见分镜：只从各镜画面图的图片输出节点收集已有结果，
 * 写回 genRefs，返回聚合 images + JSON（不级联执行 visual 节点链）。
 */
export async function collectScriptShotImages(input: {
  scriptAssetId: string
  shots: Shot[]
  signal?: AbortSignal
}): Promise<CollectScriptShotImagesResult> {
  const allImages: GraphImageItem[] = []
  const aggregateShots: Shot[] = []
  const entities: ShotEntityResult[] = []

  for (const shot of input.shots) {
    assertNotAborted(input.signal)
    const live = resolveShotRecord(shot.id, input.scriptAssetId) ?? shot
    const visual = normalizeScopedGraph('visual', live.canvas.visualGraphJson ?? null)
    const images = collectImagesFromVisualGraph(visual)

    const assetIds: string[] = []
    const imageUrls: string[] = []
    for (let i = 0; i < images.length; i++) {
      const item = images[i]!
      const asset = await ensureImageAssetForItem(item, `${live.title || 'Shot'} · ${i + 1}`)
      if (asset) {
        assetIds.push(asset.id)
        const nextItem: GraphImageItem = {
          ...item,
          id: asset.id,
          relativePath: asset.relativePath ?? item.relativePath,
          dataUrl: item.dataUrl || ''
        }
        allImages.push(nextItem)
        const url = imageUrlFromGraphImageItem(nextItem)
        if (url) imageUrls.push(url)
      } else {
        allImages.push(item)
        const url = imageUrlFromGraphImageItem(item)
        if (url) imageUrls.push(url)
      }
    }

    const nextGenRefs = assetIds.length
      ? mergeVisualOutputGenRefs(live.genRefs, assetIds, 'style')
      : live.genRefs
    const previewPath =
      images.find((item) => item.relativePath?.trim())?.relativePath?.trim() ||
      undefined
    const next: Shot = {
      ...live,
      genRefs: nextGenRefs,
      thumbnailPath: previewPath || live.thumbnailPath,
      canvas: {
        ...live.canvas,
        visualGraphJson: toPlain(visual) as Shot['canvas']['visualGraphJson']
      }
    }
    await persistShotRecord(next)
    aggregateShots.push(next)
    if (imageUrls.length) {
      entities.push({
        id: next.id,
        name: next.title?.trim() || `分镜 ${entities.length + 1}`,
        imageUrls
      })
    }
  }

  const rows = aggregateShots.map((shot, index) => shotToImageAggregateRow(shot, index))
  return {
    images: allImages,
    aggregateJson: stringifyShotImageAggregateRows(rows),
    entities
  }
}

/**
 * 对脚本下可见分镜：从各镜子图全部已完成视频生成节点收集结果，
 * 写回 genRefs（motion），返回聚合 videos + videoEntities（不级联执行 shotWorkflow）。
 */
export async function collectScriptShotVideos(input: {
  scriptAssetId: string
  shots: Shot[]
  signal?: AbortSignal
}): Promise<CollectScriptShotVideosResult> {
  const allVideos: GraphVideoItem[] = []
  const entities: VideoEntityResult[] = []

  for (const shot of input.shots) {
    assertNotAborted(input.signal)
    const live = resolveShotRecord(shot.id, input.scriptAssetId) ?? shot
    const workflow = normalizeScopedGraph('shotWorkflow', live.canvas.graphJson ?? null)
    const videos = collectVideosFromVideoGenNodes(workflow)

    const assetIds: string[] = []
    const videoUrls: string[] = []
    for (let i = 0; i < videos.length; i++) {
      const item = videos[i]!
      const rel = item.relativePath?.trim()
      if (!rel) {
        allVideos.push(item)
        const url = videoUrlFromGraphVideoItem(item)
        if (url) videoUrls.push(url)
        continue
      }
      const asset = await ensureMediaAssetForPath(rel, `${live.title || 'Shot'} · ${i + 1}`, 'video')
      if (asset) {
        assetIds.push(asset.id)
        const nextItem: GraphVideoItem = {
          ...item,
          id: asset.id,
          relativePath: asset.relativePath
        }
        allVideos.push(nextItem)
        const url = videoUrlFromGraphVideoItem(nextItem)
        if (url) videoUrls.push(url)
      } else {
        allVideos.push(item)
        const url = videoUrlFromGraphVideoItem(item)
        if (url) videoUrls.push(url)
      }
    }

    const next: Shot = {
      ...live,
      genRefs: mergeVideoOutputGenRefs(live.genRefs, assetIds, 'motion'),
      canvas: {
        ...live.canvas,
        graphJson: toPlain(workflow) as Shot['canvas']['graphJson']
      }
    }
    await persistShotRecord(next)
    if (videoUrls.length) {
      entities.push({
        id: next.id,
        name: next.title?.trim() || `分镜 ${entities.length + 1}`,
        videoUrls
      })
    }
  }

  return { videos: allVideos, entities }
}
