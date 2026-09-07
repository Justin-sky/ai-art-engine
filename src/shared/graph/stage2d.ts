/**
 * stage.2d「2D 舞台」节点参数态：承载 5.5「2D 导演台」的舞台场景。
 *
 * 数据模型与几何归一化见 `../gameAssets/stage2dScene.ts`
 * （Stage2dSceneState + normalizeStage2dScene + computeStage2dLayerPlacements，
 * 纯函数可单测）。本文件只做节点参数读写桥接与默认场景构造，
 * 让舞台场景随节点 params 随 free canvas 图持久化，供后续 2D 舞台 dock
 * 就地编辑（画布 / 锚点 / 精灵层叠放）与像素合成方消费。
 */
import {
  normalizeStage2dScene,
  DEFAULT_STAGE2D_SCENE,
  type Stage2dSceneState
} from '../gameAssets/stage2dScene'

export type { Stage2dSceneState }
export { DEFAULT_STAGE2D_SCENE, normalizeStage2dScene }

/** 新建节点时的默认舞台场景（画布 1024 + ground 语义 + 空层） */
export function createDefaultStage2dScene(): Stage2dSceneState {
  return normalizeStage2dScene(undefined)
}

/** 从节点 params 读取并归一化舞台场景；缺失 / 非法字段回落默认 */
export function readStage2dSceneFromNode(
  params?: { stage2dScene?: Partial<Stage2dSceneState> } | null
): Stage2dSceneState {
  return normalizeStage2dScene(params?.stage2dScene)
}

/** 舞台场景写回节点 params 的补丁（先归一化，保证落盘合法） */
export function stage2dSceneToNodePatch(scene: Stage2dSceneState): {
  stage2dScene: Stage2dSceneState
} {
  return { stage2dScene: normalizeStage2dScene(scene) }
}
