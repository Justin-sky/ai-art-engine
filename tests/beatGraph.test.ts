import { describe, expect, it } from 'vitest'
import {
  isNodeAddableInScope,
  listAddableNodeTypes,
  readBeatGraphFromGenParams,
  withBeatGraph
} from '../src/shared/graph'

describe('beatUnit scope', () => {
  it('offers no beat.* node types any more, and rejects classic outputs in beatUnit scope', () => {
    // beat 家族节点已随影视流水线接棒下线：注册表里不再有 beat.* 类型，
    // 所以 beatUnit 画布即使策略是通配 `*` 也拿不出可添加的 beat 节点。
    const addable = listAddableNodeTypes('beatUnit').map((def) => def.typeId)
    expect(addable.length).toBeGreaterThan(0)
    expect(addable.filter((typeId) => typeId.startsWith('beat.'))).toEqual([])
    expect(isNodeAddableInScope('beatUnit', 'note.text')).toBe(true)
    expect(isNodeAddableInScope('beatUnit', 'output.text')).toBe(false)
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
})
