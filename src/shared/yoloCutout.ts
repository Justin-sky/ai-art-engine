/**
 * 本地一键抠图 — 纯函数层（无 DOM 依赖，主进程 / 渲染层 / 测试共用）。
 *
 * YOLO 实例分割给出的 mask 是 maskHw×maskHw 的网格（由模型 proto 反推，通常 160），
 * 覆盖完整的 640×640 letterbox 画布，而不是 box 内的局部图。
 * 本模块负责把它换算回原图坐标，生成可直接当 alpha 通道用的软边掩码：
 *
 *   原图像素 x → letterbox 坐标 x * scale + padX → mask 网格坐标（双线性采样）
 *
 * 再叠加「置信度阈值 + 边缘羽化」两个可调参数，渲染层即可合成透明 PNG 资产。
 */
import { YOLO_INPUT_SIZE, type YoloBox, type YoloLetterboxGeometry } from './yolo'

/** 原图坐标系中的矩形区域（整数像素） */
export interface CutoutRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface CutoutAlphaInput {
  /** 需要保留的实例 mask（softMask=true 时为 0~255 概率，否则 0/1 二值） */
  masks: Uint8Array[]
  /** mask 网格边长（masks[0].width，通常 160） */
  maskHw: number
  /** data 是否为 0~255 概率；false 时按 0/1 二值处理 */
  soft?: boolean
  /** worker 返回的 letterbox 几何；缺省按原图尺寸复算 */
  letterbox?: YoloLetterboxGeometry
  /** 原图宽度（推理输入尺寸） */
  srcWidth: number
  /** 原图高度（推理输入尺寸） */
  srcHeight: number
  /** 输出区域（原图坐标）；缺省整图 */
  region?: CutoutRegion
  /** mask 概率阈值 0~1，低于阈值视为背景。默认 0.5 */
  threshold?: number
  /** 边缘羽化半径（输出像素），0 表示保留硬边 */
  feather?: number
  /**
   * 输出相对 region 的分辨率倍率。
   * 推理可能在缩放图上进行（省 IPC / 推理开销），但抠图要按原图分辨率输出时，
   * 直接从 mask 网格采样到目标分辨率即可，无需二次放大。默认 1。
   */
  outScale?: number
}

