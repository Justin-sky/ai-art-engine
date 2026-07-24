import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import {
  NODE_DRAG_THRESHOLD_PX,
  useGraphNodeInteraction
} from '../src/renderer/src/graph/useGraphNodeInteraction'
import type { GraphDocument } from '../src/shared/graph'

type PointerHandler = (event: PointerEvent) => void

function makeGraph(): GraphDocument {
  return {
    nodes: [
      {
        id: 'n1',
        category: 'asset',
        typeId: 'asset.image',
        position: { x: 10, y: 20 },
        params: {}
      }
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

describe('useGraphNodeInteraction drag threshold', () => {
  const listeners = new Map<string, Set<PointerHandler>>()

  beforeEach(() => {
    listeners.clear()
    vi.stubGlobal('window', {
      addEventListener: (type: string, handler: PointerHandler) => {
        let set = listeners.get(type)
        if (!set) {
          set = new Set()
          listeners.set(type, set)
        }
        set.add(handler)
      },
      removeEventListener: (type: string, handler: PointerHandler) => {
        listeners.get(type)?.delete(handler)
      },
      dispatchEvent: (event: PointerEvent) => {
        const set = listeners.get(event.type)
        if (!set) return true
        for (const handler of [...set]) handler(event)
        return true
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function fire(type: string, init: { pointerId: number; clientX: number; clientY: number }): void {
    const event = { type, ...init } as PointerEvent
    ;(window as unknown as { dispatchEvent: (e: PointerEvent) => boolean }).dispatchEvent(event)
  }

  it('does not move or record history for click below threshold', () => {
    const graph = makeGraph()
    const selectedNodeIds = ref(new Set<string>())
    const selectedEdgeIds = ref(new Set<string>())
    const recordChange = vi.fn()
    const scheduleSave = vi.fn()
    const onNodesDragStart = vi.fn()
    const onNodesDragEnd = vi.fn()

    const { onNodeDragStart, dispose } = useGraphNodeInteraction({
      graph,
      selectedNodeIds,
      selectedEdgeIds,
      selectNode: () => undefined,
      buildSnapshot: () => structuredClone(graph),
      scheduleSave,
      recordChange,
      onNodesDragStart,
      onNodesDragEnd
    })

    onNodeDragStart(
      'n1',
      {
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 100
      } as PointerEvent
    )
    fire('pointermove', {
      pointerId: 1,
      clientX: 100 + NODE_DRAG_THRESHOLD_PX - 1,
      clientY: 100
    })
    fire('pointerup', {
      pointerId: 1,
      clientX: 100 + NODE_DRAG_THRESHOLD_PX - 1,
      clientY: 100
    })

    expect(graph.nodes[0]?.position).toEqual({ x: 10, y: 20 })
    expect(onNodesDragStart).not.toHaveBeenCalled()
    expect(onNodesDragEnd).not.toHaveBeenCalled()
    expect(recordChange).not.toHaveBeenCalled()
    expect(scheduleSave).not.toHaveBeenCalled()
    dispose()
  })

  it('arms drag after threshold and records move', () => {
    const graph = makeGraph()
    const selectedNodeIds = ref(new Set<string>())
    const selectedEdgeIds = ref(new Set<string>())
    const recordChange = vi.fn()
    const scheduleSave = vi.fn()
    const onNodesDragStart = vi.fn()
    const onNodesDragEnd = vi.fn()

    const { onNodeDragStart, dispose } = useGraphNodeInteraction({
      graph,
      selectedNodeIds,
      selectedEdgeIds,
      selectNode: () => undefined,
      buildSnapshot: () => structuredClone(graph),
      scheduleSave,
      recordChange,
      onNodesDragStart,
      onNodesDragEnd
    })

    onNodeDragStart(
      'n1',
      {
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 100
      } as PointerEvent
    )
    fire('pointermove', {
      pointerId: 1,
      clientX: 100 + NODE_DRAG_THRESHOLD_PX + 2,
      clientY: 100
    })
    fire('pointerup', {
      pointerId: 1,
      clientX: 100 + NODE_DRAG_THRESHOLD_PX + 2,
      clientY: 100
    })

    expect(onNodesDragStart).toHaveBeenCalledTimes(1)
    expect(onNodesDragEnd).toHaveBeenCalledTimes(1)
    expect(onNodesDragEnd.mock.calls[0]?.[0]?.didMove).toBe(true)
    expect(recordChange).toHaveBeenCalledWith('move-node', expect.anything())
    expect(scheduleSave).toHaveBeenCalled()
    expect(graph.nodes[0]?.position.x).toBeGreaterThan(10)
    dispose()
  })
})
