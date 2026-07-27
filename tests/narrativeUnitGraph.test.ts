import { describe, expect, it } from 'vitest'
import {
  collectTextFromNarrativeUnitGraph,
  createDefaultScopedGraph,
  createNarrativeUnitRefNode,
  ensureBuiltinNodeTypes,
  formatNarrativeUnitRefText,
  isNodeAddableInScope,
  normalizeScopedGraph,
  readBoundUnitIdFromNodeParams,
  withNarrativeUnitGraph,
  readNarrativeUnitGraphFromGenParams,
  type NarrativeUnitRow
} from '../src/shared/graph'

describe('narrativeUnit scope', () => {
  it('default graph is unitGen → narrativeUnit output', () => {
    ensureBuiltinNodeTypes()
    const doc = createDefaultScopedGraph('narrativeUnit')
    const types = doc.nodes.map((n) => n.typeId).sort()
    expect(types).toEqual(['narrative.unitGen', 'output.narrativeUnit'])
    expect(doc.edges).toHaveLength(1)
    expect(doc.edges[0].sourcePort).toBe('out')
    expect(doc.edges[0].targetPort).toBe('in')
  })

  it('empty graph normalize fills default chain', () => {
    ensureBuiltinNodeTypes()
    const doc = normalizeScopedGraph('narrativeUnit', {
      nodes: [],
      edges: [],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    expect(doc.nodes.some((n) => n.typeId === 'narrative.unitGen')).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'output.narrativeUnit')).toBe(true)
  })

  it('allows unitGen / unitRef / narrativeUnit output in narrativeUnit scope', () => {
    expect(isNodeAddableInScope('narrativeUnit', 'narrative.unitGen')).toBe(true)
    expect(isNodeAddableInScope('narrativeUnit', 'narrative.unitRef')).toBe(true)
    expect(isNodeAddableInScope('narrativeUnit', 'output.narrativeUnit')).toBe(true)
    expect(isNodeAddableInScope('narrativeUnit', 'output.text')).toBe(false)
    expect(isNodeAddableInScope('narrativeUnit', 'output.narrative')).toBe(false)
  })

  it('persists unit graphs by id without touching other keys', () => {
    const next = withNarrativeUnitGraph({ narrativeCatalog: [] }, 'u1', {
      nodes: [],
      edges: [],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    expect(next.narrativeCatalog).toEqual([])
    expect(readNarrativeUnitGraphFromGenParams(next, 'u1')).toBeTruthy()
  })

  it('creates unitRef with boundUnitId', () => {
    ensureBuiltinNodeTypes()
    const unit: NarrativeUnitRow = {
      id: 'nu-1',
      title: '开场',
      order: 1,
      summary: '雨夜',
      dramaticFunction: '建置',
      characters: [{ name: '林晓' }],
      scenes: [{ name: '巷口' }],
      props: [],
      weapons: [],
      sourceExcerpt: '撑伞走进巷口',
      emotionalBeat: '不安',
      durationHint: '短',
      status: '未审核'
    }
    const node = createNarrativeUnitRefNode(unit, { x: 10, y: 20 })
    expect(node.typeId).toBe('narrative.unitRef')
    expect(readBoundUnitIdFromNodeParams(node.params)).toBe('nu-1')
    expect(formatNarrativeUnitRefText(unit)).toContain('开场')
  })

  it('collects text from narrativeUnit output resultText', () => {
    ensureBuiltinNodeTypes()
    const doc = createDefaultScopedGraph('narrativeUnit')
    const output = doc.nodes.find((n) => n.typeId === 'output.narrativeUnit')
    expect(output).toBeTruthy()
    if (!output) return
    output.params = { ...output.params, resultText: '细化后的单元正文' }
    const item = collectTextFromNarrativeUnitGraph(doc)
    expect(item?.text).toBe('细化后的单元正文')
  })

  it('falls back to unitGen params.text when output empty', () => {
    ensureBuiltinNodeTypes()
    const doc = createDefaultScopedGraph('narrativeUnit')
    const gen = doc.nodes.find((n) => n.typeId === 'narrative.unitGen')
    expect(gen).toBeTruthy()
    if (!gen) return
    gen.params = { ...gen.params, text: '生成节点暂存正文' }
    const item = collectTextFromNarrativeUnitGraph(doc)
    expect(item?.text).toBe('生成节点暂存正文')
  })
})
