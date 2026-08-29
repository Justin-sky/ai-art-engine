import {
  getNodeType,
  hashPromptForLog,
  resolveNodeType,
  summarizeInputPortsForLog,
  summarizeOutputPortsForLog,
  type GraphDocument,
  type GraphNode,
  type GraphNodeRunState,
  type GraphRunLogApiCall,
  type GraphRunLogMode,
  type GraphRunLogPortSnapshot,
  type GraphRunResult
} from '@shared/graph'
import { useGraphRunLogsStore } from '../../../stores/graphRunLogs'

function defaultNodeTitle(node: GraphNode | undefined, fallbackId: string): string {
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
  /** 节点展示名（含 i18n）；未传则用持久化 title / 英文 label */
  resolveNodeTitle?: (node: GraphNode | undefined, fallbackId: string) => string
  startMessage?: string
  pipelineStage?: string
  cellKey?: string
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
 * 将 runGraph 的 onNodeUpdate 转为带时间戳 / 耗时 / 端口数据流的执行日志事件。
 */
export function createGraphRunLogBridge(options: GraphRunLogBridgeOptions): GraphRunLogBridge {
  const store = useGraphRunLogsStore()
  const byId = new Map(options.graph.nodes.map((n) => [n.id, n]))
  const runningStartedAt = new Map<string, number>()
  const inputsByNodeId = new Map<string, Record<string, GraphRunLogPortSnapshot[]>>()
  let currentRunningNodeId: string | null = options.targetNodeId ?? null

  const resolveTitle = options.resolveNodeTitle ?? defaultNodeTitle

  const targetNodeTitle = options.targetNodeId
    ? resolveTitle(
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
    message: options.startMessage,
    pipelineStage: options.pipelineStage,
    cellKey: options.cellKey
  })

  function resolveMessage(code: string | undefined): string | undefined {
    if (!code) return undefined
    return options.resolveErrorMessage?.(code) ?? code
  }

  function onNodeUpdate(nodeId: string, state: GraphNodeRunState): void {
    const node = byId.get(nodeId)
    const now = Date.now()
    let durationMs: number | undefined
    // 运行中只记输入（含空端口）；完成/失败只记输出（不把输入再挂到完成行）
    const inputs =
      state.status === 'running'
        ? (summarizeInputPortsForLog(state.inputs ?? {}) ?? {})
        : undefined
    const outputs =
      state.status === 'done' || state.status === 'error' || state.status === 'degraded'
        ? summarizeOutputPortsForLog(state.outputs)
        : undefined

    if (state.status === 'running') {
      currentRunningNodeId = nodeId
      runningStartedAt.set(nodeId, now)
      inputsByNodeId.set(nodeId, inputs!)
    } else if (state.status === 'done' || state.status === 'error' || state.status === 'degraded') {
      const started = runningStartedAt.get(nodeId)
      if (started != null) {
        durationMs = Math.max(0, now - started)
        runningStartedAt.delete(nodeId)
      }
      if (currentRunningNodeId === nodeId) currentRunningNodeId = null
      inputsByNodeId.delete(nodeId)
    } else if (state.status === 'skipped' || state.status === 'pending') {
      // keep map as-is
    }

    const level =
      state.status === 'error'
        ? 'error'
        : state.status === 'degraded' || state.status === 'skipped'
          ? 'warn'
          : 'info'

    store.append({
      runId: options.runId,
      ts: now,
      level,
      kind: 'node_status',
      hostId: options.hostId,
      mode: options.mode,
      nodeId,
      nodeTitle: resolveTitle(node, nodeId),
      typeId: nodeTypeId(node),
      status: state.status,
      message: resolveMessage(state.error),
      errorCode: state.error,
      durationMs,
      ...(inputs !== undefined ? { inputs } : {}),
      ...(outputs ? { outputs } : {})
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
    const node = byId.get(nodeId)
    const skillId = node?.params?.skillId?.trim() || undefined
    const promptHash = hashPromptForLog(
      call.request?.prompt,
      call.request?.system,
      call.request?.input
    )
    store.appendApiCall(options.runId, {
      ...call,
      nodeId,
      ...(skillId ? { skillId } : {}),
      promptHash
    })
  }

  function finalizeOpenNodes(status: 'error' | 'done', message?: string, errorCode?: string): void {
    const now = Date.now()
    for (const [nodeId, started] of runningStartedAt) {
      const node = byId.get(nodeId)
      const durationMs = Math.max(0, now - started)
      const inputs = inputsByNodeId.get(nodeId)
      store.append({
        runId: options.runId,
        ts: now,
        level: status === 'error' ? 'error' : 'info',
        kind: 'node_status',
        hostId: options.hostId,
        mode: options.mode,
        nodeId,
        nodeTitle: resolveTitle(node, nodeId),
        typeId: nodeTypeId(node),
        status,
        message: message ?? resolveMessage(errorCode),
        errorCode,
        durationMs,
        ...(inputs ? { inputs } : {})
      })
      inputsByNodeId.delete(nodeId)
    }
    runningStartedAt.clear()
    currentRunningNodeId = null
  }

  function endFromResult(
    result: GraphRunResult | null,
    opts?: { aborted?: boolean; message?: string }
  ): void {
    if (opts?.aborted || result?.error === 'GRAPH_CANCELLED') {
      finalizeOpenNodes('error', opts?.message ?? resolveMessage('GRAPH_CANCELLED'), 'GRAPH_CANCELLED')
      store.endRun({
        runId: options.runId,
        status: 'stopped',
        message: opts?.message ?? resolveMessage('GRAPH_CANCELLED'),
        errorCode: 'GRAPH_CANCELLED'
      })
      return
    }
    if (!result) {
      finalizeOpenNodes('error', opts?.message ?? resolveMessage('failed'))
      store.endRun({
        runId: options.runId,
        status: 'error',
        message: opts?.message ?? resolveMessage('failed')
      })
      return
    }
    if (result.ok) {
      finalizeOpenNodes('done', opts?.message)
      store.endRun({
        runId: options.runId,
        status: 'done',
        message: opts?.message
      })
      return
    }
    finalizeOpenNodes(
      'error',
      opts?.message ?? resolveMessage(result.error),
      result.error
    )
    store.endRun({
      runId: options.runId,
      status: 'error',
      message: opts?.message ?? resolveMessage(result.error),
      errorCode: result.error
    })
  }

  function endStopped(message?: string): void {
    finalizeOpenNodes('error', message ?? resolveMessage('GRAPH_CANCELLED'), 'GRAPH_CANCELLED')
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
