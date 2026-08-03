import { describe, expect, it } from 'vitest'
import {
  buildSeriesStarterGraph,
  canConnectNodes,
  getNodePorts
} from '../src/shared/graph'
import { GRAPH_OUTPUT_NODE_IDS } from '../src/shared/graph/types'

const IDS = {
  screenplay: '00000000-0000-4000-8000-000000000101',
  world: '00000000-0000-4000-8000-000000000102',
  beat: '00000000-0000-4000-8000-000000000103',
  script: '00000000-0000-4000-8000-000000000104'
} as const

describe('buildSeriesStarterGraph', () => {
  it('places host nodes and wires screenplay → beat/world → select → script → timeline', () => {
    const graph = buildSeriesStarterGraph({
      screenplay: { id: IDS.screenplay, name: 'Screenplay', type: 'screenplay' },
      world: { id: IDS.world, name: 'World', type: 'world' },
      beat: { id: IDS.beat, name: 'Beat', type: 'beat' },
      script: { id: IDS.script, name: 'Shot', type: 'script' }
    })

    expect(graph.nodes).toHaveLength(6)
    expect(graph.edges).toHaveLength(6)

    const byAsset = Object.fromEntries(
      graph.nodes.filter((n) => n.assetId).map((n) => [n.assetId, n])
    )
    const screenplay = byAsset[IDS.screenplay]!
    const beat = byAsset[IDS.beat]!
    const world = byAsset[IDS.world]!
    const script = byAsset[IDS.script]!
    const select = graph.nodes.find((n) => n.typeId === 'beat.select')!
    const timeline = graph.nodes.find((n) => n.id === GRAPH_OUTPUT_NODE_IDS.timeline)

    expect(timeline?.typeId).toBe('output.timeline')
    expect(select).toBeTruthy()
    expect(canConnectNodes(screenplay, beat, { targetPort: 'in' })).toBe(true)
    expect(canConnectNodes(screenplay, world, { targetPort: 'in' })).toBe(true)
    expect(
      canConnectNodes(world, script, { targetPort: 'in-worldEntities' })
    ).toBe(true)
    expect(canConnectNodes(beat, select, { targetPort: 'in' })).toBe(true)
    expect(
      canConnectNodes(select, script, { targetPort: 'in-beat' })
    ).toBe(true)
    expect(canConnectNodes(script, timeline!, { targetPort: 'in' })).toBe(true)

    const edgeKeys = graph.edges
      .map((e) => `${e.source}->${e.target}:${e.sourcePort ?? 'out'}->${e.targetPort ?? 'in'}`)
      .sort()
    expect(edgeKeys).toEqual(
      [
        `${beat.id}->${select.id}:out->in`,
        `${select.id}->${script.id}:out->in-beat`,
        `${screenplay.id}->${beat.id}:out->in`,
        `${screenplay.id}->${world.id}:out->in`,
        `${script.id}->${timeline!.id}:out->in`,
        `${world.id}->${script.id}:out->in-worldEntities`
      ].sort()
    )
  })

  it('keeps host input ports on starter nodes and script video out', () => {
    const graph = buildSeriesStarterGraph({
      screenplay: { id: IDS.screenplay, name: 'Screenplay', type: 'screenplay' },
      world: { id: IDS.world, name: 'World', type: 'world' },
      beat: { id: IDS.beat, name: 'Beat', type: 'beat' },
      script: { id: IDS.script, name: 'Shot', type: 'script' }
    })
    const script = graph.nodes.find((n) => n.assetId === IDS.script)!
    const world = graph.nodes.find((n) => n.assetId === IDS.world)!
    const beat = graph.nodes.find((n) => n.assetId === IDS.beat)!
    expect(getNodePorts(script).some((p) => p.id === 'in-beat')).toBe(true)
    expect(getNodePorts(script).some((p) => p.id === 'in-image')).toBe(false)
    expect(getNodePorts(script).find((p) => p.id === 'out')?.dataType).toBe('videoEntities')
    expect(getNodePorts(world).find((p) => p.id === 'out')?.dataType).toBe('worldEntities')
    expect(getNodePorts(beat).some((p) => p.id === 'in-worldEntities')).toBe(false)
    expect(getNodePorts(beat).find((p) => p.id === 'out')?.dataType).toBe('beat')
    expect(getNodePorts(script).some((p) => p.id === 'in-worldEntities')).toBe(true)
    const timeline = graph.nodes.find((n) => n.typeId === 'output.timeline')!
    expect(getNodePorts(timeline).find((p) => p.id === 'in')?.dataType).toBe('videoEntities')
    expect(graph.nodes.filter((n) => n.assetId).every((n) => n.params.assetHost === true)).toBe(
      true
    )
  })
})
