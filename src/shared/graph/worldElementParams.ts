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

/** 按 world.gen 节点 id 存放四类元素工作流图的键（多节点独立状态） */
export const WORLD_ELEMENT_GRAPHS_BY_NODE_PARAM_KEY = 'worldElementGraphsByNode'

/** 旧版资产级共享图归属的默认节点 id（首个世界元素生成节点） */
export const LEGACY_WORLD_GEN_NODE_ID = 'world-gen'

/** 世界元素目录指纹（资产级 / 按节点） */
export const WORLD_CATALOG_FINGERPRINT_KEY = 'lastAppliedWorldCatalogFingerprint'
export const WORLD_CATALOG_FINGERPRINT_BY_NODE_KEY = 'lastAppliedWorldCatalogFingerprintByNode'

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

/**
 * 读取某个 world.gen 节点的四类元素图：
 * 优先按节点 id 独立存储；无独立条目时仅对旧版默认节点回退到资产级共享图，
 * 其余节点（新添加的生成节点）保持独立空状态，不继承其它节点的内容。
 */
export function readWorldElementGraphsForNode(
  genParams: Record<string, unknown> | null | undefined,
  nodeId: string
): Partial<WorldElementGraphs> {
  const nodeKey = nodeId?.trim()
  if (!nodeKey) return {}
  const byNode = genParams?.[WORLD_ELEMENT_GRAPHS_BY_NODE_PARAM_KEY]
  if (byNode && typeof byNode === 'object') {
    const entry = (byNode as Record<string, unknown>)[nodeKey]
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      return entry as Partial<WorldElementGraphs>
    }
  }
  if (nodeKey === LEGACY_WORLD_GEN_NODE_ID) {
    return readWorldElementGraphsFromGenParams(genParams)
  }
  return {}
}

export function readWorldElementGraphForNode(
  genParams: Record<string, unknown> | null | undefined,
  nodeId: string,
  kind: WorldElementKind
): GraphDocument | null {
  const graphs = readWorldElementGraphsForNode(genParams, nodeId)
  return graphs[kind] ?? null
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

/**
 * 按 world.gen 节点写回某类元素图：
 * 写入独立节点槽位，不动资产级共享图，保证多节点互不影响。
 */
export function withWorldElementGraphForNode(
  genParams: Record<string, unknown> | null | undefined,
  nodeId: string,
  kind: WorldElementKind,
  graph: GraphDocument
): Record<string, unknown> {
  const nodeKey = nodeId?.trim()
  if (!nodeKey) return withWorldElementGraph(genParams, kind, graph)
  // 旧版默认节点继续走资产级共享图，避免双份状态分叉
  if (nodeKey === LEGACY_WORLD_GEN_NODE_ID) {
    return withWorldElementGraph(genParams, kind, graph)
  }
  const prev = readWorldElementGraphsForNode(genParams, nodeKey)
  const byNode =
    genParams?.[WORLD_ELEMENT_GRAPHS_BY_NODE_PARAM_KEY] &&
    typeof genParams[WORLD_ELEMENT_GRAPHS_BY_NODE_PARAM_KEY] === 'object'
      ? { ...(genParams[WORLD_ELEMENT_GRAPHS_BY_NODE_PARAM_KEY] as Record<string, unknown>) }
      : {}
  return {
    ...(genParams ?? {}),
    [WORLD_ELEMENT_GRAPHS_BY_NODE_PARAM_KEY]: {
      ...byNode,
      [nodeKey]: {
        ...prev,
        [kind]: graph
      }
    }
  }
}

/**
 * 把指定 world.gen 节点的世界元素状态（四类子图 + 目录指纹）从源 genParams 抽取出来，
 * 供「封装为资产」时迁入子图资产，避免封装后已生成数据丢失。
 */
export function pickWorldElementStateForMigration(
  genParams: Record<string, unknown> | null | undefined,
  worldGenNodeIds: string[]
): Record<string, unknown> {
  const ids = [
    ...new Set(
      worldGenNodeIds.map((id) => id?.trim()).filter((id): id is string => !!id)
    )
  ]
  if (!ids.length) return {}
  const out: Record<string, unknown> = {}

  if (ids.includes(LEGACY_WORLD_GEN_NODE_ID)) {
    const graphs = genParams?.[WORLD_ELEMENT_GRAPHS_PARAM_KEY]
    if (graphs && typeof graphs === 'object') {
      out[WORLD_ELEMENT_GRAPHS_PARAM_KEY] = graphs
    }
    const fingerprint = genParams?.[WORLD_CATALOG_FINGERPRINT_KEY]
    if (fingerprint) out[WORLD_CATALOG_FINGERPRINT_KEY] = fingerprint
  }

  const perNodeIds = ids.filter((id) => id !== LEGACY_WORLD_GEN_NODE_ID)
  if (perNodeIds.length) {
    const byNode = genParams?.[WORLD_ELEMENT_GRAPHS_BY_NODE_PARAM_KEY]
    const fingerprintByNode = genParams?.[WORLD_CATALOG_FINGERPRINT_BY_NODE_KEY]
    if (byNode && typeof byNode === 'object') {
      const pickedGraphs: Record<string, unknown> = {}
      const pickedFingerprints: Record<string, unknown> = {}
      for (const id of perNodeIds) {
        const entry = (byNode as Record<string, unknown>)[id]
        if (entry && typeof entry === 'object') pickedGraphs[id] = entry
        const fp =
          fingerprintByNode && typeof fingerprintByNode === 'object'
            ? (fingerprintByNode as Record<string, unknown>)[id]
            : undefined
        if (fp != null) pickedFingerprints[id] = fp
      }
      if (Object.keys(pickedGraphs).length) {
        out[WORLD_ELEMENT_GRAPHS_BY_NODE_PARAM_KEY] = pickedGraphs
        if (Object.keys(pickedFingerprints).length) {
          out[WORLD_CATALOG_FINGERPRINT_BY_NODE_KEY] = pickedFingerprints
        }
      }
    }
  }

  return out
}

/** 读取节点上的托管世界元素 id */
export function readWorldElementIdFromNodeParams(
  params: GraphNodeParams | undefined | null
): string | undefined {
  const id = params?.worldElementId?.trim()
  return id || undefined
}
