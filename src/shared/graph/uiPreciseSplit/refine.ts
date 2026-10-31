/**
 * 像素级框校正：
 * - `refineElementBox`：VLM 框只是近似，按元素与周围底色的差异把框吸附到真实边缘
 * - `textStrokeMask`：在 OCR 文字框内分离出笔画（含描边/外发光），用于本地去字与文字层抠图
 */

import type { LocalOcrTextBox } from '../uiControlSpec'
import {
  clampRect,
  closeMask3x3,
  computeOtsuThreshold,
  dilateMask,
  expandRect,
  labelComponents,
  labelComponents8,
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
  /** 字形掩码质量：estimated_glyphs = Otsu+闭运算成功分离笔画；coarse = 退化为整框 */
  maskQuality?: 'estimated_glyphs' | 'coarse'
  /** 未膨胀的原始字形掩码（用于字色/字重/描边采样） */
  glyphMask?: Uint8Array
  /** 估算的局部背景色 RGB */
  bgColor?: [number, number, number]
  /** 字形像素占文本框面积比例 (0..1) */
  coverage?: number
}

/**
 * 过滤本地 OCR 误检框（对标知乎方案 2.1.1）：
 * 1. 置信度低于 0.35 的低质量候选丢弃；
 * 2. 单个拉丁字母且置信度低于 0.85 的候选丢弃（游戏图标常被误识为单个字母 x/v/i）；
 * 3. 高宽比 >= 2.4 的竖长条且字符数 <= 2、置信度低于 0.72 的装饰纹理误检丢弃。
 */
