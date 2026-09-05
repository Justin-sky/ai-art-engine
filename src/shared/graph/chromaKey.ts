/**
 * 色度键（chroma key）透明化：把接近纯黑 / 纯白的像素 alpha 置为 0。
 * 用于 2D 特效序列帧「黑底 / 白底 → 透明 PNG」的游戏素材导出。
 * 纯函数、无 DOM 依赖，可在 node / 渲染进程 / 测试中复用。
 *
 * 输入为 RGBA 字节数组（每像素 4 字节），就地修改 alpha 通道。
 */

export type ChromaKeyColor = 'black' | 'white'

export interface ChromaKeyOptions {
  /** 判定为背景色的亮度阈值（0~255，越大抠得越狠，默认 60） */
  threshold?: number
  /** 软化过渡宽度：超过阈值后的渐变带，避免硬边（默认 80） */
  feather?: number
  /**
   * 是否保留 alpha 渐变（默认 true）：
   * 亮度落在 [threshold, threshold+feather] 时按线性衰减，而非一刀切。
   * 特效边缘的灰阶往往是要保留的半透明光晕，建议开启。
   */
  soft?: boolean
}

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n)
}

/**
 * 就地执行色度键：
 * - `black`：接近纯黑的像素转透明；
 * - `white`：接近纯白的像素转透明。
 * 返回原数组（便于链式）。
 */
export function applyChromaKey(
  rgba: Uint8ClampedArray,
  color: ChromaKeyColor,
  options?: ChromaKeyOptions
): Uint8ClampedArray {
  const threshold = clampByte(options?.threshold ?? 60)
  const feather = Math.max(0, options?.feather ?? 80)
  const soft = options?.soft !== false
  const edge = threshold + feather

  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!
    const g = rgba[i + 1]!
    const b = rgba[i + 2]!
    const a = rgba[i + 3]!
    if (a === 0) continue
    // 距离：黑底看三通道最大值（越接近纯黑越“不亮”），白底看反相后的最小值。
    // 用通道极值而非感知亮度，避免把纯红/纯绿等鲜艳特效色误判为背景。
    const channelMax = Math.max(r, g, b)
    const channelMin = Math.min(r, g, b)
    const dist = color === 'black' ? channelMax : 255 - channelMin
    if (dist < threshold) {
      // 背景判定：完全透明
      rgba[i + 3] = 0
      continue
    }
    if (dist < edge && soft) {
      // 渐变带内：按接近背景的程度线性保留 alpha，避免硬边
      const keep = (dist - threshold) / feather
      rgba[i + 3] = clampByte(a * keep)
    }
  }
  return rgba
}
