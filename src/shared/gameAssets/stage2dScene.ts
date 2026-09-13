/**
 * 2D 舞台场景（5.5「2D 导演台」首子项地基）共享纯函数层。
 *
 * 2D 舞台与 image.align 的差异：对齐单图把「一个精灵」摆进统一画布；
 * 舞台把「多个已对齐精灵层」按各自锚点在同一参考画布叠放（角色 /
 * 换装部件 / 特效层同场就位），层序即 z 序。
 *
 * 数据模型：每层持有「精灵图源 + 对齐参数」。对齐参数可直接继承
 * 上游 image.align 节点的 imageAlign（见 graph/stage2d.ts 的
 * normalizeStage2dScene），几何换算复用 spriteGeometry.ts 的单精灵
 * 计划 —— 每层各自算 dst 矩形，再按层序叠绘到舞台画布。
 *
 * 纯函数，无 DOM / 模型依赖，可单测。
 */

import {
  type SpriteAlignPlan,
  type SpriteAnchorKind,
  type SpriteBounds,
  computeSpriteAlignPlan
} from './spriteGeometry'

/** 精灵层 id（节点内唯一，可跨精灵稳定排序） */
export type Stage2dLayerId = string

/**
 * 舞台场景状态：统一画布 + 按 z 序排列的精灵层。
 * 存于 stage.2d 节点 params.stage2dScene，随 free canvas 图持久化。
 */
export interface Stage2dSceneState {
  /** 舞台画布宽（px） */
  canvasWidth: number
  /** 舞台画布高（px） */
  canvasHeight: number
  /** 舞台锚点语义：center=层中心共用 / ground=层脚底共用地面基线 */
  anchor: SpriteAnchorKind
  /** anchor='ground' 时基线距画布底边的比例（0~0.5） */
  groundRatio: number
  /** 按叠放序排列的层（后置者覆盖前置） */
  layers: Stage2dLayer[]
}

/** 舞台中一个精灵层 */
export interface Stage2dLayer {
  /** 层 id：stable；由宿主生成（如节点 id + 序号 / uuid） */
  id: Stage2dLayerId
  /** 层名（默认取资产名 / 上游节点标题） */
  name: string
  /**
   * 精灵图源：dataUrl（本地合成、未落盘）或资产相对路径（已入库）。
   * 像素合成时先 resolve 成 URL；舞台预览用 resolveAssetPreviewUrl 取图。
   */
  sourceUrl: string
  /** 该精灵自己的对齐参数（继承上游 image.align / 资产 meta，缺省画布中心） */
  align: Stage2dLayerAlign
  /**
   * 锚点落位后的手动微调（舞台画布像素系，右 / 下为正）。
   * 自动落位为主、微调为辅：换锚点 / 调比例不丢微调量。
   */
  offset: Stage2dLayerOffset
  /**
   * 部件层（可选）：本层内容是「参考层」（frame.layerId，同场景另一层）
   * 内容区的裁剪矩形。放置几何不再按自身 bounds 独立缩放，而是完整继承
   * 参考层的缩放与落位（同图等比同框），因此拆件 / 换装差分部件能精确
   * 贴回原图位置而不会各自重新 fit。crop 坐标系 = 参考层 alpha 外接框
   * 内容坐标（0,0 为参考层内容左上角）。
   */
  frame?: Stage2dLayerFrameSpec | null
  /**
   * 挂骨骼时的枢轴（可选）：部件内容区内的一个像素（y-down）。
   * 绑定层绘制时把该像素对准挂点再随关节旋转——center（图中心）与
   * ground（图底边中点）只是 pivot 的两个特例；带枢轴时优先于 align.anchor。
   */
  pivot?: Stage2dLayerPivot | null
  /** 是否可见 */
  visible: boolean
}

/** 部件层对参考层（整图层）的共享几何引用 */
export interface Stage2dLayerFrameSpec {
  /** 内容参考层 id（同场景其他层，须先于本层完成放置） */
  layerId: string
  /** 本层内容 = 参考层内容区内的裁剪矩形（参考层内容坐标，px）；缺省整区 */
  crop: SpriteBounds | null
}

/** 部件枢轴：内容区内的像素（相对本层自身内容框左上角，y-down） */
export interface Stage2dLayerPivot {
  x: number
  y: number
}

/** 层对齐参数：与 image.align 的 ImageAlignState 同构，但 anchor 单用 */
export interface Stage2dLayerAlign {
  anchor: SpriteAnchorKind
  /** 主体框高度占舞台画布高度的比例（0.1~1） */
  contentHeightRatio: number
  /** anchor='ground' 时基线距画布底边的比例（0~0.5） */
  groundRatio: number
  /** 等比缩放后主体宽度超画布时，是否收缩到画布内 */
  fitWithinWidth: boolean
}

/** 层在锚点落位之后的手动微调（舞台画布像素系，右 / 下为正） */
export interface Stage2dLayerOffset {
  x: number
  y: number
}

export const DEFAULT_STAGE2D_SCENE: Stage2dSceneState = {
  canvasWidth: 1024,
  canvasHeight: 1024,
  anchor: 'ground',
  groundRatio: 0.06,
  layers: []
}

