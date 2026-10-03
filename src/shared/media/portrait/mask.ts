/**
 * 人像精修蒙版工具（纯 TS）：肤色蒙版、区域多边形蒙版、人像主体蒙版后处理。
 *
 * 蒙版统一是 `Uint8ClampedArray`，长度 = w*h，取值 0..255（0 = 完全不动，255 = 完全生效）。
 * 之所以不用 ImageData：内核层要能在 node 环境（无 DOM）里单测。
 */

import { isSkinPixel, type RgbaImage } from './kernels'

/** 滑动窗口盒式模糊（单通道），蒙版羽化主力 */
export function blurMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
): Uint8ClampedArray {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return new Uint8ClampedArray(mask)
  const tmp = new Float32Array(width * height)
  const out = new Uint8ClampedArray(width * height)
  const window = r * 2 + 1

  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let k = -r; k <= r; k++) sum += mask[row + Math.min(width - 1, Math.max(0, k))]
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / window
      sum += mask[row + Math.min(width - 1, x + r + 1)] - mask[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(height - 1, Math.max(0, k)) * width + x]
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / window
      sum += tmp[Math.min(height - 1, y + r + 1) * width + x] - tmp[Math.max(0, y - r) * width + x]
    }
  }
  return out
}

/** 形态学膨胀（半径内取最大值）：把蒙版向外扩，避免生效区比目标小一圈 */
export function dilateMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
): Uint8ClampedArray {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return new Uint8ClampedArray(mask)
  const tmp = new Uint8ClampedArray(width * height)
  const out = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let max = 0
      for (let k = -r; k <= r; k++) {
        const v = mask[row + Math.min(width - 1, Math.max(0, x + k))]
        if (v > max) max = v
      }
      tmp[row + x] = max
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let max = 0
      for (let k = -r; k <= r; k++) {
        const v = tmp[Math.min(height - 1, Math.max(0, y + k)) * width + x]
        if (v > max) max = v
      }
      out[y * width + x] = max
    }
  }
  return out
}

/** 形态学腐蚀（半径内取最小值） */
export function erodeMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
): Uint8ClampedArray {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return new Uint8ClampedArray(mask)
  const tmp = new Uint8ClampedArray(width * height)
  const out = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let min = 255
      for (let k = -r; k <= r; k++) {
        const v = mask[row + Math.min(width - 1, Math.max(0, x + k))]
        if (v < min) min = v
      }
      tmp[row + x] = min
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let min = 255
      for (let k = -r; k <= r; k++) {
        const v = tmp[Math.min(height - 1, Math.max(0, y + k)) * width + x]
        if (v < min) min = v
      }
      out[y * width + x] = min
    }
  }
  return out
}

/** 开运算（先腐蚀后膨胀）：去掉肤色误判的孤立噪点 */
export function openMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
): Uint8ClampedArray {
  return dilateMask(erodeMask(mask, width, height, radius), width, height, radius)
}

export function unionMask(a: Uint8ClampedArray, b: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] > b[i] ? a[i] : b[i]
  return out
}

export function intersectMask(a: Uint8ClampedArray, b: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] < b[i] ? a[i] : b[i]
  return out
}

export function subtractMask(a: Uint8ClampedArray, b: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(a.length)
  for (let i = 0; i < a.length; i++) {
    const v = a[i] - b[i]
    out[i] = v > 0 ? v : 0
  }
  return out
}

/** 整幅蒙版按系数缩放（不透明度） */
export function scaleMask(mask: Uint8ClampedArray, factor: number): Uint8ClampedArray {
  const f = Math.min(1, Math.max(0, factor))
  const out = new Uint8ClampedArray(mask.length)
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] * f
  return out
}

// ── 肤色蒙版 ───────────────────────────────────────────────────

/**
 * 肤色蒙版：YCbCr 阈值 + 开运算去噪 + 羽化。
 * 磨皮 / 去油光 / 肤色工具都用它，避免「整张图一起磨」把背景和五官糊掉。
 */
export function buildSkinMask(
  image: RgbaImage,
  options: { feather?: number; openRadius?: number } = {}
): Uint8ClampedArray {
  const { width: w, height: h, data } = image
  const mask = new Uint8ClampedArray(w * h)
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    mask[p] = isSkinPixel(data[i], data[i + 1], data[i + 2]) ? 255 : 0
  }
  const opened = openMask(mask, w, h, options.openRadius ?? 1)
  const feather = options.feather ?? Math.max(1, Math.round(Math.min(w, h) * 0.006))
  return blurMask(opened, w, h, feather)
}

// ── 多边形蒙版 ─────────────────────────────────────────────────

