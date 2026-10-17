/**
 * 图标包「采样色键控」纯函数：把接近指定背景色（可来自整版空白格 / 版面采样）
 * 的像素 alpha 置为 0，并按距离做软过渡。
 *
 * 与 chromaKey.ts（黑/白亮度键，面向特效序列帧）正交：本模块以 RGB 欧氏距离
 * 判色，可任意采样色（含深色卡片底），是「整版切格 → 透明 PNG 图标包」的像素底座。
 * 纯函数、无 DOM 依赖，可在 node / 渲染进程 / 测试中复用。
 */

export interface IconKeyColor {
  r: number
  g: number
  b: number
}

export interface IconKeyOptions {
  /** 判定为背景的色距阈值（0~255，越大抠得越狠；色距已归一化到 0~255） */
  distance?: number
  /** 软化过渡宽度：超过阈值后的渐变带，避免硬边（默认 40） */
  feather?: number
  /** 是否保留 alpha 渐变（默认 true）：色距落在 [distance, distance+feather] 时线性衰减 */
  soft?: boolean
}

export const DEFAULT_ICON_KEY_DISTANCE = 40
export const DEFAULT_ICON_KEY_FEATHER = 34

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n)
}

export function normalizeIconKeyOptions(options?: IconKeyOptions | null): Required<IconKeyOptions> {
  const distance = Math.max(
    0,
    Math.min(255, Math.round(Number(options?.distance ?? DEFAULT_ICON_KEY_DISTANCE)))
  )
  return {
    distance,
    feather: Math.max(
      0,
      Math.min(255, Math.round(Number(options?.feather ?? DEFAULT_ICON_KEY_FEATHER)))
    ),
    soft: options?.soft !== false
  }
}

/** 归一化色距（0~255）：RGB 欧氏距离 / √3，便于与黑/白键控阈值同尺度比较 */
export function normalizedColorDistance(r: number, g: number, b: number, bg: IconKeyColor): number {
  const dr = r - bg.r
  const dg = g - bg.g
  const db = b - bg.b
  return Math.sqrt((dr * dr + dg * dg + db * db) / 3)
}

/**
 * 就地执行采样色键控：alpha 越接近背景色的像素透明度越低。
 * 返回原数组（便于链式）。
 */
export function applyColorDistanceKey(
  rgba: Uint8ClampedArray,
  background: IconKeyColor,
  options?: IconKeyOptions
): Uint8ClampedArray {
  const bg = {
    r: clampByte(background.r),
    g: clampByte(background.g),
    b: clampByte(background.b)
  }
  const opts = normalizeIconKeyOptions(options)
  const edge = opts.distance + opts.feather
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3]!
    if (a === 0) continue
    const dist = normalizedColorDistance(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!, bg)
    if (dist < opts.distance) {
      rgba[i + 3] = 0
      continue
    }
    if (dist < edge && opts.soft) {
      const keep = (dist - opts.distance) / opts.feather
      rgba[i + 3] = clampByte(a * keep)
    }
  }
  return rgba
}

/**
 * 对像素矩形区域求平均色（纯色空白格等采样用）。
 * 忽略完全透明像素；区域为空或全透明返回 null。
 */
export function averageRegionColor(
  data: Uint8ClampedArray | Uint8Array,
  srcWidth: number,
  rect: { x: number; y: number; width: number; height: number }
): IconKeyColor | null {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(srcWidth, Math.max(x0 + 1, Math.floor(rect.x + rect.width)))
  const width = Math.min(srcWidth, Math.max(0, Math.floor(rect.width)))
  const height = Math.max(0, Math.floor(rect.height))
  if (width <= 0 || height <= 0) return null
  let sr = 0
  let sg = 0
  let sb = 0
  let count = 0
  for (let y = y0; y < y0 + height; y++) {
    const row = y * srcWidth
    for (let x = x0; x < x1; x++) {
      const i = (row + x) * 4
      if (data[i + 3] === 0) continue
      sr += data[i]!
      sg += data[i + 1]!
      sb += data[i + 2]!
      count++
    }
  }
  if (!count) return null
  return { r: sr / count, g: sg / count, b: sb / count }
}

/** 黑 / 白快捷键控色 */
export const ICON_KEY_BLACK: IconKeyColor = { r: 0, g: 0, b: 0 }
export const ICON_KEY_WHITE: IconKeyColor = { r: 255, g: 255, b: 255 }

/**
 * 采样画布四周 8 个边缘小块（四角 + 四边中点），取聚簇最多的主色均值作为纯色背景基准。
 * 相比四角直接求均值，四角/底边局部被主体脚底或阴影压住时不会污染背景采样色。
 */
