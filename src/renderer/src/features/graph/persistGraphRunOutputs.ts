import {
  cloneGraphDocument,
  exportPersistedRunStates,
  materializeNodePreviewParams,
  materializeRunStateOutputs,
  resolveHostMediaSyncSource,
  type GraphDocument,
  type GraphNode,
  type GraphNodeRunState
} from '@shared/graph'
import { isMediaFileAsset, resolveMediaOutputDir } from '@shared/domain'
import { useProjectStore } from '../../stores/project'

async function saveGraphRunMedia(input: {
  dataUrl: string
  key: string
  outputDir?: string
}): Promise<string> {
  const relativePath = await window.studio.saveGraphRunMedia(input)
  await useProjectStore().scheduleRefreshLibrary()
  return relativePath
}

function resolveNodeImageOutputDir(node: GraphNode | undefined): string {
  const project = useProjectStore()
  return resolveMediaOutputDir({
    mediaOutputDir: node?.params.mediaOutputDir,
    cacheOutputDir: project.config?.cacheOutputDir,
    kind: 'image'
  })
}

/** 物化 dataUrl → 相对路径，并导出可落盘 graphJson（含 outputs） */
export async function prepareGraphDocumentForPersist(
  graph: GraphDocument,
  runStates: Record<string, GraphNodeRunState>
): Promise<{
  document: GraphDocument
  materializedStates: Record<string, GraphNodeRunState>
}> {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))

  const materializedStates = await materializeRunStateOutputs(
    runStates,
    saveGraphRunMedia,
    (nodeId) => resolveNodeImageOutputDir(nodesById.get(nodeId))
  )
  const nodes = await materializeNodePreviewParams(graph.nodes, saveGraphRunMedia, (node) =>
    resolveNodeImageOutputDir(node)
  )
  const document = cloneGraphDocument({
    ...graph,
    nodes,
    runStates: undefined
  })
  document.runStates = exportPersistedRunStates(
    materializedStates,
    document.nodes.map((node) => node.id)
  )
  return { document, materializedStates }
}

/** 空媒体宿主：把图输出物化文件挂到资产 relativePath */
export async function syncHostMediaFromGraphOutput(input: {
  assetId: string
  graph: GraphDocument
  runStates: Record<string, GraphNodeRunState>
}): Promise<void> {
  const project = useProjectStore()
  const asset = project.assets.find((item) => item.id === input.assetId)
  if (!asset || !isMediaFileAsset(asset.type)) return
  if (asset.relativePath?.trim()) return

  const source = resolveHostMediaSyncSource(
    input.graph,
    input.runStates,
    asset.id,
    asset.type
  )
  if (!source) return

  try {
    let relativePath: string | null = null
    if (source.kind === 'relativePath') {
      relativePath = source.relativePath
    } else {
      const other = project.assets.find((item) => item.id === source.assetId)
      relativePath = other?.relativePath?.trim() || null
    }
    if (!relativePath) return
    const updated = await window.studio.attachAssetRelative({
      assetId: asset.id,
      relativePath
    })
    const idx = project.assets.findIndex((item) => item.id === updated.id)
    if (idx >= 0) project.assets.splice(idx, 1, updated)
    else project.assets.push(updated)
  } catch {
    /* 宿主同步失败不阻断图落盘 */
  }
}
