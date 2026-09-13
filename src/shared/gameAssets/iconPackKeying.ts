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
