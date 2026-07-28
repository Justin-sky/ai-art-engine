import {
  buildShotGenerationPrompt,
  createEmptyStoryboard,
  normalizeStoryboard,
  type Shot,
  type ShotStoryboard
} from '../domain'
import type { GraphNode, GraphNodeParams } from './types'
import { createNodeFromType } from './create'

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
    storyboard.finalPrompt.trim() ||
    storyboard.characters.length ||
    storyboard.scenes.length ||
    storyboard.props.length ||
    storyboard.weapons.length
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

/** 分镜参数节点在图未执行时的可读正文（与 executeShotParamsNode 输出一致） */
export function resolveShotParamsNodePrompt(
  node: Pick<GraphNode, 'typeId' | 'params'>,
  options?: { stylePreset?: string }
): string {
  if (node.typeId !== 'script.shotParams') return ''
  return buildShotGenerationPrompt(readShotStoryboardFromNodeParams(node.params), options)
}
