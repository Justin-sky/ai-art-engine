import { readDirectorStage, type DirectorCameraShot } from '../domain'
import { isDirectorProcessingNode } from './nodeRole'
import type { GraphImageItem } from './execute/types'
import type { GraphDocument, GraphNodeParams } from './types'

const STAGES_BY_NODE_KEY = 'stagesByNodeId'

function shotsToImageItems(shots: DirectorCameraShot[]): GraphImageItem[] {
  return shots
    .filter((shot) => typeof shot.dataUrl === 'string' && shot.dataUrl.length > 0)
    .map((shot) => ({
      id: shot.id,
      dataUrl: shot.dataUrl,
      createdAt: shot.createdAt
    }))
}

function findMotionProcessingNode(graphJson: unknown) {
  if (!graphJson || typeof graphJson !== 'object') return null
  const nodes = (graphJson as GraphDocument).nodes
  if (!Array.isArray(nodes)) return null
  return nodes.find((node) => isDirectorProcessingNode(node)) ?? null
}

function readStageRawForNode(
  genParams: Record<string, unknown> | null | undefined,
  nodeId: string | null
): unknown {
  if (!genParams || !nodeId) return null
  const map = genParams[STAGES_BY_NODE_KEY]
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    return (map as Record<string, unknown>)[nodeId] ?? null
  }
  return null
}

/**
 * 解析导演台资产/节点上的站位图列表。
 * 优先节点 params，其次该节点 stagesByNodeId 场景，再次资产图内加工节点。
 */
export function resolveMotionImageItems(
  genParams?: Record<string, unknown> | null,
  nodeParams?: Pick<GraphNodeParams, 'cameraShots' | 'previewDataUrl'> | null,
  processingNodeId?: string | null
): GraphImageItem[] {
  const fromNode = shotsToImageItems(nodeParams?.cameraShots ?? [])
  if (fromNode.length) return fromNode

  const processing = findMotionProcessingNode(genParams?.graphJson)
  const nodeId = processingNodeId ?? processing?.id ?? null
  const stageRaw = readStageRawForNode(genParams, nodeId)
  const fromStage = shotsToImageItems(
    stageRaw ? readDirectorStage({ stage: stageRaw }).cameraShots ?? [] : []
  )
  if (fromStage.length) return fromStage

  const fromProcessing = shotsToImageItems(processing?.params.cameraShots ?? [])
  if (fromProcessing.length) return fromProcessing
  if (processing?.params.previewDataUrl) {
    return [{ id: `${processing.id}:preview`, dataUrl: processing.params.previewDataUrl }]
  }

  if (nodeParams?.previewDataUrl) {
    return [{ dataUrl: nodeParams.previewDataUrl }]
  }
  return []
}
