import { describe, expect, it } from 'vitest'
import {
  collectDownstreamNodeIds,
  collectUpstreamNodeIds,
  createNodeFromType,
  type GraphDocument
} from '@shared/graph'

function buildDoc(edges: Array<[string, string]>): GraphDocument {
  const ids = [...new Set(edges.flat())]
  const byId = new Map(
    ids.map((id, i) => [id, createNodeFromType('note.text', { x: i * 40, y: 0 })])
  )
  for (const id of ids) {
    const node = byId.get(id)!
    node.id = id
  }
  return {
    nodes: [...byId.values()],
    edges: edges.map(([source, target], i) => ({
      id: `e${i}`,
      source,
      target
    })),
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

describe('graph downstream collection', () => {
  it('collects transitive downstream nodes including the source', () => {
    const graph = buildDoc([
      ['a', 'b'],
      ['b', 'c'],
      ['b', 'd'],
      ['d', 'e']
    ])
    expect([...collectDownstreamNodeIds(graph, 'a')].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect([...collectDownstreamNodeIds(graph, 'b')].sort()).toEqual(['b', 'c', 'd', 'e'])
    expect([...collectDownstreamNodeIds(graph, 'e')].sort()).toEqual(['e'])
  })

  it('handles branches and cycles safely', () => {
    const graph = buildDoc([
      ['a', 'b'],
      ['a', 'c'],
      ['c', 'b'],
      ['b', 'a']
    ])
    expect([...collectDownstreamNodeIds(graph, 'a')].sort()).toEqual(['a', 'b', 'c'])
  })

  it('mirrors upstream collection on the same chain', () => {
    const graph = buildDoc([
      ['a', 'b'],
      ['b', 'c']
    ])
    expect([...collectUpstreamNodeIds(graph, 'c')].sort()).toEqual(['a', 'b', 'c'])
    expect([...collectDownstreamNodeIds(graph, 'a')].sort()).toEqual(['a', 'b', 'c'])
  })
})
