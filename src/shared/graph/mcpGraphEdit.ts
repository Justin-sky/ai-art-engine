import { canConnectNodes, getNodePorts } from './ports'
import { createNodeFromType } from './create'
import { REFERENCE_PARAM_KEYS, sanitizeReferenceParams } from './referenceParams'
import { listAddableNodeTypes } from './registry'
import type { GraphAddScope } from './scopes'
import type { GraphDocument, GraphEdge, GraphNode, GraphNodeParams, GraphNodeTypeId } from './types'

/**
 * MCP graph_edit 的共享纯逻辑：把外部 Agent 提交的一组编辑操作应用到
 * 图文档上。校验失败的 op 跳过并记入 warnings，不阻断后续操作。
 * 渲染层处理器负责：读取落盘图文档 → 调用本模块 → 持久化 + 广播。
 */

export type McpGraphEditOp =
  | {
      op: 'node_upsert'
      /** 缺省自动生成；已存在同 id 节点时转为更新 */
      nodeId?: string
      typeId: string
      title?: string
      params?: Record<string, unknown>
      x?: number
      y?: number
    }
  | {
      op: 'node_update'
      nodeId: string
      title?: string
      /** 与现有 params 浅合并 */
      params?: Record<string, unknown>
    }
  | { op: 'node_delete'; nodeId: string }
  | {
      op: 'edge_connect'
      fromNodeId: string
      toNodeId: string
      fromPort?: string
      toPort?: string
    }
  | { op: 'edge_delete'; fromNodeId: string; toNodeId: string }

export interface McpGraphEditResult {
  graph: GraphDocument
  applied: string[]
  warnings: string[]
}

/**
 * graph_edit 的校验作用域（宿主资产子图）：node_upsert 只接受该作用域下
 * 可添加的节点类型。MCP 的 graph_node_types 清单工具复用本常量，
 * 保证「清单里能查到的」与「graph_edit 能建的」始终同源。
 */
export const MCP_GRAPH_EDIT_SCOPE: GraphAddScope = 'subgraphAsset'

/** 输出与边界节点承载宿主接口，远端删除会破坏资产契约 */
function isProtectedNode(node: GraphNode): boolean {
  const typeId = node.typeId ?? ''
  return (
    typeId.startsWith('output.') ||
    typeId === 'graph.boundary.input' ||
    typeId === 'graph.boundary.output'
  )
}

function findNode(graph: GraphDocument, nodeId: string): GraphNode | undefined {
  return graph.nodes.find((node) => node.id === nodeId)
}

function resolveEdgePorts(
  source: GraphNode,
  target: GraphNode,
  fromPort?: string,
  toPort?: string
): { sourcePort: string; targetPort: string } | null {
  if (fromPort || toPort) {
    const sourcePort = fromPort || 'out'
    const targetPort = toPort || 'in'
    return canConnectNodes(source, target, { sourcePort, targetPort })
      ? { sourcePort, targetPort }
      : null
  }
  const outs = getNodePorts(source).filter((port) => port.direction === 'out')
  const ins = getNodePorts(target).filter((port) => port.direction === 'in')
  for (const out of outs) {
    for (const inPort of ins) {
      if (canConnectNodes(source, target, { sourcePort: out.id, targetPort: inPort.id })) {
        return { sourcePort: out.id, targetPort: inPort.id }
      }
    }
  }
  return null
}

/**
 * 把 op.params 合并到节点上，并对参考图参数做可用性校验（与 GraphPlan 物化同一套口径）。
 *
 * - 校验用「合并后」的值：单独更新 styleImagesUseGlobal 时也要能看到节点已有的 styleImages，
 *   否则会把「本地风格图 + 关掉全局风格」的合法组合误判成无风格；
 * - 本次传入不可用时保留节点原值（有的话），不静默销毁既有参考图配置。
 */
function mergeNodeParams(
  node: GraphNode,
  incoming: Record<string, unknown> | undefined,
  warnings: string[]
): void {
  if (!incoming || typeof incoming !== 'object') return
  const before = (node.params ?? {}) as Record<string, unknown>
  const merged = { ...before, ...incoming }
  if (!REFERENCE_PARAM_KEYS.some((key) => key in incoming)) {
    node.params = merged as GraphNodeParams
    return
  }
  const sanitized = sanitizeReferenceParams(
    merged as Partial<GraphNodeParams>,
    node.id,
    warnings
  ) as Record<string, unknown>
  for (const key of REFERENCE_PARAM_KEYS) {
    if (key in sanitized || !(key in before)) continue
    // 合并后不可用（含 styleImages 变空连带的开关回落）：保留原值，别让一次失败的写入抹掉既有配置
    sanitized[key] = before[key]
    warnings.push(`节点「${node.id}」${key} 本次改动无法生效，已保留原值`)
  }
  node.params = sanitized as GraphNodeParams
}

