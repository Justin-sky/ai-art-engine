import type { AssetInfo } from '../domain'
import { createAssetGraphNode } from './create'
import type { GraphDocument, GraphEdge } from './types'

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

/** 剧集画布起步图：剧本 → 叙事/世界 → 分镜 */
export function buildSeriesStarterGraph(assets: SeriesStarterAssets): GraphDocument {
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

  const edges: GraphEdge[] = []
  ensureGraphEdge(edges, screenplay.id, narrative.id, 'out', 'in')
  ensureGraphEdge(edges, screenplay.id, world.id, 'out', 'in')
  ensureGraphEdge(edges, narrative.id, script.id, 'out', 'in-text')
  ensureGraphEdge(edges, world.id, script.id, 'out', 'in-image')

  return {
    nodes: [screenplay, narrative, world, script],
    edges,
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}
