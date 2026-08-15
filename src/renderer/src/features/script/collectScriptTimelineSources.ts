/**
 * 从宿主资产图收集可编排视频素材：
 * 优先输出节点（output.video / output.timeline），再回退扫描所有 asset.video 节点的产物。
 */
import { isDraftAssetId } from '@shared/domain'
import {
  GRAPH_OUTPUT_NODE_IDS,
  flattenVoicesValues,
  flattenVideosValues,
  type GraphDocument,
  type GraphVoiceItem,
  type GraphVideoItem,
  type ScriptTimelineSource
} from '@shared/graph'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'
import { graphRunHosts } from '../graph/model/graphRunHosts'

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
          (a) =>
            a.type === 'video' &&
            a.relativePath?.replace(/\\/g, '/') === relativePath.replace(/\\/g, '/')
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

function voiceItemToSource(item: GraphVoiceItem, index: number): ScriptTimelineSource | null {
  const relativePath = item.relativePath?.trim()
  const assetId = item.id?.trim()
  if (!relativePath && !assetId) return null
  const project = useProjectStore()
  const asset = assetId
    ? project.assets.find((a) => a.id === assetId)
    : relativePath
      ? project.assets.find(
          (a) =>
            a.type === 'voice' &&
            a.relativePath?.replace(/\\/g, '/') === relativePath.replace(/\\/g, '/')
        )
      : undefined
  return {
    id: assetId || relativePath || `voice:${index}`,
    title: asset?.name?.trim() || `声音 ${index + 1}`,
    relativePath: relativePath || asset?.relativePath,
    assetId: asset?.id || assetId,
    durationSec: undefined,
    mediaKind: 'voice'
  }
}

function collectFromValueVideos(doc: GraphDocument, hostId: string): ScriptTimelineSource[] {
  const output =
    doc.nodes.find((n) => n.id === GRAPH_OUTPUT_NODE_IDS.video) ||
    doc.nodes.find((n) => n.typeId === 'output.video') ||
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

/** 回退：扫描宿主图中所有 asset.video 节点的视频产物（agent 流水线 36 条动态视频） */
function collectFromVideoNodes(doc: GraphDocument, hostId: string): ScriptTimelineSource[] {
  const sources: ScriptTimelineSource[] = []
  const seen = new Set<string>()
  const push = (relativePath: string | undefined, assetId: string | undefined, title?: string): void => {
    const key = assetId || relativePath || ''
    if (!key || seen.has(key)) return
    seen.add(key)
    const src = videoItemToSource(
      { id: assetId, relativePath, createdAt: undefined },
      sources.length
    )
    if (!src) return
    if (title) src.title = title
    sources.push(src)
  }
  for (const node of doc.nodes) {
    if (node.typeId !== 'asset.video') continue
    const title = node.title?.trim()
    const params = node.params ?? {}
    const runOut = graphRunHosts.get(hostId)?.runStates?.[node.id]?.outputs?.out
    if (runOut) {
      const videos = flattenVideosValues([runOut])
      for (const item of videos) push(item.relativePath, item.id, title)
    }
    for (const item of Array.isArray(params.generatedVideos) ? params.generatedVideos : []) {
      push(item?.relativePath, item?.id, title)
    }
    const rel = params.previewRelativePath?.trim()
    if (rel) push(rel, undefined, title)
  }
  return sources
}

function collectFromVoiceNodes(doc: GraphDocument, hostId: string): ScriptTimelineSource[] {
  const sources: ScriptTimelineSource[] = []
  const seen = new Set<string>()
  const push = (relativePath: string | undefined, assetId: string | undefined, title?: string): void => {
    const key = assetId || relativePath || ''
    if (!key || seen.has(key)) return
    seen.add(key)
    const src = voiceItemToSource(
      { id: assetId, relativePath, createdAt: undefined },
      sources.length
    )
    if (!src) return
    if (title) src.title = title
    sources.push(src)
  }
  for (const node of doc.nodes) {
    if (node.typeId !== 'asset.voice') continue
    const title = node.title?.trim()
    const params = node.params ?? {}
    const runOut = graphRunHosts.get(hostId)?.runStates?.[node.id]?.outputs?.out
    if (runOut) {
      const voices = flattenVoicesValues([runOut])
      for (const item of voices) push(item.relativePath, item.id, title)
    }
    for (const item of Array.isArray(params.generatedVoices) ? params.generatedVoices : []) {
      push(item?.relativePath, item?.id, title)
    }
    const rel = params.previewRelativePath?.trim()
    if (rel) push(rel, undefined, title)
  }
  return sources
}

function asInputSources(list: ScriptTimelineSource[]): ScriptTimelineSource[] {
  return list.map((src) => ({
    ...src,
    origin: 'input' as const,
    mediaKind: src.mediaKind === 'voice' ? ('voice' as const) : ('video' as const)
  }))
}

export async function collectScriptTimelineSources(input: {
  scriptAssetId: string
  hostId?: string
}): Promise<ScriptTimelineSource[]> {
  const hostId = input.hostId?.trim() || `asset:${input.scriptAssetId}`
  const doc = readScriptGraph(input.scriptAssetId)
  if (doc) {
    const fromGraph = collectFromValueVideos(doc, hostId)
    if (fromGraph.length) return asInputSources(fromGraph)
  }

  // 回退：扫描宿主图中所有 asset.video 节点产物
  if (doc) {
    const fromVideoNodes = collectFromVideoNodes(doc, hostId)
    const fromVoiceNodes = collectFromVoiceNodes(doc, hostId)
    if (fromVideoNodes.length || fromVoiceNodes.length) {
      return asInputSources([...fromVideoNodes, ...fromVoiceNodes])
    }
  }
  return []
}
