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

/**
 * 提取精灵主体的水平躯干主轴 X 坐标（源图像素系）。
 *
 * 为什么不用外接框中心 `bounds.x + bounds.width / 2`？
 * 当角色在某一帧向前挥剑、伸手或踢腿时，外接框单侧显著外扩，若按外接框中心居中，
 * 会把角色躯干往反方向拉扯（产生“太空步/躯干反向抽动”）。
 *
 * 算法：取主体框纵向核心躯干带 `[y0 + 0.15*H, y0 + 0.85*H]`，统计每一列 `x` 的不透明像素数 `colCount`，
 * 并以 `colCount^2`（列纵向厚度平方）作为权重求加权质心 X。
 * 头+胸+胯所在的躯干立柱纵向厚度大，权重占绝对主导；横向伸出的武器/手臂纵向厚度薄，权重极小，
 * 从而将水平锚点牢牢锁定在角色脊椎中轴线上。
 */
export function extractSpriteCorePivotX(
  data: Uint8Array | Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  bounds?: SpriteBounds | null,
  options?: { alphaMin?: number }
): number | null {
  const b = bounds ?? extractAlphaBounds(data, srcWidth, srcHeight, options)
  if (!b || b.width <= 0 || b.height <= 0) return null
  const alphaMin = Math.max(0, Math.min(255, Math.round(options?.alphaMin ?? 12)))
  const xStart = Math.max(0, Math.floor(b.x))
  const xEnd = Math.min(srcWidth - 1, Math.ceil(b.x + b.width - 1))
  const bandY0 = Math.max(0, Math.floor(b.y + b.height * 0.15))
  const bandY1 = Math.min(srcHeight - 1, Math.ceil(b.y + b.height * 0.85))
  const yStart = bandY1 >= bandY0 ? bandY0 : Math.max(0, Math.floor(b.y))
  const yEnd = bandY1 >= bandY0 ? bandY1 : Math.min(srcHeight - 1, Math.ceil(b.y + b.height - 1))

  let weightedX = 0
  let totalWeight = 0
  for (let x = xStart; x <= xEnd; x++) {
    let colCount = 0
    for (let y = yStart; y <= yEnd; y++) {
      const a = data[(y * srcWidth + x) * 4 + 3]!
      if (a >= alphaMin) colCount++
    }
    if (colCount > 0) {
      const w = colCount * colCount
      weightedX += (x + 0.5) * w
      totalWeight += w
    }
  }
  if (totalWeight <= 0) {
    return b.x + b.width / 2
  }
  return weightedX / totalWeight
}

export interface StabilizedCellPlacementInput {
  cellWidth: number
  cellHeight: number
  bounds: SpriteBounds
  /** 躯干水平主轴 X（源格像素系）；缺省回退外接框中心 */
  pivotX?: number | null
  mode: 'ground' | 'center'
  /** 同序列多格的中位主体高度（用于消除 AI 跨格忽大忽小的呼吸抖动） */
  referenceHeightPx?: number | null
  /** 地面基线占格高比例（默认 0.94） */
  groundYRatio?: number
}

export interface StabilizedCellPlacement {
  dstX: number
  dstY: number
  dstW: number
  dstH: number
  scale: number
}

/**
 * 计算序列帧单格的原地稳像放置矩形（支持躯干主轴水平防抖 + 跨格身高尺度归一化）。
 */
