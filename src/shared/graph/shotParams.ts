import {
  buildShotGenerationPrompt,
  createEmptyStoryboard,
  normalizeStoryboard,
  type AssetType,
  type Shot,
  type ShotAudioRef,
  type ShotGenRef,
  type ShotStoryboard
} from '../domain'
import type { GraphDocument, GraphNode, GraphNodeParams } from './types'
import { createNodeFromType } from './create'

/** script 资产 genParams 中存放分镜工作流图的键 */
export const SHOT_WORKFLOW_GRAPH_PARAM_KEY = 'shotWorkflowGraph'

/** 分镜参数节点默认 params（右键添加 / 新建节点） */
export function defaultShotParamsNodeParams(): Pick<GraphNodeParams, 'shotStoryboard'> {
  return { shotStoryboard: createEmptyStoryboard() }
}

/** 从节点 params 读取分镜参数字段；缺省为空 storyboard */
export function readShotStoryboardFromNodeParams(
  params: GraphNodeParams | undefined | null
): ShotStoryboard {
  const base = createEmptyStoryboard()
  if (!params?.shotStoryboard) return base
  return { ...base, ...params.shotStoryboard }
}

/** 将 ShotStoryboard 写入节点 params 片段 */
export function shotStoryboardToNodeParams(
  storyboard: ShotStoryboard
): Pick<GraphNodeParams, 'shotStoryboard'> {
  return { shotStoryboard: { ...createEmptyStoryboard(), ...storyboard } }
}

/** storyboard 是否仍为全空（未编辑过） */
export function isEmptyShotStoryboard(storyboard: ShotStoryboard): boolean {
  return !(
    storyboard.visualDescription.trim() ||
    storyboard.shotSize.trim() ||
    storyboard.lighting.trim() ||
    storyboard.dialogue.trim() ||
    storyboard.soundFx.trim() ||
    storyboard.cameraMove.trim() ||
    storyboard.finalPrompt.trim()
  )
}

/** 读取节点绑定的分镜 id */
export function readBoundShotIdFromNodeParams(
  params: GraphNodeParams | undefined | null
): string | undefined {
  const id = params?.boundShotId?.trim()
  return id || undefined
}

/** 为指定分镜创建分镜参数节点（拖入分镜栏） */
export function createShotParamsNodeForShot(
  shot: Shot,
  position: { x: number; y: number },
  options?: { title?: string }
): GraphNode {
  const title = options?.title?.trim() || shot.title.trim() || 'Shot params'
  return createNodeFromType('script.shotParams', position, {
    title,
    params: {
      ...shotStoryboardToNodeParams(normalizeStoryboard(shot)),
      boundShotId: shot.id
    }
  })
}

/** 从 script 资产 genParams 读取分镜工作流图 */
export function readShotWorkflowGraphFromGenParams(
  genParams?: Record<string, unknown> | null
): GraphDocument | null {
  const raw = genParams?.[SHOT_WORKFLOW_GRAPH_PARAM_KEY]
  if (!raw || typeof raw !== 'object') return null
  return raw as GraphDocument
}

/** 写入分镜工作流图到 genParams */
export function withShotWorkflowGraph(
  genParams: Record<string, unknown> | null | undefined,
  graph: GraphDocument
): Record<string, unknown> {
  return {
    ...(genParams ?? {}),
    [SHOT_WORKFLOW_GRAPH_PARAM_KEY]: graph
  }
}

/** 分镜参数节点在图未执行时的可读正文（与 executeShotParamsNode 输出一致） */
export function resolveShotParamsNodePrompt(
  node: Pick<GraphNode, 'typeId' | 'params'>,
  options?: {
    genRefs?: ShotGenRef[]
    audioRefs?: ShotAudioRef[]
    assetNames?: Map<string, string>
    assetTypes?: Map<string, AssetType>
    stylePreset?: string
  }
): string {
  if (node.typeId !== 'script.shotParams') return ''
  return buildShotGenerationPrompt(readShotStoryboardFromNodeParams(node.params), options)
}
