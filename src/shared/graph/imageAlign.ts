/**
 * 精灵统一对齐节点参数：把透明 PNG（承接本地抠图）按统一画布缩放摆放，
 * 以「中心 / 脚底」锚点就位，输出引擎可直接消费的 2D 游戏资产。
 *
 * 几何算法见 `../gameAssets/spriteGeometry.ts`（extractAlphaBounds +
 * computeSpriteAlignPlan，纯函数可单测）。本文件只管节点参数形态；
 * 像素合成由渲染层注入 `composeImageAlignCanvas` 完成。
 */

export type ImageAlignAnchor = 'center' | 'ground'

export interface ImageAlignState {
  /** 统一画布宽（px） */
  canvasWidth: number
  /** 统一画布高（px） */
  canvasHeight: number
  /** 锚点方式：center=主体中心 / ground=脚底压地面基线 */
  anchor: ImageAlignAnchor
  /** 主体外接框高度占画布高度的比例（0.1~1） */
  contentHeightRatio: number
  /** anchor='ground' 时，基线距画布底边的比例（0~0.5） */
  groundRatio: number
  /** 等比缩放后主体宽度超画布时，是否收缩到画布内 */
  fitWithinWidth: boolean
}

export const DEFAULT_IMAGE_ALIGN: ImageAlignState = {
  canvasWidth: 1024,
  canvasHeight: 1024,
  anchor: 'ground',
  contentHeightRatio: 0.9,
  groundRatio: 0.06,
  fitWithinWidth: true
}

const MIN_CANVAS = 16
const MAX_CANVAS = 8192

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function clampInt(n: number, min: number, max: number): number {
  const v = Number.isFinite(n) ? n : DEFAULT_IMAGE_ALIGN.canvasWidth
  return Math.round(clamp(v, min, max))
}

export function normalizeImageAlign(
  raw?: Partial<ImageAlignState> | null
): ImageAlignState {
  const base = { ...DEFAULT_IMAGE_ALIGN, ...(raw ?? {}) }
  return {
    canvasWidth: clampInt(base.canvasWidth, MIN_CANVAS, MAX_CANVAS),
    canvasHeight: clampInt(base.canvasHeight, MIN_CANVAS, MAX_CANVAS),
    anchor: base.anchor === 'center' ? 'center' : 'ground',
    contentHeightRatio: clamp(Number(base.contentHeightRatio), 0.1, 1),
    groundRatio: clamp(Number(base.groundRatio), 0, 0.5),
    fitWithinWidth: base.fitWithinWidth !== false
  }
}

export function readImageAlignFromNode(params: {
  imageAlign?: Partial<ImageAlignState>
}): ImageAlignState {
  return normalizeImageAlign(params.imageAlign)
}

export function imageAlignToNodePatch(state: ImageAlignState): {
  imageAlign: ImageAlignState
} {
  return { imageAlign: normalizeImageAlign(state) }
}
