import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createNodeFromType, createOutputGraphNode, type GraphDocument } from '../src/shared/graph'
import { graphOutputNodeId } from '../src/shared/graph/types'
import { createGraphRunLogBridge } from '../src/renderer/src/features/graph/model/graphRunLogBridge'
import { useGraphRunLogsStore } from '../src/renderer/src/stores/graphRunLogs'

const IMAGE_OUTPUT_ID = graphOutputNodeId('image')

function sampleGraph(): GraphDocument {
  const text = createNodeFromType('play.script', { x: 0, y: 0 }, {
    id: 'n-text',
    params: { text: 'hello' }
  })
  const output = createOutputGraphNode('image', { x: 200, y: 0 }, {
    id: IMAGE_OUTPUT_ID,
    params: { outputKind: 'image', inputDataType: 'text' }
  })
  return {
    nodes: [text, output],
    edges: [
      {
        id: 'e1',
        source: text.id,
        target: output.id,
        sourcePort: 'out',
        targetPort: 'in'
      }
    ],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

describe('graphRunLogBridge', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('records input ports on running and output ports on done', () => {
    const graph = sampleGraph()
    const store = useGraphRunLogsStore()
    const bridge = createGraphRunLogBridge({
      runId: 'run-ports',
      title: 'Port flow',
      mode: 'workflow',
      graph
    })

    bridge.onNodeUpdate(IMAGE_OUTPUT_ID, {
      status: 'running',
      inputs: {
        in: [{ kind: 'text', text: 'shot table json' }]
      }
    })
    const running = store.sessions[0]?.events.find(
      (e) => e.nodeId === IMAGE_OUTPUT_ID && e.status === 'running'
    )
    expect(running?.inputs?.in?.[0]?.kind).toBe('text')
    expect(running?.inputs?.in?.[0]?.text).toBe('shot table json')

    bridge.onNodeUpdate(IMAGE_OUTPUT_ID, {
      status: 'done',
      outputs: {
        out: {
          kind: 'images',
          items: [{ id: 'img-1', dataUrl: 'data:image/png;base64,AAAA', relativePath: 'a.png' }]
        }
      },
      // 即使引擎误带 inputs，完成行也不应再记输入
      inputs: {
        in: [{ kind: 'text', text: 'should-not-appear-on-done' }]
      }
    })
    const done = store.sessions[0]?.events.find(
      (e) => e.nodeId === IMAGE_OUTPUT_ID && e.status === 'done'
    )
    expect(done?.inputs).toBeUndefined()
    expect(done?.outputs?.out?.kind).toBe('images')
    expect(done?.outputs?.out?.items?.[0]?.relativePath).toBe('a.png')
    expect(JSON.stringify(done?.outputs)).not.toContain('data:image')

    bridge.endFromResult({ ok: true, order: [IMAGE_OUTPUT_ID], states: {} })
  })

  it('records node durations and ends the session', () => {
    const graph = sampleGraph()
    const store = useGraphRunLogsStore()
    const bridge = createGraphRunLogBridge({
      runId: 'run-1',
      title: 'Test run',
      hostId: 'asset:demo',
      mode: 'workflow',
      graph,
      resolveErrorMessage: (code) => `msg:${code}`
    })

    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0]?.status).toBe('running')
    expect(store.sessions[0]?.events[0]?.kind).toBe('run_start')

    bridge.onNodeUpdate('n-text', { status: 'pending' })
    bridge.onNodeUpdate('n-text', { status: 'running' })
    bridge.onNodeUpdate('n-text', { status: 'done' })

    const doneEvent = store.sessions[0]?.events.find(
      (e) => e.nodeId === 'n-text' && e.status === 'done'
    )
    expect(doneEvent).toBeTruthy()
    expect(doneEvent?.durationMs).toBeTypeOf('number')
    expect(doneEvent?.durationMs ?? -1).toBeGreaterThanOrEqual(0)

    bridge.endFromResult({
      ok: true,
      order: ['n-text', IMAGE_OUTPUT_ID],
      states: {}
    }, { message: 'ok' })

    expect(store.sessions[0]?.status).toBe('done')
    expect(store.sessions[0]?.events.some((e) => e.kind === 'run_end')).toBe(true)
    expect(store.activeRunId).toBeNull()
  })

  it('uses target node title in run_start', () => {
    const ref = createNodeFromType('asset.voice', { x: 0, y: 0 }, {
      id: 'node-abc',
      title: '梁咏琪',
      params: { assetRef: true }
    })
    const graph: GraphDocument = {
      nodes: [ref],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const store = useGraphRunLogsStore()
    createGraphRunLogBridge({
      runId: 'run-title',
      title: '新建声音',
      mode: 'nodeOnly',
      graph,
      targetNodeId: 'node-abc',
      startMessage: '开始执行至节点 梁咏琪'
    })
    const start = store.sessions[0]?.events.find((e) => e.kind === 'run_start')
    expect(start?.nodeTitle).toBe('梁咏琪')
    expect(start?.message).toContain('梁咏琪')
    expect(start?.message).not.toContain('node-abc')
  })

  it('maps error codes and ignores double end', () => {
    const graph = sampleGraph()
    const store = useGraphRunLogsStore()
    const bridge = createGraphRunLogBridge({
      runId: 'run-2',
      title: 'Fail run',
      mode: 'nodeOnly',
      graph,
      resolveErrorMessage: (code) => `mapped:${code}`
    })

    bridge.onNodeUpdate('n-text', { status: 'running' })
    bridge.onNodeUpdate('n-text', { status: 'error', error: 'GRAPH_CYCLE' })
    bridge.endFromResult({
      ok: false,
      order: ['n-text'],
      states: {},
      error: 'GRAPH_CYCLE'
    })
    bridge.endStopped('should-not-apply')

    const session = store.sessions[0]!
    expect(session.status).toBe('error')
    expect(session.events.filter((e) => e.kind === 'run_end')).toHaveLength(1)
    const errEvent = session.events.find((e) => e.status === 'error')
    expect(errEvent?.message).toBe('mapped:GRAPH_CYCLE')
    expect(errEvent?.errorCode).toBe('GRAPH_CYCLE')
  })

  it('attaches skillId and promptHash on API calls', () => {
    const text = createNodeFromType('prompt.optimize', { x: 0, y: 0 }, {
      id: 'n-opt',
      params: { skillId: 'episode.breakdown', generateInstruction: 'x' }
    })
    const graph: GraphDocument = {
      nodes: [text],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const store = useGraphRunLogsStore()
    const bridge = createGraphRunLogBridge({
      runId: 'run-skill',
      title: 'Skill run',
      mode: 'task',
      graph,
      pipelineStage: 'breakdown'
    })
    bridge.onNodeUpdate('n-opt', { status: 'running' })
    bridge.recordApiCall({
      kind: 'generateText',
      request: { prompt: 'hello', system: 'sys' }
    })
    const session = store.sessions[0]!
    expect(session.pipelineStage).toBe('breakdown')
    const call = session.apiCalls[0]
    expect(call?.skillId).toBe('episode.breakdown')
    expect(call?.promptHash).toMatch(/^[0-9a-f]{8}$/)
    expect(call?.nodeId).toBe('n-opt')
  })
})
