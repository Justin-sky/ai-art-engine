/**
 * 已知下层的抠图：upper = 元素叠在 lower 上的结果（同一像素网格）。
 * 1. 由 upper/lower 色差估 alpha（smoothstep），并用 alpha 合成方程给出 alpha 下限
 *    （lower 透明时 alpha 精确等于 upper 的 alpha）
 * 2. 连通域去噪点、实心控件补洞、软边只保留在主体附近
 * 3. 去色污染：按 uc·ua = ec·ea + lc·la·(1-ea) 反解元素真实颜色，半透明发光/投影不带底色
 */

import {
  clampRect,
  dilateMask,
  erodeMask,
  expandRect,
  fillHoles,
  labelComponents,
  median,
  pixelDistance,
  rectIntersection
} from './pixels'
import type { PixelRect, RgbaImage } from './types'

export interface MatteOptions {
  /** 色差下阈值：低于它视为完全透明 */
  t0?: number
  /** 色差上阈值：高于它视为完全不透明 */
  t1?: number
  /** 实心控件：填补主体内部空洞 */
  fillHoles?: boolean
}

export interface MatteResult {
  rect: PixelRect
  rgba: Uint8ClampedArray
  /** 不透明像素占比（诊断用） */
  coverage: number
}

function smoothstep(e0: number, e1: number, x: number): number {
  if (x <= e0) return 0
  if (x >= e1) return 1
  const t = (x - e0) / (e1 - e0)
  return t * t * (3 - 2 * t)
}

export function extractMatte(
  upper: RgbaImage,
  lower: RgbaImage,
  box: PixelRect,
  options: MatteOptions = {}
): MatteResult | null {
  const W = upper.width
  const H = upper.height
  const rect = expandRect(box, 2, W, H)
  const rw = rect.width
  const rh = rect.height
  const n = rw * rh

  // 噪声底：框外一圈（仍在羽化带内）的色差中位数，抬高阈值抵消补底误差
  const ringRect = expandRect(box, 6, W, H)
  const ringD: number[] = []
  for (let y = ringRect.top; y < ringRect.top + ringRect.height; y += 1) {
    for (let x = ringRect.left; x < ringRect.left + ringRect.width; x += 1) {
      const inside = x >= rect.left && x < rect.left + rw && y >= rect.top && y < rect.top + rh
      if (inside) continue
      const i = (y * W + x) * 4
      ringD.push(pixelDistance(upper.data, i, lower.data, i))
    }
  }
  const noise = median(ringD)
  const t0 = (options.t0 ?? 10) + noise * 1.5
  const t1 = Math.max(t0 + 12, (options.t1 ?? 42) + noise * 1.5)

  const alpha = new Float32Array(n)
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = ((rect.top + y) * W + rect.left + x) * 4
      const ua = upper.data[i + 3]! / 255
      if (ua < 0.004) continue
      const la = lower.data[i + 3]! / 255
      const d = pixelDistance(upper.data, i, lower.data, i)
      let a = smoothstep(t0, t1, d)
      if (la < 0.999) {
        const minA = Math.max(0, (ua - la) / (1 - la))
        if (minA > a) a = minA
      }
      alpha[y * rw + x] = Math.min(1, a)
    }
  }

  // 主体：alpha ≥ 0.5 的连通域，去掉与框核心无关的零碎噪点
  let core: Uint8Array = new Uint8Array(n)
  for (let p = 0; p < n; p++) core[p] = alpha[p]! >= 0.5 ? 1 : 0
  const { labels, stats } = labelComponents(core, rw, rh)
  if (!stats.length) return null
  const localBox: PixelRect = {
    left: box.left - rect.left,
    top: box.top - rect.top,
    width: box.width,
    height: box.height
  }
  const inner: PixelRect = {
    left: localBox.left + Math.floor(localBox.width * 0.2),
    top: localBox.top + Math.floor(localBox.height * 0.2),
    width: Math.max(1, Math.ceil(localBox.width * 0.6)),
    height: Math.max(1, Math.ceil(localBox.height * 0.6))
  }
  const largest = stats.reduce((m, s) => Math.max(m, s.area), 0)
  const minArea = Math.max(4, Math.round(n * 0.002))
  const keep = new Uint8Array(stats.length + 1)
  for (const s of stats) {
    const sr: PixelRect = {
      left: s.minX,
      top: s.minY,
      width: s.maxX - s.minX + 1,
      height: s.maxY - s.minY + 1
    }
    if (s.area >= minArea || rectIntersection(sr, inner) > 0 || s.area >= largest * 0.25)
      keep[s.label] = 1
  }
  for (let p = 0; p < n; p++) core[p] = labels[p] && keep[labels[p]!] ? 1 : 0
  if (options.fillHoles) {
    const filled = fillHoles(core, rw, rh)
    for (let p = 0; p < n; p++) {
      if (filled[p] && !core[p]) alpha[p] = 1
    }
    core = filled
    // 实心控件内部（离边缘 ≥2px）接近不透明的像素直接定为不透明，软边只留在轮廓上；
    // 真正半透明的磨砂面板（alpha 明显偏低）保持原样
    const interior = erodeMask(core, rw, rh, 2)
    for (let p = 0; p < n; p++) {
      if (interior[p] && alpha[p]! >= 0.75) alpha[p] = 1
    }
  }
  let coreCount = 0
  for (let p = 0; p < n; p++) coreCount += core[p]!
  if (!coreCount) return null

  // 软边只保留在主体 3px 内（发光/抗锯齿），远处的弱差异视为补底噪声
  const band = dilateMask(core, rw, rh, 3)
  const rgba = new Uint8ClampedArray(n * 4)
  let minX = rw
  let minY = rh
  let maxX = -1
  let maxY = -1
  let opaque = 0
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const p = y * rw + x
      const ea = band[p] ? alpha[p]! : 0
      if (ea < 0.01) continue
      const i = ((rect.top + y) * W + rect.left + x) * 4
      const ua = upper.data[i + 3]! / 255
      const la = lower.data[i + 3]! / 255
      const o = p * 4
      for (let c = 0; c < 3; c++) {
        const uc = upper.data[i + c]!
        const lc = lower.data[i + c]!
        // 反解元素颜色；alpha 很低时向 upper 原色收敛，避免噪声被放大
        const solved = ea >= 0.995 ? uc : (uc * ua - lc * la * (1 - ea)) / ea
        const trust = smoothstep(0.08, 0.35, ea)
        rgba[o + c] = solved * trust + uc * (1 - trust)
      }
      rgba[o + 3] = Math.round(ea * 255)
      if (ea >= 0.5) opaque++
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null

  const tw = maxX - minX + 1
  const th = maxY - minY + 1
  const out = new Uint8ClampedArray(tw * th * 4)
  for (let y = 0; y < th; y++) {
    const start = ((minY + y) * rw + minX) * 4
    out.set(rgba.subarray(start, start + tw * 4), y * tw * 4)
  }
  return {
    rect: clampRect({ left: rect.left + minX, top: rect.top + minY, width: tw, height: th }, W, H),
    rgba: out,
    coverage: opaque / Math.max(1, tw * th)
  }
}
