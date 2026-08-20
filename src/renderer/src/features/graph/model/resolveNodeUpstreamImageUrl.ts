import {
  flattenImagesValues,
  resolveMotionImageItems,
  type GraphDocument,
  type GraphNodeRunState,
  type GraphValue
} from '@shared/graph'
import type { AssetInfo } from '@shared/domain'
import { resolveAssetFileUrl } from '../../media/assetUrlCache'

async function resolveRel(relativePath?: string | null): Promise<string> {
  const path = relativePath?.trim()
  if (!path) return ''
  try {
    return await resolveAssetFileUrl(path)
  } catch {
    return ''
  }
}

function pickFromRunOut(
  runOut: GraphValue | undefined,
  assets: AssetInfo[]
): Promise<string> {
  return (async () => {
    if (!runOut) return ''
    for (const item of flattenImagesValues([runOut])) {
      if (item.dataUrl?.trim()) return item.dataUrl
      const url = await resolveRel(item.relativePath)
      if (url) return url
    }
    if (runOut.kind === 'asset' && runOut.assetType === 'image' && runOut.assetId) {
      const asset = assets.find((item) => item.id === runOut.assetId)
      return resolveRel(asset?.thumbnailPath || asset?.relativePath)
    }
    return ''
  })()
}

/**
 * 解析节点入边上游的第一张可用图片（与编辑弹窗源图逻辑对齐）。
 * 上游优先：节点自身预览是运行产物，不能当作源图，否则会在产物上二次裁切。
 */
export async function resolveNodeUpstreamImageUrl(input: {
  document: GraphDocument | null | undefined
  nodeId: string
  runStates?: Record<string, GraphNodeRunState> | null
  assets: AssetInfo[]
}): Promise<string> {
  const { document, nodeId, assets } = input
  if (!document) return ''
  const nodes = document.nodes ?? []
  const edges = document.edges ?? []
  const runStates = input.runStates ?? {}

  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return ''

  for (const edge of edges) {
    if (edge.target !== nodeId) continue
    if ((edge.targetPort ?? 'in') !== 'in') continue
    const source = nodes.find((n) => n.id === edge.source)
    if (!source) continue

    const fromRun = await pickFromRunOut(runStates[source.id]?.outputs?.out, assets)
    if (fromRun) return fromRun

    if (source.params.previewDataUrl?.trim()) return source.params.previewDataUrl
    const sourcePreview = await resolveRel(source.params.previewRelativePath)
    if (sourcePreview) return sourcePreview

    for (const shot of source.params.cameraShots ?? []) {
      if (shot.dataUrl?.trim()) return shot.dataUrl
      const url = await resolveRel(shot.relativePath)
      if (url) return url
    }

    if (source.assetType === 'image' && source.assetId) {
      const asset = assets.find((item) => item.id === source.assetId)
      const url = await resolveRel(asset?.thumbnailPath || asset?.relativePath)
      if (url) return url
    }

    if (source.assetType === 'motion' && source.assetId && source.params.assetRef) {
      const asset = assets.find((item) => item.id === source.assetId)
      for (const item of resolveMotionImageItems(
        asset?.genParams as Record<string, unknown> | undefined,
        source.params
      )) {
        if (item.dataUrl?.trim()) return item.dataUrl
        const url = await resolveRel(item.relativePath)
        if (url) return url
      }
    }
  }

  const ownDataUrl = node.params.previewDataUrl?.trim()
  if (ownDataUrl) return ownDataUrl
  return resolveRel(node.params.previewRelativePath)
}
