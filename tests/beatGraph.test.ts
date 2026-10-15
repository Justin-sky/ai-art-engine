import { describe, expect, it } from 'vitest'
import {
  isNodeAddableInScope,
  readBeatGraphFromGenParams,
  withBeatGraph
} from '../src/shared/graph'

describe('beatUnit scope', () => {
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
})
