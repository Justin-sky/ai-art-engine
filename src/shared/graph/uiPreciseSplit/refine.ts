/**
 * 像素级框校正：
 * - `refineElementBox`：VLM 框只是近似，按元素与周围底色的差异把框吸附到真实边缘
 * - `textStrokeMask`：在 OCR 文字框内分离出笔画（含描边/外发光），用于本地去字与文字层抠图
 */

import {
  clampRect,
  dilateMask,
  expandRect,
  labelComponents,
  median,
  pixelDistance,
  rectArea,
  rectIntersection
} from './pixels'
import type { PixelRect, RgbaImage } from './types'

export interface LocalMask {
  rect: PixelRect
  /** rect.width * rect.height，1 = 命中 */
  mask: Uint8Array
}

interface RingStats {
  /** 环带中位色（RGBA） */
  color: Uint8ClampedArray
  /** 环带像素到中位色的距离中位数（越大越杂） */
  spread: number
}

/** 统计矩形外圈环带（厚度 thickness）的中位色与离散度 */
export function ringStats(img: RgbaImage, rect: PixelRect, thickness = 2): RingStats {
  const r = clampRect(rect, img.width, img.height)
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  const as: number[] = []
  const idxs: number[] = []
  const x1 = r.left + r.width - 1
  const y1 = r.top + r.height - 1
  for (let y = r.top; y <= y1; y++) {
    for (let x = r.left; x <= x1; x++) {
      const onRing =
        x - r.left < thickness || x1 - x < thickness || y - r.top < thickness || y1 - y < thickness
      if (!onRing) continue
      const i = (y * img.width + x) * 4
      rs.push(img.data[i]!)
      gs.push(img.data[i + 1]!)
      bs.push(img.data[i + 2]!)
      as.push(img.data[i + 3]!)
      idxs.push(i)
    }
  }
  const color = new Uint8ClampedArray([median(rs), median(gs), median(bs), median(as)])
  const dists = idxs.map((i) => pixelDistance(img.data, i, color, 0))
  return { color, spread: median(dists) }
}

/**
 * 把 VLM 近似框吸附到元素真实边缘。
 * 只在外圈底色足够干净时才校正；结果与原框差异过大时保留原框（宁可不动，不可跑偏）。
 */
export function refineElementBox(img: RgbaImage, box: PixelRect): PixelRect {
  const { width: W, height: H } = img
  const maxSide = Math.max(box.width, box.height)
  const margin = Math.max(3, Math.min(48, Math.round(maxSide * 0.08)))
  const region = expandRect(box, margin, W, H)
  const ring = ringStats(img, region, 2)
  if (ring.spread > 22) return box

  const rw = region.width
  const rh = region.height
  const thr = Math.max(14, ring.spread * 3)
  const fg = new Uint8Array(rw * rh)
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = ((region.top + y) * W + region.left + x) * 4
      if (pixelDistance(img.data, i, ring.color, 0) > thr) fg[y * rw + x] = 1
    }
  }
  const { stats } = labelComponents(fg, rw, rh)
  if (!stats.length) return box
  const core: PixelRect = {
    left: box.left - region.left + Math.floor(box.width * 0.25),
    top: box.top - region.top + Math.floor(box.height * 0.25),
    width: Math.max(1, Math.ceil(box.width * 0.5)),
    height: Math.max(1, Math.ceil(box.height * 0.5))
  }
  const localBox: PixelRect = {
    left: box.left - region.left,
    top: box.top - region.top,
    width: box.width,
    height: box.height
  }
  const boxArea = rectArea(box)
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of stats) {
    const sr: PixelRect = {
      left: s.minX,
      top: s.minY,
      width: s.maxX - s.minX + 1,
      height: s.maxY - s.minY + 1
    }
    const hitsCore = rectIntersection(sr, core) > 0
    const cx = (s.minX + s.maxX) / 2
    const cy = (s.minY + s.maxY) / 2
    const centerIn =
      cx >= localBox.left &&
      cx <= localBox.left + localBox.width &&
      cy >= localBox.top &&
      cy <= localBox.top + localBox.height
    if (!(hitsCore || (centerIn && s.area >= boxArea * 0.03))) continue
    x0 = Math.min(x0, s.minX)
    y0 = Math.min(y0, s.minY)
    x1 = Math.max(x1, s.maxX + 1)
    y1 = Math.max(y1, s.maxY + 1)
  }
  if (!Number.isFinite(x0)) return box
  const snapped = clampRect(
    { left: region.left + x0, top: region.top + y0, width: x1 - x0, height: y1 - y0 },
    W,
    H
  )
  const area = rectArea(snapped)
  const inter = rectIntersection(snapped, box)
  const iou = inter / Math.max(1, area + boxArea - inter)
  if (area < boxArea * 0.45 || area > boxArea * 1.7 || iou < 0.5) return box
  return snapped
}

/**
 * OCR 文字框 → 笔画蒙版（局部坐标）。
 * 外圈底色干净时按色差分离笔画（含描边/投影，再膨胀 2px 吃掉抗锯齿与外发光）；
 * 底色杂乱（纹理/渐变强烈）时退化为整框。
 */
export function textStrokeMask(img: RgbaImage, box: PixelRect): LocalMask {
  const { width: W, height: H } = img
  const pad = Math.max(2, Math.round(box.height * 0.18))
  const rect = expandRect(box, pad, W, H)
  const n = rect.width * rect.height
  const full = (): LocalMask => ({ rect, mask: new Uint8Array(n).fill(1) })
  const ring = ringStats(img, rect, 2)
  if (ring.spread > 30) return full()
  const thr = Math.max(20, ring.spread * 2.5)
  const mask = new Uint8Array(n)
  let count = 0
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const i = ((rect.top + y) * W + rect.left + x) * 4
      if (pixelDistance(img.data, i, ring.color, 0) > thr) {
        mask[y * rect.width + x] = 1
        count++
      }
    }
  }
  if (!count) return full()
  const grown = dilateMask(mask, rect.width, rect.height, 2)
  let grownCount = 0
  for (let i = 0; i < n; i++) grownCount += grown[i]!
  if (grownCount > n * 0.85) return full()
  return { rect, mask: grown }
}

/** 把局部蒙版并入整图蒙版 */
export function paintLocalMask(target: Uint8Array, width: number, local: LocalMask): void {
  const { rect, mask } = local
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      if (mask[y * rect.width + x]) target[(rect.top + y) * width + rect.left + x] = 1
    }
  }
}

export function paintRect(
  target: Uint8Array,
  width: number,
  height: number,
  rect: PixelRect
): void {
  const r = clampRect(rect, width, height)
  for (let y = r.top; y < r.top + r.height; y++) {
    target.fill(1, y * width + r.left, y * width + r.left + r.width)
  }
}
