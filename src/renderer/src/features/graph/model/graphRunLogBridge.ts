import {
  getNodeType,
  resolveNodeType,
  type GraphDocument,
  type GraphNode,
  type GraphNodeRunState,
  type GraphRunLogApiCall,
  type GraphRunLogMode,
  type GraphRunResult
} from '@shared/graph'
import { useGraphRunLogsStore } from '../../../stores/graphRunLogs'

function nodeTitle(node: GraphNode | undefined, fallbackId: string): string {
  if (!node) return fallbackId
  const custom = node.title?.trim()
  if (custom) return custom
  const def = resolveNodeType(node) ?? (node.typeId ? getNodeType(node.typeId) : undefined)
  return def?.label ?? node.typeId ?? node.id
}

function nodeTypeId(node: GraphNode | undefined): string | undefined {
  return node?.typeId
}

export interface GraphRunLogBridgeOptions {
  runId: string
  title: string
  hostId?: string
  mode: GraphRunLogMode
  graph: GraphDocument
  targetNodeId?: string
  /** 将 GRAPH_* 等错误码转为可读文案；未映射则原样返回 */
  resolveErrorMessage?: (code: string) => string
  startMessage?: string
}

export interface GraphRunLogBridge {
  readonly runId: string
  /** 当前正在 running 的节点（供 API 包装层关联） */
  currentRunningNodeId: () => string | null
  onNodeUpdate: (nodeId: string, state: GraphNodeRunState) => void
  appendMessage: (message: string, level?: 'info' | 'warn' | 'error') => void
  recordApiCall: (
    call: Omit<GraphRunLogApiCall, 'id' | 'ts' | 'nodeId'> & { nodeId?: string; ts?: number }
  ) => void
  endFromResult: (
    result: GraphRunResult | null,
    opts?: { aborted?: boolean; message?: string }
  ) => void
  endStopped: (message?: string) => void
}

/**
 * 将 runGraph 的 onNodeUpdate 转为带时间戳 / 耗时的执行日志事件。
 */
export function createGraphRunLogBridge(options: GraphRunLogBridgeOptions): GraphRunLogBridge {
  const store = useGraphRunLogsStore()
  const byId = new Map(options.graph.nodes.map((n) => [n.id, n]))
  const runningStartedAt = new Map<string, number>()
  let currentRunningNodeId: string | null = options.targetNodeId ?? null

  const targetNodeTitle = options.targetNodeId
    ? nodeTitle(
        options.graph.nodes.find((n) => n.id === options.targetNodeId),
        options.targetNodeId
      )
    : undefined

  store.beginRun({
    runId: options.runId,
    title: options.title,
    hostId: options.hostId,
    mode: options.mode,
    targetNodeId: options.targetNodeId,
    targetNodeTitle,
    message: options.startMessage
  })

  function resolveMessage(code: string | undefined): string | undefined {
    if (!code) return undefined
    return options.resolveErrorMessage?.(code) ?? code
  }

  function onNodeUpdate(nodeId: string, state: GraphNodeRunState): void {
    const node = byId.get(nodeId)
    const now = Date.now()
    let durationMs: number | undefined
    if (state.status === 'running') {
      currentRunningNodeId = nodeId
      runningStartedAt.set(nodeId, now)
    } else if (state.status === 'done' || state.status === 'error') {
      const started = runningStartedAt.get(nodeId)
      if (started != null) {
        durationMs = Math.max(0, now - started)
        runningStartedAt.delete(nodeId)
      }
      if (currentRunningNodeId === nodeId) currentRunningNodeId = null
    } else if (state.status === 'skipped' || state.status === 'pending') {
      // keep map as-is
    }

    const level =
      state.status === 'error' ? 'error' : state.status === 'skipped' ? 'warn' : 'info'

    store.append({
      runId: options.runId,
      ts: now,
      level,
      kind: 'node_status',
      hostId: options.hostId,
      mode: options.mode,
      nodeId,
      nodeTitle: nodeTitle(node, nodeId),
      typeId: nodeTypeId(node),
      status: state.status,
      message: resolveMessage(state.error),
      errorCode: state.error,
      durationMs
    })
  }

  function appendMessage(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    store.append({
      runId: options.runId,
      level,
      kind: 'run_message',
      hostId: options.hostId,
      mode: options.mode,
      message,
      status: level === 'error' ? 'error' : 'done'
    })
  }

  function recordApiCall(
    call: Omit<GraphRunLogApiCall, 'id' | 'ts' | 'nodeId'> & { nodeId?: string; ts?: number }
  ): void {
    const nodeId = call.nodeId ?? currentRunningNodeId ?? options.targetNodeId
    if (!nodeId) return
    store.appendApiCall(options.runId, {
      ...call,
      nodeId
    })
  }

  function endFromResult(
    result: GraphRunResult | null,
    opts?: { aborted?: boolean; message?: string }
  ): void {
    if (opts?.aborted || result?.error === 'GRAPH_CANCELLED') {
      store.endRun({
        runId: options.runId,
        status: 'stopped',
        message: opts?.message ?? resolveMessage('GRAPH_CANCELLED'),
        errorCode: 'GRAPH_CANCELLED'
      })
      return
    }
    if (!result) {
      store.endRun({
        runId: options.runId,
        status: 'error',
        message: opts?.message ?? resolveMessage('failed')
      })
      return
    }
    if (result.ok) {
      store.endRun({
        runId: options.runId,
        status: 'done',
        message: opts?.message
      })
      return
    }
    store.endRun({
      runId: options.runId,
      status: 'error',
      message: opts?.message ?? resolveMessage(result.error),
      errorCode: result.error
    })
  }

  function endStopped(message?: string): void {
    store.endRun({
      runId: options.runId,
      status: 'stopped',
      message: message ?? resolveMessage('GRAPH_CANCELLED'),
      errorCode: 'GRAPH_CANCELLED'
    })
  }

  return {
    runId: options.runId,
    currentRunningNodeId: () => currentRunningNodeId,
    onNodeUpdate,
    appendMessage,
    recordApiCall,
    endFromResult,
    endStopped
  }
}
