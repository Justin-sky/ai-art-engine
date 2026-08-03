import { describe, expect, it } from 'vitest'
import {
  collectTextFromBeatGraph,
  createDefaultScopedGraph,
  createBeatRefNode,
  ensureBuiltinNodeTypes,
  formatBeatRefText,
  isNodeAddableInScope,
  normalizeScopedGraph,
  readBoundBeatIdFromNodeParams,
  withBeatGraph,
  readBeatGraphFromGenParams,
  type BeatRow
} from '../src/shared/graph'

describe('beatUnit scope', () => {
  it('default graph contains unitGen without classic output', () => {
    ensureBuiltinNodeTypes()
    const doc = createDefaultScopedGraph('beatUnit')
    const types = doc.nodes.map((n) => n.typeId).sort()
    expect(types).toEqual(['beat.unitGen'])
    expect(doc.edges).toHaveLength(0)
  })

  it('empty graph normalize fills default generator', () => {
    ensureBuiltinNodeTypes()
    const doc = normalizeScopedGraph('beatUnit', {
      nodes: [],
      edges: [],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    expect(doc.nodes.some((n) => n.typeId === 'beat.unitGen')).toBe(true)
    expect(doc.nodes.some((n) => n.category === 'output')).toBe(false)
  })

  it('allows unit nodes but rejects every output in beatUnit scope', () => {
    expect(isNodeAddableInScope('beatUnit', 'beat.unitGen')).toBe(true)
    expect(isNodeAddableInScope('beatUnit', 'beat.unitRef')).toBe(true)
    expect(isNodeAddableInScope('beatUnit', 'output.beatUnit')).toBe(false)
    expect(isNodeAddableInScope('beatUnit', 'output.text')).toBe(false)
    expect(isNodeAddableInScope('beatUnit', 'output.beat')).toBe(false)
  })

  it('persists unit graphs by id without touching other keys', () => {
    const next = withBeatGraph({ beatCatalog: [] }, 'u1', {
      nodes: [],
      edges: [],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    expect(next.beatCatalog).toEqual([])
    expect(readBeatGraphFromGenParams(next, 'u1')).toBeTruthy()
  })

  it('creates unitRef with boundBeatId', () => {
    ensureBuiltinNodeTypes()
    const unit: BeatRow = {
      id: 'beat-1',
      title: '开场',
      order: 1,
      time: '雨夜',
      durationHint: '短',
      location: '巷口',
      locations: [{ name: '巷口' }],
      characters: [{ name: '林晓' }],
      action: '撑伞走进巷口',
      conflict: '',
      atmosphere: '雨声',
      props: [],
      weapons: [],
      sourceExcerpt: '撑伞走进巷口',
      status: '未审核'
    }
    const node = createBeatRefNode(unit, { x: 10, y: 20 })
    expect(node.typeId).toBe('beat.unitRef')
    expect(readBoundBeatIdFromNodeParams(node.params)).toBe('beat-1')
    expect(formatBeatRefText(unit)).toContain('开场')
  })

  it('collects resultText from beatUnit generator', () => {
    ensureBuiltinNodeTypes()
    const doc = createDefaultScopedGraph('beatUnit')
    const gen = doc.nodes.find((n) => n.typeId === 'beat.unitGen')
    expect(gen).toBeTruthy()
    if (!gen) return
    gen.params = { ...gen.params, resultText: '细化后的单元正文' }
    const item = collectTextFromBeatGraph(doc)
    expect(item?.text).toBe('细化后的单元正文')
  })

  it('falls back to unitGen params.text when output empty', () => {
    ensureBuiltinNodeTypes()
    const doc = createDefaultScopedGraph('beatUnit')
    const gen = doc.nodes.find((n) => n.typeId === 'beat.unitGen')
    expect(gen).toBeTruthy()
    if (!gen) return
    gen.params = { ...gen.params, text: '生成节点暂存正文' }
    const item = collectTextFromBeatGraph(doc)
    expect(item?.text).toBe('生成节点暂存正文')
  })
})
