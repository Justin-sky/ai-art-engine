/**
 * 从宿主资产图收集可编排视频与声音素材：
 * 优先解析目标成片时间线节点（output.timeline / timelineNodeId）所有输入端口的上游连线，
 * 若时间线节点尚未连线则回退扫描图中视频与声音节点的产物。
 */
import { isDraftAssetId } from '@shared/domain'
import {
  GRAPH_OUTPUT_NODE_IDS,
  flattenImagesValues,
  flattenVoicesValues,
  flattenVideosValues,
  parseFilmRenderCache,
  parseFilmStoryboard,
  pickImageItem,
  pickVideoItem,
  pickVoiceItem,
  type GraphDocument,
  type GraphNode,
  type GraphNodeRunState,
  type GraphVoiceItem,
  type GraphVideoItem,
  type ScriptTimelineSource
} from '@shared/graph'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'
import i18n from '../../i18n'
import { graphEditorHosts } from '../graph/model/graphEditorHosts'
import { graphRunHosts } from '../graph/model/graphRunHosts'

function readScriptGraph(scriptAssetId: string, hostId?: string): GraphDocument | null {
  const live =
    (hostId ? graphEditorHosts.getDocument(hostId) : null) ??
    graphEditorHosts.getLiveAssetDocument(scriptAssetId)
  if (live) return live
  if (isDraftAssetId(scriptAssetId)) {
    const raw = useDraftStore().getDraft(scriptAssetId)?.genParams?.graphJson
    return raw && typeof raw === 'object' ? (raw as GraphDocument) : null
  }
  const asset = useProjectStore().assets.find((a) => a.id === scriptAssetId)
  const raw = asset?.genParams?.graphJson
  return raw && typeof raw === 'object' ? (raw as GraphDocument) : null
}

/** 排除时间线节点自身合成的成片，避免把合成产物反当成输入源再次导入 */
function isTimelineComposedItem(item: {
  id?: string | null
  relativePath?: string | null
}): boolean {
  if (item.id?.trim() === 'timeline-composed') return true
  const rel = item.relativePath?.trim().replace(/\\/g, '/') ?? ''
  return rel.startsWith('Cache/TimelineCompose/')
}

function isOutputNode(node: GraphNode): boolean {
  return Boolean(node.category === 'output' || node.typeId?.startsWith('output.'))
}

function isVoiceNodeType(typeId: string | undefined): boolean {
  return (
    typeId === 'asset.voice' ||
    typeId === 'asset.sfx' ||
    typeId === 'asset.music' ||
    typeId === 'asset.dialogue' ||
    typeId === 'voice.select' ||
    typeId === 'output.voice'
  )
}

function isVoiceEdge(sourceNode: GraphNode, targetPort: string): boolean {
  if (targetPort === 'in-voice' || targetPort === 'in-voices' || targetPort === 'in-music') {
    return true
  }
  if (targetPort === 'in' || targetPort === 'in-videos') {
    return sourceNode.assetType === 'voice' || isVoiceNodeType(sourceNode.typeId)
  }
  return sourceNode.assetType === 'voice' || isVoiceNodeType(sourceNode.typeId)
}

