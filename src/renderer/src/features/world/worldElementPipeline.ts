/**
 * 世界元素图管道：先跑四类 elementWorkflow 子图的全部生成链，
 * 再从边界输出节点收集 `{ type, name, imageUrl }` 实体结果。
 */
import {
  collectImagesFromCompletedOutputNode,
  hostInterfaceForElementWorkflow,
  inferElementWorkflowHostInterface,
  isVisualOutputNodeComplete,
  listVisualOutputNodes,
  normalizeScopedGraph,
  readWorldElementGraphFromGenParams,
  readWorldElementIdFromNodeParams,
  WORLD_ELEMENT_KIND_TO_TYPE,
  WORLD_ELEMENT_KINDS,
  type GraphDocument,
  type GraphImageItem,
  type GraphNode,
  type WorldElementGenResult
} from '@shared/graph'
import { isDraftAssetId } from '@shared/domain'
import { graphEditorHosts } from '../graph/model/graphEditorHosts'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'

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

function resolveElementName(doc: GraphDocument, output: GraphNode, fallback: string): string {
  const elementId = readWorldElementIdFromNodeParams(output.params)
  if (elementId) {
    const titled = doc.nodes.find(
      (node) =>
        readWorldElementIdFromNodeParams(node.params) === elementId && !!node.title?.trim()
    )
    if (titled?.title?.trim()) return titled.title.trim()
  }
  if (output.title?.trim()) return output.title.trim()
  return fallback
}

function imageUrlFromItem(item: GraphImageItem): string {
  return item.relativePath?.trim() || item.dataUrl?.trim() || ''
}

function normalizeElementWorkflowDoc(raw: GraphDocument | null): GraphDocument {
  const items = raw?.nodes
    .map((node) => {
      const id = readWorldElementIdFromNodeParams(node.params)
      if (!id || node.typeId !== 'asset.image') return null
      return { id, name: node.title?.trim() || id }
    })
    .filter((item): item is { id: string; name: string } => !!item)
  const iface = items?.length
    ? hostInterfaceForElementWorkflow(items)
    : inferElementWorkflowHostInterface(raw)
  return normalizeScopedGraph('elementWorkflow', raw ?? null, {
    assetType: 'world',
    hostInterface: iface
  })
}

export type CollectWorldElementOutputsResult = {
  items: WorldElementGenResult[]
}

function readElementWorkflowDoc(
  worldAssetId: string,
  kind: (typeof WORLD_ELEMENT_KINDS)[number],
  genParams: Record<string, unknown> | undefined
): GraphDocument {
  // 打开中的 element 画布优先（含刚 writeBack 的 runStates / preview）
  const live = graphEditorHosts.getDocument(`asset:${worldAssetId}:element:${kind}`)
  if (live) return normalizeElementWorkflowDoc(live)
  const raw = readWorldElementGraphFromGenParams(genParams, kind)
  return normalizeElementWorkflowDoc(raw)
}

/**
 * 从世界资产四类 elementWorkflow 子图收集已完成边界输出的实体结果。
 * 调用方应先 enqueue 并等 writeBack 完成（见 graphTasks.waitForTaskIds）。
 * 只收集实体列表，不回写 worldElementGraphs（避免用旧快照冲掉刚烹好的子图）。
 */
export async function collectWorldElementOutputs(input: {
  worldAssetId: string
  signal?: AbortSignal
}): Promise<CollectWorldElementOutputsResult> {
  const items: WorldElementGenResult[] = []

  for (const kind of WORLD_ELEMENT_KINDS) {
    assertNotAborted(input.signal)
    // 每类单独读盘：四类写回串行完成后也能拿到最新 runStates
    const genParams = readWorldGenParams(input.worldAssetId)
    const doc = readElementWorkflowDoc(input.worldAssetId, kind, genParams)
    // 按子图边界输出端口收集（锁定生成节点经 soft-resolve 直接出图）
    const outputs = listVisualOutputNodes(doc)
    const type = WORLD_ELEMENT_KIND_TO_TYPE[kind]

    for (let i = 0; i < outputs.length; i++) {
      assertNotAborted(input.signal)
      const output = outputs[i]!
      if (!isVisualOutputNodeComplete(doc, output.id)) continue
      const images = collectImagesFromCompletedOutputNode(doc, output)
      if (!images.length) continue

      const name = resolveElementName(doc, output, `${type} · ${i + 1}`)
      // 每个输出节点取一张主图（首条可用）
      const primary = images[0]!
      const asset = await ensureImageAssetForItem(primary, name)
      const imageUrl = asset?.relativePath?.trim() || imageUrlFromItem(primary)
      if (!imageUrl) continue
      items.push({ type, name: asset?.name?.trim() || name, imageUrl })
    }
  }

  return { items }
}