const MIN_CANVAS = 16
const MAX_CANVAS = 8192

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
  const v = Number.isFinite(n) ? n : fallback
  return Math.round(clamp(v, min, max))
}

/** 层微调偏移归一化：非数字回落 0，越界夹取到 ±画布上限 */
function normalizeLayerOffset(raw?: Partial<Stage2dLayerOffset> | null): Stage2dLayerOffset {
  return {
    x: clampInt(Number(raw?.x) || 0, -MAX_CANVAS, MAX_CANVAS, 0),
    y: clampInt(Number(raw?.y) || 0, -MAX_CANVAS, MAX_CANVAS, 0)
  }
}

function normalizeLayerAlign(raw?: Partial<Stage2dLayerAlign> | null): Stage2dLayerAlign {
  return {
    anchor: raw?.anchor === 'center' ? 'center' : 'ground',
    contentHeightRatio: clamp(
      Number.isFinite(Number(raw?.contentHeightRatio)) ? Number(raw?.contentHeightRatio) : 0.9,
      0.1,
      1
    ),
    groundRatio: clamp(
      Number.isFinite(Number(raw?.groundRatio)) ? Number(raw?.groundRatio) : 0.06,
      0,
      0.5
    ),
    fitWithinWidth: raw?.fitWithinWidth !== false
  }
}

function normalizeFrameSpec(raw?: Stage2dLayerFrameSpec | null): Stage2dLayerFrameSpec | null {
  const layerId = String(raw?.layerId ?? '').trim()
  if (!layerId) return null
  const cropRaw = raw?.crop
  if (!cropRaw || typeof cropRaw !== 'object') return { layerId, crop: null }
  const x = Number(cropRaw.x)
  const y = Number(cropRaw.y)
  const width = Number(cropRaw.width)
  const height = Number(cropRaw.height)
  const crop: SpriteBounds = {
    x: Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0,
    y: Number.isFinite(y) ? Math.max(0, Math.floor(y)) : 0,
    width: Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1,
    height: Number.isFinite(height) ? Math.max(1, Math.floor(height)) : 1
  }
  return { layerId, crop }
}

function normalizePivot(raw?: Stage2dLayerPivot | null): Stage2dLayerPivot | null {
  const x = Number(raw?.x)
  const y = Number(raw?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: Math.max(0, x), y: Math.max(0, y) }
}

/**
 * 归一化入参：层字段允许缺失（旧版持久化场景无 offset 等字段也要能吃下）。
 */
export type Stage2dSceneInput = Partial<Omit<Stage2dSceneState, 'layers'>> & {
  layers?: Array<Partial<Stage2dLayer> | null>
}

/**
 * 场景归一化：画布与逐层字段夹取到合法范围；剔除无源层。
 * 层序保持传入顺序（作为 z 序基准）。frame 引用自身 / 无效层时回退为
 * 普通层（防止共享几何自环）。
 */
export function normalizeStage2dScene(raw?: Stage2dSceneInput | null): Stage2dSceneState {
  const base = { ...DEFAULT_STAGE2D_SCENE, ...(raw ?? {}) }
  const sourceLayers: Stage2dLayer[] = Array.isArray(base.layers)
    ? base.layers
        .filter((l): l is Stage2dLayer => !!l && typeof l === 'object')
        .map((l, index) => ({
          id: l.id?.trim() || `layer-${index}`,
          name: String(l.name ?? l.id?.trim() ?? `Layer ${index + 1}`),
          sourceUrl: String(l.sourceUrl ?? ''),
          align: normalizeLayerAlign(l.align),
          offset: normalizeLayerOffset(l.offset),
          frame: normalizeFrameSpec(l.frame),
          pivot: normalizePivot(l.pivot),
          visible: l.visible !== false
        }))
        .filter((l) => !!l.sourceUrl)
    : []
  const layerIds = new Set(sourceLayers.map((layer) => layer.id))
  const layers = sourceLayers.map((layer) => {
    const frame = layer.frame
    if (frame && frame.layerId !== layer.id && layerIds.has(frame.layerId)) return layer
    return { ...layer, frame: null }
  })
  return {
    canvasWidth: clampInt(
      base.canvasWidth,
      MIN_CANVAS,
      MAX_CANVAS,
      DEFAULT_STAGE2D_SCENE.canvasWidth
    ),
    canvasHeight: clampInt(
      base.canvasHeight,
      MIN_CANVAS,
      MAX_CANVAS,
      DEFAULT_STAGE2D_SCENE.canvasHeight
    ),
    anchor: base.anchor === 'center' ? 'center' : 'ground',
    groundRatio: clamp(Number(base.groundRatio), 0, 0.5),
    layers
  }
}