function extractShotNum(title?: string): number | null {
  if (!title) return null
  const m =
    title.match(
      /(?:\u5206\u955c|\u955c\u5934|\u7247\u6bb5|\u7ae0\u8282|\u5e55|\u6b65\u9aa4|Shot|Scene|Step|Part|Clip)\s*#?(\d+)/i
    ) ?? title.match(/^#?(\d+)[\s._:\uff1a-]/i)
  return m ? Number(m[1]) : null
}

function readNodeRunOutputs(
  doc: GraphDocument,
  hostId: string,
  nodeId: string
): GraphNodeRunState['outputs'] | undefined {
  return graphRunHosts.get(hostId)?.runStates?.[nodeId]?.outputs ?? doc.runStates?.[nodeId]?.outputs
}

function videoItemToSource(
  item: GraphVideoItem,
  index: number,
  nodeId?: string,
  nodeTitle?: string
): ScriptTimelineSource | null {
  if (isTimelineComposedItem(item)) return null
  const relativePath = item.relativePath?.trim()
  const assetId = item.id?.trim()
  if (!relativePath && !assetId) return null
  const project = useProjectStore()
  const asset = assetId
    ? project.assets.find((a) => a.id === assetId)
    : relativePath
      ? project.assets.find(
          (a) =>
            (a.type === 'video' || a.type === 'image') &&
            a.relativePath?.replace(/\\/g, '/') === relativePath.replace(/\\/g, '/')
        )
      : undefined
  const resolvedRel = relativePath || asset?.relativePath?.trim()
  if (!resolvedRel && !asset?.id && !assetId) return null
  return {
    id: resolvedRel || asset?.id || assetId || `video:${index}`,
    title:
      asset?.name?.trim() ||
      nodeTitle?.trim() ||
      String(i18n.global.t('script.timeline.defaultVideoTitle', { index: index + 1 })),
    relativePath: resolvedRel,
    assetId: asset?.id || assetId,
    durationSec: undefined,
    mediaKind: 'video',
    ...(nodeId?.trim() ? { nodeId: nodeId.trim() } : {}),
    ...(nodeTitle?.trim() ? { nodeTitle: nodeTitle.trim() } : {})
  }
}

function voiceItemToSource(
  item: GraphVoiceItem,
  index: number,
  nodeId?: string,
  nodeTitle?: string
): ScriptTimelineSource | null {
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
  const resolvedRel = relativePath || asset?.relativePath?.trim()
  if (!resolvedRel && !asset?.id && !assetId) return null
  return {
    id: resolvedRel || asset?.id || assetId || `voice:${index}`,
    title:
      asset?.name?.trim() ||
      nodeTitle?.trim() ||
      String(i18n.global.t('script.timeline.defaultVoiceTitle', { index: index + 1 })),
    relativePath: resolvedRel,
    assetId: asset?.id || assetId,
    durationSec: undefined,
    mediaKind: 'voice',
    ...(nodeId?.trim() ? { nodeId: nodeId.trim() } : {}),
    ...(nodeTitle?.trim() ? { nodeTitle: nodeTitle.trim() } : {})
  }
}

function extractFilmNodeVideos(node: GraphNode): GraphVideoItem[] {
  if (node.typeId !== 'film.workbench' && node.typeId !== 'film.render') return []
  const doc = parseFilmStoryboard(node.params?.filmStoryboard ?? '')
  const cache = parseFilmRenderCache(node.params?.filmRenders)
  const shotIds = new Set<string>([
    ...(doc?.shots.map((shot) => shot.id) ?? []),
    ...Object.keys(cache)
  ])
  const shotMap = new Map((doc?.shots ?? []).map((shot) => [shot.id, shot]))
  const out: GraphVideoItem[] = []
  for (const shotId of shotIds) {
    const shot = shotMap.get(shotId)
    const vid = cache[shotId]?.video?.trim() || shot?.media?.video?.trim() || ''
    if (!vid) continue
    out.push({
      id: `film:${shotId}`,
      relativePath: vid
    })
  }
  return out
}

function resolveNodeVideos(
  doc: GraphDocument,
  hostId: string,
  node: GraphNode,
  sourcePort: string,
  targetPort: string,
  visited: Set<string>
): GraphVideoItem[] {
  if (visited.has(node.id)) return []
  visited.add(node.id)

  // svg.anim / anim.2d 若已产出烘焙 GIF，优先返回 GIF 路径（与 executeTimelineOutputNode 严格对齐）
  const gifRel =
    (typeof node.params?.svgGifRelativePath === 'string' &&
      node.params.svgGifRelativePath.trim()) ||
    (typeof node.params?.animGifRelativePath === 'string' &&
      node.params.animGifRelativePath.trim()) ||
    ''
  if (gifRel && !isTimelineComposedItem({ relativePath: gifRel })) {
    return [{ id: node.params?.selectedImageId?.trim() || gifRel, relativePath: gifRel }]
  }

  const wantMultiple =
    targetPort === 'in-videos' ||
    targetPort === 'in-images' ||
    sourcePort === 'out-all' ||
    sourcePort === 'out-videos'
  const outputs = readNodeRunOutputs(doc, hostId, node.id)
  if (outputs) {
    const rawOut = wantMultiple
      ? (outputs[sourcePort] ?? outputs['out-videos'] ?? outputs['out-all'] ?? outputs.out)
      : (outputs[sourcePort] ??
        outputs['out-video'] ??
        outputs['out-gif'] ??
        outputs.out ??
        outputs['out-videos'] ??
        outputs['out-all'])
    if (rawOut) {
      const fromRun = flattenVideosValues([rawOut]).filter((item) => !isTimelineComposedItem(item))
      if (fromRun.length) {
        if (wantMultiple) return fromRun
        const picked = pickVideoItem(fromRun, node.params?.selectedVideoId) ?? fromRun[0]
        return picked ? [picked] : []
      }
      const fromImgRun = flattenImagesValues([rawOut]).filter(
        (item) => !isTimelineComposedItem(item)
      )
      if (fromImgRun.length) {
        if (wantMultiple) {
          return fromImgRun.map((img) => ({
            id: img.id,
            relativePath: img.relativePath,
            createdAt: img.createdAt
          }))
        }
        const picked = pickImageItem(fromImgRun, node.params?.selectedImageId) ?? fromImgRun[0]
        return picked
          ? [{ id: picked.id, relativePath: picked.relativePath, createdAt: picked.createdAt }]
          : []
      }
    }
  }

  if (node.typeId === 'media.bundle') {
    const upstream: GraphVideoItem[] = []
    for (const edge of doc.edges) {
      if (edge.target !== node.id) continue
      const upNode = doc.nodes.find((n) => n.id === edge.source)
      if (!upNode) continue
      upstream.push(
        ...resolveNodeVideos(
          doc,
          hostId,
          upNode,
          edge.sourcePort?.trim() || 'out',
          targetPort,
          visited
        )
      )
    }
    if (upstream.length) return upstream
  }

  if (node.typeId === 'video.framePull' || node.typeId === 'video.reshoot') {
    const activeRel =
      node.params?.framePullActiveVideoPath?.trim() || node.params?.previewRelativePath?.trim()
    if (activeRel && !isTimelineComposedItem({ relativePath: activeRel })) {
      return [{ id: `framepull:${activeRel}`, relativePath: activeRel }]
    }
    const upstream: GraphVideoItem[] = []
    for (const edge of doc.edges) {
      if (edge.target !== node.id) continue
      const tp = edge.targetPort?.trim() || 'in'
      if (tp !== 'in' && tp !== 'in-video') continue
      const upNode = doc.nodes.find((n) => n.id === edge.source)
      if (!upNode) continue
      upstream.push(
        ...resolveNodeVideos(doc, hostId, upNode, edge.sourcePort?.trim() || 'out', 'in', visited)
      )
    }
    if (upstream.length) return [upstream[0]!]
  }

  if (node.typeId === 'video.select') {
    const upstream: GraphVideoItem[] = []
    for (const edge of doc.edges) {
      if (edge.target !== node.id) continue
      const upNode = doc.nodes.find((n) => n.id === edge.source)
      if (!upNode) continue
      upstream.push(
        ...resolveNodeVideos(
          doc,
          hostId,
          upNode,
          edge.sourcePort?.trim() || 'out',
          'in-videos',
          visited
        )
      )
    }
    if (upstream.length) {
      const picked = pickVideoItem(upstream, node.params?.selectedVideoId) ?? upstream[0]
      if (picked) return [picked]
    }
    const previewRel = node.params?.previewRelativePath?.trim()
    if (previewRel && !isTimelineComposedItem({ relativePath: previewRel })) {
      return [{ id: node.params?.selectedVideoId?.trim() || previewRel, relativePath: previewRel }]
    }
  }

  const filmVideos = extractFilmNodeVideos(node)
  if (filmVideos.length) {
    return wantMultiple ? filmVideos : [filmVideos[0]!]
  }

  const generated = (Array.isArray(node.params?.generatedVideos) ? node.params.generatedVideos : [])
    .filter((item) => item && !isTimelineComposedItem(item))
    .filter((item) => Boolean(item.relativePath?.trim() || item.id?.trim()))
  if (generated.length) {
    if (wantMultiple) return generated
    const picked = pickVideoItem(generated, node.params?.selectedVideoId) ?? generated[0]
    return picked ? [picked] : []
  }

  const generatedImgs = (
    Array.isArray(node.params?.generatedImages) ? node.params.generatedImages : []
  )
    .filter((item) => item && !isTimelineComposedItem(item))
    .filter((item) => Boolean(item.relativePath?.trim() || item.id?.trim()))
  if (generatedImgs.length) {
    const picked = pickImageItem(generatedImgs, node.params?.selectedImageId) ?? generatedImgs[0]
    return picked
      ? [{ id: picked.id, relativePath: picked.relativePath, createdAt: picked.createdAt }]
      : []
  }

  const previewRel = node.params?.previewRelativePath?.trim()
  if (previewRel && !isTimelineComposedItem({ relativePath: previewRel })) {
    return [{ relativePath: previewRel }]
  }

  const refAssetId = node.assetId?.trim()
  if (refAssetId) {
    const project = useProjectStore()
    const asset = project.assets.find((a) => a.id === refAssetId)
    if (
      asset?.relativePath?.trim() &&
      (asset.type === 'video' ||
        asset.type === 'image' ||
        node.assetType === 'video' ||
        node.assetType === 'image' ||
        node.typeId === 'asset.video' ||
        node.typeId === 'asset.image')
    ) {
      return [{ id: asset.id, relativePath: asset.relativePath.trim() }]
    }
    if (asset?.genParams?.graphJson) {
      const innerDoc = readScriptGraph(asset.id, `asset:${asset.id}`)
      if (innerDoc) {
        const innerSources = collectFromVideoNodes(innerDoc, `asset:${asset.id}`)
        if (innerSources.length) {
          return innerSources.map((s) => ({
            id: s.assetId || s.id,
            relativePath: s.relativePath
          }))
        }
      }
    }
    if (node.assetType === 'video' || node.typeId === 'asset.video') {
      return [{ id: refAssetId }]
    }
  }

  return []
}

function resolveNodeVoices(
  doc: GraphDocument,
  hostId: string,
  node: GraphNode,
  sourcePort: string,
  targetPort: string,
  visited: Set<string>
): GraphVoiceItem[] {
  if (visited.has(node.id)) return []
  visited.add(node.id)

  const wantMultiple = targetPort === 'in-voices' || sourcePort === 'out-all'
  const outputs = readNodeRunOutputs(doc, hostId, node.id)
  if (outputs) {
    const rawOut = wantMultiple
      ? (outputs[sourcePort] ?? outputs['out-all'] ?? outputs.out)
      : (outputs[sourcePort] ?? outputs.out ?? outputs['out-all'])
    if (rawOut) {
      const fromRun = flattenVoicesValues([rawOut])
      if (fromRun.length) {
        if (wantMultiple) return fromRun
        const picked = pickVoiceItem(fromRun, node.params?.selectedVoiceId) ?? fromRun[0]
        return picked ? [picked] : []
      }
    }
  }

  if (node.typeId === 'media.bundle') {
    const upstream: GraphVoiceItem[] = []
    for (const edge of doc.edges) {
      if (edge.target !== node.id) continue
      const upNode = doc.nodes.find((n) => n.id === edge.source)
      if (!upNode) continue
      upstream.push(
        ...resolveNodeVoices(
          doc,
          hostId,
          upNode,
          edge.sourcePort?.trim() || 'out',
          targetPort,
          visited
        )
      )
    }
    if (upstream.length) return upstream
  }

  if (node.typeId === 'voice.select') {
    const upstream: GraphVoiceItem[] = []
    for (const edge of doc.edges) {
      if (edge.target !== node.id) continue
      const upNode = doc.nodes.find((n) => n.id === edge.source)
      if (!upNode) continue
      upstream.push(
        ...resolveNodeVoices(
          doc,
          hostId,
          upNode,
          edge.sourcePort?.trim() || 'out',
          'in-voices',
          visited
        )
      )
    }
    if (upstream.length) {
      const picked = pickVoiceItem(upstream, node.params?.selectedVoiceId) ?? upstream[0]
      if (picked) return [picked]
    }
    const previewRel = node.params?.previewRelativePath?.trim()
    if (previewRel) {
      return [{ id: node.params?.selectedVoiceId?.trim() || previewRel, relativePath: previewRel }]
    }
  }

  const generated = (Array.isArray(node.params?.generatedVoices) ? node.params.generatedVoices : [])
    .filter(Boolean)
    .filter((item) => Boolean(item.relativePath?.trim() || item.id?.trim()))
  if (generated.length) {
    if (wantMultiple) return generated
    const picked = pickVoiceItem(generated, node.params?.selectedVoiceId) ?? generated[0]
    return picked ? [picked] : []
  }

  const previewRel = node.params?.previewRelativePath?.trim()
  if (previewRel) {
    return [{ relativePath: previewRel }]
  }

  const refAssetId = node.assetId?.trim()
  if (refAssetId) {
    const project = useProjectStore()
    const asset = project.assets.find((a) => a.id === refAssetId)
    if (
      asset?.relativePath?.trim() &&
      (asset.type === 'voice' || node.assetType === 'voice' || isVoiceNodeType(node.typeId))
    ) {
      return [{ id: asset.id, relativePath: asset.relativePath.trim() }]
    }
    if (asset?.genParams?.graphJson) {
      const innerDoc = readScriptGraph(asset.id, `asset:${asset.id}`)
      if (innerDoc) {
        const innerSources = collectFromVoiceNodes(innerDoc, `asset:${asset.id}`)
        if (innerSources.length) {
          return innerSources.map((s) => ({
            id: s.assetId || s.id,
            relativePath: s.relativePath
          }))
        }
      }
    }
    if (node.assetType === 'voice' || isVoiceNodeType(node.typeId)) {
      return [{ id: refAssetId }]
    }
  }

  return []
}

interface ExpandedOutputEdge {
  sourceNode: GraphNode
  sourcePort: string
  targetPort: string
}

function expandOutputIncomingEdges(doc: GraphDocument, outputId: string): ExpandedOutputEdge[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const out: ExpandedOutputEdge[] = []
  const walk = (targetId: string, rootTargetPort: string | undefined, seen: Set<string>): void => {
    if (seen.has(targetId)) return
    seen.add(targetId)
    for (const edge of doc.edges) {
      if (edge.target !== targetId) continue
      const sourceNode = byId.get(edge.source)
      if (!sourceNode) continue
      const tp = rootTargetPort ?? (edge.targetPort?.trim() || 'in')
      if (sourceNode.typeId === 'media.bundle') {
        walk(sourceNode.id, tp, seen)
        continue
      }
      out.push({
        sourceNode,
        sourcePort: edge.sourcePort?.trim() || 'out',
        targetPort: tp
      })
    }
  }
  walk(outputId, undefined, new Set())
  return out
}

function findTargetOutputNode(doc: GraphDocument, timelineNodeId?: string): GraphNode | undefined {
  const preferredId = timelineNodeId?.trim()
  if (preferredId) {
    const exact = doc.nodes.find((n) => n.id === preferredId)
    if (exact) return exact
  }
  const candidates = [
    doc.nodes.find((n) => n.id === GRAPH_OUTPUT_NODE_IDS.timeline),
    ...doc.nodes.filter((n) => n.typeId === 'output.timeline'),
    doc.nodes.find((n) => n.id === GRAPH_OUTPUT_NODE_IDS.video),
    ...doc.nodes.filter((n) => n.typeId === 'output.video'),
    ...doc.nodes.filter((n) => n.category === 'output')
  ].filter((n): n is GraphNode => Boolean(n))
  const withEdges = candidates.find((n) => doc.edges.some((e) => e.target === n.id))
  return withEdges ?? candidates[0]
}

function collectFromTargetOutputNode(
  doc: GraphDocument,
  hostId: string,
  timelineNodeId?: string
): {
  videos: ScriptTimelineSource[]
  voices: ScriptTimelineSource[]
  hasIncomingEdges: boolean
  hasVideoEdges: boolean
  hasVoiceEdges: boolean
} {
  const output = findTargetOutputNode(doc, timelineNodeId)
  if (!output) {
    return {
      videos: [],
      voices: [],
      hasIncomingEdges: false,
      hasVideoEdges: false,
      hasVoiceEdges: false
    }
  }

  const incomingEdges = expandOutputIncomingEdges(doc, output.id)
  const videos: ScriptTimelineSource[] = []
  const voices: ScriptTimelineSource[] = []
  const seenVideos = new Set<string>()
  const seenVoices = new Set<string>()
  let hasVideoEdges = false
  let hasVoiceEdges = false

  for (const edge of incomingEdges) {
    const { sourceNode, sourcePort, targetPort } = edge
    if (targetPort === 'in-text') continue

    if (isVoiceEdge(sourceNode, targetPort)) {
      hasVoiceEdges = true
      const resolved = resolveNodeVoices(doc, hostId, sourceNode, sourcePort, targetPort, new Set())
      for (const [i, item] of resolved.entries()) {
        const title =
          resolved.length > 1 && sourceNode.title?.trim()
            ? `${sourceNode.title.trim()} ${i + 1}`
            : sourceNode.title
        const src = voiceItemToSource(item, voices.length, sourceNode.id, title)
        if (!src) continue
        const key = src.relativePath || src.assetId || src.id
        if (seenVoices.has(key)) continue
        seenVoices.add(key)
        voices.push(src)
      }
    } else {
      hasVideoEdges = true
      const resolved = resolveNodeVideos(doc, hostId, sourceNode, sourcePort, targetPort, new Set())
      for (const [i, item] of resolved.entries()) {
        const title =
          resolved.length > 1 && sourceNode.title?.trim()
            ? `${sourceNode.title.trim()} ${i + 1}`
            : sourceNode.title
        const src = videoItemToSource(item, videos.length, sourceNode.id, title)
        if (!src) continue
        const key = src.relativePath || src.assetId || src.id
        if (seenVideos.has(key)) continue
        seenVideos.add(key)
        videos.push(src)
      }
    }
  }

  const sortByShotNum = (list: ScriptTimelineSource[]): void => {
    const withOrder = list.map((src, idx) => {
      const shotNum = extractShotNum(src.nodeTitle || src.title)
      return {
        src,
        order: shotNum !== null ? shotNum * 1000 + idx : 100000 + idx
      }
    })
    withOrder.sort((a, b) => a.order - b.order)
    list.splice(0, list.length, ...withOrder.map((x) => x.src))
  }
  if (videos.some((s) => extractShotNum(s.nodeTitle || s.title) !== null)) {
    sortByShotNum(videos)
  }
  if (voices.some((s) => extractShotNum(s.nodeTitle || s.title) !== null)) {
    sortByShotNum(voices)
  }

  if (!videos.length) {
    const runOut = readNodeRunOutputs(doc, hostId, output.id)?.out
    const fromRun = runOut
      ? flattenVideosValues([runOut]).filter((item) => !isTimelineComposedItem(item))
      : []
    for (const [i, item] of fromRun.entries()) {
      const src = videoItemToSource(item, i)
      if (!src) continue
      const key = src.relativePath || src.assetId || src.id
      if (seenVideos.has(key)) continue
      seenVideos.add(key)
      videos.push(src)
    }
  }

  if (!voices.length && Array.isArray(output.params?.generatedVoices)) {
    for (const [i, item] of output.params.generatedVoices.entries()) {
      if (!item) continue
      const src = voiceItemToSource(item, i)
      if (!src) continue
      const key = src.relativePath || src.assetId || src.id
      if (seenVoices.has(key)) continue
      seenVoices.add(key)
      voices.push(src)
    }
  }

  return {
    videos,
    voices,
    hasIncomingEdges: incomingEdges.length > 0,
    hasVideoEdges,
    hasVoiceEdges
  }
}

/** 回退：扫描宿主图中所有非输出视频节点的视频产物（agent 流水线 36 条动态视频或引用资产） */
function collectFromVideoNodes(doc: GraphDocument, hostId: string): ScriptTimelineSource[] {
  const sources: ScriptTimelineSource[] = []
  const seen = new Set<string>()
  const push = (
    relativePath: string | undefined,
    assetId: string | undefined,
    title?: string,
    nodeId?: string,
    nodeTitle?: string
  ): void => {
    if (isTimelineComposedItem({ id: assetId, relativePath })) return
    const src = videoItemToSource(
      { id: assetId, relativePath, createdAt: undefined },
      sources.length,
      nodeId,
      nodeTitle
    )
    if (!src) return
    const key = src.relativePath || src.assetId || src.id
    if (!key || seen.has(key)) return
    seen.add(key)
    if (title) src.title = title
    sources.push(src)
  }
  for (const node of doc.nodes) {
    if (isOutputNode(node)) continue
    const isVideoCandidate =
      node.typeId === 'asset.video' ||
      node.assetType === 'video' ||
      node.typeId === 'film.workbench' ||
      node.typeId === 'film.render' ||
      Array.isArray(node.params?.generatedVideos)
    if (!isVideoCandidate) continue

    const title = node.title?.trim()
    const params = node.params ?? {}
    const runOut =
      readNodeRunOutputs(doc, hostId, node.id)?.['out-videos'] ??
      readNodeRunOutputs(doc, hostId, node.id)?.out
    if (runOut) {
      const videos = flattenVideosValues([runOut])
      for (const item of videos) push(item.relativePath, item.id, title, node.id, node.title)
    }
    for (const item of extractFilmNodeVideos(node)) {
      push(item.relativePath, item.id, title, node.id, node.title)
    }
    for (const item of Array.isArray(params.generatedVideos) ? params.generatedVideos : []) {
      push(item?.relativePath, item?.id, title, node.id, node.title)
    }
    const rel = params.previewRelativePath?.trim()
    if (rel) push(rel, undefined, title, node.id, node.title)
    if (node.assetId?.trim() && (node.assetType === 'video' || node.typeId === 'asset.video')) {
      push(undefined, node.assetId.trim(), title, node.id, node.title)
    }
  }
  return sources
}

function collectFromVoiceNodes(doc: GraphDocument, hostId: string): ScriptTimelineSource[] {
  const sources: ScriptTimelineSource[] = []
  const seen = new Set<string>()
  const push = (
    relativePath: string | undefined,
    assetId: string | undefined,
    title?: string,
    nodeId?: string,
    nodeTitle?: string
  ): void => {
    const src = voiceItemToSource(
      { id: assetId, relativePath, createdAt: undefined },
      sources.length,
      nodeId,
      nodeTitle
    )
    if (!src) return
    const key = src.relativePath || src.assetId || src.id
    if (!key || seen.has(key)) return
    seen.add(key)
    if (title) src.title = title
    sources.push(src)
  }
  for (const node of doc.nodes) {
    if (isOutputNode(node)) continue
    const isVoiceCandidate =
      isVoiceNodeType(node.typeId) ||
      node.assetType === 'voice' ||
      Array.isArray(node.params?.generatedVoices)
    if (!isVoiceCandidate) continue

    const title = node.title?.trim()
    const params = node.params ?? {}
    const runOut = readNodeRunOutputs(doc, hostId, node.id)?.out
    if (runOut) {
      const voices = flattenVoicesValues([runOut])
      for (const item of voices) push(item.relativePath, item.id, title, node.id, node.title)
    }
    for (const item of Array.isArray(params.generatedVoices) ? params.generatedVoices : []) {
      push(item?.relativePath, item?.id, title, node.id, node.title)
    }
    const rel = params.previewRelativePath?.trim()
    if (rel) push(rel, undefined, title, node.id, node.title)
    if (node.assetId?.trim() && (node.assetType === 'voice' || isVoiceNodeType(node.typeId))) {
      push(undefined, node.assetId.trim(), title, node.id, node.title)
    }
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
  timelineNodeId?: string
}): Promise<ScriptTimelineSource[]> {
  const hostId = input.hostId?.trim() || `asset:${input.scriptAssetId}`
  const doc = readScriptGraph(input.scriptAssetId, hostId)
  if (!doc) return []

  const fromTarget = collectFromTargetOutputNode(doc, hostId, input.timelineNodeId)
  if (fromTarget.videos.length || fromTarget.voices.length) {
    return asInputSources([...fromTarget.videos, ...fromTarget.voices])
  }

  const videoFallback = collectFromVideoNodes(doc, hostId)
  const voiceFallback = collectFromVoiceNodes(doc, hostId)
  if (videoFallback.length || voiceFallback.length) {
    return asInputSources([...videoFallback, ...voiceFallback])
  }
  return []
}
