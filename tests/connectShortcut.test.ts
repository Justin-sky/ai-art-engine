import { describe, expect, it } from 'vitest'
import {
  connectEdgesWithShortcutPrune,
  nodeCanReach,
  nodesShareUpstream,
  type GraphEdge
} from '../src/shared/graph'

function edge(
  id: string,
  source: string,
  target: string,
  sourcePort = 'out',
  targetPort = 'in'
): GraphEdge {
  return { id, source, target, sourcePort, targetPort }
}

describe('nodeCanReach', () => {
  it('detects multi-hop reachability', () => {
    const edges = [
      edge('e1', 'A', 'B'),
      edge('e2', 'B', 'C'),
      edge('e3', 'C', 'D')
    ]
    expect(nodeCanReach(edges, 'A', 'D')).toBe(true)
    expect(nodeCanReach(edges, 'B', 'D')).toBe(true)
    expect(nodeCanReach(edges, 'D', 'A')).toBe(false)
    expect(nodeCanReach(edges, 'A', 'A')).toBe(true)
  })
})

describe('nodesShareUpstream', () => {
  it('detects common ancestor', () => {
    const edges = [edge('e1', 'A', 'B'), edge('e2', 'A', 'C')]
    expect(nodesShareUpstream(edges, 'B', 'C')).toBe(true)
    expect(nodesShareUpstream(edges, 'B', 'A')).toBe(true)
  })
})

describe('connectEdgesWithShortcutPrune', () => {
  it('when A→B→C exists, connecting A→C removes B→C', () => {
    const edges = [edge('e1', 'A', 'B'), edge('e2', 'B', 'C')]
    const next = connectEdgesWithShortcutPrune(edges, {
      sourceId: 'A',
      targetId: 'C',
      sourcePort: 'out',
      targetPort: 'in',
      edgeId: 'e-ac'
    })
    expect(next.map((e) => e.id).sort()).toEqual(['e-ac', 'e1'])
    expect(next.some((e) => e.id === 'e2')).toBe(false)
  })

  it('when A→B→C→D exists, connecting A→D removes C→D', () => {
    const edges = [
      edge('e1', 'A', 'B'),
      edge('e2', 'B', 'C'),
      edge('e3', 'C', 'D')
    ]
    const next = connectEdgesWithShortcutPrune(edges, {
      sourceId: 'A',
      targetId: 'D',
      sourcePort: 'out',
      targetPort: 'in',
      edgeId: 'e-ad'
    })
    expect(next.map((e) => e.id).sort()).toEqual(['e-ad', 'e1', 'e2'])
    expect(next.some((e) => e.id === 'e3')).toBe(false)
  })

  it('when A→D short exists, completing A→B→C→D removes A→D', () => {
    const edges = [
      edge('e-ad', 'A', 'D'),
      edge('e1', 'A', 'B'),
      edge('e2', 'B', 'C')
    ]
    const next = connectEdgesWithShortcutPrune(edges, {
      sourceId: 'C',
      targetId: 'D',
      sourcePort: 'out',
      targetPort: 'in',
      edgeId: 'e-cd'
    })
    expect(next.some((e) => e.id === 'e-ad')).toBe(false)
    expect(next.some((e) => e.id === 'e-cd')).toBe(true)
    expect(next.some((e) => e.id === 'e1')).toBe(true)
    expect(next.some((e) => e.id === 'e2')).toBe(true)
  })

  it('keeps unrelated parallel feed into the same target', () => {
    const edges = [edge('e1', 'A', 'B'), edge('e2', 'C', 'D')]
    const next = connectEdgesWithShortcutPrune(edges, {
      sourceId: 'A',
      targetId: 'D',
      sourcePort: 'out',
      targetPort: 'in',
      edgeId: 'e-ad'
    })
    expect(next.map((e) => e.id).sort()).toEqual(['e-ad', 'e1', 'e2'])
  })

  it('only clears the matched target port on shortcut', () => {
    const edges = [
      edge('e1', 'A', 'B'),
      edge('e2', 'B', 'D', 'out', 'in'),
      edge('e3', 'X', 'D', 'out', 'in-text')
    ]
    const next = connectEdgesWithShortcutPrune(edges, {
      sourceId: 'A',
      targetId: 'D',
      sourcePort: 'out',
      targetPort: 'in',
      edgeId: 'e-ad'
    })
    expect(next.some((e) => e.id === 'e2')).toBe(false)
    expect(next.some((e) => e.id === 'e3')).toBe(true)
    expect(next.some((e) => e.id === 'e-ad')).toBe(true)
  })
})
