import { ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import type { GraphNode, GraphNodeParams, GraphNodeRunState } from '../src/shared/graph'
import { graphEditorHosts } from '../src/renderer/src/features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../src/renderer/src/features/graph/model/graphRunHosts'
import {
  deleteGalleryOutput,
  hasGalleryEntry,
  selectGalleryOutput
} from '../src/renderer/src/features/graph/model/graphGalleryOutput'

const HOST_ID = 'test-host'

function frameAnimGenNode(): GraphNode {
  return {
    id: 'anim-1',
    typeId: 'frame.animGen',
    category: 'note',
    position: { x: 0, y: 0 },
    size: { w: 220, h: 180 },
    params: {
      generatedImages: [
        { id: 'img-1', dataUrl: '', relativePath: 'graph-run/a.png' },
        { id: 'img-2', dataUrl: '', relativePath: 'graph-run/b.png' },
        { id: 'img-3', dataUrl: '', relativePath: 'graph-run/c.png' }
      ],
      selectedImageId: 'img-3'
    }
  }
}

function registerHosts(node: GraphNode): {
  runStates: Record<string, GraphNodeRunState>
  dispose: () => void
} {
  const runStates: Record<string, GraphNodeRunState> = {
    [node.id]: {
      status: 'done',
      outputs: {
        out: { kind: 'image', id: 'img-3', dataUrl: '' },
        'out-all': { kind: 'images', items: node.params.generatedImages ?? [] }
      }
    }
  }
  const disposeEditor = graphEditorHosts.register(HOST_ID, {
    getNode: (nodeId) => (nodeId === node.id ? node : null),
    updateNode: (nodeId, params: Partial<GraphNodeParams>) => {
      if (nodeId !== node.id) return
      node.params = { ...node.params, ...params }
    },
    setNodeAsset: () => {},
    flush: async () => {}
  })
  const disposeRun = graphRunHosts.register(HOST_ID, {
    runStates,
    isRunning: ref(false),
    runningTargetNodeId: ref(null),
    runToNode: async () => undefined,
    stopWorkflow: () => {},
    toggleNodeRun: () => {}
  })
  return {
    runStates,
    dispose: () => {
      disposeRun()
      disposeEditor()
    }
  }
}

let cleanup: (() => void) | null = null

afterEach(() => {
  cleanup?.()
  cleanup = null
})

describe('gallery output select', () => {
  it('sets the clicked entry as out and keeps out-all in sync', () => {
    const node = frameAnimGenNode()
    const { runStates, dispose } = registerHosts(node)
    cleanup = dispose

    expect(hasGalleryEntry(node, 'image', 'img-1')).toBe(true)
    expect(selectGalleryOutput(HOST_ID, node, 'image', 'img-1')).toBe(true)
    expect(node.params.selectedImageId).toBe('img-1')
    expect(node.params.previewRelativePath).toBe('graph-run/a.png')
    expect(runStates[node.id]?.outputs?.out).toMatchObject({ kind: 'image', id: 'img-1' })
    expect(runStates[node.id]?.outputs?.['out-all']).toMatchObject({
      kind: 'images',
      items: [{ id: 'img-1' }, { id: 'img-2' }, { id: 'img-3' }]
    })
  })

  it('ignores ids that are not in the gallery', () => {
    const node = frameAnimGenNode()
    const { dispose } = registerHosts(node)
    cleanup = dispose

    expect(selectGalleryOutput(HOST_ID, node, 'image', 'missing')).toBe(false)
    expect(node.params.selectedImageId).toBe('img-3')
  })
})

describe('gallery output delete', () => {
  it('removes one entry and keeps the current selection', () => {
    const node = frameAnimGenNode()
    const { runStates, dispose } = registerHosts(node)
    cleanup = dispose

    const result = deleteGalleryOutput(HOST_ID, node, 'image', 'img-1')
    expect(result).toMatchObject({
      removed: true,
      emptied: false,
      relativePath: 'graph-run/a.png'
    })
    expect(node.params.generatedImages?.map((item) => item.id)).toEqual(['img-2', 'img-3'])
    expect(node.params.selectedImageId).toBe('img-3')
    expect(runStates[node.id]?.outputs?.out).toMatchObject({ kind: 'image', id: 'img-3' })
  })

  it('falls back to the newest entry when the selected one is deleted', () => {
    const node = frameAnimGenNode()
    const { dispose } = registerHosts(node)
    cleanup = dispose

    deleteGalleryOutput(HOST_ID, node, 'image', 'img-3')
    expect(node.params.selectedImageId).toBe('img-2')
    expect(node.params.previewRelativePath).toBe('graph-run/b.png')
  })

  it('clears run state and preview params when the gallery becomes empty', () => {
    const node = frameAnimGenNode()
    const { runStates, dispose } = registerHosts(node)
    cleanup = dispose

    for (const id of ['img-1', 'img-2', 'img-3']) {
      deleteGalleryOutput(HOST_ID, node, 'image', id)
    }
    expect(node.params.generatedImages).toEqual([])
    expect(node.params.selectedImageId).toBe('')
    expect(node.params.previewRelativePath).toBe('')
    expect(runStates[node.id]).toBeUndefined()
  })

  it('reports no removal for unknown ids so callers can clear the whole output', () => {
    const node = frameAnimGenNode()
    const { dispose } = registerHosts(node)
    cleanup = dispose

    expect(deleteGalleryOutput(HOST_ID, node, 'image', 'nope')).toMatchObject({
      removed: false,
      emptied: false
    })
    expect(node.params.generatedImages).toHaveLength(3)
  })
})
