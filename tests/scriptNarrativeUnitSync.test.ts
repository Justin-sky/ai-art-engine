import { describe, expect, it } from 'vitest'
import {
  createDefaultScopedGraph,
  syncScriptNarrativeUnitChains,
  type NarrativeUnitRow
} from '../src/shared/graph'
import {
  GRAPH_SCRIPT_SHOT_SPLIT_NODE_ID,
  GRAPH_SCRIPT_SHOT_TABLE_NODE_ID
} from '../src/shared/graph/types'

function unit(id: string, order: number, title: string): NarrativeUnitRow {
  return {
    id,
    title,
    order,
    summary: `${title} summary`,
    dramaticFunction: '',
    characters: [],
    scenes: [],
    props: [],
    weapons: [],
    sourceExcerpt: '',
    emotionalBeat: '',
    durationHint: '',
    status: '未审核'
  }
}

describe('syncScriptNarrativeUnitChains', () => {
  it('keeps empty default chain and strips narrative input slots', () => {
    const base = createDefaultScopedGraph('scriptAsset', 'script')
    base.nodes.push({
      id: 'graph-input-in-narrative-0',
      typeId: 'graph.input.slot',
      category: 'note',
      position: { x: 0, y: 0 },
      params: {
        hostInputSlot: { portId: 'in-narrative', index: 0, dataType: 'narrative' }
      }
    })
    const doc = syncScriptNarrativeUnitChains(base, [])
    expect(doc.nodes.some((n) => n.id === GRAPH_SCRIPT_SHOT_SPLIT_NODE_ID)).toBe(true)
    expect(doc.nodes.some((n) => n.id === GRAPH_SCRIPT_SHOT_TABLE_NODE_ID)).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'narrative.unitRef')).toBe(false)
    expect(
      doc.nodes.some(
        (n) =>
          n.typeId === 'graph.input.slot' &&
          (n.params.hostInputSlot as { portId?: string } | undefined)?.portId === 'in-narrative'
      )
    ).toBe(false)
  })

  it('materializes one full pipeline per narrative unit', () => {
    const units = [unit('u1', 1, '开场'), unit('u2', 2, '冲突')]
    const doc = syncScriptNarrativeUnitChains(null, units)
    expect(doc.nodes.filter((n) => n.typeId === 'narrative.unitRef')).toHaveLength(2)
    expect(doc.nodes.filter((n) => n.typeId === 'script.shotSplit')).toHaveLength(2)
    expect(doc.nodes.filter((n) => n.typeId === 'script.shotTable')).toHaveLength(2)
    expect(doc.nodes.filter((n) => n.typeId === 'script.shotImageGen')).toHaveLength(2)
    expect(doc.nodes.filter((n) => n.typeId === 'script.shotVideoGen')).toHaveLength(2)
    expect(doc.nodes.filter((n) => n.typeId === 'output.video')).toHaveLength(2)
    expect(doc.nodes.some((n) => n.id === GRAPH_SCRIPT_SHOT_SPLIT_NODE_ID)).toBe(false)

    for (const u of units) {
      const ref = doc.nodes.find(
        (n) => n.typeId === 'narrative.unitRef' && n.params.boundUnitId === u.id
      )
      const split = doc.nodes.find(
        (n) => n.typeId === 'script.shotSplit' && n.params.boundUnitId === u.id
      )
      const table = doc.nodes.find(
        (n) => n.typeId === 'script.shotTable' && n.params.boundUnitId === u.id
      )
      const image = doc.nodes.find(
        (n) => n.typeId === 'script.shotImageGen' && n.params.boundUnitId === u.id
      )
      const video = doc.nodes.find(
        (n) => n.typeId === 'script.shotVideoGen' && n.params.boundUnitId === u.id
      )
      const out = doc.nodes.find(
        (n) => n.typeId === 'output.video' && n.params.boundUnitId === u.id
      )
      expect(ref && split && table && image && video && out).toBeTruthy()
      expect(
        doc.edges.some((e) => e.source === ref!.id && e.target === split!.id)
      ).toBe(true)
      expect(
        doc.edges.some((e) => e.source === split!.id && e.target === table!.id)
      ).toBe(true)
      expect(
        doc.edges.some(
          (e) => e.source === table!.id && e.target === video!.id && e.targetPort === 'in-text'
        )
      ).toBe(true)
      expect(
        doc.edges.some(
          (e) =>
            e.source === image!.id && e.target === video!.id && e.targetPort === 'in-entities'
        )
      ).toBe(true)
      expect(doc.edges.some((e) => e.source === video!.id && e.target === out!.id)).toBe(true)
    }
  })

  it('removes chains for deleted units', () => {
    const first = syncScriptNarrativeUnitChains(null, [
      unit('u1', 1, 'A'),
      unit('u2', 2, 'B')
    ])
    const next = syncScriptNarrativeUnitChains(first, [unit('u1', 1, 'A')])
    expect(next.nodes.filter((n) => n.params.boundUnitId === 'u2')).toHaveLength(0)
    expect(next.nodes.filter((n) => n.params.boundUnitId === 'u1')).toHaveLength(6)
  })
})