/** 新增空层：id 唯一、默认对齐继承舞台语义 */
export function createStage2dLayer(input: {
  sourceUrl: string
  name?: string
  anchor?: SpriteAnchorKind
  contentHeightRatio?: number
  groundRatio?: number
}): Stage2dLayer {
  const align = normalizeLayerAlign({
    anchor: input.anchor,
    contentHeightRatio: input.contentHeightRatio,
    groundRatio: input.groundRatio,
    fitWithinWidth: true
  })
  return {
    id: `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: String(input.name || input.sourceUrl || 'Layer'),
    sourceUrl: String(input.sourceUrl ?? ''),
    align,
    offset: { x: 0, y: 0 },
    visible: true
  }
}

/** 把上游对齐参数转成层对齐（anchor / 比例字段同构，供继承 image.align） */
export function stage2dLayerAlignFromRaw(
  align?: Partial<Stage2dLayerAlign> | null
): Stage2dLayerAlign {
  return normalizeLayerAlign(align)
}

/** 舞台 ground 基线 y（px）；center 时为 -1（用画布中心） */
export function stage2dGroundY(scene: Stage2dSceneState): number {
  const s = normalizeStage2dScene(scene)
  if (s.anchor === 'center') return -1
  return Math.round(
    s.canvasHeight - (Number.isFinite(s.groundRatio) ? s.groundRatio : 0) * s.canvasHeight
  )
}

export interface Stage2dLayerPlacement {
  /** 归一化后的层 */
  layer: Stage2dLayer
  /** 单精灵统一对齐计划（空 bounds 或源非法时为 null） */
  plan: SpriteAlignPlan | null
  /** 该层主体外接框（源像素系）；层空源时为 null */
  bounds: SpriteBounds | null
}

/**
 * 逐层计算在舞台画布上的放置计划（顺序与 layers 一致）。
 * 纯几何；像素合成方只负责把每层 plan 的 dst 矩形叠绘到舞台画布。
 */
export function computeStage2dLayerPlacements(
  scene: Stage2dSceneState,
  perLayerSource: Array<{ srcWidth: number; srcHeight: number; bounds: SpriteBounds | null }>
): Stage2dLayerPlacement[] {
  const s = normalizeStage2dScene(scene)
  const placements: Stage2dLayerPlacement[] = s.layers.map((layer, index) => {
    const src = perLayerSource[index]
    if (!src || !src.bounds) {
      return { layer, plan: null, bounds: src?.bounds ?? null }
    }
    const plan = computeSpriteAlignPlan(
      { srcWidth: src.srcWidth, srcHeight: src.srcHeight, bounds: src.bounds },
      {
        canvasWidth: s.canvasWidth,
        canvasHeight: s.canvasHeight,
        anchor: layer.align.anchor,
        contentHeightRatio: layer.align.contentHeightRatio,
        groundRatio: layer.align.groundRatio,
        fitWithinWidth: layer.align.fitWithinWidth
      }
    )
    // 手动微调叠加在锚点落位之上（自动落位为主、微调为辅）
    const shifted = plan
      ? { ...plan, dstX: plan.dstX + layer.offset.x, dstY: plan.dstY + layer.offset.y }
      : null
    return { layer, plan: shifted, bounds: src.bounds }
  })
  // 部件层（frame）：放置几何继承参考层的缩放与落位（同图等比同框）
  return s.layers.map((layer, index) => {
    const base = placements[index]
    const frame = layer.frame
    if (!frame || !frame.crop || frame.layerId === layer.id) return base
    const frameIndex = s.layers.findIndex((l) => l.id === frame.layerId)
    const framePlacement = frameIndex >= 0 ? placements[frameIndex] : null
    if (
      frameIndex < 0 ||
      frameIndex === index ||
      !framePlacement ||
      !framePlacement.plan ||
      !framePlacement.bounds ||
      s.layers[frameIndex].frame // 参考层自身不可再是部件层（避免链式）
    ) {
      return base
    }
    const fp = framePlacement.plan
    const crop = frame.crop
    // 参考层内容坐标 → 画布：内容坐标 0,0 对应参考层 bounds 左上角，即 fp.dstX/dstY。
    // 用参考层自身的精确 scale（不要用取整后的 dstW/bounds.width 反推，避免子像素误差）
    const scale = fp.scale > 0 ? fp.scale : 0
    if (!(scale > 0)) return base
    const dstX = fp.dstX + Math.round(crop.x * scale)
    const dstY = fp.dstY + Math.round(crop.y * scale)
    const dstW = Math.max(1, Math.round(crop.width * scale))
    const dstH = Math.max(1, Math.round(crop.height * scale))
    const src = perLayerSource[index]
    const plan: SpriteAlignPlan = {
      canvasWidth: s.canvasWidth,
      canvasHeight: s.canvasHeight,
      anchor: 'ground',
      anchorX: Math.round(s.canvasWidth / 2),
      anchorY: fp.groundY,
      groundY: fp.groundY,
      bounds: { x: 0, y: 0, width: crop.width, height: crop.height },
      scale,
      dstX,
      dstY,
      dstW,
      dstH,
      srcWidth: Math.round(src?.srcWidth ?? crop.width),
      srcHeight: Math.round(src?.srcHeight ?? crop.height)
    }
    return {
      layer,
      plan,
      bounds: src?.bounds ?? { x: 0, y: 0, width: crop.width, height: crop.height }
    }
  })
}
