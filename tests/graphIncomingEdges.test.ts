import { describe, expect, it } from 'vitest'
import {
  buildIncomingEdgeRefs,
  buildMentionIndexMapAfterReorder,
  remapInstructionMentions,
  reorderIncomingEdgesByIds
} from '../src/renderer/src/features/graph/model/graphEditorHosts'
import type { GraphEdge } from '../src/shared/graph'

describe('buildIncomingEdgeRefs', () => {
  const edges: GraphEdge[] = [
    {
      id: 'e-model',
      source: 'model-1',
      target: 'motion-1',
      sourcePort: 'out',
      targetPort: 'in-model'
    },
    {
      id: 'e-image',
      source: 'scene-1',
      target: 'motion-1',
      sourcePort: 'out',
      targetPort: 'in-image'
    },
    {
      id: 'e-text',
      source: 'play-1',
      target: 'motion-1',
      sourcePort: 'out',
      targetPort: 'in-text'
    },
    {
      id: 'e-other',
      source: 'model-1',
      target: 'other-1',
      sourcePort: 'out',
      targetPort: 'in'
    }
  ]

  it('returns all incoming edges when portId is omitted', () => {
    const refs = buildIncomingEdgeRefs(edges, 'motion-1')
    expect(refs.map((r) => r.edgeId).sort()).toEqual(['e-image', 'e-model', 'e-text'])
  })

  it('filters by targetPort when portId is provided', () => {
    const refs = buildIncomingEdgeRefs(edges, 'motion-1', 'in-model')
    expect(refs).toHaveLength(1)
    expect(refs[0]?.edgeId).toBe('e-model')
  })
})

describe('reorderIncomingEdgesByIds', () => {
  const edges: GraphEdge[] = [
    { id: 'keep-before', source: 'a', target: 'other', sourcePort: 'out', targetPort: 'in' },
    { id: 'e1', source: 'n1', target: 'gen', sourcePort: 'out', targetPort: 'in' },
    { id: 'keep-mid', source: 'b', target: 'other', sourcePort: 'out', targetPort: 'in' },
    { id: 'e2', source: 'n2', target: 'gen', sourcePort: 'out', targetPort: 'in' },
    { id: 'e3', source: 'n3', target: 'gen', sourcePort: 'out', targetPort: 'in' },
    { id: 'keep-after', source: 'c', target: 'other', sourcePort: 'out', targetPort: 'in' }
  ]

  it('reorders only incoming edges and keeps other edges in place', () => {
    const next = reorderIncomingEdgesByIds(edges, 'gen', ['e2', 'e1', 'e3'])
    expect(next?.map((e) => e.id)).toEqual([
      'keep-before',
      'e2',
      'keep-mid',
      'e1',
      'e3',
      'keep-after'
    ])
  })

  it('returns null when order is unchanged or invalid', () => {
    expect(reorderIncomingEdgesByIds(edges, 'gen', ['e1', 'e2', 'e3'])).toBeNull()
    expect(reorderIncomingEdgesByIds(edges, 'gen', ['e1', 'e2'])).toBeNull()
    expect(reorderIncomingEdgesByIds(edges, 'gen', ['e1', 'e2', 'missing'])).toBeNull()
  })
})

describe('remapInstructionMentions', () => {
  it('remaps @n so mentions keep pointing at the same edges after reorder', () => {
    const map = buildMentionIndexMapAfterReorder(['e1', 'e2', 'e3'], ['e2', 'e1', 'e3'])
    expect(Object.fromEntries(map)).toEqual({ 1: 2, 2: 1, 3: 3 })
    expect(remapInstructionMentions('用@1和@2，忽略@9', map)).toBe('用@2和@1，忽略@9')
  })
})
