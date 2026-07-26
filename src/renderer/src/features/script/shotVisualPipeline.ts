/**
 * 分镜图/视频管道：从各镜 visual / shotWorkflow 的输出节点收集结果 → 物化资产 → 写回 genRefs。
 * 不级联跑分镜画面/视频图中的生成节点链；需在对应分镜窗口内先行跑完，或走 Inspector 批量入队。
 */
import {
  collectImagesFromVisualGraph,
  collectVideosFromShotWorkflowGraph,
  mergeVideoOutputGenRefs,
  mergeVisualOutputGenRefs,
  normalizeScopedGraph,
  shotToImageAggregateRow,
  stringifyShotImageAggregateRows,
  type GraphDocument,
  type GraphImageItem,
  type GraphVideoItem
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
}

export type CollectScriptShotVideosResult = {
  videos: GraphVideoItem[]
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

  for (const shot of input.shots) {
    assertNotAborted(input.signal)
    const live = resolveShotRecord(shot.id, input.scriptAssetId) ?? shot
    const visual = normalizeScopedGraph('visual', live.canvas.visualGraphJson ?? null)
    const images = collectImagesFromVisualGraph(visual)

    const assetIds: string[] = []
    for (let i = 0; i < images.length; i++) {
      const item = images[i]!
      const asset = await ensureImageAssetForItem(item, `${live.title || 'Shot'} · ${i + 1}`)
      if (asset) {
        assetIds.push(asset.id)
        allImages.push({
          ...item,
          id: asset.id,
          relativePath: asset.relativePath ?? item.relativePath,
          dataUrl: item.dataUrl || ''
        })
      } else {
        allImages.push(item)
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
  }

  const rows = aggregateShots.map((shot, index) => shotToImageAggregateRow(shot, index))
  return {
    images: allImages,
    aggregateJson: stringifyShotImageAggregateRows(rows)
  }
}

/**
 * 对脚本下可见分镜：只从各镜视频图的视频输出节点收集已有结果，
 * 写回 genRefs（motion），返回聚合 videos（不级联执行 shotWorkflow 节点链）。
 */
export async function collectScriptShotVideos(input: {
  scriptAssetId: string
  shots: Shot[]
  signal?: AbortSignal
}): Promise<CollectScriptShotVideosResult> {
  const allVideos: GraphVideoItem[] = []

  for (const shot of input.shots) {
    assertNotAborted(input.signal)
    const live = resolveShotRecord(shot.id, input.scriptAssetId) ?? shot
    const workflow = normalizeScopedGraph('shotWorkflow', live.canvas.graphJson ?? null)
    const videos = collectVideosFromShotWorkflowGraph(workflow)

    const assetIds: string[] = []
    for (let i = 0; i < videos.length; i++) {
      const item = videos[i]!
      const rel = item.relativePath?.trim()
      if (!rel) {
        allVideos.push(item)
        continue
      }
      const asset = await ensureMediaAssetForPath(rel, `${live.title || 'Shot'} · ${i + 1}`, 'video')
      if (asset) {
        assetIds.push(asset.id)
        allVideos.push({
          ...item,
          id: asset.id,
          relativePath: asset.relativePath
        })
      } else {
        allVideos.push(item)
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
  }

  return { videos: allVideos }
}
