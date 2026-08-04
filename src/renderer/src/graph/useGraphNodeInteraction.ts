import type { Ref } from 'vue'
import {
  clampNodeSize,
  createFlickGestureTracker,
  getNodeSize,
  GROUP_EXIT_FLICK_MIN_COUNT,
  snapPositionToGrid,
  type GraphDocument,
  type GraphNode
} from '@shared/graph'

export interface GraphNodeDragMoveContext {
  nodeIds: string[]
  flickCount: number
  /** 本次移动中首次达到甩动离组阈值 */
  flickExitReached: boolean
}

export interface GraphNodeDragEndContext {
  nodeIds: string[]
  fromGroupLabel: boolean
  nodeStarts: Map<string, { x: number; y: number }>
  /** 是否真正发生过拖拽位移（超过阈值） */
  didMove: boolean
}

export interface GraphNodeInteractionOptions {
  graph: GraphDocument
  selectedNodeIds: Ref<Set<string>>
  selectedEdgeIds: Ref<Set<string>>
  /** 同步到 workspace：单选传节点 id，多选传 null（避免 Inspector 桥接把本地多选压成单选） */
  selectNode: (nodeId: string | null) => void
  buildSnapshot: () => GraphDocument
  scheduleSave: () => void
  recordChange: (label: string, before: GraphDocument) => void
  /** 拖拽时是否吸附网格 */
  snapToGrid?: () => boolean
  onNodesDragStart?: (nodeIds: string[]) => void
  onNodesDragMove?: (context: GraphNodeDragMoveContext) => void
  onNodesDragEnd?: (context: GraphNodeDragEndContext) => void
}

export interface GraphNodeDragOptions {
  moveWholeGroup?: boolean
}

/** 未超过该像素位移前不进入拖拽，避免单击/双击被当成拖动 */
export const NODE_DRAG_THRESHOLD_PX = 4

function resolveSelectionForDrag(
  nodeId: string,
  selectedNodeIds: Set<string>,
  event: PointerEvent
): Set<string> {
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    const next = new Set(selectedNodeIds)
    if (next.has(nodeId)) next.delete(nodeId)
    else next.add(nodeId)
    return next.size > 0 ? next : new Set([nodeId])
  }
  if (selectedNodeIds.has(nodeId) && selectedNodeIds.size > 1) {
    return new Set(selectedNodeIds)
  }
  return new Set([nodeId])
}

function resolveDragNodeIds(
  graph: GraphDocument,
  nodeId: string,
  selectedNodeIds: Set<string>,
  moveWholeGroup: boolean
): string[] {
  if (moveWholeGroup) {
    const node = graph.nodes.find((item) => item.id === nodeId)
    if (node?.groupId) {
      return graph.nodes.filter((item) => item.groupId === node.groupId).map((item) => item.id)
    }
  }
  if (selectedNodeIds.has(nodeId) && selectedNodeIds.size > 1) {
    return [...selectedNodeIds]
  }
  return [nodeId]
}

