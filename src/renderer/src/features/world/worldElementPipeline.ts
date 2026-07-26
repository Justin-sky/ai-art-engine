/**
 * 世界元素图管道：从四类 elementWorkflow 子图收集已有图片输出。
 * 不级联跑元素子图中的生成节点；需在世界编辑侧栏内先行跑完。
 */
import {
  collectImagesFromVisualGraph,
  normalizeScopedGraph,
  readWorldElementGraphFromGenParams,
  readWorldElementIdFromNodeParams,
  withWorldElementGraph,
  WORLD_ELEMENT_KINDS,
  type GraphDocument,
  type GraphImageItem,
  type WorldElementKind
} from '@shared/graph'
import { isDraftAssetId } from '@shared/domain'
import { persistAssetRecord } from '../../composables/useAssetRecord'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'
import { toPlain } from '../../utils/toPlain'

function normalizeRel(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('GRAPH_CANCELLED')
    err.name = 'AbortError'
    throw err
  }
}

function readWorldGenParams(worldAssetId: string): Record<string, unknown> | undefined {
  if (isDraftAssetId(worldAssetId)) {
    return useDraftStore().getDraft(worldAssetId)?.genParams
  }
  return useProjectStore().assets.find((item) => item.id === worldAssetId)?.genParams as
    | Record<string, unknown>
    | undefined
}

async function writeWorldGenParams(
  worldAssetId: string,
  genParams: Record<string, unknown>
): Promise<void> {
  if (isDraftAssetId(worldAssetId)) {
    useDraftStore().updateDraft(worldAssetId, { genParams })
    return
  }
  await persistAssetRecord(worldAssetId, { genParams })
}

async function ensureMediaAssetForPath(
  relativePath: string,
  name: string
): Promise<{ id: string; name: string; relativePath: string } | null> {
  const project = useProjectStore()
  await project.refreshAssets()
  const key = normalizeRel(relativePath)
  const existing = project.assets.find(
    (asset) =>
      asset.type === 'image' &&
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
      type: 'image',
      name: name || 'World element'
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
    console.error('[worldElementPipeline] ensureMediaAssetForPath failed', error)
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
        key: `${name || 'World element'}_${Date.now()}`,
        outputDir: undefined
      })
    } catch (error) {
      console.error('[worldElementPipeline] saveGraphRunMedia failed', error)
      return null
    }
  }
  if (!relativePath) return null
  return ensureMediaAssetForPath(relativePath, name)
}

function nodeTitleForImage(
  doc: GraphDocument,
  item: GraphImageItem,
  kind: WorldElementKind,
  index: number
): string {
  if (item.id?.trim()) {
    const byElement = doc.nodes.find(
      (node) => readWorldElementIdFromNodeParams(node.params) === item.id
    )
    if (byElement?.title?.trim()) return byElement.title.trim()
    const byNode = doc.nodes.find((node) => node.id === item.id)
    if (byNode?.title?.trim()) return byNode.title.trim()
  }
  return `${kind} · ${index + 1}`
}

export type CollectWorldElementImagesResult = {
  images: GraphImageItem[]
}

/**
 * 从世界资产四类 elementWorkflow 子图收集已有图片（不级联跑生成）。
 */
export async function collectWorldElementImages(input: {
  worldAssetId: string
  signal?: AbortSignal
}): Promise<CollectWorldElementImagesResult> {
  const allImages: GraphImageItem[] = []
  let genParams = { ...(readWorldGenParams(input.worldAssetId) ?? {}) }
  let dirty = false

  for (const kind of WORLD_ELEMENT_KINDS) {
    assertNotAborted(input.signal)
    const raw = readWorldElementGraphFromGenParams(genParams, kind)
    const doc = normalizeScopedGraph('elementWorkflow', raw ?? null, {
      assetType: 'world'
    })
    const images = collectImagesFromVisualGraph(doc)
    if (!images.length) continue

    for (let i = 0; i < images.length; i++) {
      assertNotAborted(input.signal)
      const item = images[i]!
      const name = nodeTitleForImage(doc, item, kind, i)
      const asset = await ensureImageAssetForItem(item, name)
      if (asset) {
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

    genParams = withWorldElementGraph(genParams, kind, toPlain(doc) as GraphDocument)
    dirty = true
  }

  if (dirty) {
    await writeWorldGenParams(input.worldAssetId, genParams)
  }

  return { images: allImages }
}
