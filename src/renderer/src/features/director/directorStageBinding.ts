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

export function readStageOwnerNodeId(
  genParams: Record<string, unknown> | undefined
): string | null {
  const raw = genParams?.stage
  if (!raw || typeof raw !== 'object') return null
  const id = (raw as Record<string, unknown>).ownerProcessingNodeId
  return typeof id === 'string' && id.trim() ? id.trim() : null
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
    cameras,
    viewer: { ...viewer }
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

/** 读取各导演台编辑节点的独立场景表（含从旧版 genParams.stage 迁移）。 */
export function readStagesByNodeId(
  genParams: Record<string, unknown> | undefined,
  graphJson?: unknown
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

  // 旧版单 stage：挂到 owner 或图中第一个加工节点
  if (Object.keys(result).length === 0 && genParams?.stage) {
    const legacy = readDirectorStage(genParams)
    const owner =
      (typeof legacy.ownerProcessingNodeId === 'string' && legacy.ownerProcessingNodeId) ||
      findDirectorProcessingNode(graphJson)?.id ||
      null
    if (owner) {
      legacy.ownerProcessingNodeId = owner
      result[owner] = legacy
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

  // 兼容：仅有旧 stage 且 owner 匹配 / 未标 owner
  if (genParams?.stage) {
    const legacy = readDirectorStage(genParams)
    const owner = readStageOwnerNodeId(genParams)
    if (!owner || owner === nodeId) {
      legacy.ownerProcessingNodeId = nodeId
      return legacy
    }
  }

  return createFreshDirectorStage(node)
}

/** @deprecated 使用 resolveDirectorStageForNode；保留给旧调用方 */
export function resolveDirectorStageFromAsset(
  genParams: Record<string, unknown> | undefined,
  graphJson: unknown
): DirectorStageState {
  const processingNode = findDirectorProcessingNode(graphJson)
  return resolveDirectorStageForNode(genParams, graphJson, processingNode?.id ?? null)
}

/** 写入某一节点的舞台，并同步镜像到 genParams.stage（兼容旧读取路径）。 */
export function patchGenParamsWithNodeStage(
  genParams: Record<string, unknown> | undefined,
  nodeId: string,
  stage: DirectorStageState
): Record<string, unknown> {
  const base = { ...(genParams ?? {}) }
  const prevMap =
    base[DIRECTOR_STAGES_BY_NODE_KEY] &&
    typeof base[DIRECTOR_STAGES_BY_NODE_KEY] === 'object' &&
    !Array.isArray(base[DIRECTOR_STAGES_BY_NODE_KEY])
      ? { ...(base[DIRECTOR_STAGES_BY_NODE_KEY] as Record<string, unknown>) }
      : {}
  const nextStage = { ...stage, ownerProcessingNodeId: nodeId }
  prevMap[nodeId] = nextStage
  return {
    ...base,
    [DIRECTOR_STAGES_BY_NODE_KEY]: prevMap,
    stage: nextStage
  }
}

/** 删除若干节点对应的舞台；若删光则清空 stage 镜像。 */
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

  const remainingIds = Object.keys(serializable)
  if (!remainingIds.length) {
    const { [DIRECTOR_STAGES_BY_NODE_KEY]: _removed, stage: _stage, ...rest } = base
    return {
      ...rest,
      [DIRECTOR_STAGES_BY_NODE_KEY]: {},
      stage: createDefaultDirectorStage()
    }
  }

  const mirrorId =
    (typeof base.stage === 'object' &&
      base.stage &&
      typeof (base.stage as DirectorStageState).ownerProcessingNodeId === 'string' &&
      remainingIds.includes((base.stage as DirectorStageState).ownerProcessingNodeId!))
      ? (base.stage as DirectorStageState).ownerProcessingNodeId!
      : remainingIds[0]

  return {
    ...base,
    [DIRECTOR_STAGES_BY_NODE_KEY]: serializable,
    stage: serializable[mirrorId!]
  }
}

export function stageWindowKey(
  directorAssetId: string,
  processingNodeId?: string | null
): string {
  return processingNodeId ? `${directorAssetId}::${processingNodeId}` : directorAssetId
}