function applyOp(
  graph: GraphDocument,
  op: McpGraphEditOp,
  addable: Set<string>,
  warnings: string[]
): string | null {
  switch (op.op) {
    case 'node_upsert': {
      if (!addable.has(op.typeId)) {
        warnings.push(`未知或不可添加的节点类型「${op.typeId}」，已跳过`)
        return null
      }
      const existing = op.nodeId ? findNode(graph, op.nodeId) : undefined
      if (op.nodeId && existing) {
        if (typeof op.title === 'string' && op.title.trim()) existing.title = op.title.trim()
        mergeNodeParams(existing, op.params, warnings)
        return `更新节点 ${existing.id}`
      }
      const node = createNodeFromType(
        op.typeId as GraphNodeTypeId,
        {
          x: op.x ?? 0,
          y: op.y ?? 0
        },
        { title: op.title?.trim() || undefined }
      )
      if (op.nodeId) node.id = op.nodeId
      if (findNode(graph, node.id)) {
        warnings.push(`节点 id「${node.id}」已存在，已跳过新建`)
        return null
      }
      mergeNodeParams(node, op.params, warnings)
      graph.nodes.push(node)
      return `新建节点 ${node.id}（${op.typeId}）`
    }
    case 'node_update': {
      const node = findNode(graph, op.nodeId)
      if (!node) {
        warnings.push(`节点「${op.nodeId}」不存在，更新已跳过`)
        return null
      }
      if (typeof op.title === 'string' && op.title.trim()) node.title = op.title.trim()
      mergeNodeParams(node, op.params, warnings)
      return `更新节点 ${node.id}`
    }
    case 'node_delete': {
      const node = findNode(graph, op.nodeId)
      if (!node) {
        warnings.push(`节点「${op.nodeId}」不存在，删除已跳过`)
        return null
      }
      if (isProtectedNode(node)) {
        warnings.push(`节点「${op.nodeId}」为输出 / 边界节点，禁止删除`)
        return null
      }
      graph.nodes = graph.nodes.filter((item) => item.id !== op.nodeId)
      graph.edges = graph.edges.filter(
        (edge) => edge.source !== op.nodeId && edge.target !== op.nodeId
      )
      return `删除节点 ${op.nodeId}（含连线）`
    }
    case 'edge_connect': {
      const source = findNode(graph, op.fromNodeId)
      const target = findNode(graph, op.toNodeId)
      if (!source || !target) {
        warnings.push(`连线端点不存在（${op.fromNodeId} → ${op.toNodeId}），已跳过`)
        return null
      }
      const ports = resolveEdgePorts(source, target, op.fromPort, op.toPort)
      if (!ports) {
        warnings.push(`连线不兼容（${op.fromNodeId} → ${op.toNodeId}），已跳过`)
        return null
      }
      const duplicate = graph.edges.some(
        (edge) =>
          edge.source === source.id &&
          edge.target === target.id &&
          edge.sourcePort === ports.sourcePort &&
          edge.targetPort === ports.targetPort
      )
      if (duplicate) return `连线已存在（${op.fromNodeId} → ${op.toNodeId}）`
      const edge: GraphEdge = {
        id: `edge-mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        source: source.id,
        target: target.id,
        sourcePort: ports.sourcePort,
        targetPort: ports.targetPort
      }
      graph.edges.push(edge)
      return `连线 ${op.fromNodeId} → ${op.toNodeId}`
    }
    case 'edge_delete': {
      const before = graph.edges.length
      graph.edges = graph.edges.filter(
        (edge) => !(edge.source === op.fromNodeId && edge.target === op.toNodeId)
      )
      const removed = before - graph.edges.length
      if (!removed) warnings.push(`连线不存在（${op.fromNodeId} → ${op.toNodeId}），已跳过`)
      return `删除连线 ${op.fromNodeId} → ${op.toNodeId}`
    }
    default:
      warnings.push('未知操作，已跳过')
      return null
  }
}

export function applyGraphEditOps(graph: GraphDocument, ops: McpGraphEditOp[]): McpGraphEditResult {
  const next: GraphDocument = {
    ...graph,
    nodes: [...graph.nodes],
    edges: [...graph.edges]
  }
  const addable = new Set(listAddableNodeTypes(MCP_GRAPH_EDIT_SCOPE).map((def) => def.typeId))
  const applied: string[] = []
  const warnings: string[] = []
  for (const op of ops) {
    try {
      const appliedDesc = applyOp(next, op, addable, warnings)
      if (appliedDesc) applied.push(appliedDesc)
    } catch (err) {
      warnings.push(
        `操作 ${'op' in op ? op.op : '?'} 执行失败：${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  return { graph: next, applied, warnings }
}
