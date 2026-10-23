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
  /** 原图是否自带原生透明背景（由支持透明出图的模型直接生成，无需二次抠底或 YOLO 处理） */
  nativeTransparent?: boolean
}

/**
 * 检测图像是否已经自带原生透明背景（如 gpt-image-1 / recraft 等模型直接产出的 RGBA 透明 PNG）：
 * - 画布四周边框像素中已有 >= 5% 的透明/半透明像素（alpha < 245），或
 * - 全图采样中已有 >= 1% 的透明/半透明像素（alpha < 245）。
 */
export function hasNativeTransparentPixels(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): boolean {
  const w = Math.max(0, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  const total = w * h
  if (total <= 0 || data.length < total * 4) return false

  let borderCount = 0
  let borderTransparent = 0
  for (let x = 0; x < w; x++) {
    borderCount += 2
    if (data[x * 4 + 3]! < 245) borderTransparent++
    if (data[((h - 1) * w + x) * 4 + 3]! < 245) borderTransparent++
  }
  for (let y = 1; y < h - 1; y++) {
    borderCount += 2
    if (data[y * w * 4 + 3]! < 245) borderTransparent++
    if (data[(y * w + w - 1) * 4 + 3]! < 245) borderTransparent++
  }
  if (borderCount > 0 && borderTransparent / borderCount >= 0.05) {
    return true
  }

  const step = Math.max(1, Math.floor(total / 4096))
  let sampled = 0
  let transparent = 0
  for (let i = 0; i < total; i += step) {
    sampled++
    if (data[i * 4 + 3]! < 245) transparent++
  }
  return sampled > 0 && transparent / sampled >= 0.01
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
  // 平滑背景阴影/渐晕可继续泛洪的色距上界（仅当相邻像素步进色差极小时才顺延，且泛洪区一律置为全透明 alpha=0）
  const expandLimit = opts.distance + opts.feather * 0.75

  const flooded = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0
  let keyedPixels = 0

  const tryVisit = (idx: number, parentIdx: number): void => {
    if (idx < 0 || idx >= total || flooded[idx]) return
    const p = idx * 4
    const a = rgba[p + 3]!
    if (a === 0) {
      flooded[idx] = 1
      queue[tail++] = idx
      return
    }
    const r = rgba[p]!
    const g = rgba[p + 1]!
    const b = rgba[p + 2]!
    const dist = normalizedColorDistance(r, g, b, bg)
    if (dist >= expandLimit) return

    let stepDist = 0
    if (parentIdx >= 0) {
      const pp = parentIdx * 4
      stepDist = normalizedColorDistance(r, g, b, {
        r: rgba[pp]!,
        g: rgba[pp + 1]!,
        b: rgba[pp + 2]!
      })
    }

    // 1. 核心纯色背景（若贴近阈值上限则校验步进连续性，防止跨过浅银灰描边钻入白发内部）
    // 2. 凹陷处平滑环境阴影/柔光渐晕（像素间步进色差 <= 10）：直接归入透明背景（alpha=0），杜绝半透明白雾光晕
    const isCoreBg =
      dist < opts.distance && (parentIdx < 0 || dist < opts.distance * 0.72 || stepDist <= 22)
    const isSmoothGradientBg =
      opts.soft && opts.feather > 0 && dist < expandLimit && parentIdx >= 0 && stepDist <= 10

    if (isCoreBg || isSmoothGradientBg) {
      flooded[idx] = 1
      rgba[p + 3] = 0
      keyedPixels++
      queue[tail++] = idx
    }
  }

  for (let x = 0; x < w; x++) {
    tryVisit(x, -1)
    tryVisit((h - 1) * w + x, -1)
  }
  for (let y = 1; y < h - 1; y++) {
    tryVisit(y * w, -1)
    tryVisit(y * w + w - 1, -1)
  }

  while (head < tail) {
    const idx = queue[head++]!
    const x = idx % w
    const y = (idx - x) / w
    if (x > 0) tryVisit(idx - 1, idx)
    if (x + 1 < w) tryVisit(idx + 1, idx)
    if (y > 0) tryVisit(idx - w, idx)
    if (y + 1 < h) tryVisit(idx + w, idx)
  }

  // 仅对紧邻已泛洪背景的 1px 主体轮廓外缘执行光学共线抗锯齿与色距软化，不向内部或外部扩散半透明雾带
  if (opts.soft && opts.feather > 0 && keyedPixels > 0) {
    const dirX = [-1, 1, 0, 0, -1, 1, -1, 1]
    const dirY = [0, 0, -1, 1, -1, -1, 1, 1]
    for (let y = 0; y < h; y++) {
      const row = y * w
      for (let x = 0; x < w; x++) {
        const idx = row + x
        if (flooded[idx]) continue
        const p = idx * 4
        const a = rgba[p + 3]!
        if (a === 0) continue

        let bgNeighborIdx = -1
        let minBgNeighborDist = Infinity
        const cr = rgba[p]!
        const cg = rgba[p + 1]!
        const cb = rgba[p + 2]!

        for (let k = 0; k < 8; k++) {
          const nx = x + dirX[k]!
          const ny = y + dirY[k]!
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const ni = ny * w + nx
          if (!flooded[ni]) continue
          const np = ni * 4
          const nd = normalizedColorDistance(cr, cg, cb, {
            r: rgba[np]!,
            g: rgba[np + 1]!,
            b: rgba[np + 2]!
          })
          if (nd < minBgNeighborDist) {
            minBgNeighborDist = nd
            bgNeighborIdx = ni
          }
        }
        if (bgNeighborIdx < 0) continue

        const bp = bgNeighborIdx * 4
        const localBg: IconKeyColor = {
          r: rgba[bp]!,
          g: rgba[bp + 1]!,
          b: rgba[bp + 2]!
        }
        const dBg = Math.min(
          normalizedColorDistance(cr, cg, cb, bg),
          normalizedColorDistance(cr, cg, cb, localBg)
        )

        let keep = 1
        if (dBg < edge) {
          keep =
            dBg <= opts.distance
              ? (dBg / Math.max(1, opts.distance)) * 0.35
              : 0.35 + ((dBg - opts.distance) / Math.max(1, opts.feather)) * 0.65
        }

        // 光学抗锯齿投影：当轮廓外缘 1px 像素恰好落在局部背景 B 与内侧 1~2px 实心轮廓 F 的色彩连线上时，
        // 按真实光学混合比 t = ||C - B|| / ||F - B|| 赋予精确半透明 alpha，消除深色线稿外侧的灰白锯齿晶格
        let bestFgIdx = -1
        let maxFgBgDist = 0
        for (let k = 0; k < 8; k++) {
          for (let step = 1; step <= 2; step++) {
            const nx = x + dirX[k]! * step
            const ny = y + dirY[k]! * step
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) break
            const ni = ny * w + nx
            if (flooded[ni]) continue
            const np = ni * 4
            const fbDist = normalizedColorDistance(rgba[np]!, rgba[np + 1]!, rgba[np + 2]!, localBg)
            if (fbDist > maxFgBgDist) {
              maxFgBgDist = fbDist
              bestFgIdx = ni
            }
          }
        }

        if (bestFgIdx >= 0 && maxFgBgDist >= 35 && dBg < maxFgBgDist * 0.92) {
          const fp = bestFgIdx * 4
          const dfR = rgba[fp]! - localBg.r
          const dfG = rgba[fp + 1]! - localBg.g
          const dfB = rgba[fp + 2]! - localBg.b
          const dfLenSq = dfR * dfR + dfG * dfG + dfB * dfB
          if (dfLenSq >= 900) {
            const uR = cr - localBg.r
            const uG = cg - localBg.g
            const uB = cb - localBg.b
            const t = (uR * dfR + uG * dfG + uB * dfB) / dfLenSq
            if (t > 0.02 && t < 0.92) {
              const errR = uR - t * dfR
              const errG = uG - t * dfG
              const errB = uB - t * dfB
              const perpErr = Math.sqrt((errR * errR + errG * errG + errB * errB) / 3)
              if (perpErr < 18 && t < keep) {
                keep = t
              }
            }
          }
        }

        if (keep < 0.995) {
          rgba[p + 3] = clampByte(a * Math.max(0, Math.min(1, keep)))
          keyedPixels++
        }
      }
    }
  }

  return {
    background: bg,
    keyedPixels,
    keyedRatio: keyedPixels / total
  }
}
