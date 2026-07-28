import { describe, expect, it } from 'vitest'
import {
  boundaryOutputNodeId,
  isBoundaryInputNode,
  isBoundaryOutputNode,
  syncWorldElementKindGraph,
  worldElementBoundaryPortId
} from '../src/shared/graph'

describe('syncWorldElementKindGraph', () => {
  it('creates script → image gen → boundary.output chain per catalog item', () => {
    const doc = syncWorldElementKindGraph(null, [
      { id: 'c1', name: 'Hero', prompt: 'a hero', status: 'draft' },
      { id: 'c2', name: 'Villain', prompt: 'a villain', status: 'draft' }
    ])

    const scripts = doc.nodes.filter((node) => node.typeId === 'play.script')
    const gens = doc.nodes.filter((node) => node.typeId === 'asset.image')
    const boundaries = doc.nodes.filter((node) => isBoundaryOutputNode(node))
    expect(scripts).toHaveLength(2)
    expect(gens).toHaveLength(2)
    expect(boundaries).toHaveLength(2)
    expect(doc.nodes.some((node) => isBoundaryInputNode(node))).toBe(false)
    expect(doc.nodes.some((node) => node.category === 'output')).toBe(false)

    for (const itemId of ['c1', 'c2']) {
      const script = scripts.find((node) => node.params.worldElementId === itemId)!
      const gen = gens.find((node) => node.params.worldElementId === itemId)!
      const boundaryId = boundaryOutputNodeId(worldElementBoundaryPortId(itemId))
      const boundary = boundaries.find((node) => node.id === boundaryId)!
      expect(gen.params.generateInstruction).toBe('')
      expect(script.params.text).toBe(itemId === 'c1' ? 'a hero' : 'a villain')
      expect(boundary.params.worldElementId).toBe(itemId)
      expect(boundary.params.hostBoundaryPort).toEqual({
        portId: worldElementBoundaryPortId(itemId),
        dataType: 'image',
        multiple: false
      })
      expect(
        doc.edges.some(
          (edge) =>
            edge.source === script.id &&
            edge.target === gen.id &&
            (edge.sourcePort ?? 'out') === 'out' &&
            (edge.targetPort ?? 'in') === 'in-text'
        )
      ).toBe(true)
      expect(
        doc.edges.some(
          (edge) =>
            edge.source === gen.id &&
            edge.target === boundary.id &&
            (edge.sourcePort ?? 'out') === 'out' &&
            (edge.targetPort ?? 'in') === 'in'
        )
      ).toBe(true)
    }
  })

  it('removes managed script, gen and boundary when catalog item disappears', () => {
    const first = syncWorldElementKindGraph(null, [
      { id: 'c1', name: 'Hero', prompt: 'a', status: 'draft' },
      { id: 'c2', name: 'Extra', prompt: 'b', status: 'draft' }
    ])
    const next = syncWorldElementKindGraph(first, [
      { id: 'c1', name: 'Hero', prompt: 'a', status: 'draft' }
    ])
    const ids = [
      ...new Set(next.nodes.map((node) => node.params.worldElementId).filter(Boolean))
    ]
    expect(ids).toEqual(['c1'])
    expect(next.nodes.filter((n) => n.typeId === 'play.script')).toHaveLength(1)
    expect(next.nodes.filter((n) => n.typeId === 'asset.image')).toHaveLength(1)
    expect(next.nodes.filter((n) => isBoundaryOutputNode(n))).toHaveLength(1)
    expect(next.nodes.some((n) => isBoundaryInputNode(n))).toBe(false)
    expect(next.nodes.some((n) => n.category === 'output')).toBe(false)
  })
})
