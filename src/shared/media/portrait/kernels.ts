/**
 * 人像精修像素内核（纯 TS，零 DOM 依赖）。
 *
 * 约定：
 * - 图像统一是 RGBA，`Uint8ClampedArray`，长度 = w*h*4，行优先；
 * - 所有函数**不改入参**，返回新数组（除显式标注 in-place 的）；
 * - 全程避免逐像素分配，滤波器走积分 / 滑动窗口，保证预览分辨率下可交互；
 * - 随机（颗粒）用**带种子**的 PRNG —— 同一个节点参数重复 Cook 必须得到同一张图，
 *   否则「运行两次结果不一样」会成为无法排查的幽灵问题。
 */

export interface RgbaImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

export function cloneImage(image: RgbaImage): RgbaImage {
  return { data: new Uint8ClampedArray(image.data), width: image.width, height: image.height }
}

export function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** 可复现的伪随机（mulberry32）：同一个种子给同一串数 */
export function createRng(seed: number): () => number {
  let state = seed | 0 || 0x9e3779b9
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── 采样 ───────────────────────────────────────────────────────

/** 双线性采样，越界按边缘钳制；坐标是像素中心系 */
export function sampleBilinear(image: RgbaImage, x: number, y: number, out: Float32Array): void {
  const { data, width, height } = image
  const cx = x < 0 ? 0 : x > width - 1 ? width - 1 : x
  const cy = y < 0 ? 0 : y > height - 1 ? height - 1 : y
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = x0 + 1 > width - 1 ? width - 1 : x0 + 1
  const y1 = y0 + 1 > height - 1 ? height - 1 : y0 + 1
  const fx = cx - x0
  const fy = cy - y0
  const i00 = (y0 * width + x0) * 4
  const i10 = (y0 * width + x1) * 4
  const i01 = (y1 * width + x0) * 4
  const i11 = (y1 * width + x1) * 4
  for (let c = 0; c < 4; c++) {
    const top = lerp(data[i00 + c], data[i10 + c], fx)
    const bottom = lerp(data[i01 + c], data[i11 + c], fx)
    out[c] = lerp(top, bottom, fy)
  }
}

// ── 模糊 / 滤波 ────────────────────────────────────────────────

/**
 * 可分离盒式模糊（滑动窗口，O(1)/像素）。
 * 大半径磨皮 / 虚化的主力；多次调用可逼近高斯。
 */
export function boxBlurRgba(image: RgbaImage, radius: number): RgbaImage {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return cloneImage(image)
  const { width: w, height: h } = image
  const src = image.data
  const tmp = new Float32Array(w * h * 4)
  const out = new Uint8ClampedArray(w * h * 4)
  const window = r * 2 + 1

  // 水平
  for (let y = 0; y < h; y++) {
    const row = y * w
    let s0 = 0
    let s1 = 0
    let s2 = 0
    let s3 = 0
    for (let k = -r; k <= r; k++) {
      const x = k < 0 ? 0 : k > w - 1 ? w - 1 : k
      const i = (row + x) * 4
      s0 += src[i]
      s1 += src[i + 1]
      s2 += src[i + 2]
      s3 += src[i + 3]
    }
    for (let x = 0; x < w; x++) {
      const i = (row + x) * 4
      tmp[i] = s0 / window
      tmp[i + 1] = s1 / window
      tmp[i + 2] = s2 / window
      tmp[i + 3] = s3 / window
      const outX = x - r < 0 ? 0 : x - r
      const inX = x + r + 1 > w - 1 ? w - 1 : x + r + 1
      const oi = (row + outX) * 4
      const ii = (row + inX) * 4
      s0 += src[ii] - src[oi]
      s1 += src[ii + 1] - src[oi + 1]
      s2 += src[ii + 2] - src[oi + 2]
      s3 += src[ii + 3] - src[oi + 3]
    }
  }

  // 垂直
  for (let x = 0; x < w; x++) {
    let s0 = 0
    let s1 = 0
    let s2 = 0
    let s3 = 0
    for (let k = -r; k <= r; k++) {
      const y = k < 0 ? 0 : k > h - 1 ? h - 1 : k
      const i = (y * w + x) * 4
      s0 += tmp[i]
      s1 += tmp[i + 1]
      s2 += tmp[i + 2]
      s3 += tmp[i + 3]
    }
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4
      out[i] = s0 / window
      out[i + 1] = s1 / window
      out[i + 2] = s2 / window
      out[i + 3] = s3 / window
      const outY = y - r < 0 ? 0 : y - r
      const inY = y + r + 1 > h - 1 ? h - 1 : y + r + 1
      const oi = (outY * w + x) * 4
      const ii = (inY * w + x) * 4
      s0 += tmp[ii] - tmp[oi]
      s1 += tmp[ii + 1] - tmp[oi + 1]
      s2 += tmp[ii + 2] - tmp[oi + 2]
      s3 += tmp[ii + 3] - tmp[oi + 3]
    }
  }

  return { data: out, width: w, height: h }
}

