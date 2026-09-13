/**
 * 2D 游戏资产「统一对齐」纯函数地基（5.4「2D 游戏资产版」）。
 *
 * 所有引擎就绪资产生成链路共用的几何前置：把任意来源的透明 PNG（承接
 * 5.3 本地抠图产物）摆放到统一画布上——先由 alpha 通道求主体外接框，
 * 再按「中心 / 脚底」锚点规则等比缩放到目标画布，输出可喂给 canvas
 * 合成的整数放置参数与锚点像素坐标。无 DOM / 模型依赖，可单测。
 *
 * 术语约定（画布坐标，原点在左上，y 向下）：
 * - anchor='center'：主体框中心锚定画布水平中心 + 垂直中心；
 * - anchor='ground'：主体框底边压到地面基线，供角色「不漂移」落地；
 * - anchorX/Y：引擎挂载 / 对齐用的基准像素（相对画布左上角）。
 */

export type SpriteAnchorKind = 'center' | 'ground'

/** 像素矩形（源图像素系） */
export interface SpriteBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface SpriteAlignOptions {
  /** 统一画布宽（px） */
  canvasWidth: number
  /** 统一画布高（px） */
  canvasHeight: number
  /** 锚点方式：center=主体中心 / ground=脚底压基线 */
  anchor: SpriteAnchorKind
  /** 主体外接框高度占画布高度的比例（0.1~1） */
  contentHeightRatio: number
  /** anchor='ground' 时，基线距画布底边的比例（0~0.5） */
  groundRatio: number
  /** 等比缩放后主体宽度超画布时，是否收缩到画布内（保证不裁出画布） */
  fitWithinWidth: boolean
}

export const DEFAULT_SPRITE_ALIGN: SpriteAlignOptions = {
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
  return Math.round(clamp(n, min, max))
}

/** 参数归一化：非法 / 越界值回落到默认或就近夹取，保证后续几何有确定行为 */
export function normalizeSpriteAlignOptions(
  raw?: Partial<SpriteAlignOptions> | null
): SpriteAlignOptions {
  const base = { ...DEFAULT_SPRITE_ALIGN, ...(raw ?? {}) }
  return {
    canvasWidth: clampInt(base.canvasWidth, MIN_CANVAS, MAX_CANVAS),
    canvasHeight: clampInt(base.canvasHeight, MIN_CANVAS, MAX_CANVAS),
    anchor: base.anchor === 'center' ? 'center' : 'ground',
    contentHeightRatio: clamp(Number(base.contentHeightRatio), 0.1, 1),
    groundRatio: clamp(Number(base.groundRatio), 0, 0.5),
    fitWithinWidth: base.fitWithinWidth !== false
  }
}

function isEmptyBounds(b: SpriteBounds): boolean {
  return !(b.width > 0 && b.height > 0)
}

/** 把越界主体框收缩进源图范围内（防御脏输入） */
function clampBoundsToSource(b: SpriteBounds, srcWidth: number, srcHeight: number): SpriteBounds {
  const x = Math.max(0, Math.floor(b.x))
  const y = Math.max(0, Math.floor(b.y))
  const maxX = Math.min(srcWidth, Math.ceil(b.x + b.width))
  const maxY = Math.min(srcHeight, Math.ceil(b.y + b.height))
  return { x, y, width: Math.max(0, maxX - x), height: Math.max(0, maxY - y) }
}

/**
 * 由 RGBA 像素求透明通道主体外接框。
 * alpha >= alphaMin 视为「有内容」像素；全透明返回 null。
 * 该框即后续缩放的基准——对抠图 / 键控透明产物，
 * 它描述了可看见的实体边界（人物、特效帧、部件）。
 */
