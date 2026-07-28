import { describe, expect, it } from 'vitest'
import { syncWorldElementKindGraph } from '../src/shared/graph'

describe('syncWorldElementKindGraph', () => {
  it('creates script → image gen chain per catalog item without outputs', () => {
    const doc = syncWorldElementKindGraph(null, [
      { id: 'c1', name: 'Hero', prompt: 'a hero', status: 'draft' },
      { id: 'c2', name: 'Villain', prompt: 'a villain', status: 'draft' }
    ])

    const scripts = doc.nodes.filter((node) => node.typeId === 'play.script')
    const gens = doc.nodes.filter((node) => node.typeId === 'asset.image')
    expect(scripts).toHaveLength(2)
    expect(gens).toHaveLength(2)
    expect(doc.nodes.some((node) => node.category === 'output')).toBe(false)

    for (const itemId of ['c1', 'c2']) {
      const script = scripts.find((node) => node.params.worldElementId === itemId)!
      const gen = gens.find((node) => node.params.worldElementId === itemId)!
      expect(gen.params.generateInstruction).toBe('')
      expect(script.params.text).toBe(itemId === 'c1' ? 'a hero' : 'a villain')
      expect(
        doc.edges.some(
          (edge) =>
            edge.source === script.id &&
            edge.target === gen.id &&
            (edge.sourcePort ?? 'out') === 'out' &&
            (edge.targetPort ?? 'in') === 'in-text'
        )
      ).toBe(true)
      expect(doc.edges.some((edge) => edge.source === gen.id)).toBe(false)
    }
  })

  it('removes managed script and gen when catalog item disappears', () => {
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
    expect(next.nodes.some((n) => n.category === 'output')).toBe(false)
  })
})