/** 三连盒式模糊近似高斯（磨皮/虚化用，边缘比单次盒式柔和） */
export function gaussianLikeBlur(image: RgbaImage, radius: number): RgbaImage {
  const r = Math.max(1, Math.round(radius / 3))
  let out = boxBlurRgba(image, r)
  out = boxBlurRgba(out, r)
  out = boxBlurRgba(out, r)
  return out
}

// ── 引导滤波（保边平滑） ────────────────────────────────────────

function toFloatChannel(image: RgbaImage, channel: number): Float32Array {
  const { data, width, height } = image
  const out = new Float32Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) out[p] = data[i + channel]
  return out
}

function boxBlurFloat(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return src.slice()
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const window = r * 2 + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let k = -r; k <= r; k++) sum += src[row + Math.min(w - 1, Math.max(0, k))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / window
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / window
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

/**
 * 引导滤波（单通道）：以自身为引导做保边平滑。
 * `eps` 越小越保边。返回平滑后的通道值。
 */
export function guidedFilterFloat(
  guide: Float32Array,
  src: Float32Array,
  w: number,
  h: number,
  radius: number,
  eps: number
): Float32Array {
  const meanI = boxBlurFloat(guide, w, h, radius)
  const meanP = boxBlurFloat(src, w, h, radius)
  const corrI = boxBlurFloat(
    (() => {
      const out = new Float32Array(w * h)
      for (let i = 0; i < out.length; i++) out[i] = guide[i] * guide[i]
      return out
    })(),
    w,
    h,
    radius
  )
  const corrIP = boxBlurFloat(
    (() => {
      const out = new Float32Array(w * h)
      for (let i = 0; i < out.length; i++) out[i] = guide[i] * src[i]
      return out
    })(),
    w,
    h,
    radius
  )
  const a = new Float32Array(w * h)
  const b = new Float32Array(w * h)
  for (let i = 0; i < a.length; i++) {
    const varI = corrI[i] - meanI[i] * meanI[i]
    const covIP = corrIP[i] - meanI[i] * meanP[i]
    const ai = covIP / (varI + eps)
    a[i] = ai
    b[i] = meanP[i] - ai * meanI[i]
  }
  const meanA = boxBlurFloat(a, w, h, radius)
  const meanB = boxBlurFloat(b, w, h, radius)
  const out = new Float32Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = meanA[i] * guide[i] + meanB[i]
  return out
}

/**
 * 频率分离磨皮：低频用引导滤波（保边，不会把睫毛/唇线糊掉），
 * 高频按 `poreRetain` 保留毛孔质感。`mask` 为可选的逐像素权重 0..255。
 */
export function frequencySeparationSkin(
  image: RgbaImage,
  options: { radius: number; strength: number; poreRetain: number; mask?: Uint8ClampedArray | null }
): RgbaImage {
  const { width: w, height: h } = image
  const strength = Math.min(1, Math.max(0, options.strength))
  if (strength <= 0.001) return cloneImage(image)
  // 毛孔保留 0..100 → 高频保留 0.15..0.85
  const highKeep = 0.15 + (Math.min(100, Math.max(0, options.poreRetain)) / 100) * 0.7
  const radius = Math.max(1, Math.round(options.radius))
  const eps = 16 + (1 - strength) * 240
  const out = new Uint8ClampedArray(image.data)
  const guideCache = new Float32Array(w * h)
  const srcCache = new Float32Array(w * h)
  const mask = options.mask
  const alpha = new Float32Array(w * h)
  if (mask) {
    for (let i = 0; i < alpha.length; i++) alpha[i] = (mask[i] / 255) * strength
  } else {
    alpha.fill(strength)
  }
  for (let c = 0; c < 3; c++) {
    const channel = toFloatChannel(image, c)
    for (let i = 0; i < channel.length; i++) {
      guideCache[i] = channel[i]
      srcCache[i] = channel[i]
    }
    const low = guidedFilterFloat(guideCache, srcCache, w, h, radius, eps)
    for (let p = 0, i = 0; p < low.length; p++, i += 4) {
      const a = alpha[p]
      if (a <= 0.001) continue
      const high = channel[p] - low[p]
      const smoothed = low[p] + high * highKeep
      out[i + c] = clamp255(channel[p] + (smoothed - channel[p]) * a)
    }
  }
  return { data: out, width: w, height: h }
}

/** 去噪：小半径中值（保边去粒）+ 轻度混合 */
export function denoiseImage(image: RgbaImage, strength: number): RgbaImage {
  const amount = Math.min(1, Math.max(0, strength))
  if (amount <= 0.001) return cloneImage(image)
  const smooth = gaussianLikeBlur(image, 2)
  const out = new Uint8ClampedArray(image.data)
  for (let i = 0; i < out.length; i += 4) {
    const a = amount * 0.85
    for (let c = 0; c < 3; c++) {
      out[i + c] = clamp255(image.data[i + c] + (smooth.data[i + c] - image.data[i + c]) * a)
    }
  }
  return { data: out, width: image.width, height: image.height }
}

// ── 锐化 / 清晰度 / 柔焦 ────────────────────────────────────────

export function unsharpMask(image: RgbaImage, radius: number, amount: number): RgbaImage {
  const a = Math.max(0, amount)
  if (a <= 0.001) return cloneImage(image)
  const blurred = gaussianLikeBlur(image, Math.max(1, radius))
  const out = new Uint8ClampedArray(image.data)
  for (let i = 0; i < out.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const base = image.data[i + c]
      out[i + c] = clamp255(base + (base - blurred.data[i + c]) * a)
    }
  }
  return { data: out, width: image.width, height: image.height }
}

