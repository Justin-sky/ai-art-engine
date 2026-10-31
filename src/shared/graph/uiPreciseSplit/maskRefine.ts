/**
 * 调色板掩码精修（UI 精准拆层 v2 · P2）：
 * 本地分割 / 大模型框在纹理底或相近色底上容易把 1~2px 的底色「多包」进元素掩码，
 * 这些像素在新的「内部 alpha = 1」合成里会成为图层污染。
 *
 * 做法：在掩码内侧 2px 边带上，用前景调色板（掩码核心）和背景调色板（掩码外 2~5px 环带）
 * 做最近色判定；**只删不加**，且只删「几乎就是底色」的像素（与背景调色板足够接近、
 * 明显比前景更像背景）——独立颜色的描边 / 边框线既不像核心也不像底色，会被保留。
 */

import { expandRect, labelComponents, pixelDistance } from './pixels'
import type { PixelRect, RgbaImage } from './types'

type Rgb = [number, number, number]

function kmeans(samples: Rgb[], k: number, iters = 6): Rgb[] {
  if (!samples.length) return []
  const centers: Rgb[] = []
  // 确定性初始化：按亮度排序后等距取样
  const sorted = [...samples].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]))
  for (let i = 0; i < k; i++) {
    const s = sorted[Math.min(sorted.length - 1, Math.floor(((i + 0.5) / k) * sorted.length))]!
    centers.push([s[0], s[1], s[2]])
  }
  const sums = centers.map(() => [0, 0, 0, 0])
  for (let it = 0; it < iters; it++) {
    for (const s of sums) s.fill(0)
    for (const p of samples) {
      let best = 0
      let bd = Infinity
      for (let c = 0; c < centers.length; c++) {
        const d =
          (p[0] - centers[c]![0]) ** 2 + (p[1] - centers[c]![1]) ** 2 + (p[2] - centers[c]![2]) ** 2
        if (d < bd) {
          bd = d
          best = c
        }
      }
      const s = sums[best]!
      s[0]! += p[0]
      s[1]! += p[1]
      s[2]! += p[2]
      s[3]!++
    }
    for (let c = 0; c < centers.length; c++) {
      const s = sums[c]!
      if (s[3]! > 0) centers[c] = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!]
    }
  }
  return centers
}

const tA = new Uint8ClampedArray(4)
const tB = new Uint8ClampedArray(4)
function nearest(img: Uint8ClampedArray, i: number, centers: readonly Rgb[]): number {
  tA[0] = img[i]!
  tA[1] = img[i + 1]!
  tA[2] = img[i + 2]!
  tA[3] = 255
  let best = Infinity
  for (const c of centers) {
    tB[0] = c[0]
    tB[1] = c[1]
    tB[2] = c[2]
    tB[3] = 255
    const d = pixelDistance(tA, 0, tB, 0)
    if (d < best) best = d
  }
  return best
}

/** 8 邻域棋盘距离：from = 1 的像素为 0，向外扩散到 maxR */
function chessDist(from: Uint8Array, w: number, h: number, maxR: number): Uint8Array {
  const n = w * h
  const dist = new Uint8Array(n).fill(255)
  const q = new Int32Array(n)
  let head = 0
  let tail = 0
  for (let p = 0; p < n; p++) {
    if (from[p]) {
      dist[p] = 0
      q[tail++] = p
    }
  }
  while (head < tail) {
    const p = q[head++]!
    const d = dist[p]!
    if (d >= maxR) continue
    const py = (p / w) | 0
    const px = p - py * w
    for (let dy = -1; dy <= 1; dy++) {
      const ny = py + dy
      if (ny < 0 || ny >= h) continue
      for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx
        if (nx < 0 || nx >= w || (!dx && !dy)) continue
        const np = ny * w + nx
        if (dist[np]! <= d + 1) continue
        dist[np] = d + 1
        q[tail++] = np
      }
    }
  }
  return dist
}

