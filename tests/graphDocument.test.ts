import { describe, expect, it } from 'vitest'
import {
  cloneGraphDocument,
  graphDocumentsEqual,
  replaceGraphDocument
} from '../src/shared/graph/document'
import type { GraphDocument } from '../src/shared/graph/types'

function document(): GraphDocument {
  return {
    nodes: [{
      id: 'node',
      category: 'note',
      position: { x: 1, y: 2 },
      params: { text: 'before' }
    }],
    edges: [],
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

describe('graph document model', () => {
  it('deep clones nested editable fields', () => {
    const source = document()
    const cloned = cloneGraphDocument(source)
    cloned.nodes[0].position.x = 99
    cloned.nodes[0].params.text = 'after'
    expect(source.nodes[0].position.x).toBe(1)
    expect(source.nodes[0].params.text).toBe('before')
  })

  it('replaces content while preserving root identity', () => {
    const target = document()
    const identity = target
    const next = document()
    next.nodes[0].params.text = 'after'
    replaceGraphDocument(target, next)
    expect(target).toBe(identity)
    expect(target.nodes[0].params.text).toBe('after')
    expect(graphDocumentsEqual(target, next)).toBe(true)
  })
})