/** 多边形（归一化 0..1 坐标）→ 蒙版；`feather` 是相对外接框短边的羽化比例 */
export function polygonMask(
  width: number,
  height: number,
  polygon: ReadonlyArray<readonly [number, number]>,
  feather = 0.2
): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(width * height)
  if (polygon.length < 3) return mask
  const pts = polygon.map(([x, y]) => [x * width, y * height] as [number, number])

  let minY = Infinity
  let maxY = -Infinity
  let minX = Infinity
  let maxX = -Infinity
  for (const [x, y] of pts) {
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (x < minX) minX = x
    if (x > maxX) maxX = x
  }
  const y0 = Math.max(0, Math.floor(minY))
  const y1 = Math.min(height - 1, Math.ceil(maxY))
  const crossings: number[] = []

  for (let y = y0; y <= y1; y++) {
    crossings.length = 0
    const cy = y + 0.5
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]
      const [xj, yj] = pts[j]
      if (yi > cy !== yj > cy) {
        const t = (cy - yi) / (yj - yi)
        crossings.push(xi + t * (xj - xi))
      }
    }
    if (crossings.length === 0) continue
    crossings.sort((a, b) => a - b)
    const row = y * width
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const xs = Math.max(0, Math.ceil(crossings[k] - 0.5))
      const xe = Math.min(width - 1, Math.floor(crossings[k + 1] - 0.5))
      for (let x = xs; x <= xe; x++) mask[row + x] = 255
    }
  }

  const shortSide = Math.max(1, Math.min(maxX - minX, maxY - minY))
  const radius = Math.round(shortSide * Math.min(0.95, Math.max(0, feather)))
  return radius > 0 ? blurMask(mask, width, height, radius) : mask
}

/** 矩形蒙版（归一化坐标） */
export function rectMask(
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number },
  feather = 0.15
): Uint8ClampedArray {
  const x0 = rect.x
  const y0 = rect.y
  const x1 = rect.x + rect.w
  const y1 = rect.y + rect.h
  return polygonMask(
    width,
    height,
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1]
    ],
    feather
  )
}

// ── 人像主体蒙版（YOLO segment 输出）后处理 ─────────────────────

/**
 * 由二值主体蒙版得到「背景权重」：1 - 主体（羽化）。
 * 背景虚化 / 换底都用它，羽化给边缘过渡。
 */
export function backgroundMaskFromSubject(
  subject: Uint8ClampedArray,
  width: number,
  height: number,
  feather = 0.01
): Uint8ClampedArray {
  const radius = Math.max(1, Math.round(Math.min(width, height) * feather))
  const softened = blurMask(subject, width, height, radius)
  const out = new Uint8ClampedArray(softened.length)
  for (let i = 0; i < softened.length; i++) out[i] = 255 - softened[i]
  return out
}

/**
 * 手绘笔刷蒙版：把一组笔画（归一化圆点 + 半径）烧成蒙版。
 * 修复/局部磨皮/背景手绘都用同一条实现，避免各处重复写笔刷几何。
 */
export function strokeMask(
  width: number,
  height: number,
  strokes: ReadonlyArray<{
    size: number
    hardness: number
    points: ReadonlyArray<{ x: number; y: number }>
  }>,
  featherScale = 1
): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(width * height)
  const shortSide = Math.min(width, height)
  for (const stroke of strokes) {
    const radius = Math.max(1, (stroke.size * shortSide) / 2)
    const hardness = Math.min(1, Math.max(0, stroke.hardness / 100))
    for (const point of stroke.points) {
      const cx = point.x * width
      const cy = point.y * height
      const x0 = Math.max(0, Math.floor(cx - radius))
      const x1 = Math.min(width - 1, Math.ceil(cx + radius))
      const y0 = Math.max(0, Math.floor(cy - radius))
      const y1 = Math.min(height - 1, Math.ceil(cy + radius))
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
          if (d > radius) continue
          const t = radius === 0 ? 0 : d / radius
          // 硬度 100 = 实心圆；硬度 0 = 从中心到边缘线性衰减
          const inner = hardness
          const value = t <= inner ? 1 : 1 - (t - inner) / Math.max(1e-3, 1 - inner)
          const p = y * width + x
          const v = Math.round(value * 255)
          if (v > mask[p]) mask[p] = v
        }
      }
    }
  }
  if (featherScale > 1) {
    return blurMask(mask, width, height, Math.round(featherScale))
  }
  return mask
}

/** 笔画包围盒（归一化）：用于把修复/消除限制在局部，避免全图重算 */
export function strokeBounds(
  strokes: ReadonlyArray<{
    size: number
    points: ReadonlyArray<{ x: number; y: number }>
  }>
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const stroke of strokes) {
    const r = stroke.size / 2
    for (const p of stroke.points) {
      minX = Math.min(minX, p.x - r)
      minY = Math.min(minY, p.y - r)
      maxX = Math.max(maxX, p.x + r)
      maxY = Math.max(maxY, p.y + r)
    }
  }
  if (!Number.isFinite(minX)) return null
  return {
    x: Math.max(0, minX),
    y: Math.max(0, minY),
    w: Math.min(1, maxX) - Math.max(0, minX),
    h: Math.min(1, maxY) - Math.max(0, minY)
  }
}