/** 节点拖动/缩放 Controller；不依赖 Vue 模板和 Workspace Store。 */
export function useGraphNodeInteraction(options: GraphNodeInteractionOptions) {
  let pendingNodeId: string | null = null
  let pendingMoveWholeGroup = false
  let pendingPointerId: number | null = null
  let dragArmed = false
  let dragNodeIds: string[] = []
  let dragBefore: GraphDocument | null = null
  let dragStart = { x: 0, y: 0 }
  let nodeStarts = new Map<string, { x: number; y: number }>()
  let dragFromGroupLabel = false
  let flickExitTriggered = false
  const flickTracker = createFlickGestureTracker()

  function clearWindowListeners(): void {
    window.removeEventListener('pointermove', onNodeDragMove)
    window.removeEventListener('pointerup', onNodeDragEnd)
    window.removeEventListener('pointercancel', onNodeDragEnd)
  }

  function resetDragState(): void {
    pendingNodeId = null
    pendingMoveWholeGroup = false
    pendingPointerId = null
    dragArmed = false
    dragBefore = null
    dragNodeIds = []
    nodeStarts = new Map()
    dragFromGroupLabel = false
    flickExitTriggered = false
  }

  function beginArmedDrag(): void {
    if (!pendingNodeId || dragArmed) return
    const nodeId = pendingNodeId
    const moveWholeGroup = pendingMoveWholeGroup
    dragFromGroupLabel = moveWholeGroup
    const draggedNode = options.graph.nodes.find((item) => item.id === nodeId)
    dragNodeIds = resolveDragNodeIds(
      options.graph,
      nodeId,
      options.selectedNodeIds.value,
      moveWholeGroup
    )
    // 分组整拖时补齐选中集
    if (moveWholeGroup && draggedNode?.groupId) {
      options.selectedNodeIds.value = new Set(
        options.graph.nodes
          .filter((item) => item.groupId === draggedNode.groupId)
          .map((item) => item.id)
      )
    }
    dragBefore = options.buildSnapshot()
    nodeStarts = new Map(
      dragNodeIds
        .map((id) => options.graph.nodes.find((item) => item.id === id))
        .filter((node): node is GraphNode => !!node)
        .map((node) => [node.id, { ...node.position }])
    )
    flickTracker.reset(dragStart.x, dragStart.y)
    flickExitTriggered = false
    dragArmed = true
    options.onNodesDragStart?.([...dragNodeIds])
  }

  function syncWorkspaceNodeSelection(selection: Set<string>): void {
    if (selection.size === 1) {
      const onlyId = selection.values().next().value
      options.selectNode(onlyId ?? null)
      return
    }
    // 多选时清空 workspace 单节点，防止 selectedGraphNodeId watch 把 Set 压成单选
    options.selectNode(null)
  }

  function onNodeDragStart(
    nodeId: string,
    event: PointerEvent,
    dragOptions?: GraphNodeDragOptions
  ): void {
    if (event.button !== 0) return
    const moveWholeGroup = dragOptions?.moveWholeGroup === true
    // 单击/双击：仅更新选中，不立刻 snapshot / 进入 dragging
    const nextSelection = moveWholeGroup
      ? (() => {
          const draggedNode = options.graph.nodes.find((item) => item.id === nodeId)
          return draggedNode?.groupId
            ? new Set(
                options.graph.nodes
                  .filter((item) => item.groupId === draggedNode.groupId)
                  .map((item) => item.id)
              )
            : new Set([nodeId])
        })()
      : resolveSelectionForDrag(nodeId, options.selectedNodeIds.value, event)
    options.selectedNodeIds.value = nextSelection
    options.selectedEdgeIds.value = new Set()
    syncWorkspaceNodeSelection(nextSelection)

    pendingNodeId = nodeId
    pendingMoveWholeGroup = moveWholeGroup
    pendingPointerId = event.pointerId
    dragArmed = false
    dragStart = { x: event.clientX, y: event.clientY }
    clearWindowListeners()
    window.addEventListener('pointermove', onNodeDragMove)
    window.addEventListener('pointerup', onNodeDragEnd)
    window.addEventListener('pointercancel', onNodeDragEnd)
  }

  function onNodeDragMove(event: PointerEvent): void {
    if (pendingPointerId != null && event.pointerId !== pendingPointerId) return
    if (!pendingNodeId && !dragArmed) return

    if (!dragArmed) {
      const dist = Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y)
      if (dist < NODE_DRAG_THRESHOLD_PX) return
      beginArmedDrag()
    }
    if (!dragArmed || dragNodeIds.length === 0) return

    const flickCountBefore = flickTracker.count
    flickTracker.track(event.clientX, event.clientY)
    const flickCount = flickTracker.count
    const flickExitReached =
      !dragFromGroupLabel &&
      !flickExitTriggered &&
      flickCountBefore < GROUP_EXIT_FLICK_MIN_COUNT &&
      flickCount >= GROUP_EXIT_FLICK_MIN_COUNT
    if (flickExitReached) flickExitTriggered = true

    const dx = (event.clientX - dragStart.x) / options.graph.viewport.zoom
    const dy = (event.clientY - dragStart.y) / options.graph.viewport.zoom
    for (const id of dragNodeIds) {
      const node = options.graph.nodes.find((item) => item.id === id)
      const start = nodeStarts.get(id)
      if (!node || !start) continue
      const next = { x: start.x + dx, y: start.y + dy }
      const snapped = options.snapToGrid?.() ? snapPositionToGrid(next) : next
      node.position.x = snapped.x
      node.position.y = snapped.y
    }
    options.onNodesDragMove?.({
      nodeIds: [...dragNodeIds],
      flickCount,
      flickExitReached
    })
  }

  function onNodeDragEnd(event: PointerEvent): void {
    if (pendingPointerId != null && event.pointerId !== pendingPointerId) return
    const didMove = dragArmed
    if (didMove) {
      flickTracker.track(event.clientX, event.clientY)
    }

    const before = dragBefore
    const context: GraphNodeDragEndContext = {
      nodeIds: didMove ? [...dragNodeIds] : pendingNodeId ? [pendingNodeId] : [],
      fromGroupLabel: dragFromGroupLabel,
      nodeStarts: new Map(nodeStarts),
      didMove
    }
    clearWindowListeners()
    resetDragState()

    if (!didMove) {
      // 纯点击 / 双击：不记移动历史、不触发拖拽收尾重算
      return
    }

    options.onNodesDragEnd?.(context)
    options.scheduleSave()
    if (before) options.recordChange('move-node', before)
  }

  function onNodeResizeStart(nodeId: string, event: PointerEvent): void {
    const node = options.graph.nodes.find((item) => item.id === nodeId)
    if (!node) return
    options.selectedNodeIds.value = new Set([nodeId])
    options.selectNode(nodeId)
    const sizeStart = getNodeSize(node)
    const before = options.buildSnapshot()
    const resizeStart = { x: event.clientX, y: event.clientY }

    const onMove = (moveEvent: PointerEvent): void => {
      const target = options.graph.nodes.find((item) => item.id === nodeId)
      if (!target) return
      const dx = (moveEvent.clientX - resizeStart.x) / options.graph.viewport.zoom
      const dy = (moveEvent.clientY - resizeStart.y) / options.graph.viewport.zoom
      target.size = clampNodeSize(target, sizeStart.w + dx, sizeStart.h + dy)
      target.params = { ...target.params, sizeManuallyResized: true }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      options.scheduleSave()
      options.recordChange('resize-node', before)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  function dispose(): void {
    clearWindowListeners()
    resetDragState()
  }

  return { onNodeDragStart, onNodeResizeStart, dispose }
}
