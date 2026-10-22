/**
 * 纯 RGBA 缓冲区上的像素工具：裁切 / 缩放 / 感知色差 / 形态学 / 连通域 / 推拉补洞。
 * 全部是确定性的纯函数，不依赖 DOM。
 */

import type { PixelRect, RgbaImage } from './types'

export function createImage(width: number, height: number): RgbaImage {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
}

export function cloneImage(img: RgbaImage): RgbaImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }
}

export function clampRect(rect: PixelRect, width: number, height: number): PixelRect {
  const left = Math.max(0, Math.min(width - 1, Math.round(rect.left)))
  const top = Math.max(0, Math.min(height - 1, Math.round(rect.top)))
  const right = Math.max(left + 1, Math.min(width, Math.round(rect.left + rect.width)))
  const bottom = Math.max(top + 1, Math.min(height, Math.round(rect.top + rect.height)))
  return { left, top, width: right - left, height: bottom - top }
}

export function expandRect(rect: PixelRect, pad: number, width: number, height: number): PixelRect {
  return clampRect(
    {
      left: rect.left - pad,
      top: rect.top - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2
    },
    width,
    height
  )
}

export function rectArea(rect: PixelRect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height)
}

export function rectIntersection(a: PixelRect, b: PixelRect): number {
  const x0 = Math.max(a.left, b.left)
  const y0 = Math.max(a.top, b.top)
  const x1 = Math.min(a.left + a.width, b.left + b.width)
  const y1 = Math.min(a.top + a.height, b.top + b.height)
  return x1 > x0 && y1 > y0 ? (x1 - x0) * (y1 - y0) : 0
}

export function rectUnion(rects: readonly PixelRect[]): PixelRect | null {
  if (!rects.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.left)
    y0 = Math.min(y0, r.top)
    x1 = Math.max(x1, r.left + r.width)
    y1 = Math.max(y1, r.top + r.height)
  }
  return { left: x0, top: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) }
}

export function cropImage(img: RgbaImage, rect: PixelRect): RgbaImage {
  const r = clampRect(rect, img.width, img.height)
  const out = createImage(r.width, r.height)
  for (let y = 0; y < r.height; y++) {
    const srcStart = ((r.top + y) * img.width + r.left) * 4
    out.data.set(img.data.subarray(srcStart, srcStart + r.width * 4), y * r.width * 4)
  }
  return out
}

/** 双线性缩放（RGBA 预乘插值，避免透明边缘发黑） */
export function resizeBilinear(img: RgbaImage, width: number, height: number): RgbaImage {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  if (w === img.width && h === img.height) return cloneImage(img)
  const out = createImage(w, h)
  const sx = img.width / w
  const sy = img.height / h
  const src = img.data
  const iw = img.width
  const ih = img.height
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(ih - 1, (y + 0.5) * sy - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(ih - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(iw - 1, (x + 0.5) * sx - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(iw - 1, x0 + 1)
      const tx = fx - x0
      const i00 = (y0 * iw + x0) * 4
      const i01 = (y0 * iw + x1) * 4
      const i10 = (y1 * iw + x0) * 4
      const i11 = (y1 * iw + x1) * 4
      const w00 = (1 - tx) * (1 - ty)
      const w01 = tx * (1 - ty)
      const w10 = (1 - tx) * ty
      const w11 = tx * ty
      const a00 = src[i00 + 3]! * w00
      const a01 = src[i01 + 3]! * w01
      const a10 = src[i10 + 3]! * w10
      const a11 = src[i11 + 3]! * w11
      const a = a00 + a01 + a10 + a11
      const o = (y * w + x) * 4
      if (a > 0.0001) {
        for (let c = 0; c < 3; c++) {
          out.data[o + c] =
            (src[i00 + c]! * a00 +
              src[i01 + c]! * a01 +
              src[i10 + c]! * a10 +
              src[i11 + c]! * a11) /
            a
        }
      }
      out.data[o + 3] = a
    }
  }
  return out
}

/**
 * 感知色差（redmean 近似 + alpha 差），返回 0..~255。
 * 透明像素按「对黑底预乘」比较，保证透明 vs 不透明总是大差异。
 */
export function pixelDistance(
  a: Uint8ClampedArray,
  ai: number,
  b: Uint8ClampedArray,
  bi: number
): number {
  const aa = a[ai + 3]! / 255
  const ba = b[bi + 3]! / 255
  const r1 = a[ai]! * aa
  const g1 = a[ai + 1]! * aa
  const b1 = a[ai + 2]! * aa
  const r2 = b[bi]! * ba
  const g2 = b[bi + 1]! * ba
  const b2 = b[bi + 2]! * ba
  const rm = (r1 + r2) * 0.5
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  const color =
    Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db) / 3
  return Math.max(color, Math.abs(aa - ba) * 255)
}

