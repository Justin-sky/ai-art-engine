import { describe, expect, it } from 'vitest'
import { autoLayoutNodes, getNodesBounds, type GraphNode } from '../src/shared/graph'

function makeNode(id: string, x = 0, y = 0, w = 260, h = 220): GraphNode {
  return {
    id,
    typeId: 'asset.sfx',
    category: 'asset',
    title: id,
    position: { x, y },
    size: { w, h },
    params: {}
  } as GraphNode
}

describe('autoLayoutNodes isolated & dense batch wrapping', () => {
  it('wraps a large batch of unconnected nodes into a multi-column landscape grid instead of a single vertical tower', () => {
    const nodes = Array.from({ length: 36 }, (_, i) => makeNode(`sfx-${i + 1}`, 0, 0))
    autoLayoutNodes(nodes, [])

    const uniqueCols = new Set(nodes.map((n) => n.position.x))
    const uniqueRows = new Set(nodes.map((n) => n.position.y))
    expect(uniqueCols.size).toBeGreaterThanOrEqual(5)
    expect(uniqueRows.size).toBeGreaterThanOrEqual(4)
    expect(uniqueRows.size).toBeLessThanOrEqual(8)

    const bounds = getNodesBounds(nodes, 0)!
    const aspect = bounds.w / bounds.h
    expect(aspect).toBeGreaterThan(1.1)
    expect(aspect).toBeLessThan(2.2)

    // No pair of nodes overlaps
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!
        const b = nodes[j]!
        const separated =
          a.position.x + a.size!.w <= b.position.x ||
          b.position.x + b.size!.w <= a.position.x ||
          a.position.y + a.size!.h <= b.position.y ||
          b.position.y + b.size!.h <= a.position.y
        expect(separated).toBe(true)
      }
    }

    // Idempotent when autoLayoutNodes runs a second time
    const snapshot = nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }))
    autoLayoutNodes(nodes, [])
    expect(nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }))).toEqual(snapshot)
  })

  it('places isolated node grid cleanly below an existing connected DAG without overlapping', () => {
    const src = makeNode('prompt-1', 100, 80)
    const sink = makeNode('video-1', 100, 80)
    const isolated = Array.from({ length: 12 }, (_, i) => makeNode(`sfx-${i + 1}`, 100, 80))
    const all = [src, sink, ...isolated]

    autoLayoutNodes(all, [{ source: 'prompt-1', target: 'video-1' }])

    expect(src.position.x).toBeLessThan(sink.position.x)
    const connectedBottom = Math.max(src.position.y + src.size!.h, sink.position.y + sink.size!.h)
    const isolatedTop = Math.min(...isolated.map((n) => n.position.y))
    expect(isolatedTop).toBeGreaterThan(connectedBottom)
    expect(new Set(isolated.map((n) => n.position.x)).size).toBeGreaterThanOrEqual(3)
  })

  it('wraps over-tall connected layer (>8 nodes) into sub-columns before advancing to downstream layer', () => {
    const sources = Array.from({ length: 18 }, (_, i) => makeNode(`shot-${i + 1}`, 0, 0))
    const timeline = makeNode('timeline', 0, 0, 320, 240)
    const all = [...sources, timeline]
    const edges = sources.map((s) => ({ source: s.id, target: timeline.id }))

    autoLayoutNodes(all, edges)

    const sourceCols = new Set(sources.map((s) => s.position.x))
    expect(sourceCols.size).toBe(3) // 18 / 8 => 3 sub-columns (8 + 8 + 2)
    const maxSourceRight = Math.max(...sources.map((s) => s.position.x + s.size!.w))
    expect(timeline.position.x).toBeGreaterThan(maxSourceRight)
  })
})
