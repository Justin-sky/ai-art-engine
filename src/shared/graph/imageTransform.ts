/**
 * 图片变换（`image.transform`）：纯本地像素变换 —— 缩放 / 旋转 / 镜像 / 平移。
 *
 * 与 `image.crop` / `image.cutout` 一类「本地节点」同口径：执行**不调模型**，
 * 全部在渲染层 canvas 里完成，因此本文件只负责**契约与几何**，真正落笔在
 * `features/graph/model/composeImageTransformCanvas.ts`。
 *
 * 为什么几何放在 shared 而不是渲染层：编辑器要「所见即所得」地画同一套变换。
 * 若编辑器与执行器各写一份三角函数，两边一旦不一致，表现就是「预览和出图不一样」——
 * 这类 bug 只能在用起来之后靠肉眼发现。所以两边共用 `planImageTransform`。
 */

/** 输出画幅：`original` = 跟随源图（旋转时按外接框扩张，不裁掉内容） */
export const IMAGE_TRANSFORM_ASPECTS = [
  'original',
  '1:1',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '16:9',
  '9:16'
] as const
export type ImageTransformAspect = (typeof IMAGE_TRANSFORM_ASPECTS)[number]

/** 输出尺寸（长边像素）：`original` = 跟随源图 */
export const IMAGE_TRANSFORM_SIZES = ['original', '1K', '2K', '4K'] as const
export type ImageTransformSize = (typeof IMAGE_TRANSFORM_SIZES)[number]

/** 档位 → 长边像素（与「人像处理」的画幅档位同口径，避免同一套档位两处数字不一样） */
export const IMAGE_TRANSFORM_SIZE_EDGE: Readonly<Record<'1K' | '2K' | '4K', number>> = {
  '1K': 1024,
  '2K': 2048,
  '4K': 4096
}

/** 旋转 / 缩放后露出来的空白处怎么填 */
export const IMAGE_TRANSFORM_FILLS = ['transparent', 'white', 'black'] as const
export type ImageTransformFill = (typeof IMAGE_TRANSFORM_FILLS)[number]

export interface ImageTransformState {
  /** 缩放倍数：1 = 原始像素，<1 缩小，>1 放大 */
  scale: number
  /** 顺时针旋转角度（-180…180，任意角度；90 的整数倍时边角最干净） */
  rotate: number
  flipH: boolean
  flipV: boolean
  /** 平移（占输出画布的比例，-1…1；1 = 移出整幅宽度） */
  offsetX: number
  offsetY: number
  aspectId: ImageTransformAspect
  sizeId: ImageTransformSize
  fill: ImageTransformFill
}

export const IMAGE_TRANSFORM_LIMITS = {
  scaleMin: 0.1,
  scaleMax: 4,
  rotateLimit: 180,
  offsetLimit: 1
} as const

export const DEFAULT_IMAGE_TRANSFORM: Readonly<ImageTransformState> = {
  scale: 1,
  rotate: 0,
  flipH: false,
  flipV: false,
  offsetX: 0,
  offsetY: 0,
  aspectId: 'original',
  sizeId: 'original',
  fill: 'transparent'
}

/** 画幅比例表（`original` 由调用方按源图处理） */
const ASPECT_RATIOS: Readonly<Record<Exclude<ImageTransformAspect, 'original'>, number>> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '3:2': 3 / 2,
  '2:3': 2 / 3,
  '16:9': 16 / 9,
  '9:16': 9 / 16
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 把任意来源（旧工程 / 面板输入 / 导入预设）夹回合法状态 */
export function normalizeImageTransform(
  raw?: Partial<ImageTransformState> | null
): ImageTransformState {
  const source = raw ?? {}
  return {
    scale: clamp(
      finiteOr(source.scale, DEFAULT_IMAGE_TRANSFORM.scale),
      IMAGE_TRANSFORM_LIMITS.scaleMin,
      IMAGE_TRANSFORM_LIMITS.scaleMax
    ),
    rotate: clamp(
      finiteOr(source.rotate, DEFAULT_IMAGE_TRANSFORM.rotate),
      -IMAGE_TRANSFORM_LIMITS.rotateLimit,
      IMAGE_TRANSFORM_LIMITS.rotateLimit
    ),
    flipH: source.flipH === true,
    flipV: source.flipV === true,
    offsetX: clamp(
      finiteOr(source.offsetX, DEFAULT_IMAGE_TRANSFORM.offsetX),
      -IMAGE_TRANSFORM_LIMITS.offsetLimit,
      IMAGE_TRANSFORM_LIMITS.offsetLimit
    ),
    offsetY: clamp(
      finiteOr(source.offsetY, DEFAULT_IMAGE_TRANSFORM.offsetY),
      -IMAGE_TRANSFORM_LIMITS.offsetLimit,
      IMAGE_TRANSFORM_LIMITS.offsetLimit
    ),
    aspectId: IMAGE_TRANSFORM_ASPECTS.includes(source.aspectId as ImageTransformAspect)
      ? (source.aspectId as ImageTransformAspect)
      : DEFAULT_IMAGE_TRANSFORM.aspectId,
    sizeId: IMAGE_TRANSFORM_SIZES.includes(source.sizeId as ImageTransformSize)
      ? (source.sizeId as ImageTransformSize)
      : DEFAULT_IMAGE_TRANSFORM.sizeId,
    fill: IMAGE_TRANSFORM_FILLS.includes(source.fill as ImageTransformFill)
      ? (source.fill as ImageTransformFill)
      : DEFAULT_IMAGE_TRANSFORM.fill
  }
}