export function computeStabilizedCellPlacement(
  input: StabilizedCellPlacementInput
): StabilizedCellPlacement {
  const { cellWidth, cellHeight, bounds, mode } = input
  let scale = 1
  if (
    typeof input.referenceHeightPx === 'number' &&
    Number.isFinite(input.referenceHeightPx) &&
    input.referenceHeightPx > 4 &&
    bounds.height > 4
  ) {
    const ratio = input.referenceHeightPx / bounds.height
    if (ratio >= 0.75 && ratio <= 1.32) {
      scale = clamp(ratio, 0.84, 1.18)
    }
  }
  if (scale > 1) {
    const maxWScale = (cellWidth * 0.96) / Math.max(1, bounds.width)
    const maxHScale = (cellHeight * (mode === 'ground' ? 0.92 : 0.96)) / Math.max(1, bounds.height)
    scale = Math.max(1, Math.min(scale, maxWScale, maxHScale))
  }

  const dstW = Math.max(1, Math.round(bounds.width * scale))
  const dstH = Math.max(1, Math.round(bounds.height * scale))
  const pivotOffset =
    (typeof input.pivotX === 'number' && Number.isFinite(input.pivotX)
      ? input.pivotX - bounds.x
      : bounds.width / 2) * scale

  let dstX = Math.round(cellWidth / 2 - pivotOffset)
  if (dstW <= cellWidth) {
    dstX = clampInt(dstX, 0, cellWidth - dstW)
  } else {
    dstX = Math.round((cellWidth - dstW) / 2)
  }

  const groundRatio = clamp(Number(input.groundYRatio ?? 0.94), 0.5, 0.99)
  const dstY =
    mode === 'ground'
      ? clampInt(Math.round(cellHeight * groundRatio) - dstH, 0, Math.max(0, cellHeight - dstH))
      : Math.round((cellHeight - dstH) / 2)

  return { dstX, dstY, dstW, dstH, scale }
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

/* ================= PixelOver 级精灵后处理：真像素网格规整 / 自动外描边 / 脚底接地阴影 ================= */

export type SpriteOutlineColor = '' | 'black' | 'white' | 'gold' | 'cyan'

/**
 * 真像素网格规整（Pixel-Art Grid Snap）：
 * 将 AI 生成的“伪像素画（大小不一的 Mixels 与模糊抗锯齿边缘）”按 `pixelSize × pixelSize` 晶格重采样，
 * 并把半透明毛边二值化为锐利像素边界（alpha >= 110 → 255，否则 0）。
 */
export function applySpritePixelSnap(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  pixelSize: number
): Uint8ClampedArray {
  const step = Math.floor(Number(pixelSize) || 0)
  if (step <= 1 || width <= 0 || height <= 0 || rgba.length < width * height * 4) {
    return rgba
  }
  const clampedStep = Math.min(16, Math.max(2, step))
  for (let by = 0; by < height; by += clampedStep) {
    const bh = Math.min(clampedStep, height - by)
    for (let bx = 0; bx < width; bx += clampedStep) {
      const bw = Math.min(clampedStep, width - bx)
      const cx = bx + Math.floor(bw / 2)
      const cy = by + Math.floor(bh / 2)
      let sampleIdx = (cy * width + cx) * 4
      let opaqueCount = 0
      const total = bw * bh
      for (let yy = by; yy < by + bh; yy++) {
        for (let xx = bx; xx < bx + bw; xx++) {
          const p = (yy * width + xx) * 4
          if (rgba[p + 3]! >= 110) {
            opaqueCount++
            if (rgba[sampleIdx + 3]! < 110) sampleIdx = p
          }
        }
      }
      const isOpaque = opaqueCount >= Math.max(1, Math.ceil(total * 0.4))
      const r = isOpaque ? rgba[sampleIdx]! : 0
      const g = isOpaque ? rgba[sampleIdx + 1]! : 0
      const b = isOpaque ? rgba[sampleIdx + 2]! : 0
      const a = isOpaque ? 255 : 0
      for (let yy = by; yy < by + bh; yy++) {
        for (let xx = bx; xx < bx + bw; xx++) {
          const p = (yy * width + xx) * 4
          rgba[p] = r
          rgba[p + 1] = g
          rgba[p + 2] = b
          rgba[p + 3] = a
        }
      }
    }
  }
  return rgba
}

const OUTLINE_RGB_MAP: Record<
  Exclude<SpriteOutlineColor, ''>,
  readonly [number, number, number]
> = {
  black: [17, 24, 39],
  white: [255, 255, 255],
  gold: [250, 204, 21],
  cyan: [34, 211, 238]
}

/**
 * 精灵外轮廓描边生成（1px 四连通 / 2px 八连通干净像素外描边）：
 * 在主体不透明像素（alpha >= 140）外围紧贴生成统一色外描边，统一多帧边缘质感。
 */
export function applySpriteOuterOutline(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: { color: SpriteOutlineColor; thickness?: 1 | 2 }
): Uint8ClampedArray {
  if (!options.color || !(options.color in OUTLINE_RGB_MAP)) return rgba
  const w = Math.floor(width)
  const h = Math.floor(height)
  const total = w * h
  if (total <= 0 || rgba.length < total * 4) return rgba

  const [or, og, ob] = OUTLINE_RGB_MAP[options.color as Exclude<SpriteOutlineColor, ''>]
  const thick = options.thickness === 2 ? 2 : 1
  const fg = new Uint8Array(total)
  for (let i = 0; i < total; i++) {
    if (rgba[i * 4 + 3]! >= 140) fg[i] = 1
  }

  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      const idx = row + x
      if (fg[idx]) continue
      let touchesFg = false
      if (thick === 1) {
        if (
          (x > 0 && fg[idx - 1]) ||
          (x + 1 < w && fg[idx + 1]) ||
          (y > 0 && fg[idx - w]) ||
          (y + 1 < h && fg[idx + w])
        ) {
          touchesFg = true
        }
      } else {
        for (let dy = -1; dy <= 1 && !touchesFg; dy++) {
          const ny = y + dy
          if (ny < 0 || ny >= h) continue
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx
            if (nx >= 0 && nx < w && fg[ny * w + nx]) {
              touchesFg = true
              break
            }
          }
        }
      }
      if (touchesFg) {
        const p = idx * 4
        rgba[p] = or
        rgba[p + 1] = og
        rgba[p + 2] = ob
        rgba[p + 3] = 255
      }
    }
  }
  return rgba
}

