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
  DEFAULT_STAGE2D_SCENE,
  normalizeStage2dScene,
  type Stage2dLayer,
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

/** 上游精灵源（执行器自动成层的输入）：像素源 + 可选显示名 */
export interface StageSpriteSource {
  /** 层像素源 storeable：项目相对路径（优先）或 dataUrl */
  sourceUrl?: string | null
  /** 显示名（缺省取上游标题 / 「Layer N+1」） */
  name?: string | null
}

/**
 * 以「上游精灵」刷新舞台层（stage.2d 执行器级联接线）：
 * 上游个数即层数、按序成层（后置者覆盖前置，层序即 z 序）。
 * 复用既有同序层的 id / 对齐参数 / 可见性（重跑同批上游不抖动），
 * 多余旧层移除；无上游时原样返回归一化场景（供 dock 预置层直接合成）。
 */
export function stageSceneWithUpstreamSources(
  scene: Stage2dSceneState,
  upstream: StageSpriteSource[]
): Stage2dSceneState {
  const base = normalizeStage2dScene(scene)
  if (!upstream.length) return base
  const layers: Stage2dLayer[] = []
  upstream.forEach((u, index) => {
    const sourceUrl = String(u.sourceUrl ?? '').trim()
    if (!sourceUrl) return
    const existed = base.layers[index]
    layers.push({
      id: existed?.id ?? `layer-${index}`,
      name: String(u.name ?? '').trim() || existed?.name || `Layer ${index + 1}`,
      sourceUrl,
      align: existed?.align ?? {
        anchor: base.anchor,
        contentHeightRatio: 0.9,
        groundRatio: base.groundRatio,
        fitWithinWidth: true
      },
      visible: existed?.visible ?? true
    })
  })
  return normalizeStage2dScene({ ...base, layers })
}
