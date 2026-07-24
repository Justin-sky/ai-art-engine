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

  const blocked = computed(() => isGraphRunning.value)

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
