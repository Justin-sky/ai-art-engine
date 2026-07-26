import { describe, expect, it } from 'vitest'
import {
  buildSeriesStarterGraph,
  canConnectNodes,
  getNodePorts
} from '../src/shared/graph'

const IDS = {
  screenplay: '00000000-0000-4000-8000-000000000101',
  world: '00000000-0000-4000-8000-000000000102',
  narrative: '00000000-0000-4000-8000-000000000103',
  script: '00000000-0000-4000-8000-000000000104'
} as const

describe('buildSeriesStarterGraph', () => {
  it('places four host nodes and wires screenplay → narrative/world → script', () => {
    const graph = buildSeriesStarterGraph({
      screenplay: { id: IDS.screenplay, name: 'Screenplay', type: 'screenplay' },
      world: { id: IDS.world, name: 'World', type: 'world' },
      narrative: { id: IDS.narrative, name: 'Narrative', type: 'narrative' },
      script: { id: IDS.script, name: 'Shot', type: 'script' }
    })

    expect(graph.nodes).toHaveLength(4)
    expect(graph.edges).toHaveLength(4)

    const byAsset = Object.fromEntries(graph.nodes.map((n) => [n.assetId, n]))
    const screenplay = byAsset[IDS.screenplay]!
    const narrative = byAsset[IDS.narrative]!
    const world = byAsset[IDS.world]!
    const script = byAsset[IDS.script]!

    expect(canConnectNodes(screenplay, narrative, { targetPort: 'in' })).toBe(true)
    expect(canConnectNodes(screenplay, world, { targetPort: 'in' })).toBe(true)
    expect(canConnectNodes(narrative, script, { targetPort: 'in-text' })).toBe(true)
    expect(canConnectNodes(world, script, { targetPort: 'in-image' })).toBe(true)

    const edgeKeys = graph.edges
      .map((e) => `${e.source}->${e.target}:${e.sourcePort ?? 'out'}->${e.targetPort ?? 'in'}`)
      .sort()
    expect(edgeKeys).toEqual(
      [
        `${narrative.id}->${script.id}:out->in-text`,
        `${screenplay.id}->${narrative.id}:out->in`,
        `${screenplay.id}->${world.id}:out->in`,
        `${world.id}->${script.id}:out->in-image`
      ].sort()
    )
  })

  it('keeps host input ports on starter nodes', () => {
    const graph = buildSeriesStarterGraph({
      screenplay: { id: IDS.screenplay, name: 'Screenplay', type: 'screenplay' },
      world: { id: IDS.world, name: 'World', type: 'world' },
      narrative: { id: IDS.narrative, name: 'Narrative', type: 'narrative' },
      script: { id: IDS.script, name: 'Shot', type: 'script' }
    })
    const script = graph.nodes.find((n) => n.assetId === IDS.script)!
    expect(getNodePorts(script).some((p) => p.id === 'in-text')).toBe(true)
    expect(getNodePorts(script).some((p) => p.id === 'in-image')).toBe(true)
    expect(graph.nodes.every((n) => n.params.assetHost === true)).toBe(true)
  })
})