export function colorDistanceRgb(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number
): number {
  const rm = (r1 + r2) * 0.5
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db) / 3
}

export function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((x, y) => x - y)
  return sorted[Math.floor(sorted.length / 2)]!
}

/** 正方形最大值滤波（二值膨胀），可分离实现 */
export function dilateMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return new Uint8Array(mask)
  const tmp = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    let count = 0
    for (let x = 0; x < Math.min(width, r); x++) count += mask[row + x] ? 1 : 0
    for (let x = 0; x < width; x++) {
      const add = x + r
      if (add < width && mask[row + add]) count++
      const sub = x - r - 1
      if (sub >= 0 && mask[row + sub]) count--
      tmp[row + x] = count > 0 ? 1 : 0
    }
  }
  const out = new Uint8Array(mask.length)
  for (let x = 0; x < width; x++) {
    let count = 0
    for (let y = 0; y < Math.min(height, r); y++) count += tmp[y * width + x] ? 1 : 0
    for (let y = 0; y < height; y++) {
      const add = y + r
      if (add < height && tmp[add * width + x]) count++
      const sub = y - r - 1
      if (sub >= 0 && tmp[sub * width + x]) count--
      out[y * width + x] = count > 0 ? 1 : 0
    }
  }
  return out
}

export function erodeMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  const inv = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1
  const grown = dilateMask(inv, width, height, radius)
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) out[i] = grown[i] ? 0 : 1
  return out
}

/** 浮点盒式模糊（可分离），用于羽化蒙版 */
export function boxBlurFloat(
  src: Float32Array,
  width: number,
  height: number,
  radius: number
): Float32Array {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return new Float32Array(src)
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const span = r * 2 + 1
  for (let y = 0; y < height; y++) {
    const row = y * width
    let acc = 0
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(width - 1, Math.max(0, k))]!
    for (let x = 0; x < width; x++) {
      tmp[row + x] = acc / span
      const add = Math.min(width - 1, x + r + 1)
      const sub = Math.max(0, x - r)
      acc += src[row + add]! - src[row + sub]!
    }
  }
  for (let x = 0; x < width; x++) {
    let acc = 0
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(height - 1, Math.max(0, k)) * width + x]!
    for (let y = 0; y < height; y++) {
      out[y * width + x] = acc / span
      const add = Math.min(height - 1, y + r + 1)
      const sub = Math.max(0, y - r)
      acc += tmp[add * width + x]! - tmp[sub * width + x]!
    }
  }
  return out
}

export interface ComponentStat {
  label: number
  area: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 4 邻接连通域标记 */
export function labelComponents(
  mask: Uint8Array,
  width: number,
  height: number
): { labels: Int32Array; stats: ComponentStat[] } {
  const labels = new Int32Array(mask.length)
  const stats: ComponentStat[] = []
  const stack: number[] = []
  let next = 0
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue
    next++
    const stat: ComponentStat = {
      label: next,
      area: 0,
      minX: width,
      minY: height,
      maxX: -1,
      maxY: -1
    }
    labels[start] = next
    stack.push(start)
    while (stack.length) {
      const p = stack.pop()!
      const x = p % width
      const y = (p - x) / width
      stat.area++
      if (x < stat.minX) stat.minX = x
      if (x > stat.maxX) stat.maxX = x
      if (y < stat.minY) stat.minY = y
      if (y > stat.maxY) stat.maxY = y
      if (x > 0 && mask[p - 1] && !labels[p - 1]) {
        labels[p - 1] = next
        stack.push(p - 1)
      }
      if (x + 1 < width && mask[p + 1] && !labels[p + 1]) {
        labels[p + 1] = next
        stack.push(p + 1)
      }
      if (y > 0 && mask[p - width] && !labels[p - width]) {
        labels[p - width] = next
        stack.push(p - width)
      }
      if (y + 1 < height && mask[p + width] && !labels[p + width]) {
        labels[p + width] = next
        stack.push(p + width)
      }
    }
    stats.push(stat)
  }
  return { labels, stats }
}