/**
 * 脚底接触椭圆阴影（Destination-Over 底层合成，不污染角色双脚像素）：
 * 根据主体外接框与躯干水平主轴，在脚底基线处绘制半透明贴地椭圆阴影，增强游戏落地感。
 */
export function applySpriteGroundShadow(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  bounds?: SpriteBounds | null,
  options?: { groundYRatio?: number; maxAlpha?: number }
): Uint8ClampedArray {
  const w = Math.floor(width)
  const h = Math.floor(height)
  if (w <= 8 || h <= 8 || rgba.length < w * h * 4) return rgba
  const b = bounds ?? extractAlphaBounds(rgba, w, h, { alphaMin: 20 })
  if (!b || b.width <= 4 || b.height <= 4) return rgba

  const cx = extractSpriteCorePivotX(rgba, w, h, b, { alphaMin: 20 }) ?? b.x + b.width / 2
  const groundY = Math.round(h * clamp(Number(options?.groundYRatio ?? 0.94), 0.5, 0.99))
  const cy = clampInt(Math.max(b.y + b.height - 2, groundY), 2, h - 2)
  const rx = Math.max(5, Math.min(Math.round(w * 0.42), Math.round(b.width * 0.38)))
  const ry = Math.max(2, Math.min(12, Math.round(h * 0.036)))
  const maxAlpha = clampInt(options?.maxAlpha ?? 110, 20, 220)

  const x0 = Math.max(0, Math.floor(cx - rx))
  const x1 = Math.min(w - 1, Math.ceil(cx + rx))
  const y0 = Math.max(0, Math.floor(cy - ry))
  const y1 = Math.min(h - 1, Math.ceil(cy + ry))

  for (let y = y0; y <= y1; y++) {
    const dy = (y - cy) / ry
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx
      const distSq = dx * dx + dy * dy
      if (distSq > 1) continue
      const shadowA = Math.round(maxAlpha * (1 - distSq * 0.7))
      if (shadowA <= 0) continue
      const p = (y * w + x) * 4
      const fgA = rgba[p + 3]!
      if (fgA >= 250) continue
      if (fgA === 0) {
        rgba[p] = 10
        rgba[p + 1] = 14
        rgba[p + 2] = 24
        rgba[p + 3] = shadowA
      } else {
        const fa = fgA / 255
        const sa = (shadowA / 255) * (1 - fa)
        const outA = fa + sa
        if (outA > 0) {
          rgba[p] = Math.round((rgba[p]! * fa + 10 * sa) / outA)
          rgba[p + 1] = Math.round((rgba[p + 1]! * fa + 14 * sa) / outA)
          rgba[p + 2] = Math.round((rgba[p + 2]! * fa + 24 * sa) / outA)
          rgba[p + 3] = clampInt(outA * 255, 0, 255)
        }
      }
    }
  }
  return rgba
}
