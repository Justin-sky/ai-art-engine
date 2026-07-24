import { describe, expect, it } from 'vitest'
import {
  getGroupBounds,
  GROUP_EXIT_FLICK_MIN_COUNT,
  GROUP_EXIT_FLICK_SPEED,
  resolveNodeGroupAfterMove,
  sanitizeGraphGroups,
  wouldLeaveCurrentGroup
} from '../src/shared/graph/groups'
import type { GraphDocument, GraphNode } from '../src/shared/graph/types'

function noteNode(id: string, x: number, y: number, groupId?: string): GraphNode {
  return {
    id,
    category: 'note',
    position: { x, y },
    params: { text: id },
    groupId
  }
}

function document(nodes: GraphNode[], groups: GraphDocument['groups'] = []): GraphDocument {
  return {
    nodes,
    edges: [],
    groups,
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

describe('graph groups', () => {
  it('computes bounds from member nodes', () => {
    const groupId = 'group-a'
    const doc = document(
      [noteNode('a', 10, 20, groupId), noteNode('b', 120, 40, groupId)],
      [{ id: groupId, title: 'A' }]
    )
    const bounds = getGroupBounds(doc.nodes, groupId)
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeLessThan(10)
    expect(bounds!.y).toBeLessThan(20)
    expect(bounds!.w).toBeGreaterThan(120)
    expect(bounds!.h).toBeGreaterThan(40)
  })

  it('drops empty groups during sanitize', () => {
    const doc = document([noteNode('solo', 0, 0)], [{ id: 'empty', title: 'Empty' }])
    expect(sanitizeGraphGroups(doc)).toEqual([])
  })

  it('assigns node to another group when dropped inside', () => {
    const groupA = 'group-a'
    const groupB = 'group-b'
    const doc = document(
      [
        noteNode('in-a', 0, 0, groupA),
        noteNode('in-b', 500, 0, groupB),
        noteNode('free', 520, 10)
      ],
      [
        { id: groupA, title: 'A' },
        { id: groupB, title: 'B' }
      ]
    )
    expect(resolveNodeGroupAfterMove(doc, 'free')).toBe(true)
    expect(doc.nodes.find((n) => n.id === 'free')?.groupId).toBe(groupB)
  })

  it('detects leaving a multi-node group', () => {
    const groupId = 'group-a'
    const doc = document(
      [noteNode('a', 0, 0, groupId), noteNode('b', 120, 0, groupId)],
      [{ id: groupId }]
    )
    doc.nodes.find((n) => n.id === 'b')!.position = { x: 400, y: 0 }
    expect(wouldLeaveCurrentGroup(doc, 'b', { x: 120, y: 0 })).toBe(true)
  })

  it('keeps node in group when moved within group hull', () => {
    const groupId = 'group-a'
    const doc = document(
      [
        noteNode('a', 0, 0, groupId),
        noteNode('b', 220, 0, groupId),
        noteNode('c', 110, 120, groupId)
      ],
      [{ id: groupId }]
    )
    doc.nodes.find((n) => n.id === 'c')!.position = { x: 110, y: 60 }
    expect(wouldLeaveCurrentGroup(doc, 'c', { x: 110, y: 120 })).toBe(false)
    expect(resolveNodeGroupAfterMove(doc, 'c')).toBe(false)
    expect(doc.nodes.find((n) => n.id === 'c')?.groupId).toBe(groupId)
  })

  it('allows exit from group when flick exit is enabled', () => {
    const groupId = 'group-a'
    const doc = document(
      [noteNode('a', 0, 0, groupId), noteNode('b', 120, 0, groupId)],
      [{ id: groupId }]
    )
    doc.nodes.find((n) => n.id === 'b')!.position = { x: 400, y: 0 }
    expect(resolveNodeGroupAfterMove(doc, 'b', { allowExit: true })).toBe(true)
    expect(doc.nodes.find((n) => n.id === 'b')?.groupId).toBeUndefined()
  })

  it('exports flick exit thresholds', () => {
    expect(GROUP_EXIT_FLICK_SPEED).toBeGreaterThan(0)
    expect(GROUP_EXIT_FLICK_MIN_COUNT).toBe(2)
  })
})
