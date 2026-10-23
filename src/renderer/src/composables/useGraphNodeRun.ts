import { computed, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { getNodePorts, type GraphNode, type GraphNodeRunStatus } from '@shared/graph'
import { useEditorKernel } from '../editor/kernel'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { useGraphTaskStore } from '../stores/graphTasks'

/** Inspector 与画布节点共用同一 runStates（经 graphRunHosts） */
export function useGraphNodeRun(
  node: Ref<GraphNode | null | undefined>,
  explicitHostId?: MaybeRefOrGetter<string | null | undefined>
) {
  const editor = useEditorKernel()
  const taskStore = useGraphTaskStore()

  const hostId = computed(() => {
    const explicit = toValue(explicitHostId)?.trim()
    if (explicit) return explicit
    const selection = editor.selection.current.value
    return selection.kind === 'graph.node' ? selection.hostId : null
  })

  const runHost = computed(() => graphRunHosts.get(hostId.value))

  const hasInPort = computed(() => {
    const current = node.value
    if (!current) return false
    return getNodePorts(current).some((port) => port.direction === 'in')
  })

  const activeQueueTaskForNode = computed(() => {
    const id = node.value?.id
    const hId = hostId.value
    if (!id || !hId) return null
    return (
      taskStore.tasks.find(
        (t) =>
          (t.status === 'running' || t.status === 'pending') &&
          t.target.hostId === hId &&
          (t.runStates[id]?.status === 'running' ||
            t.runStates[id]?.status === 'pending' ||
            t.order.includes(id))
      ) ?? null
    )
  })

  const runStatus = computed<GraphNodeRunStatus | undefined>(() => {
    const id = node.value?.id
    if (!id) return undefined
    const states = runHost.value?.runStates
    const hostStatus = states?.[id]?.status
    if (hostStatus) return hostStatus
    return activeQueueTaskForNode.value?.runStates[id]?.status
  })

  const isGraphRunning = computed(
    () => runHost.value?.isRunning.value === true || activeQueueTaskForNode.value !== null
  )

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
    if (!id) return
    const queueTask = activeQueueTaskForNode.value
    if (queueTask && (runStatus.value === 'running' || runStatus.value === 'pending')) {
      taskStore.stopAndRemove(queueTask.id)
      return
    }
    const host = runHost.value
    if (!host) return
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