function clampInt(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/**
 * 复刻 YOLO 前处理的 letterbox 几何（worker 未返回时的兜底路径）。
 * 公式必须与 src/main/yolo/preprocess.ts 保持一致，否则掩码会整体偏移。
 */
export function letterboxGeometryFor(
  srcWidth: number,
  srcHeight: number,
  size: number = YOLO_INPUT_SIZE
): YoloLetterboxGeometry {
  const w = Math.max(1, srcWidth)
  const h = Math.max(1, srcHeight)
  const scale = Math.min(size / w, size / h)
  const newW = Math.max(1, Math.round(w * scale))
  const newH = Math.max(1, Math.round(h * scale))
  return {
    size,
    scale,
    padX: Math.floor((size - newW) / 2),
    padY: Math.floor((size - newH) / 2)
  }
}

/** 网格连续坐标处的概率（双线性插值；letterbox 填充区一律视为背景） */
function probabilityAt(
  data: Uint8Array,
  maskHw: number,
  soft: boolean,
  gx: number,
  gy: number
): number {
  if (gx < -0.5 || gy < -0.5 || gx > maskHw - 0.5 || gy > maskHw - 0.5) return 0
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const fx = gx - x0
  const fy = gy - y0
  const cx0 = clampInt(x0, 0, maskHw - 1)
  const cy0 = clampInt(y0, 0, maskHw - 1)
  const cx1 = clampInt(x0 + 1, 0, maskHw - 1)
  const cy1 = clampInt(y0 + 1, 0, maskHw - 1)
  const unit = soft ? 1 / 255 : 1
  const v00 = data[cy0 * maskHw + cx0]! * unit
  const v10 = data[cy0 * maskHw + cx1]! * unit
  const v01 = data[cy1 * maskHw + cx0]! * unit
  const v11 = data[cy1 * maskHw + cx1]! * unit
  const top = v00 + (v10 - v00) * fx
  const bottom = v01 + (v11 - v01) * fx
  return top + (bottom - top) * fy
}

/**
 * 把选中的实例掩码合成为输出区域的 alpha（0~1，长度 = region.width * region.height）。
 * 多实例取概率最大值合并；随后按阈值二值化，最后做羽化模糊得到软边。
 */
export function buildCutoutAlpha(input: CutoutAlphaInput): Float32Array {
  const srcW = Math.max(1, Math.floor(input.srcWidth))
  const srcH = Math.max(1, Math.floor(input.srcHeight))
  const region = input.region ?? { x: 0, y: 0, width: srcW, height: srcH }
  const outScale = Math.max(0.01, input.outScale ?? 1)
  const outW = Math.max(1, Math.round(region.width * outScale))
  const outH = Math.max(1, Math.round(region.height * outScale))
  const out = new Float32Array(outW * outH)
  if (input.masks.length === 0 || input.maskHw <= 0) return out

  const geo = input.letterbox ?? letterboxGeometryFor(srcW, srcH)
  const soft = input.soft === true
  const threshold = clamp(input.threshold ?? 0.5, 0, 1)
  const maskHw = input.maskHw

  for (const mask of input.masks) {
    if (mask.length < maskHw * maskHw) continue
    for (let oy = 0; oy < outH; oy++) {
      // 取原图像素中心，保证与 letterbox 前处理的采样对齐
      const ly = (region.y + (oy + 0.5) / outScale) * geo.scale + geo.padY
      const gy = ly * (maskHw / geo.size) - 0.5
      const row = oy * outW
      if (gy < -1 || gy > maskHw) continue
      for (let ox = 0; ox < outW; ox++) {
        const lx = (region.x + (ox + 0.5) / outScale) * geo.scale + geo.padX
        const gx = lx * (maskHw / geo.size) - 0.5
        const p = probabilityAt(mask, maskHw, soft, gx, gy)
        const i = row + ox
        if (p > out[i]!) out[i] = p
      }
    }
  }

  for (let i = 0; i < out.length; i++) out[i] = out[i]! >= threshold ? 1 : 0

  const feather = Math.max(0, Math.round(input.feather ?? 0))
  return feather > 0 ? featherAlpha(out, outW, outH, feather) : out
}

/** 可分离盒式模糊（3 趟近似高斯），把硬边 alpha 羽化成软边 */
export function featherAlpha(
  alpha: Float32Array,
  width: number,
  height: number,
  radius: number
): Float32Array {
  if (radius <= 0 || width <= 0 || height <= 0) return Float32Array.from(alpha)
  let src = Float32Array.from(alpha)
  let dst = new Float32Array(src.length)
  for (let pass = 0; pass < 3; pass++) {
    boxBlurH(src, dst, width, height, radius)
    const t1 = src
    src = dst
    dst = t1
    boxBlurV(src, dst, width, height, radius)
    const t2 = src
    src = dst
    dst = t2
  }
  return src
}

function boxBlurH(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number
): void {
  const win = radius * 2 + 1
  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let x = -radius; x <= radius; x++) sum += src[row + clampInt(x, 0, width - 1)]!
    for (let x = 0; x < width; x++) {
      dst[row + x] = sum / win
      sum +=
        src[row + clampInt(x + radius + 1, 0, width - 1)]! -
        src[row + clampInt(x - radius, 0, width - 1)]!
    }
  }
}

function boxBlurV(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number
): void {
  const win = radius * 2 + 1
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) sum += src[clampInt(y, 0, height - 1) * width + x]!
    for (let y = 0; y < height; y++) {
      dst[y * width + x] = sum / win
      sum +=
        src[clampInt(y + radius + 1, 0, height - 1) * width + x]! -
        src[clampInt(y - radius, 0, height - 1) * width + x]!
    }
  }
}

/**
 * 选中实例的外接区域（原图坐标，整数像素，clamp 到画面内）。
 * 羽化会把边缘向外扩散，因此按羽化半径 + 边距一起外扩，避免软边被裁掉。
 */
