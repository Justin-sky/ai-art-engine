import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  createNodeFromType,
  createOutputGraphNode,
  type GraphDocument,
  type GraphRunResult
} from '../src/shared/graph'
import { graphOutputNodeId } from '../src/shared/graph/types'
import { useGraphRunSession } from '../src/renderer/src/features/graph/controllers/useGraphRunSession'

/**
 * 画布并行执行：两条互不相交的链（scriptA -> noteA、scriptB -> noteB）
 * 应能同时进行；共用上游时后到的一趟被拒绝并回调提示。
 */
function buildGraph(options: { sharedUpstream?: boolean } = {}): GraphDocument {
  const scriptA = createNodeFromType('play.script', { x: 0, y: 0 }, { params: { text: 'a' } })
  const noteA = createNodeFromType('note.text', { x: 200, y: 0 })
  const scriptB = createNodeFromType('play.script', { x: 0, y: 200 }, { params: { text: 'b' } })
  const noteB = createNodeFromType('note.text', { x: 200, y: 200 })
  const shared = createNodeFromType('play.script', { x: -200, y: 100 }, { params: { text: 's' } })
  const out = createOutputGraphNode(
    'text',
    { x: 400, y: 0 },
    {
      id: graphOutputNodeId('text')
    }
  )
  const edges = [
    { id: 'e1', source: scriptA.id, target: noteA.id, sourcePort: 'out', targetPort: 'in' },
    { id: 'e2', source: noteA.id, target: out.id, sourcePort: 'out', targetPort: 'in' },
    { id: 'e3', source: scriptB.id, target: noteB.id, sourcePort: 'out', targetPort: 'in' }
  ]
  if (options.sharedUpstream) {
    // 共用上游：同时跑 noteA / noteB 会重叠
    edges.push(
      { id: 'e4', source: shared.id, target: noteA.id, sourcePort: 'out', targetPort: 'in' },
      { id: 'e5', source: shared.id, target: noteB.id, sourcePort: 'out', targetPort: 'in' }
    )
  }
  return {
    nodes: [scriptA, noteA, scriptB, noteB, shared, out],
    edges,
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

function createSession(graph: GraphDocument, onRunBlocked?: (info: unknown) => void) {
  let doc = graph
  const session = useGraphRunSession({
    buildGraph: () => doc,
    commitLocal: () => undefined,
    t: (key, params) => (params ? `${key}` : key),
    onRunBlocked
  })
  return {
    session,
    setGraph: (next: GraphDocument) => {
      doc = next
    }
  }
}

function idsOf(graph: GraphDocument): {
  scriptA: string
  noteA: string
  scriptB: string
  noteB: string
  shared: string
} {
  const [scriptA, noteA, scriptB, noteB, shared] = graph.nodes
  return {
    scriptA: scriptA.id,
    noteA: noteA.id,
    scriptB: scriptB.id,
    noteB: noteB.id,
    shared: shared.id
  }
}

describe('useGraphRunSession parallel lanes', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('runs two non-overlapping chains at the same time', async () => {
    const graph = buildGraph()
    const { session } = createSession(graph)
    const ids = idsOf(graph)

    const first = session.runToNode(ids.noteA)
    const second = session.runToNode(ids.noteB)

    // 第二趟没有被第一趟挡住：两条泳道同时在跑
    expect(session.isRunning.value).toBe(true)
    expect(session.activeLanes.value).toHaveLength(2)
    expect([...session.activeRunNodeIds.value].sort()).toEqual(
      [ids.scriptA, ids.noteA, ids.scriptB, ids.noteB].sort()
    )

    const results = (await Promise.all([first, second])) as Array<GraphRunResult | null>
    expect(results.map((result) => result?.ok)).toEqual([true, true])
    expect(session.runStates[ids.noteA]?.status).toBe('done')
    expect(session.runStates[ids.noteB]?.status).toBe('done')
    expect(session.isRunning.value).toBe(false)
    expect(session.activeLanes.value).toHaveLength(0)
  })

  it('rejects a chain that overlaps a running one and reports the conflict', async () => {
    const graph = buildGraph({ sharedUpstream: true })
    const blocked: Array<{ conflictNodeIds: string[] }> = []
    const { session } = createSession(graph, (info) =>
      blocked.push(info as { conflictNodeIds: string[] })
    )
    const ids = idsOf(graph)

    const running = session.runToNode(ids.noteA)
    // noteB 的上游与 noteA 的上游共用 shared → 重叠
    const rejected = await session.runToNode(ids.noteB)

    expect(rejected).toBeNull()
    expect(blocked).toHaveLength(1)
    expect(blocked[0].conflictNodeIds).toContain(ids.shared)
    expect(session.activeLanes.value).toHaveLength(1)

    expect((await running)?.ok).toBe(true)
  })

  it('rejects the same target twice while it is still running', async () => {
    const graph = buildGraph()
    let blockedCount = 0
    const { session } = createSession(graph, () => {
      blockedCount += 1
    })
    const ids = idsOf(graph)

    const running = session.runToNode(ids.noteA)
    expect(await session.runToNode(ids.noteA)).toBeNull()
    expect(blockedCount).toBe(1)

    await running
  })

  it('stops only the lane that owns the toggled node', async () => {
    const graph = buildGraph()
    const { session } = createSession(graph)
    const ids = idsOf(graph)

    const laneA = session.runToNode(ids.noteA)
    const laneB = session.runToNode(ids.noteB)
    expect(session.activeLanes.value).toHaveLength(2)

    // noteA 就是 A 趟的目标 → 停止该趟，B 趟继续
    session.toggleNodeRun(ids.noteA)
    expect(session.activeLanes.value).toHaveLength(1)
    expect(session.activeLanes.value[0].nodeIds.has(ids.noteB)).toBe(true)

    const [resultA] = (await Promise.all([laneA, laneB])) as Array<GraphRunResult | null>
    // 被停止的趟不再回写结果（与旧 stopWorkflow 语义一致）
    expect(resultA).toBeNull()

    // B 趟不受影响，正常完成
    expect(session.runStates[ids.noteB]?.status).toBe('done')
    // A 趟不得留下卡住的 running/pending
    expect(['running', 'pending']).not.toContain(session.runStates[ids.noteA]?.status)
    expect(session.isRunning.value).toBe(false)
  })

  it('marks in-flight nodes of the stopped lane as stopped', async () => {
    const graph = buildGraph()
    const { session } = createSession(graph)
    const ids = idsOf(graph)

    const laneA = session.runToNode(ids.noteA)
    const laneB = session.runToNode(ids.noteB)
    // 让两趟都进入 pending / running 再停 A
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(['pending', 'running']).toContain(session.runStates[ids.scriptA]?.status)

    session.toggleNodeRun(ids.noteA)
    expect(session.runStates[ids.scriptA]?.status).toBe('error')
    expect(session.runStates[ids.noteA]?.status).toBe('error')

    await Promise.all([laneA, laneB])
    // B 趟节点状态不被 A 趟的停止波及
    expect(session.runStates[ids.scriptB]?.status).toBe('done')
    expect(session.runStates[ids.noteB]?.status).toBe('done')
  })

  it('treats an entire-graph run as mutually exclusive', async () => {
    const graph = buildGraph()
    let blockedCount = 0
    const { session } = createSession(graph, () => {
      blockedCount += 1
    })
    const ids = idsOf(graph)

    const branch = session.runToNode(ids.noteA)
    const full = await session.runWorkflow()
    expect(full).toBeNull()
    expect(blockedCount).toBeGreaterThan(0)

    await branch
    // 全图运行在画布空闲时可以开始
    expect((await session.runWorkflow())?.ok).toBe(true)
  })
})
