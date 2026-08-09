import {
  createDefaultDirectorStage,
  readDirectorStage,
  type DirectorStageState,
  type DirectorViewerState
} from '@shared/domain'
import { isDirectorProcessingNode, type GraphDocument, type GraphNode } from '@shared/graph'

export const DIRECTOR_STAGES_BY_NODE_KEY = 'stagesByNodeId'

export function findDirectorProcessingNode(
  graphJson: unknown,
  preferredNodeId?: string | null
): GraphNode | null {
  if (!graphJson || typeof graphJson !== 'object') return null
  const nodes = (graphJson as GraphDocument).nodes
  if (!Array.isArray(nodes)) return null
  if (preferredNodeId) {
    const preferred = nodes.find(
      (node) => node.id === preferredNodeId && isDirectorProcessingNode(node)
    )
    if (preferred) return preferred
  }
  return nodes.find((node) => isDirectorProcessingNode(node)) ?? null
}

export function listDirectorProcessingNodes(graphJson: unknown): GraphNode[] {
  if (!graphJson || typeof graphJson !== 'object') return []
  const nodes = (graphJson as GraphDocument).nodes
  if (!Array.isArray(nodes)) return []
  return nodes.filter((node) => isDirectorProcessingNode(node))
}

/** 当前图内编辑节点与已保存舞台的绑定是否仍有效。 */
export function shouldResetDirectorStage(
  boundOwnerId: string | null,
  processingNodeId: string | null
): boolean {
  if (!processingNodeId) return true
  if (!boundOwnerId) return false
  return boundOwnerId !== processingNodeId
}

function seedStageFromProcessingNode(
  stage: DirectorStageState,
  node: GraphNode | null
): DirectorStageState {
  if (!node?.params.viewer) return stage
  const viewer = node.params.viewer as DirectorViewerState
  const activeId = stage.activeCameraId ?? stage.cameras?.[0]?.id
  const cameras = (stage.cameras ?? []).map((cam) =>
    cam.id === activeId ? { ...cam, viewer: { ...viewer } } : cam
  )
  return {
    ...stage,
    cameras
  }
}

export function createFreshDirectorStage(processingNode: GraphNode | null): DirectorStageState {
  const fresh = createDefaultDirectorStage()
  fresh.ownerProcessingNodeId = processingNode?.id ?? null
  return seedStageFromProcessingNode(fresh, processingNode)
}

function normalizeStoredStage(raw: unknown): DirectorStageState | null {
  if (!raw || typeof raw !== 'object') return null
  return readDirectorStage({ stage: raw })
}

/** 读取各导演台编辑节点的独立场景表（只认 stagesByNodeId）。 */
export function readStagesByNodeId(
  genParams: Record<string, unknown> | undefined,
  _graphJson?: unknown
): Record<string, DirectorStageState> {
  const result: Record<string, DirectorStageState> = {}
  const rawMap = genParams?.[DIRECTOR_STAGES_BY_NODE_KEY]
  if (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) {
    for (const [nodeId, raw] of Object.entries(rawMap as Record<string, unknown>)) {
      const stage = normalizeStoredStage(raw)
      if (!stage) continue
      stage.ownerProcessingNodeId = nodeId
      result[nodeId] = stage
    }
  }
  return result
}

export function resolveDirectorStageForNode(
  genParams: Record<string, unknown> | undefined,
  graphJson: unknown,
  processingNodeId: string | null
): DirectorStageState {
  const node = findDirectorProcessingNode(graphJson, processingNodeId)
  const nodeId = node?.id ?? processingNodeId
  if (!nodeId) return createFreshDirectorStage(null)

  const map = readStagesByNodeId(genParams, graphJson)
  const existing = map[nodeId]
  if (existing) {
    existing.ownerProcessingNodeId = nodeId
    return existing
  }

  return createFreshDirectorStage(node)
}

/** 写入某一节点的舞台到 genParams.stagesByNodeId。 */
export function patchGenParamsWithNodeStage(
  genParams: Record<string, unknown> | undefined,
  nodeId: string,
  stage: DirectorStageState
): Record<string, unknown> {
  const base = { ...(genParams ?? {}) }
  const prevMap = readStagesByNodeId(base, base.graphJson)
  // 只保留仍存在于图中的导演台节点舞台，避免删除/重建节点后孤儿数据残留
  const liveNodes = listDirectorProcessingNodes(base.graphJson)
  const liveNodeIds = liveNodes.length ? new Set(liveNodes.map((node) => node.id)) : null
  const nextMap: Record<string, DirectorStageState> = {}
  for (const [id, stored] of Object.entries(prevMap)) {
    if (!liveNodeIds || liveNodeIds.has(id)) nextMap[id] = stored
  }
  const nextStage = { ...stage, ownerProcessingNodeId: nodeId }
  nextMap[nodeId] = nextStage
  const { stage: _legacyStage, ...rest } = base
  return {
    ...rest,
    [DIRECTOR_STAGES_BY_NODE_KEY]: nextMap
  }
}

/** 删除若干节点对应的舞台。 */
export function removeNodeStagesFromGenParams(
  genParams: Record<string, unknown> | undefined,
  nodeIds: string[],
  graphJson?: unknown
): Record<string, unknown> {
  const base = { ...(genParams ?? {}) }
  const map = { ...readStagesByNodeId(base, graphJson) }
  for (const id of nodeIds) delete map[id]

  const serializable: Record<string, DirectorStageState> = {}
  for (const [id, stage] of Object.entries(map)) {
    serializable[id] = { ...stage, ownerProcessingNodeId: id }
  }

  const { stage: _legacyStage, ...rest } = base
  return {
    ...rest,
    [DIRECTOR_STAGES_BY_NODE_KEY]: serializable
  }
}