export function samplePerimeterBackgroundColor(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): IconKeyColor | null {
  const w = Math.max(0, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  if (w <= 0 || h <= 0 || data.length < w * h * 4) return null
  const patch = Math.max(1, Math.min(6, Math.floor(Math.min(w, h) / 10) || 1))
  const midX = Math.max(0, Math.floor((w - patch) / 2))
  const midY = Math.max(0, Math.floor((h - patch) / 2))
  const rightX = Math.max(0, w - patch)
  const bottomY = Math.max(0, h - patch)

  const candidates = [
    averageRegionColor(data, w, { x: 0, y: 0, width: patch, height: patch }),
    averageRegionColor(data, w, { x: rightX, y: 0, width: patch, height: patch }),
    averageRegionColor(data, w, { x: 0, y: bottomY, width: patch, height: patch }),
    averageRegionColor(data, w, { x: rightX, y: bottomY, width: patch, height: patch }),
    averageRegionColor(data, w, { x: midX, y: 0, width: patch, height: patch }),
    averageRegionColor(data, w, { x: midX, y: bottomY, width: patch, height: patch }),
    averageRegionColor(data, w, { x: 0, y: midY, width: patch, height: patch }),
    averageRegionColor(data, w, { x: rightX, y: midY, width: patch, height: patch })
  ].filter((c): c is IconKeyColor => c !== null)

  if (!candidates.length) return null
  if (candidates.length === 1) {
    const c = candidates[0]!
    return { r: clampByte(c.r), g: clampByte(c.g), b: clampByte(c.b) }
  }

  const clusterRadius = 28
  let bestCluster: IconKeyColor[] = []
  let bestSpread = Infinity
  for (const seed of candidates) {
    const inliers = candidates.filter(
      (other) => normalizedColorDistance(other.r, other.g, other.b, seed) <= clusterRadius
    )
    const spread = inliers.reduce(
      (sum, other) => sum + normalizedColorDistance(other.r, other.g, other.b, seed),
      0
    )
    if (
      inliers.length > bestCluster.length ||
      (inliers.length === bestCluster.length && spread < bestSpread)
    ) {
      bestCluster = inliers
      bestSpread = spread
    }
  }

  const chosen = bestCluster.length ? bestCluster : candidates
  const sum = chosen.reduce((acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b }), {
    r: 0,
    g: 0,
    b: 0
  })
  return {
    r: clampByte(sum.r / chosen.length),
    g: clampByte(sum.g / chosen.length),
    b: clampByte(sum.b / chosen.length)
  }
}

export interface BorderFloodKeyResult {
  background: IconKeyColor | null
  /** 被键控置透明或半透明羽化的像素数 */
  keyedPixels: number
  /** 被键控像素占整图比例 0..1 */
  keyedRatio: number
}

/**
 * 四边连通泛洪键控（面向单图「纯色背景 → 透明 PNG」）：
 * - 从画布四条边界向内泛洪所有与外部背景连通的背景色像素，把核心背景置为全透明，
 *   并对贴近主体轮廓的过渡带按色距做软边 alpha 衰减；
 * - 主体内部被轮廓包围的同色区域（如白底角色的白眼珠、白衬衫高光）不与四边连通，
 *   因此不会被误挖出内部透明孔洞。
 */
export function applyBorderFloodColorKey(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options?: IconKeyOptions & { background?: IconKeyColor | null }
): BorderFloodKeyResult {
  const w = Math.max(0, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  const total = w * h
  if (total <= 0 || rgba.length < total * 4) {
    return { background: null, keyedPixels: 0, keyedRatio: 0 }
  }
  const sampled = options?.background ?? samplePerimeterBackgroundColor(rgba, w, h)
  if (!sampled) {
    return { background: null, keyedPixels: 0, keyedRatio: 0 }
  }
  const bg: IconKeyColor = {
    r: clampByte(sampled.r),
    g: clampByte(sampled.g),
    b: clampByte(sampled.b)
  }
  const opts = normalizeIconKeyOptions(options)
  const edge = opts.distance + opts.feather
  // 泛洪扩张上界略收紧，避免顺着浅色半透明抗锯齿缝隙钻进主体内部，外圈羽化像素仍在出队时一并软化
  const expandLimit = opts.distance + opts.feather * 0.65

  const visited = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0
  let keyedPixels = 0

  const tryVisit = (idx: number): void => {
    if (idx < 0 || idx >= total || visited[idx]) return
    visited[idx] = 1
    const p = idx * 4
    const a = rgba[p + 3]!
    if (a === 0) {
      queue[tail++] = idx
      return
    }
    const dist = normalizedColorDistance(rgba[p]!, rgba[p + 1]!, rgba[p + 2]!, bg)
    if (dist >= edge) return
    if (dist < opts.distance) {
      rgba[p + 3] = 0
      keyedPixels++
      queue[tail++] = idx
      return
    }
    if (opts.soft && opts.feather > 0) {
      const keep = (dist - opts.distance) / opts.feather
      rgba[p + 3] = clampByte(a * keep)
      keyedPixels++
    }
    if (dist < expandLimit) {
      queue[tail++] = idx
    }
  }

  for (let x = 0; x < w; x++) {
    tryVisit(x)
    tryVisit((h - 1) * w + x)
  }
  for (let y = 1; y < h - 1; y++) {
    tryVisit(y * w)
    tryVisit(y * w + w - 1)
  }

  while (head < tail) {
    const idx = queue[head++]!
    const x = idx % w
    const y = (idx - x) / w
    if (x > 0) tryVisit(idx - 1)
    if (x + 1 < w) tryVisit(idx + 1)
    if (y > 0) tryVisit(idx - w)
    if (y + 1 < h) tryVisit(idx + w)
  }

  return {
    background: bg,
    keyedPixels,
    keyedRatio: keyedPixels / total
  }
}
