import type { AssetInfo } from '../domain'
import { ensureBuiltinNodeTypes } from './builtinState'
import { createAssetGraphNode, createNodeFromType } from './create'
import type { GraphDocument, GraphEdge } from './types'
import { GRAPH_OUTPUT_NODE_IDS } from './types'

export interface SeriesStarterAssets {
  screenplay: Pick<AssetInfo, 'id' | 'name' | 'type'>
  world: Pick<AssetInfo, 'id' | 'name' | 'type'>
  narrative: Pick<AssetInfo, 'id' | 'name' | 'type'>
  script: Pick<AssetInfo, 'id' | 'name' | 'type'>
}

function ensureGraphEdge(
  edges: GraphEdge[],
  sourceId: string,
  targetId: string,
  sourcePort: string,
  targetPort: string
): void {
  const linked = edges.some(
    (edge) =>
      edge.source === sourceId &&
      edge.target === targetId &&
      (edge.sourcePort ?? 'out') === sourcePort &&
      (edge.targetPort ?? 'in') === targetPort
  )
  if (linked) return
  edges.push({
    id: `edge-${crypto.randomUUID()}`,
    source: sourceId,
    target: targetId,
    sourcePort,
    targetPort
  })
}

/** 剧集画布起步图：剧本 → 世界/叙事（实体入叙事）→ 分镜 → 成片时间线 */
export function buildSeriesStarterGraph(assets: SeriesStarterAssets): GraphDocument {
  ensureBuiltinNodeTypes()
  const screenplay = createAssetGraphNode(
    assets.screenplay.id,
    'screenplay',
    assets.screenplay.name,
    { x: 80, y: 220 },
    { assetHost: true }
  )
  const narrative = createAssetGraphNode(
    assets.narrative.id,
    'narrative',
    assets.narrative.name,
    { x: 420, y: 80 },
    { assetHost: true }
  )
  const world = createAssetGraphNode(assets.world.id, 'world', assets.world.name, {
    x: 420,
    y: 360
  }, { assetHost: true })
  const script = createAssetGraphNode(assets.script.id, 'script', assets.script.name, {
    x: 760,
    y: 220
  }, { assetHost: true })
  const timeline = createNodeFromType(
    'output.timeline',
    { x: 1100, y: 220 },
    { id: GRAPH_OUTPUT_NODE_IDS.timeline }
  )

  const edges: GraphEdge[] = []
  ensureGraphEdge(edges, screenplay.id, narrative.id, 'out', 'in')
  ensureGraphEdge(edges, screenplay.id, world.id, 'out', 'in')
  ensureGraphEdge(edges, world.id, script.id, 'out', 'in-worldEntities')
  ensureGraphEdge(edges, narrative.id, script.id, 'out', 'in-narrative')
  ensureGraphEdge(edges, script.id, timeline.id, 'out', 'in')

  return {
    nodes: [screenplay, narrative, world, script, timeline],
    edges,
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}