/** 填充被前景完全包围的空洞（从边界泛洪背景，未到达的背景即空洞） */
export function fillHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const reach = new Uint8Array(mask.length)
  const stack: number[] = []
  const push = (p: number): void => {
    if (mask[p] || reach[p]) return
    reach[p] = 1
    stack.push(p)
  }
  for (let x = 0; x < width; x++) {
    push(x)
    push((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    push(y * width)
    push(y * width + width - 1)
  }
  while (stack.length) {
    const p = stack.pop()!
    const x = p % width
    if (x > 0) push(p - 1)
    if (x + 1 < width) push(p + 1)
    if (p >= width) push(p - width)
    if (p + width < mask.length) push(p + width)
  }
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] || !reach[i] ? 1 : 0
  return out
}

/**
 * 推拉金字塔补洞（push-pull）：在 hole=1 的位置用周围有效像素做多尺度平滑插值。
 * 预乘 RGBA 插值，透明区域会自然延续为透明。原地修改 img。
 */
export function inpaintPushPull(img: RgbaImage, hole: Uint8Array): void {
  const { width, height } = img
  let holeCount = 0
  for (let i = 0; i < hole.length; i++) if (hole[i]) holeCount++
  if (!holeCount) return
  if (holeCount === hole.length) return

  type Level = { w: number; h: number; c: Float32Array; wt: Float32Array }
  const levels: Level[] = []
  const n0 = width * height
  const c0 = new Float32Array(n0 * 4)
  const w0 = new Float32Array(n0)
  for (let p = 0; p < n0; p++) {
    if (hole[p]) continue
    const i = p * 4
    const a = img.data[i + 3]! / 255
    c0[i] = img.data[i]! * a
    c0[i + 1] = img.data[i + 1]! * a
    c0[i + 2] = img.data[i + 2]! * a
    c0[i + 3] = a
    w0[p] = 1
  }
  levels.push({ w: width, h: height, c: c0, wt: w0 })

  // push：逐级 2x 降采样，直到没有空洞或缩到 1px
  while (true) {
    const prev = levels[levels.length - 1]!
    let missing = false
    for (let p = 0; p < prev.wt.length; p++) {
      if (prev.wt[p]! < 0.999) {
        missing = true
        break
      }
    }
    if (!missing || (prev.w === 1 && prev.h === 1)) break
    const w = Math.max(1, Math.ceil(prev.w / 2))
    const h = Math.max(1, Math.ceil(prev.h / 2))
    const c = new Float32Array(w * h * 4)
    const wt = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sw = 0
        let s0 = 0
        let s1 = 0
        let s2 = 0
        let s3 = 0
        for (let dy = 0; dy < 2; dy++) {
          const py = y * 2 + dy
          if (py >= prev.h) continue
          for (let dx = 0; dx < 2; dx++) {
            const px = x * 2 + dx
            if (px >= prev.w) continue
            const q = py * prev.w + px
            const qw = prev.wt[q]!
            if (qw <= 0) continue
            sw += qw
            s0 += prev.c[q * 4]! * qw
            s1 += prev.c[q * 4 + 1]! * qw
            s2 += prev.c[q * 4 + 2]! * qw
            s3 += prev.c[q * 4 + 3]! * qw
          }
        }
        const o = y * w + x
        if (sw > 0) {
          c[o * 4] = s0 / sw
          c[o * 4 + 1] = s1 / sw
          c[o * 4 + 2] = s2 / sw
          c[o * 4 + 3] = s3 / sw
          wt[o] = Math.min(1, sw)
        }
      }
    }
    levels.push({ w, h, c, wt })
  }

  // pull：从最粗一级向上，用上采样值补足权重不足的像素
  for (let li = levels.length - 2; li >= 0; li--) {
    const fine = levels[li]!
    const coarse = levels[li + 1]!
    for (let y = 0; y < fine.h; y++) {
      for (let x = 0; x < fine.w; x++) {
        const p = y * fine.w + x
        const wf = fine.wt[p]!
        if (wf >= 0.999) continue
        // 双线性取粗一级
        const fx = Math.max(0, Math.min(coarse.w - 1, (x + 0.5) / 2 - 0.5))
        const fy = Math.max(0, Math.min(coarse.h - 1, (y + 0.5) / 2 - 0.5))
        const x0 = Math.floor(fx)
        const y0 = Math.floor(fy)
        const x1 = Math.min(coarse.w - 1, x0 + 1)
        const y1 = Math.min(coarse.h - 1, y0 + 1)
        const tx = fx - x0
        const ty = fy - y0
        for (let ch = 0; ch < 4; ch++) {
          const v =
            coarse.c[(y0 * coarse.w + x0) * 4 + ch]! * (1 - tx) * (1 - ty) +
            coarse.c[(y0 * coarse.w + x1) * 4 + ch]! * tx * (1 - ty) +
            coarse.c[(y1 * coarse.w + x0) * 4 + ch]! * (1 - tx) * ty +
            coarse.c[(y1 * coarse.w + x1) * 4 + ch]! * tx * ty
          fine.c[p * 4 + ch] = fine.c[p * 4 + ch]! * wf + v * (1 - wf)
        }
        fine.wt[p] = 1
      }
    }
  }

  const base = levels[0]!
  for (let p = 0; p < n0; p++) {
    if (!hole[p]) continue
    const i = p * 4
    const a = base.c[i + 3]!
    if (a > 0.002) {
      img.data[i] = base.c[i]! / a
      img.data[i + 1] = base.c[i + 1]! / a
      img.data[i + 2] = base.c[i + 2]! / a
    }
    img.data[i + 3] = a * 255
  }
}

