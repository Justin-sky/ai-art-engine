import {
  flattenVideosValues,
  type GraphDocument,
  type GraphNodeRunState,
  type GraphValue
} from '@shared/graph'
import type { AssetInfo } from '@shared/domain'
import { isVideoFilePath } from '@shared/import'
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

async function pickFromRunOut(
  runOut: GraphValue | undefined,
  assets: AssetInfo[]
): Promise<{ url: string; relativePath: string }> {
  if (!runOut) return { url: '', relativePath: '' }
  for (const item of flattenVideosValues([runOut])) {
    if (item.dataUrl?.trim()) return { url: item.dataUrl, relativePath: '' }
    const url = await resolveRel(item.relativePath)
    if (url) return { url, relativePath: item.relativePath?.trim() ?? '' }
  }
  if (runOut.kind === 'asset' && runOut.assetType === 'video' && runOut.assetId) {
    const asset = assets.find((item) => item.id === runOut.assetId)
    if (asset?.relativePath?.trim()) {
      const url = await resolveRel(asset.relativePath)
      if (url) return { url, relativePath: asset.relativePath }
    }
  }
  return { url: '', relativePath: '' }
}

/**
 * 解析节点入边上游的第一段可用视频（与图片上游解析对齐）。
 * 优先运行产物，其次上游生成图库 / 预览路径，最后回退到视频资产文件。
 */
export async function resolveNodeUpstreamVideoUrl(input: {
  document: GraphDocument | null | undefined
  nodeId: string
  runStates?: Record<string, GraphNodeRunState> | null
  assets: AssetInfo[]
}): Promise<{ url: string; relativePath: string }> {
  const { document, nodeId, assets } = input
  if (!document) return { url: '', relativePath: '' }
  const nodes = document.nodes ?? []
  const edges = document.edges ?? []
  const runStates = input.runStates ?? {}

  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return { url: '', relativePath: '' }

  for (const edge of edges) {
    if (edge.target !== nodeId) continue
    if ((edge.targetPort ?? 'in') !== 'in') continue
    const source = nodes.find((n) => n.id === edge.source)
    if (!source) continue

    const fromRun = await pickFromRunOut(runStates[source.id]?.outputs?.out, assets)
    if (fromRun.url) return fromRun

    for (const item of source.params.generatedVideos ?? []) {
      if (item.relativePath?.trim()) {
        const url = await resolveRel(item.relativePath)
        if (url) return { url, relativePath: item.relativePath }
      }
    }

    if (source.params.previewRelativePath?.trim()) {
      const rel = source.params.previewRelativePath.trim()
      if (isVideoFilePath(rel)) {
        const url = await resolveRel(rel)
        if (url) return { url, relativePath: rel }
      }
    }

    if (source.assetType === 'video' && source.assetId) {
      const asset = assets.find((item) => item.id === source.assetId)
      if (asset?.relativePath?.trim()) {
        const url = await resolveRel(asset.relativePath)
        if (url) return { url, relativePath: asset.relativePath }
      }
    }
  }

  return { url: '', relativePath: '' }
}
