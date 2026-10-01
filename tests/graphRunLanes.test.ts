import { describe, expect, it } from 'vitest'
import { createNodeFromType, createOutputGraphNode } from '../src/shared/graph'
import {
  collectBlockedNodeIds,
  findConflictingGraphRunLane,
  graphRunLanesConflict,
  listGraphRunLaneOverlap,
  resolveGraphRunTargeting,
  type GraphRunLane
} from '../src/shared/graph'
import type { GraphDocument } from '../src/shared/graph'
import { graphOutputNodeId } from '../src/shared/graph/types'

/**
 * 画布并行执行：`a -> b -> out` 与 `c -> d` 两条互不相交的链。
 * 另有 `shared -> b`、`shared -> d` 作为共用上游。
 */
function buildGraph(): GraphDocument {
  const a = createNodeFromType('play.script', { x: 0, y: 0 }, { params: { text: 'a' } })
  const b = createNodeFromType('note.text', { x: 200, y: 0 })
  const c = createNodeFromType('play.script', { x: 0, y: 200 }, { params: { text: 'c' } })
  const d = createNodeFromType('note.text', { x: 200, y: 200 })
  const shared = createNodeFromType('play.script', { x: -200, y: 100 }, { params: { text: 's' } })
  const out = createOutputGraphNode(
    'text',
    { x: 400, y: 0 },
    {
      id: graphOutputNodeId('text')
    }
  )
  return {
    nodes: [a, b, c, d, shared, out],
    edges: [
      { id: 'e1', source: a.id, target: b.id, sourcePort: 'out', targetPort: 'in' },
      { id: 'e2', source: b.id, target: out.id, sourcePort: 'out', targetPort: 'in' },
      { id: 'e3', source: c.id, target: d.id, sourcePort: 'out', targetPort: 'in' },
      { id: 'e4', source: shared.id, target: b.id, sourcePort: 'out', targetPort: 'in' },
      { id: 'e5', source: shared.id, target: d.id, sourcePort: 'out', targetPort: 'in' }
    ],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

function lane(nodeIds: string[], exclusive = false): GraphRunLane {
  return { nodeIds: new Set(nodeIds), exclusive }
}

describe('resolveGraphRunTargeting', () => {
  it('resolves the upstream closure of an explicit target', () => {
    const graph = buildGraph()
    const [a, b] = graph.nodes
    const targeting = resolveGraphRunTargeting(graph, { targetNodeId: b.id })
    expect(targeting).not.toBeNull()
    expect([...targeting!.subset].sort()).toEqual([a.id, b.id, graph.nodes[4].id].sort())
    expect(targeting!.onlyTarget).toBe(false)
    expect([...targeting!.forceRunIds]).toEqual([b.id])
  })

  it('restricts an onlyTarget run to the target itself', () => {
    const graph = buildGraph()
    const b = graph.nodes[1]
    const targeting = resolveGraphRunTargeting(graph, {
      targetNodeId: b.id,
      onlyTargetNode: true
    })
    expect([...targeting!.subset]).toEqual([b.id])
    expect(targeting!.onlyTarget).toBe(true)
  })

  it('unions the upstream closures of explicit multi targets', () => {
    const graph = buildGraph()
    const [a, b, c, d] = graph.nodes
    const targeting = resolveGraphRunTargeting(graph, { targetNodeIds: [b.id, d.id] })
    expect([...targeting!.subset].sort()).toEqual(
      [a.id, b.id, c.id, d.id, graph.nodes[4].id].sort()
    )
    expect([...targeting!.forceRunIds].sort()).toEqual([b.id, d.id].sort())
    expect(targeting!.onlyTarget).toBe(false)
  })

  it('falls back to the default output node and returns null without one', () => {
    const graph = buildGraph()
    const targeting = resolveGraphRunTargeting(graph, {})
    expect(targeting?.target.id).toBe(graphOutputNodeId('text'))
    expect(resolveGraphRunTargeting({ ...graph, nodes: graph.nodes.slice(0, 2) }, {})).toBeNull()
  })

  it('ignores unknown target ids the way runGraph does', () => {
    const graph = buildGraph()
    // 未知 targetNodeId → 无可用汇点（GRAPH_NO_OUTPUT）
    expect(resolveGraphRunTargeting(graph, { targetNodeId: 'missing' })).toBeNull()
    // 未知多汇点 → 视为未指定，回落到默认输出节点
    expect(resolveGraphRunTargeting(graph, { targetNodeIds: ['missing'] })?.target.id).toBe(
      graphOutputNodeId('text')
    )
  })
})

describe('graphRunLanesConflict', () => {
  it('allows two disjoint chains to run in parallel', () => {
    expect(graphRunLanesConflict(lane(['a', 'b']), lane(['c', 'd']))).toBe(false)
  })

  it('rejects chains that share a node', () => {
    expect(graphRunLanesConflict(lane(['a', 'b']), lane(['b', 'c']))).toBe(true)
  })

  it('rejects an entire-graph run against any lane', () => {
    expect(graphRunLanesConflict(lane(['out'], true), lane(['c']))).toBe(true)
    expect(graphRunLanesConflict(lane(['c']), lane(['out'], true))).toBe(true)
  })

  it('rejects the same lane twice', () => {
    expect(graphRunLanesConflict(lane(['a', 'b']), lane(['a', 'b']))).toBe(true)
  })
})

describe('findConflictingGraphRunLane', () => {
  it('returns the index of the overlapping lane', () => {
    const active = [lane(['c', 'd']), lane(['a', 'b', 'shared'])]
    expect(findConflictingGraphRunLane(lane(['a']), active)).toBe(1)
  })

  it('returns -1 when nothing overlaps', () => {
    expect(findConflictingGraphRunLane(lane(['c']), [lane(['a', 'b'])])).toBe(-1)
  })
})

describe('listGraphRunLaneOverlap', () => {
  it('lists the shared nodes with the blocking lane', () => {
    expect(listGraphRunLaneOverlap(lane(['a', 'b', 'x']), lane(['b', 'x', 'y']))).toEqual([
      'b',
      'x'
    ])
  })

  it('returns nothing without a lane', () => {
    expect(listGraphRunLaneOverlap(lane(['a']), undefined)).toEqual([])
  })
})

describe('collectBlockedNodeIds', () => {
  it('blocks the upstream closure of an active lane, including its own nodes', () => {
    const graph = buildGraph()
    const [a, b, , , shared, out] = graph.nodes
    const blocked = collectBlockedNodeIds(graph, [lane([a.id, b.id])])
    // 泳道内节点由那一趟写状态，单跑会重叠 → 一并阻塞
    expect(blocked.has(a.id)).toBe(true)
    expect(blocked.has(b.id)).toBe(true)
    // 下游的输出节点会被重叠，必须阻塞
    expect(blocked.has(out.id)).toBe(true)
    // 另一条链不共用上游时完全不受影响
    expect(blocked.has(graph.nodes[2].id)).toBe(false)
    expect(blocked.has(graph.nodes[3].id)).toBe(false)
    expect(blocked.has(shared.id)).toBe(false)
  })

  it('blocks a sibling chain that shares an upstream node', () => {
    const graph = buildGraph()
    const [, b, , d, shared] = graph.nodes
    const blocked = collectBlockedNodeIds(graph, [lane([shared.id, b.id])])
    // d 依赖 shared，与泳道重叠 → 阻塞
    expect(blocked.has(d.id)).toBe(true)
  })

  it('blocks every node while an exclusive lane runs', () => {
    const graph = buildGraph()
    const out = graph.nodes[5]
    const blocked = collectBlockedNodeIds(graph, [lane([out.id], true)])
    expect(blocked.has(out.id)).toBe(true)
    for (const node of graph.nodes) expect(blocked.has(node.id)).toBe(true)
  })

  it('returns nothing when no lane runs', () => {
    const graph = buildGraph()
    expect(collectBlockedNodeIds(graph, []).size).toBe(0)
  })
})