/**
 * 清晰度（局部对比）：只在中灰区提升对比，避免高光/阴影溢出。
 * 与锐化分开是因为它作用半径大、影响的是「立体感」而非「边缘」。
 */
export function localContrast(image: RgbaImage, radius: number, amount: number): RgbaImage {
  const a = Math.max(0, amount)
  if (a <= 0.001) return cloneImage(image)
  const blurred = gaussianLikeBlur(image, Math.max(2, radius))
  const out = new Uint8ClampedArray(image.data)
  for (let i = 0; i < out.length; i += 4) {
    const lum = 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2]
    // 中灰权重：两端压低，防止高光死白 / 阴影死黑
    const weight = 1 - Math.abs(lum - 128) / 128
    for (let c = 0; c < 3; c++) {
      const base = image.data[i + c]
      out[i + c] = clamp255(base + (base - blurred.data[i + c]) * a * weight * 0.7)
    }
  }
  return { data: out, width: image.width, height: image.height }
}

export function softFocus(image: RgbaImage, amount: number): RgbaImage {
  const a = Math.min(1, Math.max(0, amount))
  if (a <= 0.001) return cloneImage(image)
  const blurred = gaussianLikeBlur(image, 4)
  const out = new Uint8ClampedArray(image.data)
  for (let i = 0; i < out.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      out[i + c] = clamp255(image.data[i + c] + (blurred.data[i + c] - image.data[i + c]) * a * 0.7)
    }
  }
  return { data: out, width: image.width, height: image.height }
}

export function addGrain(image: RgbaImage, amount: number, seed = 1): RgbaImage {
  const a = Math.min(1, Math.max(0, amount))
  if (a <= 0.001) return cloneImage(image)
  const rng = createRng(seed)
  const out = new Uint8ClampedArray(image.data)
  const strength = a * 26
  for (let i = 0; i < out.length; i += 4) {
    const n = (rng() - 0.5) * strength
    for (let c = 0; c < 3; c++) out[i + c] = clamp255(out[i + c] + n)
  }
  return { data: out, width: image.width, height: image.height }
}

