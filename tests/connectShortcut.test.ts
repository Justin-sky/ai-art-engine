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
  it('appends the new edge without pruning the existing path', () => {
    const edges = [edge('e1', 'A', 'B'), edge('e2', 'B', 'C')]
    const next = connectEdgesWithShortcutPrune(edges, {
      sourceId: 'A',
      targetId: 'C',
      sourcePort: 'out',
      targetPort: 'in',
      edgeId: 'e-ac'
    })
    expect(next.map((e) => e.id).sort()).toEqual(['e-ac', 'e1', 'e2'])
  })

  it('does not remove redundant direct edges when a path already exists', () => {
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
    expect(next.map((e) => e.id).sort()).toEqual(['e-ad', 'e1', 'e2', 'e3'])
  })

  it('allows multiple outputs to connect into one input port', () => {
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
    // A→D 与 C→D 同时保留，同一输入口可接入多个输出
    expect(next.map((e) => e.id).sort()).toEqual(['e-ad', 'e-cd', 'e1', 'e2'])
  })

  it('keeps unrelated parallel feed and dedupes identical four-tuples', () => {
    const edges = [edge('e1', 'A', 'B'), edge('e2', 'C', 'D')]
    const next = connectEdgesWithShortcutPrune(edges, {
      sourceId: 'A',
      targetId: 'D',
      sourcePort: 'out',
      targetPort: 'in',
      edgeId: 'e-ad'
    })
    expect(next.map((e) => e.id).sort()).toEqual(['e-ad', 'e1', 'e2'])
    const again = connectEdgesWithShortcutPrune(next, {
      sourceId: 'A',
      targetId: 'D',
      sourcePort: 'out',
      targetPort: 'in',
      edgeId: 'e-ad'
    })
    expect(again.filter((e) => e.id === 'e-ad')).toHaveLength(1)
  })

  it('without edgeId only returns deduped old edges for caller to push', () => {
    const edges = [edge('e1', 'A', 'B')]
    const next = connectEdgesWithShortcutPrune(edges, {
      sourceId: 'A',
      targetId: 'C',
      sourcePort: 'out',
      targetPort: 'in'
    })
    expect(next.map((e) => e.id)).toEqual(['e1'])
  })
})
