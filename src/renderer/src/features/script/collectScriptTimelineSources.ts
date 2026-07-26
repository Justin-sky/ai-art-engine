/**
 * 从剧本资产图「成片时间线」节点上游收集可编排视频素材。
 */
import { isDraftAssetId, shotScriptAssetId } from '@shared/domain'
import {
  GRAPH_OUTPUT_NODE_IDS,
  flattenVideosValues,
  type GraphDocument,
  type GraphVideoItem,
  type ScriptTimelineSource
} from '@shared/graph'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'
import { graphRunHosts } from '../graph/model/graphRunHosts'
import { collectScriptShotVideos } from './shotVisualPipeline'

function readScriptGraph(scriptAssetId: string): GraphDocument | null {
  if (isDraftAssetId(scriptAssetId)) {
    const raw = useDraftStore().getDraft(scriptAssetId)?.genParams?.graphJson
    return raw && typeof raw === 'object' ? (raw as GraphDocument) : null
  }
  const asset = useProjectStore().assets.find((a) => a.id === scriptAssetId)
  const raw = asset?.genParams?.graphJson
  return raw && typeof raw === 'object' ? (raw as GraphDocument) : null
}

function videoItemToSource(item: GraphVideoItem, index: number): ScriptTimelineSource | null {
  const relativePath = item.relativePath?.trim()
  const assetId = item.id?.trim()
  if (!relativePath && !assetId) return null
  const project = useProjectStore()
  const asset = assetId
    ? project.assets.find((a) => a.id === assetId)
    : relativePath
      ? project.assets.find(
          (a) => a.type === 'video' && a.relativePath?.replace(/\\/g, '/') === relativePath.replace(/\\/g, '/')
        )
      : undefined
  return {
    id: assetId || relativePath || `video:${index}`,
    title: asset?.name?.trim() || `视频 ${index + 1}`,
    relativePath: relativePath || asset?.relativePath,
    assetId: asset?.id || assetId,
    durationSec: undefined
  }
}

function collectFromValueVideos(doc: GraphDocument, hostId: string): ScriptTimelineSource[] {
  const output =
    doc.nodes.find((n) => n.id === GRAPH_OUTPUT_NODE_IDS.timeline) ||
    doc.nodes.find((n) => n.typeId === 'output.timeline') ||
    doc.nodes.find((n) => n.category === 'output')
  if (!output) return []

  const runOut = graphRunHosts.get(hostId)?.runStates?.[output.id]?.outputs?.out
  const fromRun = runOut ? flattenVideosValues([runOut]) : []
  if (fromRun.length) {
    return fromRun
      .map((item, i) => videoItemToSource(item, i))
      .filter((item): item is ScriptTimelineSource => !!item)
  }

  // 沿入边读上游节点输出 / 预览路径
  const sources: ScriptTimelineSource[] = []
  const seen = new Set<string>()
  for (const edge of doc.edges) {
    if (edge.target !== output.id) continue
    const sourceNode = doc.nodes.find((n) => n.id === edge.source)
    if (!sourceNode) continue
    const upstreamOut = graphRunHosts.get(hostId)?.runStates?.[sourceNode.id]?.outputs?.out
    const videos = upstreamOut ? flattenVideosValues([upstreamOut]) : []
    for (const [i, item] of videos.entries()) {
      const src = videoItemToSource(item, sources.length + i)
      if (!src || seen.has(src.id)) continue
      seen.add(src.id)
      sources.push(src)
    }
    if (!videos.length) {
      const rel = sourceNode.params.previewRelativePath?.trim()
      if (rel && !seen.has(rel)) {
        seen.add(rel)
        sources.push({
          id: rel,
          title: sourceNode.title?.trim() || `视频 ${sources.length + 1}`,
          relativePath: rel
        })
      }
    }
  }
  return sources
}

export async function collectScriptTimelineSources(input: {
  scriptAssetId: string
  hostId?: string
}): Promise<ScriptTimelineSource[]> {
  const hostId = input.hostId?.trim() || `asset:${input.scriptAssetId}`
  const doc = readScriptGraph(input.scriptAssetId)
  if (doc) {
    const fromGraph = collectFromValueVideos(doc, hostId)
    if (fromGraph.length) return fromGraph
  }

  // 回退：收集各镜 shotWorkflow 已有视频
  const project = useProjectStore()
  const shots = isDraftAssetId(input.scriptAssetId)
    ? useDraftStore().getDraft(input.scriptAssetId)?.shots ?? []
    : project.shots.filter((s) => shotScriptAssetId(s) === input.scriptAssetId)
  if (!shots.length) return []
  const collected = await collectScriptShotVideos({
    scriptAssetId: input.scriptAssetId,
    shots
  })
  return collected.videos
    .map((item, i) => videoItemToSource(item, i))
    .filter((item): item is ScriptTimelineSource => !!item)
}