/** 把 top 按 alpha 叠到 base 上（非预乘 RGBA 的标准 over 合成），原地修改 base */
export function compositeOver(base: RgbaImage, top: RgbaImage, left: number, top0: number): void {
  for (let y = 0; y < top.height; y++) {
    const by = y + top0
    if (by < 0 || by >= base.height) continue
    for (let x = 0; x < top.width; x++) {
      const bx = x + left
      if (bx < 0 || bx >= base.width) continue
      const ti = (y * top.width + x) * 4
      const ta = top.data[ti + 3]! / 255
      if (ta <= 0) continue
      const bi = (by * base.width + bx) * 4
      const ba = base.data[bi + 3]! / 255
      const oa = ta + ba * (1 - ta)
      if (oa <= 0) continue
      for (let c = 0; c < 3; c++) {
        base.data[bi + c] = (top.data[ti + c]! * ta + base.data[bi + c]! * ba * (1 - ta)) / oa
      }
      base.data[bi + 3] = oa * 255
    }
  }
}

/** 两张同尺寸图的平均绝对误差（预乘比较，0..255） */
export function meanAbsoluteError(a: RgbaImage, b: RgbaImage): number {
  if (a.width !== b.width || a.height !== b.height) return 255
  let sum = 0
  const n = a.width * a.height
  for (let p = 0; p < n; p++) sum += pixelDistance(a.data, p * 4, b.data, p * 4)
  return n ? sum / n : 0
}

/** 根据宽高比挑一个生图模型普遍支持的画幅枚举 */
export function nearestAspectRatio(width: number, height: number): string {
  const ratio = width / Math.max(1, height)
  const options: Array<[string, number]> = [
    ['21:9', 21 / 9],
    ['16:9', 16 / 9],
    ['3:2', 3 / 2],
    ['4:3', 4 / 3],
    ['1:1', 1],
    ['3:4', 3 / 4],
    ['2:3', 2 / 3],
    ['9:16', 9 / 16]
  ]
  let best = options[0]!
  for (const opt of options) {
    if (Math.abs(Math.log(opt[1] / ratio)) < Math.abs(Math.log(best[1] / ratio))) best = opt
  }
  return best[0]
}