/** 是否「什么都没做」（编辑器据此提示，执行器据此决定要不要真的重画一遍） */ export function isIdentityImageTransform(
  state: ImageTransformState
): boolean {
  return (
    state.scale === 1 &&
    state.rotate === 0 &&
    !state.flipH &&
    !state.flipV &&
    state.offsetX === 0 &&
    state.offsetY === 0 &&
    state.aspectId === 'original' &&
    state.sizeId === 'original'
  )
}

/**
 * 变换计划：输出画布尺寸 + 源图在画布上的画法（缩放 / 旋转 / 翻转 / 平移）。
 *
 * 画布尺寸规则（这是本节点的核心契约，编辑器预览与执行器落笔都必须照它走）：
 * 1. `aspectId = original` 且 `sizeId = original`：画布 = 源图**旋转后的外接框**，所以旋转不会裁掉内容；
 * 2. `aspectId = original` 且选了档位：画布 = 源图比例 + 该档长边（旋转后可能超框，由用户自己决定）；
 * 3. 选了具体画幅：画布 = 该比例 + 长边（未选档位时用源图长边），源图按 `scale` 放进去。
 *
 * 画法顺序固定：**缩放 → 旋转（绕画布中心）→ 平移**，翻转在旋转前施加（镜像后再转＝逆着转，符合直觉）。
 */
export interface ImageTransformPlan {
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  /** 源图绘制尺寸（缩放后的像素尺寸） */
  drawWidth: number
  drawHeight: number
  rotate: number
  flipH: boolean
  flipV: boolean
  /** 平移像素（相对画布中心） */
  offsetX: number
  offsetY: number
  fill: ImageTransformFill
}

export function planImageTransform(
  sourceWidth: number,
  sourceHeight: number,
  state: ImageTransformState
): ImageTransformPlan {
  const safeSourceWidth = Math.max(1, Math.round(finiteOr(sourceWidth, 1)))
  const safeSourceHeight = Math.max(1, Math.round(finiteOr(sourceHeight, 1)))
  const aspect = state.aspectId === 'original' ? null : ASPECT_RATIOS[state.aspectId]
  const edge =
    state.sizeId === 'original'
      ? Math.max(safeSourceWidth, safeSourceHeight)
      : IMAGE_TRANSFORM_SIZE_EDGE[state.sizeId]

  let width: number
  let height: number
  if (!aspect && state.sizeId === 'original') {
    // 规则 1：旋转后按外接框扩张（90° 的整数倍时就是原尺寸的交换）
    const radians = (state.rotate * Math.PI) / 180
    const cos = Math.abs(Math.cos(radians))
    const sin = Math.abs(Math.sin(radians))
    width = safeSourceWidth * cos + safeSourceHeight * sin
    height = safeSourceWidth * sin + safeSourceHeight * cos
  } else if (aspect) {
    // 规则 3：按画幅比例拟合长边
    if (aspect >= 1) {
      width = edge
      height = edge / aspect
    } else {
      height = edge
      width = edge * aspect
    }
  } else {
    // 规则 2：源图比例 + 档位长边
    const ratio = safeSourceWidth / safeSourceHeight
    if (ratio >= 1) {
      width = edge
      height = edge / ratio
    } else {
      height = edge
      width = edge * ratio
    }
  }

  const outWidth = Math.max(1, Math.round(width))
  const outHeight = Math.max(1, Math.round(height))
  const scale = clamp(state.scale, IMAGE_TRANSFORM_LIMITS.scaleMin, IMAGE_TRANSFORM_LIMITS.scaleMax)

  return {
    width: outWidth,
    height: outHeight,
    sourceWidth: safeSourceWidth,
    sourceHeight: safeSourceHeight,
    drawWidth: Math.max(1, Math.round(safeSourceWidth * scale)),
    drawHeight: Math.max(1, Math.round(safeSourceHeight * scale)),
    rotate: state.rotate,
    flipH: state.flipH,
    flipV: state.flipV,
    offsetX: Math.round(state.offsetX * outWidth),
    offsetY: Math.round(state.offsetY * outHeight),
    fill: state.fill
  }
}

/**
 * 一行英文日志（进运行日志；刻意不用中文 —— 与 `portraitFraming` 的日志同口径，
 * 而且 `scripts/check-hardcoded-cjk.mjs` 会拦住 shared 里的硬编码中文）。
 */
export function describeImageTransform(plan: ImageTransformPlan): string {
  const parts = [
    `${plan.sourceWidth}x${plan.sourceHeight} -> ${plan.width}x${plan.height}`,
    `scale ${(plan.drawWidth / plan.sourceWidth).toFixed(2)}`
  ]
  if (plan.rotate) parts.push(`rotate ${plan.rotate}deg`)
  if (plan.flipH) parts.push('flip H')
  if (plan.flipV) parts.push('flip V')
  if (plan.offsetX || plan.offsetY) parts.push(`offset ${plan.offsetX},${plan.offsetY}px`)
  if (plan.fill !== 'transparent') parts.push(`fill ${plan.fill}`)
  return `transform: ${parts.join(' · ')}`
}

/** 从节点参数读取（并夹回合法）图片变换参数 */
export function readImageTransformFromNode(
  params?: { imageTransform?: Partial<ImageTransformState> | null } | null
): ImageTransformState {
  return normalizeImageTransform(params?.imageTransform)
}

/** 编辑器 → 节点参数补丁（与 `imageCropToNodePatch` 同口径，宿主与单测统一走它） */
export function imageTransformToNodePatch(state: ImageTransformState): {
  imageTransform: ImageTransformState
} {
  return { imageTransform: normalizeImageTransform(state) }
}