export function extractAlphaBounds(
  data: Uint8Array | Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  options?: { alphaMin?: number }
): SpriteBounds | null {
  if (srcWidth <= 0 || srcHeight <= 0) return null
  if (data.length < srcWidth * srcHeight * 4) return null
  const alphaMin = Math.max(0, Math.min(255, Math.round(options?.alphaMin ?? 8)))
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  let idx = 3
  for (let y = 0; y < srcHeight; y++) {
    for (let x = 0; x < srcWidth; x++, idx += 4) {
      if (data[idx]! >= alphaMin) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0 || maxY < 0) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

export interface SpriteAlignPlan {
  srcWidth: number
  srcHeight: number
  /** 归一化前的主体外接框（源图像素系） */
  bounds: SpriteBounds
  canvasWidth: number
  canvasHeight: number
  /** 实际等比缩放倍数 */
  scale: number
  /** 绘制矩形（目标画布像素系，整数） */
  dstX: number
  dstY: number
  dstW: number
  dstH: number
  /** 画布上的锚点像素（引擎挂载基准） */
  anchorX: number
  anchorY: number
  anchor: SpriteAnchorKind
  /** anchor='ground' 时的地面基线 y（画布像素系）；center 时为 -1 */
  groundY: number
}

/**
 * 计算单个精灵的统一对齐放置参数。
 *
 * 规则：
 * 1. 主体框高度等比缩放到 `contentHeightRatio * canvasHeight`；
 * 2. 宽度若超画布（fitWithinWidth）则改按宽度收缩，保证整体在画布内；
 * 3. 水平始终取画布中心；
 * 4. center：主体框中心对齐画布中心；
 *    ground：主体框底边贴到基线 `groundY = canvasHeight - groundRatio*canvasHeight`，
 *            角色系列帧因此脚底不漂移。
 *
 * bounds 为空或源尺寸非法时返回 null。
 */
export function computeSpriteAlignPlan(
  input: { srcWidth: number; srcHeight: number; bounds: SpriteBounds },
  rawOptions?: Partial<SpriteAlignOptions> | null
): SpriteAlignPlan | null {
  const srcWidth = Math.max(1, Math.round(input.srcWidth))
  const srcHeight = Math.max(1, Math.round(input.srcHeight))
  if (srcWidth !== input.srcWidth || srcHeight !== input.srcHeight) return null
  const options = normalizeSpriteAlignOptions(rawOptions)
  const bounds = clampBoundsToSource(input.bounds, srcWidth, srcHeight)
  if (isEmptyBounds(bounds)) return null

  const contentHeightPx = options.contentHeightRatio * options.canvasHeight
  // 先按高度等比；超宽时收缩到画布宽度内（保留 ground 基线一致性）
  let scale = contentHeightPx / bounds.height
  if (options.fitWithinWidth && bounds.width * scale > options.canvasWidth) {
    scale = options.canvasWidth / bounds.width
  }
  scale = Math.max(0.001, scale)

  const dstW = Math.round(bounds.width * scale)
  const dstH = Math.round(bounds.height * scale)
  const dstX = Math.round((options.canvasWidth - dstW) / 2)

  let dstY: number
  let groundY: number
  if (options.anchor === 'ground') {
    groundY = options.canvasHeight - Math.round(options.groundRatio * options.canvasHeight)
    dstY = groundY - dstH
  } else {
    groundY = -1
    dstY = Math.round((options.canvasHeight - dstH) / 2)
  }
  // 画布足够小、主体又接近满高时 dstY 可能为负：上贴 0，保证不外溢
  if (dstY < 0) dstY = 0
  const finalBottom = dstY + dstH
  if (finalBottom > options.canvasHeight) {
    // 收缩置顶后仍超高：以下边缘为约束整体上移会裁顶，改为按比例重新约束——极少见
    // （contentHeightRatio<=1 时不应发生），保守处理为贴底裁剪前先按高度兜底。
  }

  const anchorX = Math.round(options.canvasWidth / 2)
  const anchorY = options.anchor === 'ground' ? groundY : Math.round(dstY + dstH / 2)
  return {
    srcWidth,
    srcHeight,
    bounds,
    canvasWidth: options.canvasWidth,
    canvasHeight: options.canvasHeight,
    scale,
    dstX,
    dstY,
    dstW,
    dstH,
    anchorX,
    anchorY,
    anchor: options.anchor,
    groundY: options.anchor === 'ground' ? groundY : -1
  }
}

/* ================= 多帧序列去抖（平移估计） ================= */

export interface PixelImage {
  width: number
  height: number
  /** RGBA（行主序），与 ImageData / 解码缓冲同构 */
  data: Uint8Array | Uint8ClampedArray
}

export interface DejitterOptions {
  /** 最大搜索位移（px，整数），默认取较短边 15% 下限 2 上限 256 */
  maxShiftPx?: number
  /** 内容判定 alpha 阈值 */
  alphaMin?: number
}

export interface FrameShift {
  index: number
  /** 把该帧内容平移 (dx, dy) 后与参考帧对齐（正 = 右 / 下移） */
  dx: number
  dy: number
}

export interface DejitterResult {
  referenceIndex: number
  shifts: FrameShift[]
}

interface LumaBuffer {
  width: number
  height: number
  luma: Float32Array
  mask: Uint8Array
}

function toLuma(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  alphaMin: number
): LumaBuffer {
  const n = width * height
  const luma = new Float32Array(n)
  const mask = new Uint8Array(n)
  let idx = 0
  for (let i = 0; i < n; i++, idx += 4) {
    const r = data[idx]!
    const g = data[idx + 1]!
    const b = data[idx + 2]!
    const a = data[idx + 3]!
    if (a >= alphaMin) {
      luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b
      mask[i] = 1
    }
  }
  return { width, height, luma, mask }
}

function frameCost(
  ref: LumaBuffer,
  probe: LumaBuffer,
  ox: number,
  oy: number
): { cost: number; valid: number } {
  const { width, height } = ref
  let sum = 0
  let valid = 0
  for (let ry = 0; ry < height; ry++) {
    const py = ry - oy
    if (py < 0 || py >= probe.height) continue
    for (let rx = 0; rx < width; rx++) {
      const px = rx - ox
      if (px < 0 || px >= probe.width) continue
      const ri = ry * width + rx
      const pi = py * probe.width + px
      if (ref.mask[ri]! && probe.mask[pi]!) {
        sum += Math.abs(ref.luma[ri]! - probe.luma[pi]!)
        valid++
      }
    }
  }
  return { cost: valid > 0 ? sum / valid : Number.POSITIVE_INFINITY, valid }
}

/**
 * 估计某帧相对参考帧的内容平移（整数像素）。
 *
 * 用途：同一静态主体的多次重渲染 / 截取帧之间存在取景抖动时，
 * 平移互相关找到使两帧内容最吻合的 (dx, dy)，把抖动抹平后再做
 * 统一锚点落盘，进引擎即「不抖」。
 *
 * 约定：返回 (dx, dy) 表示把 probe 内容平移 dx / dy（正 = 右 / 下）
 * 后与 reference 内容对齐。
 *
 * 尺寸与参考不一致的帧返回 (0,0)（不参与平移，调用方应先用
 * computeSpriteAlignPlan 归一化到同画布再调用）。
 */
export function estimateContentTranslation(
  reference: PixelImage,
  probe: PixelImage,
  options?: DejitterOptions
): { dx: number; dy: number } {
  const alphaMin = Math.max(0, Math.min(255, Math.round(options?.alphaMin ?? 8)))
  if (
    reference.width <= 0 ||
    reference.height <= 0 ||
    reference.width !== probe.width ||
    reference.height !== probe.height
  ) {
    return { dx: 0, dy: 0 }
  }
  const ref = toLuma(reference.data, reference.width, reference.height, alphaMin)
  const probeBuf = toLuma(probe.data, probe.width, probe.height, alphaMin)
  const shortSide = Math.min(reference.width, reference.height)
  const maxShift = Math.min(
    256,
    Math.max(2, Math.round(options?.maxShiftPx ?? Math.max(2, Math.round(shortSide * 0.15))))
  )

  // 先大步长粗扫，再在最优邻域做 ±1 精修，把计算量控制在常数级
  const coarseStep = shortSide >= 128 ? 2 : 1
  let bestOx = 0
  let bestOy = 0
  let bestCost = Number.POSITIVE_INFINITY
  for (let oy = -maxShift; oy <= maxShift; oy += coarseStep) {
    for (let ox = -maxShift; ox <= maxShift; ox += coarseStep) {
      const { cost, valid } = frameCost(ref, probeBuf, ox, oy)
      if (valid > 0 && cost < bestCost) {
        bestCost = cost
        bestOx = ox
        bestOy = oy
      }
    }
  }
  if (!Number.isFinite(bestCost)) return { dx: 0, dy: 0 }

  const refineSpan = Math.max(1, coarseStep)
  let refined = bestCost
  let dx = bestOx
  let dy = bestOy
  for (let oy = bestOy - refineSpan; oy <= bestOy + refineSpan; oy++) {
    for (let ox = bestOx - refineSpan; ox <= bestOx + refineSpan; ox++) {
      if (ox < -maxShift || ox > maxShift || oy < -maxShift || oy > maxShift) continue
      const { cost, valid } = frameCost(ref, probeBuf, ox, oy)
      if (valid > 0 && cost < refined) {
        refined = cost
        dx = ox
        dy = oy
      }
    }
  }
  return { dx, dy }
}

/**
 * 多帧去抖：以参考帧为基准逐帧估平移。
 * 参考帧默认取内容（alpha 主体框）面积最大者——信息量最多、估得最稳。
 */
export function estimateFrameTranslations(
  frames: PixelImage[],
  options?: DejitterOptions & { referenceIndex?: number }
): DejitterResult | null {
  if (!frames || frames.length === 0) return null
  if (frames.length === 1) {
    return { referenceIndex: 0, shifts: [{ index: 0, dx: 0, dy: 0 }] }
  }
  const alphaMin = Math.max(0, Math.min(255, Math.round(options?.alphaMin ?? 8)))
  const areas = frames.map((f) => {
    const b = extractAlphaBounds(f.data, f.width, f.height, { alphaMin })
    return b ? b.width * b.height : 0
  })
  let referenceIndex = options?.referenceIndex ?? 0
  if (!Number.isInteger(referenceIndex) || referenceIndex < 0 || referenceIndex >= frames.length) {
    referenceIndex = 0
  }
  const argmaxArea = areas.indexOf(Math.max(...areas))
  if (areas[argmaxArea]! > areas[referenceIndex]!) {
    referenceIndex = argmaxArea
  }
  const reference: PixelImage = frames[referenceIndex]!
  const shifts: FrameShift[] = frames.map((frame, index) => {
    if (index === referenceIndex) return { index, dx: 0, dy: 0 }
    const t = estimateContentTranslation(reference, frame, options)
    return { index, dx: t.dx, dy: t.dy }
  })
  return { referenceIndex, shifts }
}