export function applyVignette(image: RgbaImage, amount: number): RgbaImage {
  const a = Math.min(1, Math.max(0, amount))
  if (a <= 0.001) return cloneImage(image)
  const { width: w, height: h } = image
  const out = new Uint8ClampedArray(image.data)
  const cx = (w - 1) / 2
  const cy = (h - 1) / 2
  const maxDist = Math.hypot(cx, cy)
  const strength = a * 0.75
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy) / maxDist
      const factor = 1 - strength * Math.max(0, d - 0.4) * (1 / 0.6)
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) out[i + c] = clamp255(out[i + c] * factor)
    }
  }
  return { data: out, width: w, height: h }
}

// ── 调色 ───────────────────────────────────────────────────────

export interface PortraitColorAdjust {
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  colorTemp: number
  tint: number
  vibrance: number
  saturation: number
  hslHue: number
  hslSat: number
  hslLum: number
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** 全局调色：曝光/对比/高光阴影/白黑场/色温色调/饱和度/自然饱和度/HSL 主调 */
export function applyColorAdjust(image: RgbaImage, p: PortraitColorAdjust): RgbaImage {
  const out = new Uint8ClampedArray(image.data)
  const exposureGain = Math.pow(2, p.exposure / 100)
  const contrast = 1 + p.contrast / 200
  const highlights = p.highlights / 100
  const shadows = p.shadows / 100
  const whites = p.whites / 100
  const blacks = p.blacks / 100
  const tempR = (p.colorTemp / 100) * 22
  const tempB = -(p.colorTemp / 100) * 22
  const tintG = -(p.tint / 100) * 14
  const tintRB = (p.tint / 100) * 7
  const sat = 1 + p.saturation / 100
  const vib = p.vibrance / 100
  const hslShift = p.hslHue / 100
  const hslSat = 1 + p.hslSat / 100
  const hslLum = p.hslLum / 100

  for (let i = 0; i < out.length; i += 4) {
    let r = out[i] * exposureGain
    let g = out[i + 1] * exposureGain
    let b = out[i + 2] * exposureGain

    r += tempR + tintRB
    g += tintG
    b += tempB + tintRB

    // 高光 / 阴影区域压缩（按亮度分区）
    const lum0 = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    if (highlights !== 0) {
      const weight = smoothstep(0.5, 1, lum0)
      const k = 1 + highlights * weight * 0.5
      r *= k
      g *= k
      b *= k
    }
    if (shadows !== 0) {
      const weight = 1 - smoothstep(0, 0.5, lum0)
      const k = 1 + shadows * weight * 0.6
      r *= k
      g *= k
      b *= k
    }
    if (whites !== 0) {
      const weight = smoothstep(0.72, 1, lum0)
      const add = whites * weight * 40
      r += add
      g += add
      b += add
    }
    if (blacks !== 0) {
      const weight = 1 - smoothstep(0, 0.28, lum0)
      const add = blacks * weight * 40
      r += add
      g += add
      b += add
    }

    // 对比（围绕中灰）
    r = (r - 128) * contrast + 128
    g = (g - 128) * contrast + 128
    b = (b - 128) * contrast + 128

    // 饱和度 + 自然饱和度（低饱和像素受 vibrance 影响更大）
    let lum = 0.299 * r + 0.587 * g + 0.114 * b
    if (sat !== 1) {
      r = lum + (r - lum) * sat
      g = lum + (g - lum) * sat
      b = lum + (b - lum) * sat
    }
    if (vib !== 0) {
      const maxC = Math.max(r, g, b)
      const minC = Math.min(r, g, b)
      const chroma = (maxC - minC) / 255
      const k = 1 + vib * (1 - chroma) * 0.8
      lum = 0.299 * r + 0.587 * g + 0.114 * b
      r = lum + (r - lum) * k
      g = lum + (g - lum) * k
      b = lum + (b - lum) * k
    }

    // HSL 主调：旋转色相 / 整体饱和度 / 明度
    if (hslShift !== 0 || hslSat !== 1 || hslLum !== 0) {
      const nr = r / 255
      const ng = g / 255
      const nb = b / 255
      const maxC = Math.max(nr, ng, nb)
      const minC = Math.min(nr, ng, nb)
      let hDeg = 0
      const l = (maxC + minC) / 2
      const d = maxC - minC
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
      if (d !== 0) {
        if (maxC === nr) hDeg = 60 * (((ng - nb) / d) % 6)
        else if (maxC === ng) hDeg = 60 * ((nb - nr) / d + 2)
        else hDeg = 60 * ((nr - ng) / d + 4)
      }
      if (hDeg < 0) hDeg += 360
      const h2 = (hDeg + hslShift * 60 + 360) % 360
      const s2 = Math.min(1, Math.max(0, s * hslSat))
      const l2 = Math.min(1, Math.max(0, l + hslLum * 0.25))
      const c = (1 - Math.abs(2 * l2 - 1)) * s2
      const x = c * (1 - Math.abs(((h2 / 60) % 2) - 1))
      const m = l2 - c / 2
      let rr = 0
      let gg = 0
      let bb = 0
      if (h2 < 60) [rr, gg, bb] = [c, x, 0]
      else if (h2 < 120) [rr, gg, bb] = [x, c, 0]
      else if (h2 < 180) [rr, gg, bb] = [0, c, x]
      else if (h2 < 240) [rr, gg, bb] = [0, x, c]
      else if (h2 < 300) [rr, gg, bb] = [x, 0, c]
      else [rr, gg, bb] = [c, 0, x]
      r = (rr + m) * 255
      g = (gg + m) * 255
      b = (bb + m) * 255
    }

    out[i] = clamp255(r)
    out[i + 1] = clamp255(g)
    out[i + 2] = clamp255(b)
  }
  return { data: out, width: image.width, height: image.height }
}

/** 内置 LUT（滤镜）：以调色参数表达，便于与手动参数叠加且无需外部资源文件 */
export const PORTRAIT_LUTS: Readonly<Record<string, Partial<PortraitColorAdjust>>> = {
  none: {},
  clear: { exposure: 6, shadows: 10, vibrance: 8, contrast: 4 },
  warmFilm: { colorTemp: 14, contrast: 8, saturation: -6, highlights: -8 },
  coolFilm: { colorTemp: -14, contrast: 6, saturation: -4, shadows: 8 },
  fuji: { colorTemp: -6, saturation: 6, contrast: 10, shadows: 12 },
  kodak: { colorTemp: 10, saturation: 4, contrast: 8, highlights: -10 },
  hongkong: { colorTemp: 12, contrast: 16, saturation: 10, shadows: -6 },
  japanese: { exposure: 8, saturation: -8, highlights: 6, shadows: 14, colorTemp: -4 },
  morandi: { saturation: -22, contrast: -6, vibrance: 10 },
  blackGold: { contrast: 20, saturation: -16, shadows: -10, highlights: 8 },
  bw: { saturation: -100, contrast: 12 },
  sepia: { saturation: -60, colorTemp: 22, contrast: 6 }
}

export function applyLut(image: RgbaImage, lutId: string, amount = 1): RgbaImage {
  const lut = PORTRAIT_LUTS[lutId]
  if (!lut || Object.keys(lut).length === 0) return cloneImage(image)
  const base: PortraitColorAdjust = {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    colorTemp: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
    hslHue: 0,
    hslSat: 0,
    hslLum: 0,
    ...lut
  }
  const a = Math.min(1, Math.max(0, amount))
  if (a >= 0.999) return applyColorAdjust(image, base)
  const scaled = Object.fromEntries(
    Object.entries(base).map(([k, v]) => [k, (v as number) * a])
  ) as unknown as PortraitColorAdjust
  return applyColorAdjust(image, scaled)
}

// ── 蒙版合成 ───────────────────────────────────────────────────

/** 用蒙版把 overlay 混到 base 上（mask 0..255） */
export function blendWithMask(
  base: RgbaImage,
  overlay: RgbaImage,
  mask: Uint8ClampedArray,
  opacity = 1
): RgbaImage {
  const out = new Uint8ClampedArray(base.data)
  const o = Math.min(1, Math.max(0, opacity))
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    const a = (mask[p] / 255) * o
    if (a <= 0.001) continue
    for (let c = 0; c < 3; c++) {
      out[i + c] = clamp255(base.data[i + c] + (overlay.data[i + c] - base.data[i + c]) * a)
    }
  }
  return { data: out, width: base.width, height: base.height }
}