export function filterOcrFalsePositives(boxes: readonly LocalOcrTextBox[]): LocalOcrTextBox[] {
  const out: LocalOcrTextBox[] = []
  for (const box of boxes) {
    const cleaned = (box.text ?? '').trim()
    if (!cleaned) continue
    if (!/[\p{L}\p{N}]/u.test(cleaned)) continue
    if (box.width < 4 || box.height < 4) continue
    const conf = box.confidence
    if (conf != null && Number.isFinite(conf)) {
      if (conf < 0.35) continue
      if (cleaned.length === 1 && /^[a-z]$/i.test(cleaned) && conf < 0.85) continue
      const aspect = box.height / Math.max(1, box.width)
      if (aspect >= 2.4 && cleaned.length <= 2 && conf < 0.72) continue
    }
    out.push(box)
  }
  return out
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
 * 当 VLM 预测的按钮/角标框偏小（如 "+/-" 按钮框只盖住上半截、或五边形角标框偏小）时，
 * 采样框内主体面色（排除中心纯白/纯黑符号），沿四个方向向框外逐行/逐列生长，直至触达真实边缘。
 */
function expandBoxToConnectedSurface(img: RgbaImage, box: PixelRect): PixelRect {
  const { width: W, height: H } = img
  if (box.width < 10 || box.height < 10 || box.width > W * 0.48 || box.height > H * 0.48) {
    return box
  }
  const maxSide = Math.max(box.width, box.height)
  const outerMargin = Math.max(8, Math.min(36, Math.round(maxSide * 0.35)))
  const outerRegion = expandRect(box, outerMargin, W, H)
  const outerRing = ringStats(img, outerRegion, 2)
  if (outerRing.spread > 22) return box
  const outerBg = outerRing.color

  const cx0 = box.left + Math.floor(box.width * 0.15)
  const cy0 = box.top + Math.floor(box.height * 0.15)
  const cx1 = Math.max(cx0 + 1, box.left + Math.ceil(box.width * 0.85))
  const cy1 = Math.max(cy0 + 1, box.top + Math.ceil(box.height * 0.85))

  const allLums: number[] = []
  const candidates: Array<[number, number, number, number]> = []
  for (let y = cy0; y < cy1; y++) {
    for (let x = cx0; x < cx1; x++) {
      const i = (y * W + x) * 4
      if (pixelDistance(img.data, i, outerBg, 0) <= 22) continue
      const r = img.data[i]!
      const g = img.data[i + 1]!
      const b = img.data[i + 2]!
      const a = img.data[i + 3]!
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      allLums.push(lum)
      candidates.push([r, g, b, a])
    }
  }
  if (candidates.length < 8) return box
  const medLum = median(allLums)
  // 若主体不是纯白块，剔除中心高亮白色符号（如 "+"、"-"、白色拼图符号）以准确提取按钮/角标底色
  const bodySamples =
    medLum < 205
      ? candidates.filter(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b < 225)
      : candidates
  const used = bodySamples.length >= 6 ? bodySamples : candidates
  const bodyColor = new Uint8ClampedArray([
    median(used.map((c) => c[0])),
    median(used.map((c) => c[1])),
    median(used.map((c) => c[2])),
    median(used.map((c) => c[3]))
  ])
  if (pixelDistance(bodyColor, 0, outerBg, 0) < 26) return box

  const spreadDists = used.map(
    (c) =>
      Math.sqrt(
        (c[0] - bodyColor[0]!) ** 2 + (c[1] - bodyColor[1]!) ** 2 + (c[2] - bodyColor[2]!) ** 2
      ) / 2
  )
  if (median(spreadDists) > 28) return box

  let left = box.left
  let top = box.top
  let right = box.left + box.width
  let bottom = box.top + box.height
  const maxGrowX = Math.max(8, Math.min(36, Math.round(box.width * 0.5)))
  const maxGrowY = Math.max(8, Math.min(36, Math.round(box.height * 0.5)))

  const matchesBody = (x: number, y: number): boolean => {
    const i = (y * W + x) * 4
    const dBody = pixelDistance(img.data, i, bodyColor, 0)
    const dBg = pixelDistance(img.data, i, outerBg, 0)
    return dBody <= 34 && dBody + 8 < dBg
  }

  const rowMatchRatio = (y: number, x0: number, x1: number): number => {
    const padX = Math.min(2, Math.floor((x1 - x0) * 0.15))
    const s0 = x0 + padX
    const s1 = x1 - padX
    if (s1 <= s0) return 0
    let hits = 0
    for (let x = s0; x < s1; x++) {
      if (matchesBody(x, y)) hits++
    }
    return hits / (s1 - s0)
  }

  const colMatchRatio = (x: number, y0: number, y1: number): number => {
    const padY = Math.min(2, Math.floor((y1 - y0) * 0.15))
    const s0 = y0 + padY
    const s1 = y1 - padY
    if (s1 <= s0) return 0
    let hits = 0
    for (let y = s0; y < s1; y++) {
      if (matchesBody(x, y)) hits++
    }
    return hits / (s1 - s0)
  }

  if (rowMatchRatio(bottom - 1, left, right) >= 0.35) {
    for (let step = 0; step < maxGrowY && bottom < H; step++) {
      if (rowMatchRatio(bottom, left, right) >= 0.42) bottom++
      else break
    }
  }
  if (rowMatchRatio(top, left, right) >= 0.35) {
    for (let step = 0; step < maxGrowY && top > 0; step++) {
      if (rowMatchRatio(top - 1, left, right) >= 0.42) top--
      else break
    }
  }
  if (colMatchRatio(right - 1, top, bottom) >= 0.35) {
    for (let step = 0; step < maxGrowX && right < W; step++) {
      if (colMatchRatio(right, top, bottom) >= 0.42) right++
      else break
    }
  }
  if (colMatchRatio(left, top, bottom) >= 0.35) {
    for (let step = 0; step < maxGrowX && left > 0; step++) {
      if (colMatchRatio(left - 1, top, bottom) >= 0.42) left--
      else break
    }
  }

  return clampRect({ left, top, width: right - left, height: bottom - top }, W, H)
}

/**
 * 把 VLM 近似框吸附到元素真实边缘。
 * 先沿连通同色面板/按钮表面向外补齐被截断的边缘，再按与外圈底色的差异吸附紧致边缘。
 */
export function refineElementBox(img: RgbaImage, rawBox: PixelRect): PixelRect {
  const { width: W, height: H } = img
  const box = expandBoxToConnectedSurface(img, rawBox)
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
  if (area < boxArea * 0.45 || area > boxArea * 1.85 || iou < 0.48) return box
  return snapped
}

/**
 * OCR 文字框 → 笔画蒙版（局部坐标，对标知乎方案 2.1.2）：
 * 1. 取边框带（宽度 clamp(round(min(w,h)/4), 1, 3)）的 RGB 中位数估算局部背景色 B；
 * 2. 计算每个像素与 B 的欧氏距离 d(p)，缩放为 D(p) = clamp(round(3*d(p)), 0, 255)；
 * 3. 在 D(p) 上求 Otsu 阈值 T，取有效阈值 max(12, round(0.65*T)) 分离初始笔画；
 * 4. 执行 3x3 形态学闭运算连接断笔；
 * 5. 质量检验：若笔画占比不在 1.5%..68% 之间，说明背景极度复杂，退化为整框（coarse）；
 * 6. 自适应膨胀：单个汉字按 clamp(round(0.16*h), 3, 8) 膨胀，其余文本按 clamp(round(0.09*h), 2, 6) 膨胀，吃掉描边与抗锯齿残影。
 */
export function textStrokeMask(img: RgbaImage, box: PixelRect, text?: string): LocalMask {
  const { width: W, height: H } = img
  const trimmedText = (text ?? '').trim()
  const isSingleCjk = /^\p{Script=Han}$/u.test(trimmedText)
  const dilateRadius = isSingleCjk
    ? Math.max(3, Math.min(8, Math.round(box.height * 0.16)))
    : Math.max(2, Math.min(6, Math.round(box.height * 0.09)))
  const pad = Math.max(2, dilateRadius)
  const rect = expandRect(box, pad, W, H)
  const rw = rect.width
  const rh = rect.height
  const n = rw * rh

  const strip = Math.max(1, Math.min(3, Math.round(Math.min(rw, rh) / 4)))
  const ring = ringStats(img, rect, strip)
  const bgColor: [number, number, number] = [ring.color[0]!, ring.color[1]!, ring.color[2]!]

  const full = (): LocalMask => {
    const m = new Uint8Array(n).fill(1)
    return {
      rect,
      mask: m,
      maskQuality: 'coarse',
      glyphMask: m,
      bgColor,
      coverage: 1
    }
  }

  // 当外圈背景色差较大（如文字 "x5" 同时压在黄黑肩甲与紫色底板上）时，
  // 收集外圈环带的所有背景颜色样本（outerSamples）：凡是穿过外圈环带的肩甲色、底板色，
  // 其到 outerSamples 的最小色差 minDistToRing 均接近 0；唯有框内独立的文字字芯具有高色差！
  const complexBg = ring.spread > 24
  const outerSamples: Array<[number, number, number]> = []
  if (complexBg) {
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        if (x >= strip && x < rw - strip && y >= strip && y < rh - strip) continue
        const i = ((rect.top + y) * W + rect.left + x) * 4
        outerSamples.push([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!])
      }
    }
  }

  const scaledDist = new Uint8Array(n)
  let maxScaled = 0
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const p = y * rw + x
      const i = ((rect.top + y) * W + rect.left + x) * 4
      let d: number
      if (complexBg && outerSamples.length > 0) {
        const r = img.data[i]!
        const g = img.data[i + 1]!
        const b = img.data[i + 2]!
        let minD2 = Infinity
        for (let k = 0; k < outerSamples.length; k++) {
          const s = outerSamples[k]!
          const dr = r - s[0]
          const dg = g - s[1]
          const db = b - s[2]
          const d2 = dr * dr + dg * dg + db * db
          if (d2 < minD2) minD2 = d2
        }
        d = Math.sqrt(minD2)
      } else {
        const dr = img.data[i]! - bgColor[0]
        const dg = img.data[i + 1]! - bgColor[1]
        const db = img.data[i + 2]! - bgColor[2]
        d = Math.sqrt(dr * dr + dg * dg + db * db)
      }
      const s = Math.max(0, Math.min(255, Math.round(d * 3)))
      scaledDist[p] = s
      if (s > maxScaled) maxScaled = s
    }
  }

  // 完全均匀的纯色块（无任何笔画对比）直接标记为 coarse
  if (maxScaled < 24) {
    return full()
  }

  const otsuT = computeOtsuThreshold(scaledDist)
  const effT = complexBg
    ? Math.max(24, Math.round(otsuT * 0.78))
    : Math.max(12, Math.round(otsuT * 0.65), Math.round(ring.spread * 2.2 * 3))
  const rawGlyph = new Uint8Array(n)
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const p = y * rw + x
      if (complexBg && (x < 1 || x >= rw - 1 || y < 1 || y >= rh - 1)) continue
      if (scaledDist[p]! >= effT) rawGlyph[p] = 1
    }
  }

  // 在复杂背景上，剔除紧贴外框边缘贯通的背景纹理连通块（如 "x5" 左下角贴边的衣领/肩甲块），仅保留内部独立笔画连通域
  let filteredGlyph = closeMask3x3(rawGlyph, rw, rh)
  if (complexBg) {
    const { labels, stats } = labelComponents8(filteredGlyph, rw, rh)
    if (stats.length > 0) {
      const nonBorderLabels = new Set<number>()
      const moderateLabels = new Set<number>()
      for (const s of stats) {
        let outerEdgeTouches = 0
        let ringTouches = 0
        for (let y = s.minY; y <= s.maxY; y++) {
          for (let x = s.minX; x <= s.maxX; x++) {
            const p = y * rw + x
            if (labels[p] !== s.label) continue
            if (x <= 1 || x >= rw - 2 || y <= 1 || y >= rh - 2) outerEdgeTouches++
            if (x <= strip || x >= rw - 1 - strip || y <= strip || y >= rh - 1 - strip) {
              ringTouches++
            }
          }
        }
        if (outerEdgeTouches === 0 && ringTouches / Math.max(1, s.area) <= 0.25) {
          nonBorderLabels.add(s.label)
        } else if (ringTouches / Math.max(1, s.area) <= 0.35) {
          moderateLabels.add(s.label)
        }
      }
      const keep = nonBorderLabels.size > 0 ? nonBorderLabels : moderateLabels
      if (keep.size > 0) {
        const nextGlyph = new Uint8Array(n)
        for (let p = 0; p < n; p++) {
          if (keep.has(labels[p]!)) nextGlyph[p] = 1
        }
        filteredGlyph = nextGlyph
      }
    }
    // 吸收紧贴亮色字芯外围 1~2px 内的深色描边像素（如白色 "x5" 的黑色外描边）
    const strokeHalo = dilateMask(filteredGlyph, rw, rh, Math.min(2, dilateRadius))
    for (let p = 0; p < n; p++) {
      if (!strokeHalo[p] || filteredGlyph[p]) continue
      const y = Math.floor(p / rw)
      const x = p - y * rw
      if (x <= 1 || x >= rw - 2 || y <= 1 || y >= rh - 2) continue
      const i = ((rect.top + y) * W + rect.left + x) * 4
      const lum = 0.2126 * img.data[i]! + 0.7152 * img.data[i + 1]! + 0.0722 * img.data[i + 2]!
      if (lum <= 68) {
        filteredGlyph[p] = 1
      }
    }
  }

  let glyphCount = 0
  for (let p = 0; p < n; p++) glyphCount += filteredGlyph[p]!
  const coverage = n > 0 ? glyphCount / n : 0

  if (!complexBg && (coverage < 0.015 || coverage > 0.68)) {
    return full()
  }

  const grown = dilateMask(filteredGlyph, rw, rh, complexBg ? 1 : Math.min(3, dilateRadius))
  let grownCount = 0
  for (let i = 0; i < n; i++) grownCount += grown[i]!
  if (!complexBg && grownCount > n * 0.88) return full()

  return {
    rect,
    mask: grown,
    maskQuality: 'estimated_glyphs',
    glyphMask: filteredGlyph,
    bgColor,
    coverage
  }
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
