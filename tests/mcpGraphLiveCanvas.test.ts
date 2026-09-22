import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { GraphNodeRunState } from '../src/shared/graph'
import { graphRunHosts } from '../src/renderer/src/features/graph/model/graphRunHosts'
import type { GraphNode } from '../src/shared/graph'
import { graphEditorHosts } from '../src/renderer/src/features/graph/model/graphEditorHosts'
import {
  seedLiveCanvasRunStates,
  syncLiveCanvasEpisodeReviewFromNode,
  syncLiveCanvasNodeParams,
  syncLiveCanvasRunState
} from '../src/renderer/src/features/mcp/mcpGraphLiveCanvas'

describe('mcpGraphLiveCanvas', () => {
  it('syncLiveCanvasRunState mirrors engine updates when canvas is idle', () => {
    const hostId = 'asset:test-live-sync'
    const runStates: Record<string, GraphNodeRunState> = {}
    const unregister = graphRunHosts.register(hostId, {
      runStates,
      isRunning: ref(false),
      runningTargetNodeId: ref(null),
      runToNode: async () => null,
      stopWorkflow: () => {},
      toggleNodeRun: () => {}
    })
    try {
      syncLiveCanvasRunState(hostId, 'n1', {
        status: 'running',
        inputs: { in: { kind: 'text', text: 'secret' } }
      })
      expect(runStates.n1?.status).toBe('running')
      expect(runStates.n1?.inputs).toBeUndefined()

      syncLiveCanvasRunState(hostId, 'n1', { status: 'done', outputs: { out: { kind: 'text', text: 'ok' } } })
      expect(runStates.n1?.status).toBe('done')
      expect(runStates.n1?.outputs?.out).toEqual({ kind: 'text', text: 'ok' })
    } finally {
      unregister()
    }
  })

  it('does not overwrite live canvas while foreground runGraph is active', () => {
    const hostId = 'asset:test-foreground'
    const runStates: Record<string, GraphNodeRunState> = { n1: { status: 'running' } }
    const unregister = graphRunHosts.register(hostId, {
      runStates,
      isRunning: ref(true),
      runningTargetNodeId: ref('n1'),
      runToNode: async () => null,
      stopWorkflow: () => {},
      toggleNodeRun: () => {}
    })
    try {
      syncLiveCanvasRunState(hostId, 'n1', { status: 'done' })
      expect(runStates.n1?.status).toBe('running')
    } finally {
      unregister()
    }
  })

  it('syncLiveCanvasEpisodeReviewFromNode patches review and upstream stage nodes', () => {
    const hostId = 'asset:test-review'
    const patched: Array<{ nodeId: string; params: Record<string, unknown> }> = []
    const unregister = graphEditorHosts.register(hostId, {
      getDocument: () => ({ nodes: [], edges: [] }),
      updateNode: (nodeId, params) => {
        patched.push({ nodeId, params: { ...params, via: 'update' } })
      },
      patchNodeParamsLive: (nodeId, params) => {
        patched.push({ nodeId, params: { ...params, via: 'live' } })
      },
      getNode: () => null,
      setNodeAsset: () => {},
      flush: async () => {}
    })
    const nodes: GraphNode[] = [
      {
        id: 'gen',
        typeId: 'prompt.optimize',
        title: 'breakdown',
        position: { x: 0, y: 0 },
        params: { episodeStep: 'breakdown' }
      },
      {
        id: 'review',
        typeId: 'prompt.optimize',
        title: 'review',
        position: { x: 0, y: 0 },
        params: {
          episodeReviewTarget: 'breakdown',
          episodeReviewStatus: 'FAIL',
          episodeReviewReason: '节拍不足'
        }
      }
    ]
    try {
      syncLiveCanvasEpisodeReviewFromNode(hostId, nodes, 'review')
      expect(patched).toHaveLength(2)
      expect(patched[0]?.nodeId).toBe('review')
      expect(patched[0]?.params.via).toBe('live')
      expect(patched[0]?.params.episodeReviewStatus).toBe('FAIL')
      expect(patched[1]?.nodeId).toBe('gen')
    } finally {
      unregister()
    }
  })

  it('syncLiveCanvasNodeParams ignores heavy text patches', () => {
    const hostId = 'asset:test-slim-params'
    const patched: Array<Record<string, unknown>> = []
    const unregister = graphEditorHosts.register(hostId, {
      getDocument: () => ({ nodes: [], edges: [] }),
      updateNode: () => {},
      patchNodeParamsLive: (_nodeId, params) => {
        patched.push({ ...params })
      },
      getNode: () => null,
      setNodeAsset: () => {},
      flush: async () => {}
    })
    try {
      syncLiveCanvasNodeParams(hostId, 'n1', { text: 'huge body' })
      expect(patched).toHaveLength(0)
      syncLiveCanvasNodeParams(hostId, 'n1', {
        text: 'huge body',
        episodeReviewStatus: 'PASS',
        episodeReviewReason: '',
        episodeReviewPending: false
      })
      expect(patched).toHaveLength(1)
      expect(patched[0]?.text).toBeUndefined()
      expect(patched[0]?.episodeReviewStatus).toBe('PASS')
    } finally {
      unregister()
    }
  })

  it('syncLiveCanvasNodeParams is a no-op when host is missing', () => {
    expect(() => syncLiveCanvasNodeParams('asset:missing', 'n1', { text: 'x' })).not.toThrow()
  })

  it('syncLiveCanvasRunState keeps prior outputs while status is running', () => {
    const hostId = 'asset:test-running-keep-outputs'
    const runStates: Record<string, GraphNodeRunState> = {
      n1: { status: 'done', outputs: { out: { kind: 'text', text: 'kept' } } }
    }
    const unregister = graphRunHosts.register(hostId, {
      runStates,
      isRunning: ref(false),
      runningTargetNodeId: ref(null),
      runToNode: async () => null,
      stopWorkflow: () => {},
      toggleNodeRun: () => {}
    })
    try {
      syncLiveCanvasRunState(hostId, 'n1', { status: 'running' })
      expect(runStates.n1?.status).toBe('running')
      expect(runStates.n1?.outputs?.out).toEqual({ kind: 'text', text: 'kept' })
    } finally {
      unregister()
    }
  })

  it('seedLiveCanvasRunStates applies prior done states', () => {
    const hostId = 'asset:test-seed'
    const runStates: Record<string, GraphNodeRunState> = {}
    const unregister = graphRunHosts.register(hostId, {
      runStates,
      isRunning: ref(false),
      runningTargetNodeId: ref(null),
      runToNode: async () => null,
      stopWorkflow: () => {},
      toggleNodeRun: () => {}
    })
    try {
      seedLiveCanvasRunStates(hostId, {
        a: { status: 'done' },
        b: { status: 'pending' }
      })
      expect(runStates.a?.status).toBe('done')
      expect(runStates.b?.status).toBe('pending')
    } finally {
      unregister()
    }
  })
})