export function resolveCutoutRegion(params: {
  boxes: YoloBox[]
  srcWidth: number
  srcHeight: number
  feather?: number
  margin?: number
}): CutoutRegion {
  const srcW = Math.max(1, Math.floor(params.srcWidth))
  const srcH = Math.max(1, Math.floor(params.srcHeight))
  if (params.boxes.length === 0) return { x: 0, y: 0, width: srcW, height: srcH }
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const b of params.boxes) {
    x1 = Math.min(x1, b.x)
    y1 = Math.min(y1, b.y)
    x2 = Math.max(x2, b.x + b.width)
    y2 = Math.max(y2, b.y + b.height)
  }
  const pad =
    Math.max(0, Math.round(params.feather ?? 0)) + Math.max(0, Math.round(params.margin ?? 0))
  const left = clampInt(Math.floor(x1) - pad, 0, srcW - 1)
  const top = clampInt(Math.floor(y1) - pad, 0, srcH - 1)
  const right = clampInt(Math.ceil(x2) + pad, left + 1, srcW)
  const bottom = clampInt(Math.ceil(y2) + pad, top + 1, srcH)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** 把 0~1 的 alpha 写入 RGBA 像素的第 4 字节（就地修改） */
export function applyAlphaToRgba(rgba: Uint8ClampedArray | Uint8Array, alpha: Float32Array): void {
  const count = Math.min(alpha.length, rgba.length >> 2)
  for (let i = 0; i < count; i++) {
    rgba[i * 4 + 3] = Math.round(clamp(alpha[i]!, 0, 1) * 255)
  }
}

export interface DefringeOptions {
  /** 向外搜索纯背景像素的最大步数（输出像素）。默认 48 */
  maxSearch?: number
  /** alpha 低于该值视为「纯背景」像素，用于估计背景色。默认 0.05 */
  bgAlphaThresh?: number
  /** 仅处理 alpha 落在此区间的过渡像素（避免无谓计算与噪声）。默认 [0.05, 0.95] */
  minAlpha?: number
  maxAlpha?: number
  /** 去污染强度 0~1，1 为完全按反混合公式替换。默认 0.9 */
  strength?: number
}

/**
 * 边缘背景去污染（Defringe），消除发丝 / 轮廓四周的光晕。
 *
 * 背景：羽化后的半透明过渡像素，其 RGB 仍是「前景×α + 背景×(1-α)」的混合色。
 * 贴到任意背景上时，那部分背景色会残留——例如原图背景是黄/橙渐变时，
 * 头发边缘就会泛出黄圈。
 *
 * 做法：对每个半透明像素，沿上下左右向外找最近的纯背景像素（alpha < bgAlphaThresh），
 * 取其 RGB 均值作为背景估计 B，再用前景反混合公式
 *
 *     F = (C - (1-α)·B) / α
 *
 * 恢复前景色，从而消除背景污染。就地修改 rgba 的 R/G/B，alpha 保留。
 */
export function defringeRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  alpha: Float32Array,
  width: number,
  height: number,
  opts: DefringeOptions = {}
): void {
  const maxSearch = opts.maxSearch ?? 48
  const bgThresh = opts.bgAlphaThresh ?? 0.05
  const minA = opts.minAlpha ?? 0.05
  const maxA = opts.maxAlpha ?? 0.95
  const strength = clamp(opts.strength ?? 0.9, 0, 1)
  const dirX = [1, -1, 0, 0]
  const dirY = [0, 0, 1, -1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const a = alpha[i]!
      if (a < minA || a > maxA) continue
      // 沿四个方向找最近的纯背景像素，取其 RGB 均值作为背景估计 B
      let br = 0
      let bg = 0
      let bb = 0
      let found = 0
      for (let d = 0; d < 4; d++) {
        for (let s = 1; s <= maxSearch; s++) {
          const nx = x + dirX[d]! * s
          const ny = y + dirY[d]! * s
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) break
          if (alpha[ny * width + nx]! < bgThresh) {
            const off = (ny * width + nx) * 4
            br += rgba[off]!
            bg += rgba[off + 1]!
            bb += rgba[off + 2]!
            found++
            break
          }
        }
      }
      if (found === 0) continue
      const inv = 1 / Math.max(a, 0.05)
      const off = i * 4
      const r = (rgba[off]! - (1 - a) * (br / found)) * inv
      const g = (rgba[off + 1]! - (1 - a) * (bg / found)) * inv
      const b = (rgba[off + 2]! - (1 - a) * (bb / found)) * inv
      rgba[off] = clampInt(Math.round(rgba[off]! + (r - rgba[off]!) * strength), 0, 255)
      rgba[off + 1] = clampInt(Math.round(rgba[off + 1]! + (g - rgba[off + 1]!) * strength), 0, 255)
      rgba[off + 2] = clampInt(Math.round(rgba[off + 2]! + (b - rgba[off + 2]!) * strength), 0, 255)
    }
  }
}