/**
 * 区域调色：只在蒙版内按因子缩放亮度/加色。
 * 用于眼睛增亮、牙齿美白、口红提色这类「局部小动作」。
 */
export function applyRegionTint(
  image: RgbaImage,
  mask: Uint8ClampedArray,
  options: {
    brighten?: number
    whiten?: number
    saturate?: number
    tint?: [number, number, number]
  },
  opacity = 1
): RgbaImage {
  const out = new Uint8ClampedArray(image.data)
  const brighten = options.brighten ?? 0
  const whiten = options.whiten ?? 0
  const saturate = options.saturate ?? 0
  const tint = options.tint
  const o = Math.min(1, Math.max(0, opacity))
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    const a = (mask[p] / 255) * o
    if (a <= 0.001) continue
    let r = image.data[i]
    let g = image.data[i + 1]
    let b = image.data[i + 2]
    if (brighten !== 0) {
      r += brighten
      g += brighten
      b += brighten
    }
    if (whiten !== 0) {
      // 向白色靠拢（保色相）：抬高暗部、压缩彩度
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      r += (255 - r) * whiten * 0.4 + (lum - r) * whiten * 0.2
      g += (255 - g) * whiten * 0.4 + (lum - g) * whiten * 0.2
      b += (255 - b) * whiten * 0.4 + (lum - b) * whiten * 0.2
    }
    if (saturate !== 0) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      const k = 1 + saturate
      r = lum + (r - lum) * k
      g = lum + (g - lum) * k
      b = lum + (b - lum) * k
    }
    if (tint) {
      // 保亮度上色：把目标色的「色度」加回原亮度，避免整块糊成一个色斑
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      const tr = tint[0] * 255
      const tg = tint[1] * 255
      const tb = tint[2] * 255
      const tl = 0.299 * tr + 0.587 * tg + 0.114 * tb
      const k = 0.4
      r += (tr - tl + lum - r) * k
      g += (tg - tl + lum - g) * k
      b += (tb - tl + lum - b) * k
    }
    out[i] = clamp255(r)
    out[i + 1] = clamp255(g)
    out[i + 2] = clamp255(b)
  }
  return { data: out, width: image.width, height: image.height }
}

