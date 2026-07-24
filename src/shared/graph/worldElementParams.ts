import type { GraphDocument, GraphNodeParams } from './types'
import type { WorldElementKind } from './worldElementParse'
import { WORLD_ELEMENT_KINDS } from './worldElementParse'

/** world 资产 genParams 中存放四类元素工作流图的键 */
export const WORLD_ELEMENT_GRAPHS_PARAM_KEY = 'worldElementGraphs'

export type WorldElementGraphs = Record<WorldElementKind, GraphDocument>

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