export function refineMaskByPalette(
  img: RgbaImage,
  m: { rect: PixelRect; mask: Uint8Array }
): { rect: PixelRect; mask: Uint8Array; removed: number } {
  const W = img.width
  const H = img.height
  const region = expandRect(m.rect, 6, W, H)
  const rw = region.width
  const rh = region.height
  const n = rw * rh
  const inside = new Uint8Array(n)
  let insideCount = 0
  for (let y = 0; y < m.rect.height; y++) {
    const ly = m.rect.top + y - region.top
    if (ly < 0 || ly >= rh) continue
    for (let x = 0; x < m.rect.width; x++) {
      if (!m.mask[y * m.rect.width + x]) continue
      const lx = m.rect.left + x - region.left
      if (lx < 0 || lx >= rw) continue
      inside[ly * rw + lx] = 1
      insideCount++
    }
  }
  const unchanged = { rect: m.rect, mask: m.mask, removed: 0 }
  if (insideCount < 24) return unchanged
  const outside = new Uint8Array(n)
  for (let p = 0; p < n; p++) outside[p] = inside[p] ? 0 : 1
  const dIn = chessDist(outside, rw, rh, 6)
  const dOut = chessDist(inside, rw, rh, 6)

  const fg: Rgb[] = []
  const bg: Rgb[] = []
  for (let p = 0; p < n; p++) {
    const gi = ((region.top + ((p / rw) | 0)) * W + region.left + (p % rw)) * 4
    if (img.data[gi + 3]! < 200) continue
    const c: Rgb = [img.data[gi]!, img.data[gi + 1]!, img.data[gi + 2]!]
    if (inside[p] && dIn[p]! >= 3) fg.push(c)
    else if (!inside[p] && dOut[p]! >= 2 && dOut[p]! <= 5) bg.push(c)
  }
  if (fg.length < 8 || bg.length < 12) return unchanged
  const fgC = kmeans(fg, Math.min(4, Math.max(1, fg.length >> 3)))
  const bgC = kmeans(bg, 4)
  // 背景调色板的自身离散度：纹理底时放宽「像底色」的判定
  const spreads: number[] = []
  for (let p = 0; p < n; p++) {
    if (inside[p] || dOut[p]! < 2 || dOut[p]! > 5) continue
    const gi = ((region.top + ((p / rw) | 0)) * W + region.left + (p % rw)) * 4
    spreads.push(nearest(img.data, gi, bgC))
  }
  spreads.sort((a, b) => a - b)
  const bgSpread = spreads.length ? spreads[spreads.length >> 1]! : 0
  const likeBg = Math.max(14, bgSpread * 1.5)

  const out = new Uint8Array(inside)
  let removed = 0
  // 由外向内两轮：先判 1px 边，再判 2px 边（只有外侧已被删的像素才继续判，保持连续）
  for (let ring = 1; ring <= 2; ring++) {
    for (let p = 0; p < n; p++) {
      if (!out[p] || dIn[p] !== ring) continue
      if (ring === 2) {
        const py = (p / rw) | 0
        const px = p - py * rw
        let outerRemoved = false
        for (let dy = -1; dy <= 1 && !outerRemoved; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx
            const ny = py + dy
            if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue
            const np = ny * rw + nx
            if (inside[np] && !out[np] && dIn[np] === 1) {
              outerRemoved = true
              break
            }
          }
        }
        if (!outerRemoved) continue
      }
      const gi = ((region.top + ((p / rw) | 0)) * W + region.left + (p % rw)) * 4
      const dB = nearest(img.data, gi, bgC)
      if (dB > likeBg) continue
      const dF = nearest(img.data, gi, fgC)
      if (dB + 8 < dF) {
        out[p] = 0
        removed++
      }
    }
  }
  if (!removed) return unchanged
  // 删完后只保留连到核心的连通块，避免留下碎屑
  const { labels, stats } = labelComponents(out, rw, rh)
  const coreLabels = new Set<number>()
  for (let p = 0; p < n; p++) if (out[p] && dIn[p]! >= 3 && labels[p]) coreLabels.add(labels[p]!)
  if (!coreLabels.size && stats.length) {
    const biggest = stats.reduce((a, b) => (b.area > a.area ? b : a))
    coreLabels.add(biggest.label)
  }
  for (let p = 0; p < n; p++) if (out[p] && !coreLabels.has(labels[p]!)) out[p] = 0

  const mask = new Uint8Array(m.rect.width * m.rect.height)
  for (let y = 0; y < m.rect.height; y++) {
    const ly = m.rect.top + y - region.top
    if (ly < 0 || ly >= rh) continue
    for (let x = 0; x < m.rect.width; x++) {
      const lx = m.rect.left + x - region.left
      if (lx < 0 || lx >= rw) continue
      mask[y * m.rect.width + x] = out[ly * rw + lx]!
    }
  }
  return { rect: m.rect, mask, removed }
}