// ── 肤色相关 ───────────────────────────────────────────────────

/** 皮肤像素判定（YCbCr 阈值，覆盖绝大多数肤色） */
export function isSkinPixel(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
  const maxC = Math.max(r, g, b)
  const minC = Math.min(r, g, b)
  return (
    y > 40 && cb >= 77 && cb <= 135 && cr >= 133 && cr <= 180 && r > g && r > b && maxC - minC > 10
  )
}

/** 局部去瑕疵：小半径平滑 + 只在皮肤掩膜内、且与邻域差异明显的像素上生效 */
export function healBlemishes(
  image: RgbaImage,
  skinMask: Uint8ClampedArray | null,
  strength: number,
  radius = 2
): RgbaImage {
  const a = Math.min(1, Math.max(0, strength))
  if (a <= 0.001) return cloneImage(image)
  const smooth = gaussianLikeBlur(image, radius)
  const out = new Uint8ClampedArray(image.data)
  for (let p = 0, i = 0; p < image.data.length / 4; p++, i += 4) {
    if (skinMask && skinMask[p] < 40) continue
    // 只修「比周围暗/红」的斑点，避免把五官（明暗结构）一起抹平
    const diff =
      0.299 * (smooth.data[i] - image.data[i]) +
      0.587 * (smooth.data[i + 1] - image.data[i + 1]) +
      0.114 * (smooth.data[i + 2] - image.data[i + 2])
    const weight = diff > 2 ? Math.min(1, diff / 24) : 0
    if (weight <= 0) continue
    const k = a * weight
    for (let c = 0; c < 3; c++) {
      out[i + c] = clamp255(image.data[i + c] + (smooth.data[i + c] - image.data[i + c]) * k)
    }
  }
  return { data: out, width: image.width, height: image.height }
}

/** 去油光：压高光 + 降局部对比（只在脸部蒙版内） */
export function removeShine(
  image: RgbaImage,
  mask: Uint8ClampedArray | null,
  strength: number
): RgbaImage {
  const a = Math.min(1, Math.max(0, strength))
  if (a <= 0.001) return cloneImage(image)
  const out = new Uint8ClampedArray(image.data)
  for (let p = 0, i = 0; p < image.data.length / 4; p++, i += 4) {
    if (mask && mask[p] < 30) continue
    const lum = 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2]
    if (lum < 175) continue
    const weight = smoothstep(175, 250, lum) * a
    for (let c = 0; c < 3; c++) {
      const base = image.data[i + c]
      const target = base - (base - 190) * 0.35
      out[i + c] = clamp255(base + (target - base) * weight)
    }
  }
  return { data: out, width: image.width, height: image.height }
}
