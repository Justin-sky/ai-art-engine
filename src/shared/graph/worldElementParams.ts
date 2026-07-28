import type { GraphDocument, GraphNodeParams } from './types'
import { GraphPortType } from './types'
import {
  HOST_INTERFACE_FORMAT_VERSION,
  isBoundaryOutputNode,
  type HostInterfaceDocument
} from './hostInterface'
import type { WorldElementItem, WorldElementKind } from './worldElementParse'
import { WORLD_ELEMENT_KINDS } from './worldElementParse'

/** world 资产 genParams 中存放四类元素工作流图的键 */
export const WORLD_ELEMENT_GRAPHS_PARAM_KEY = 'worldElementGraphs'

export type WorldElementGraphs = Record<WorldElementKind, GraphDocument>

/** 元素图边界输出口 id：每条目录对应一个 image 出口 */
export function worldElementBoundaryPortId(elementId: string): string {
  return `out-${elementId}`
}

/** elementWorkflow 专用接口：无输入；每个元素一条 image 边界输出 */
export function hostInterfaceForElementWorkflow(
  items: Array<Pick<WorldElementItem, 'id' | 'name'>>
): HostInterfaceDocument {
  return {
    version: HOST_INTERFACE_FORMAT_VERSION,
    inputs: [],
    outputs: items.map((item) => ({
      id: worldElementBoundaryPortId(item.id),
      label: item.name,
      dataType: GraphPortType.image,
      multiple: false
    }))
  }
}

/**
 * 从已有子图反推 elementWorkflow 接口，避免 reload 时被 world 默认接口剪掉边界输出。
 */
export function inferElementWorkflowHostInterface(
  doc: Pick<GraphDocument, 'nodes'> | null | undefined
): HostInterfaceDocument {
  const outputs: HostInterfaceDocument['outputs'] = []
  for (const node of doc?.nodes ?? []) {
    if (!isBoundaryOutputNode(node)) continue
    const portId = node.params.hostBoundaryPort?.portId?.trim()
    if (!portId) continue
    const dataType = node.params.hostBoundaryPort?.dataType
    if (dataType && dataType !== GraphPortType.image && dataType !== GraphPortType.images) {
      continue
    }
    outputs.push({
      id: portId,
      label: node.title?.trim() || portId,
      dataType: GraphPortType.image,
      multiple: false
    })
  }
  return {
    version: HOST_INTERFACE_FORMAT_VERSION,
    inputs: [],
    outputs
  }
}

export function readWorldElementGraphsFromGenParams(
  genParams?: Record<string, unknown> | null
): Partial<WorldElementGraphs> {
  const raw = genParams?.[WORLD_ELEMENT_GRAPHS_PARAM_KEY]
  if (!raw || typeof raw !== 'object') return {}
  const out: Partial<WorldElementGraphs> = {}
  for (const kind of WORLD_ELEMENT_KINDS) {
    const doc = (raw as Record<string, unknown>)[kind]
    if (doc && typeof doc === 'object') {
      out[kind] = doc as GraphDocument
    }
  }
  return out
}

export function readWorldElementGraphFromGenParams(
  genParams: Record<string, unknown> | null | undefined,
  kind: WorldElementKind
): GraphDocument | null {
  const graphs = readWorldElementGraphsFromGenParams(genParams)
  return graphs[kind] ?? null
}

export function withWorldElementGraph(
  genParams: Record<string, unknown> | null | undefined,
  kind: WorldElementKind,
  graph: GraphDocument
): Record<string, unknown> {
  const prev = readWorldElementGraphsFromGenParams(genParams)
  return {
    ...(genParams ?? {}),
    [WORLD_ELEMENT_GRAPHS_PARAM_KEY]: {
      ...prev,
      [kind]: graph
    }
  }
}

/** 读取节点上的托管世界元素 id */
export function readWorldElementIdFromNodeParams(
  params: GraphNodeParams | undefined | null
): string | undefined {
  const id = params?.worldElementId?.trim()
  return id || undefined
}
