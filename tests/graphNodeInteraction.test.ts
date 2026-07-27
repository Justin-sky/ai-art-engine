import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import {
  NODE_DRAG_THRESHOLD_PX,
  useGraphNodeInteraction
} from '../src/renderer/src/graph/useGraphNodeInteraction'
import type { GraphDocument } from '../src/shared/graph'

type PointerHandler = (event: PointerEvent) => void

function makeGraph(nodeCount = 1): GraphDocument {
  return {
    nodes: Array.from({ length: nodeCount }, (_, index) => ({
      id: `n${index + 1}`,
      category: 'asset' as const,
      typeId: 'asset.image',
      position: { x: 10 + index * 40, y: 20 + index * 10 },
      params: {}
    })),
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

  it('drags all selected nodes together and syncs multi-select as null', () => {
    const graph = makeGraph(3)
    const selectedNodeIds = ref(new Set(['n1', 'n2', 'n3']))
    const selectedEdgeIds = ref(new Set<string>())
    const selectNode = vi.fn()
    const starts = graph.nodes.map((node) => ({ ...node.position }))

    const { onNodeDragStart, dispose } = useGraphNodeInteraction({
      graph,
      selectedNodeIds,
      selectedEdgeIds,
      selectNode,
      buildSnapshot: () => structuredClone(graph),
      scheduleSave: () => undefined,
      recordChange: () => undefined
    })

    onNodeDragStart(
      'n2',
      {
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 100
      } as PointerEvent
    )
    expect(selectNode).toHaveBeenCalledWith(null)
    expect(selectedNodeIds.value).toEqual(new Set(['n1', 'n2', 'n3']))

    fire('pointermove', {
      pointerId: 1,
      clientX: 100 + NODE_DRAG_THRESHOLD_PX + 10,
      clientY: 100 + 6
    })

    for (let i = 0; i < graph.nodes.length; i += 1) {
      expect(graph.nodes[i]?.position.x).toBe(starts[i]!.x + NODE_DRAG_THRESHOLD_PX + 10)
      expect(graph.nodes[i]?.position.y).toBe(starts[i]!.y + 6)
    }
    expect(selectedNodeIds.value.size).toBe(3)
    dispose()
  })

  it('keeps multi-select when pointerdown hits an already selected node', () => {
    const graph = makeGraph(2)
    const selectedNodeIds = ref(new Set(['n1', 'n2']))
    const selectedEdgeIds = ref(new Set<string>())
    const selectNode = vi.fn()

    const { onNodeDragStart, dispose } = useGraphNodeInteraction({
      graph,
      selectedNodeIds,
      selectedEdgeIds,
      selectNode,
      buildSnapshot: () => structuredClone(graph),
      scheduleSave: () => undefined,
      recordChange: () => undefined
    })

    onNodeDragStart(
      'n1',
      {
        button: 0,
        pointerId: 1,
        clientX: 50,
        clientY: 50
      } as PointerEvent
    )

    expect(selectedNodeIds.value).toEqual(new Set(['n1', 'n2']))
    expect(selectNode).toHaveBeenCalledWith(null)
    dispose()
  })
})
