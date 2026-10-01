import { computed, type Ref } from 'vue'
import { getNodePorts, type GraphNode, type GraphNodeRunStatus } from '@shared/graph'
import { useEditorKernel } from '../editor/kernel'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'

/** Inspector 与画布节点共用同一 runStates（经 graphRunHosts） */
export function useGraphNodeRun(node: Ref<GraphNode | null | undefined>) {
  const editor = useEditorKernel()

  const hostId = computed(() => {
    const selection = editor.selection.current.value
    return selection.kind === 'graph.node' ? selection.hostId : null
  })

  const runHost = computed(() => graphRunHosts.get(hostId.value))

  const hasInPort = computed(() => {
    const current = node.value
    if (!current) return false
    return getNodePorts(current).some((port) => port.direction === 'in')
  })

  const runStatus = computed<GraphNodeRunStatus | undefined>(() => {
    const id = node.value?.id
    if (!id) return undefined
    const states = runHost.value?.runStates
    return states?.[id]?.status
  })

  const isGraphRunning = computed(() => runHost.value?.isRunning.value === true)

  /**
   * 该节点与画布上进行中的运行冲突（共用上游）→ 禁用执行按钮。
   * 仅「别的链在跑」不再禁用：互不重叠的链可以并行启动。
   */
  const blocked = computed(() => {
    const id = node.value?.id
    if (!id) return false
    return runHost.value?.blockedNodeIds.value.has(id) === true
  })

  function toggleRun(): void {
    const id = node.value?.id
    const host = runHost.value
    if (!id || !host) return
    host.toggleNodeRun(id)
  }

  return {
    hasInPort,
    runStatus,
    isGraphRunning,
    blocked,
    toggleRun
  }
}
