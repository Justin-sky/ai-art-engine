/**
 * 点 + 框提示的实例分割、多候选掩码评分与形态学连通域后处理（对标知乎方案 2.2.2 ~ 2.2.4）：
 *
 * 1. 支持外部注入的本地 SAM 2.1 ONNX 编码/解码器（3 候选掩码 + IoU 预测分）；
 * 2. 当未安装 SAM 2.1 ONNX 时，提供基于正向锚点 / 负向排除点 / 提示框的多尺度局部色差与种子生长 3 候选生成器；
 * 3. 严格按公式评分挑出最佳候选：
 *    TotalScore = samScore + 0.22 * posHitRate - 0.38 * negHitRate + 0.10 * boxContainment + 0.06 * bboxIoU
 * 4. 对胜出掩码执行 3x3 闭运算（先膨胀 1px 再腐蚀 1px）与 8 邻域连通域过滤
 *    （保留命中正向点的连通块；若均未命中则保留最大块；同时保留面积 >= 最大块 8% 的多笔/分离部件块）。
 */

import {
  clampRect,
  closeMask3x3,
  computeOtsuThreshold,
  dilateMask,
  fillHoles,
  labelComponents8,
  median,
  pixelDistance,
  rectArea,
  rectIntersection
} from './pixels'
import { ringStats } from './refine'
import type {
  PixelPoint,
  PixelRect,
  PreciseSplitIo,
  PreciseSplitSam2Candidate,
  RgbaImage,
  UiElementNode
} from './types'

export interface SamCandidateScoreInput {
  /** 与 width * height 同尺寸的二值掩码（1 = 前景） */
  mask: Uint8Array
  width: number
  height: number
  samScore: number
  promptBox: PixelRect
  positivePoints: readonly PixelPoint[]
  negativePoints: readonly PixelPoint[]
}

export interface SamCandidateScoreBreakdown {
  totalScore: number
  samScore: number
  posHitRate: number
  negHitRate: number
  boxContainment: number
  bboxIoU: number
}

/**
 * 计算候选掩码的综合评分（对标知乎方案 2.2.3）：
 * TotalScore = samScore + 0.22 * posHitRate - 0.38 * negHitRate + 0.10 * boxContainment + 0.06 * bboxIoU
 */
export function scoreSamCandidateMask(input: SamCandidateScoreInput): SamCandidateScoreBreakdown {
  const { mask, width, height, samScore, promptBox, positivePoints, negativePoints } = input
  const box = clampRect(promptBox, width, height)
  const bx0 = box.left
  const by0 = box.top
  const bx1 = box.left + box.width
  const by1 = box.top + box.height

  let totalFg = 0
  let inBoxFg = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    const row = y * width
    const inY = y >= by0 && y < by1
    for (let x = 0; x < width; x++) {
      if (!mask[row + x]) continue
      totalFg++
      if (inY && x >= bx0 && x < bx1) inBoxFg++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  let posHits = 0
  if (positivePoints.length > 0) {
    for (const pt of positivePoints) {
      const px = Math.max(0, Math.min(width - 1, Math.round(pt.x)))
      const py = Math.max(0, Math.min(height - 1, Math.round(pt.y)))
      if (mask[py * width + px]) posHits++
    }
  }
  const posHitRate = positivePoints.length > 0 ? posHits / positivePoints.length : 1

  let negHits = 0
  if (negativePoints.length > 0) {
    for (const pt of negativePoints) {
      const px = Math.max(0, Math.min(width - 1, Math.round(pt.x)))
      const py = Math.max(0, Math.min(height - 1, Math.round(pt.y)))
      if (mask[py * width + px]) negHits++
    }
  }
  const negHitRate = negativePoints.length > 0 ? negHits / negativePoints.length : 0

  const boxContainment = totalFg > 0 ? inBoxFg / totalFg : 0

  let bboxIoU = 0
  if (totalFg > 0 && maxX >= minX && maxY >= minY) {
    const maskRect: PixelRect = {
      left: minX,
      top: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    }
    const inter = rectIntersection(maskRect, box)
    const union = rectArea(maskRect) + rectArea(box) - inter
    bboxIoU = union > 0 ? inter / union : 0
  }

  const totalScore =
    samScore + 0.22 * posHitRate - 0.38 * negHitRate + 0.1 * boxContainment + 0.06 * bboxIoU

  return {
    totalScore,
    samScore,
    posHitRate,
    negHitRate,
    boxContainment,
    bboxIoU
  }
}

/**
 * 掩码形态学闭运算与 8 邻域连通域过滤后处理（对标知乎方案 2.2.4）：
 * 1. 3x3 闭运算（先膨胀 1px 再腐蚀 1px）闭合边缘小裂缝；
 * 2. 8 邻域连通域标记；
 * 3. 保留包含任一正向点的连通块；若没有任何块命中正向点，则保留最大连通块；
 * 4. 额外保留面积 >= 最大连通块面积 8% 的块（兼顾多笔画艺术字、带独立装饰角标的控件）。
 */
export function postProcessInstanceMask(
  mask: Uint8Array,
  width: number,
  height: number,
  positivePoints: readonly PixelPoint[] = [],
  NegativeRadius = 2
): Uint8Array {
  const closed = closeMask3x3(mask, width, height)
  const { labels, stats } = labelComponents8(closed, width, height)
  if (!stats.length) return closed

  let maxArea = 0
  let maxLabel = stats[0]!.label
  for (const s of stats) {
    if (s.area > maxArea) {
      maxArea = s.area
      maxLabel = s.label
    }
  }

  const keepLabels = new Set<number>()
  for (const pt of positivePoints) {
    const px = Math.max(0, Math.min(width - 1, Math.round(pt.x)))
    const py = Math.max(0, Math.min(height - 1, Math.round(pt.y)))
    const lbl = labels[py * width + px]!
    if (lbl > 0) {
      keepLabels.add(lbl)
      continue
    }
    // 允许在正向点周围小半径内吸附最近的前景连通块
    for (let dy = -NegativeRadius; dy <= NegativeRadius; dy++) {
      const ny = py + dy
      if (ny < 0 || ny >= height) continue
      for (let dx = -NegativeRadius; dx <= NegativeRadius; dx++) {
        const nx = px + dx
        if (nx < 0 || nx >= width) continue
        const nearLbl = labels[ny * width + nx]!
        if (nearLbl > 0) keepLabels.add(nearLbl)
      }
    }
  }

  if (keepLabels.size === 0) {
    keepLabels.add(maxLabel)
  }

  const areaThreshold = maxArea * 0.08
  for (const s of stats) {
    if (s.area >= areaThreshold) {
      keepLabels.add(s.label)
    }
  }

  const out = new Uint8Array(closed.length)
  for (let i = 0; i < closed.length; i++) {
    if (keepLabels.has(labels[i]!)) out[i] = 1
  }
  return out
}

/**
 * 在局部区域（crop）上根据正向锚点、负向排除点与外框生成 3 个多尺度候选掩码：
 * - Candidate 0 (Tight): 围绕正向锚点与核心前景色的紧致掩码（排除负向点颜色）；
 * - Candidate 1 (Medium): 基于外框背景色差 + Otsu 自适应阈值的标准实例掩码；
 * - Candidate 2 (Inclusive): 闭合填充内部孔洞的完整控件实心轮廓掩码。
 */
export function generateLocalPromptedCandidates(
  crop: RgbaImage,
  localBox: PixelRect,
  positivePoints: readonly PixelPoint[],
  negativePoints: readonly PixelPoint[]
): PreciseSplitSam2Candidate[] {
  const { width: W, height: H } = crop
  const n = W * H
  const box = clampRect(localBox, W, H)
  const outerThickness = Math.max(
    1,
    Math.min(3, Math.max(1, box.left), Math.max(1, box.top), Math.round(Math.min(W, H) * 0.06))
  )
  // 必须采样 crop 外圈边缘（即元素框外的真实画布/父容器背景），绝不能传 localBox（否则会把元素自身边缘颜色当成背景色！）
  const ring = ringStats(crop, { left: 0, top: 0, width: W, height: H }, outerThickness)
  const bgRgba = ring.color

  const bx0 = box.left
  const by0 = box.top
  const bx1 = box.left + box.width
  const by1 = box.top + box.height

  // 采样正向点颜色 + 框内 9 宫格锚点颜色（解决中心单点落在 "+/-" 白色符号或白色拼图上而漏掉青色按钮/五边形底板本体颜色的问题）
  const posColors: Uint8ClampedArray[] = []
  const addPosSample = (fx: number, fy: number, requireContrast: boolean): void => {
    const px = Math.max(0, Math.min(W - 1, Math.round(fx)))
    const py = Math.max(0, Math.min(H - 1, Math.round(fy)))
    const i = (py * W + px) * 4
    const sample = crop.data.slice(i, i + 4)
    if (requireContrast && pixelDistance(sample, 0, bgRgba, 0) < 20) return
    for (const existing of posColors) {
      if (pixelDistance(sample, 0, existing, 0) <= 10) return
    }
    posColors.push(sample)
  }

  for (const pt of positivePoints) {
    addPosSample(pt.x, pt.y, false)
  }
  const interiorAnchors: ReadonlyArray<[number, number]> = [
    [0.5, 0.5],
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
    [0.5, 0.24],
    [0.5, 0.76],
    [0.24, 0.5],
    [0.76, 0.5]
  ]
  for (const [ax, ay] of interiorAnchors) {
    addPosSample(bx0 + box.width * ax, by0 + box.height * ay, true)
  }

  const negColors: Uint8ClampedArray[] = [bgRgba]
  for (const pt of negativePoints) {
    const px = Math.max(0, Math.min(W - 1, Math.round(pt.x)))
    const py = Math.max(0, Math.min(H - 1, Math.round(pt.y)))
    const i = (py * W + px) * 4
    negColors.push(crop.data.slice(i, i + 4))
  }

  // 边界连通背景泛洪排除（Boundary-Seeded Background Flood-Fill）：
  // 仅从 crop 最外圈 1px 边界（且不属于正向核心颜色的像素）及显式负向点向内泛洪，
  // 既能剔除五边形斜切角外的背景像素，又绝不会把贴近 localBox 边缘的按钮本体误当成背景种子反向吞噬。
  const boundaryBg = new Uint8Array(n)
  const seedIdx = new Int32Array(n).fill(-1)
  const queue = new Int32Array(n)
  let qHead = 0
  let qTail = 0

  const trySeedBoundary = (x: number, y: number, force: boolean): void => {
    const p = y * W + x
    if (boundaryBg[p]) return
    const i = p * 4
    if (!force && posColors.length > 0) {
      let minPos = Infinity
      for (const pc of posColors) {
        const d = pixelDistance(crop.data, i, pc, 0)
        if (d < minPos) minPos = d
      }
      const dBg = pixelDistance(crop.data, i, bgRgba, 0)
      if (minPos <= 22 && minPos + 8 < dBg) return
    }
    boundaryBg[p] = 1
    seedIdx[p] = i
    queue[qTail++] = p
  }

  for (let x = 0; x < W; x++) {
    trySeedBoundary(x, 0, false)
    trySeedBoundary(x, H - 1, false)
  }
  for (let y = 1; y < H - 1; y++) {
    trySeedBoundary(0, y, false)
    trySeedBoundary(W - 1, y, false)
  }
  for (const pt of negativePoints) {
    const px = Math.max(0, Math.min(W - 1, Math.round(pt.x)))
    const py = Math.max(0, Math.min(H - 1, Math.round(pt.y)))
    trySeedBoundary(px, py, true)
  }

  while (qHead < qTail) {
    const p = queue[qHead++]!
    const py = Math.floor(p / W)
    const px = p - py * W
    const pi = p * 4
    const sOff = seedIdx[p]!
    for (let dy = -1; dy <= 1; dy++) {
      const ny = py + dy
      if (ny < 0 || ny >= H) continue
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = px + dx
        if (nx < 0 || nx >= W) continue
        const np = ny * W + nx
        if (boundaryBg[np]) continue
        const ni = np * 4
        const stepDist = pixelDistance(crop.data, pi, crop.data, ni)
        if (stepDist > 15) continue
        const seedDist = pixelDistance(crop.data, sOff, crop.data, ni)
        if (seedDist > 32) continue
        let minPosDist = Infinity
        for (const pc of posColors) {
          const pd = pixelDistance(crop.data, ni, pc, 0)
          if (pd < minPosDist) minPosDist = pd
        }
        // 若该像素明显更接近正向锚点颜色（含按钮本体色/角标底板色），立即停止泛洪，保护前景主体
        if (minPosDist <= seedDist + 10 && minPosDist <= 28) continue
        boundaryBg[np] = 1
        seedIdx[np] = sOff
        queue[qTail++] = np
      }
    }
  }

  const distToBg = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    if (boundaryBg[p]) {
      distToBg[p] = 0
      continue
    }
    const i = p * 4
    let minNegDist = pixelDistance(crop.data, i, bgRgba, 0)
    for (let k = 1; k < negColors.length; k++) {
      const d = pixelDistance(crop.data, i, negColors[k]!, 0)
      if (d < minNegDist) minNegDist = d
    }
    distToBg[p] = Math.max(0, Math.min(255, Math.round(minNegDist * 2.5)))
  }

  const otsuT = computeOtsuThreshold(distToBg)
  const medThr = Math.max(14, Math.round(otsuT * 0.68))
  const tightThr = Math.max(20, Math.round(otsuT * 0.92))

  const candTight = new Uint8Array(n)
  const candMed = new Uint8Array(n)
  const allowMargin = Math.max(1, Math.floor(Math.min(bx0, by0) * 0.6))
  const ax0 = Math.max(0, bx0 - allowMargin)
  const ay0 = Math.max(0, by0 - allowMargin)
  const ax1 = Math.min(W, bx1 + allowMargin)
  const ay1 = Math.min(H, by1 + allowMargin)

  for (let y = ay0; y < ay1; y++) {
    const row = y * W
    for (let x = ax0; x < ax1; x++) {
      const p = row + x
      if (boundaryBg[p]) continue
      const d = distToBg[p]!
      const i = p * 4
      let minPosDist = Infinity
      for (const pc of posColors) {
        const pd = pixelDistance(crop.data, i, pc, 0)
        if (pd < minPosDist) minPosDist = pd
      }
      if (d >= medThr || (minPosDist <= 24 && d >= 14)) {
        candMed[p] = 1
      }
      if (d >= tightThr || (minPosDist <= 26 && d >= medThr * 0.7)) {
        candTight[p] = 1
      }
    }
  }

  // 闭合填充内部孔洞（如五边形角标内部的白色拼图图案、按钮内部的 "+"/"-" 符号），同时保持边界泛洪排除区为 0
  const candInclusive = fillHoles(closeMask3x3(candMed, W, H), W, H)
  let medCount = 0
  for (let p = 0; p < n; p++) medCount += candMed[p]!
  if (medCount < Math.max(4, rectArea(box) * 0.04)) {
    for (let y = by0; y < by1; y++) {
      for (let x = bx0; x < bx1; x++) {
        const p = y * W + x
        if (!boundaryBg[p]) candInclusive[p] = 1
      }
    }
  }

  return [
    { mask: candTight, samScore: 0.82 },
    { mask: candMed, samScore: 0.88 },
    { mask: candInclusive, samScore: 0.86 }
  ]
}

export interface ElementInstanceSegmentationResult {
  /** 局部裁剪框（画布坐标） */
  rect: PixelRect
  /** 局部二值掩码（rect.width * rect.height，1 = 属于该元素实例） */
  mask: Uint8Array
  /** 胜出候选的评分明细 */
  score: SamCandidateScoreBreakdown
}

/**
 * 对单个 UI 元素执行「点 + 框」引导的多候选实例分割、评分选优与形态学连通域后处理。
 */
export async function segmentElementInstance(
  img: RgbaImage,
  node: Pick<UiElementNode, 'box' | 'positivePoints' | 'negativePoints'>,
  io?: Pick<PreciseSplitIo, 'segmentSam2'>
): Promise<ElementInstanceSegmentationResult> {
  const { width: W, height: H } = img
  const box = clampRect(node.box, W, H)
  const pad = Math.max(2, Math.min(16, Math.round(Math.max(box.width, box.height) * 0.06)))
  const rect = clampRect(
    {
      left: box.left - pad,
      top: box.top - pad,
      width: box.width + pad * 2,
      height: box.height + pad * 2
    },
    W,
    H
  )
  const rw = rect.width
  const rh = rect.height

  // 提取局部图像与局部坐标点
  const cropData = new Uint8ClampedArray(rw * rh * 4)
  for (let y = 0; y < rh; y++) {
    const srcOff = ((rect.top + y) * W + rect.left) * 4
    cropData.set(img.data.subarray(srcOff, srcOff + rw * 4), y * rw * 4)
  }
  const crop: RgbaImage = { width: rw, height: rh, data: cropData }
  const localBox: PixelRect = {
    left: box.left - rect.left,
    top: box.top - rect.top,
    width: box.width,
    height: box.height
  }
  const localPos: PixelPoint[] = [
    ...(node.positivePoints?.length
      ? node.positivePoints
      : [{ x: Math.round(box.left + box.width * 0.5), y: Math.round(box.top + box.height * 0.5) }]),
    { x: Math.round(box.left + box.width * 0.3), y: Math.round(box.top + box.height * 0.3) },
    { x: Math.round(box.left + box.width * 0.7), y: Math.round(box.top + box.height * 0.3) },
    { x: Math.round(box.left + box.width * 0.3), y: Math.round(box.top + box.height * 0.7) },
    { x: Math.round(box.left + box.width * 0.7), y: Math.round(box.top + box.height * 0.7) }
  ].map((p) => ({
    x: Math.max(0, Math.min(rw - 1, Math.round(p.x - rect.left))),
    y: Math.max(0, Math.min(rh - 1, Math.round(p.y - rect.top)))
  }))
  const localNeg: PixelPoint[] = (node.negativePoints ?? []).map((p) => ({
    x: Math.max(0, Math.min(rw - 1, Math.round(p.x - rect.left))),
    y: Math.max(0, Math.min(rh - 1, Math.round(p.y - rect.top)))
  }))

  let candidates: PreciseSplitSam2Candidate[] | null = null
  if (io?.segmentSam2) {
    try {
      candidates = await runSam2WithContext(img, box, rect, node, io.segmentSam2)
    } catch {
      candidates = null
    }
  }
  if (!candidates || !candidates.length) {
    candidates = generateLocalPromptedCandidates(crop, localBox, localPos, localNeg)
  }

  let bestCand = candidates[0]!
  let bestScore = scoreSamCandidateMask({
    mask: bestCand.mask,
    width: rw,
    height: rh,
    samScore: bestCand.samScore,
    promptBox: localBox,
    positivePoints: localPos,
    negativePoints: localNeg
  })

  for (let i = 1; i < candidates.length; i++) {
    const cand = candidates[i]!
    const sc = scoreSamCandidateMask({
      mask: cand.mask,
      width: rw,
      height: rh,
      samScore: cand.samScore,
      promptBox: localBox,
      positivePoints: localPos,
      negativePoints: localNeg
    })
    if (sc.totalScore > bestScore.totalScore) {
      bestCand = cand
      bestScore = sc
    }
  }

  const finalMask = postProcessInstanceMask(bestCand.mask, rw, rh, localPos)
  return {
    rect,
    mask: finalMask,
    score: bestScore
  }
}

/**
 * SAM 2.1 需要足够的上下文才能分清「元素本体」与「周围背景」：
 * 以元素框外扩 35%（≥ 12px）的大上下文裁剪送模型（小元素在 1024² 输入里被放大，边缘更准），
 * 再把候选掩码裁回调用方的局部 rect。提示只用框 + VLM 明确给出的正负点
 * （不再撒四象限正点：UI 图标/符号的象限点常落在背景上，会把背景误拉进前景）。
 */
async function runSam2WithContext(
  img: RgbaImage,
  box: PixelRect,
  rect: PixelRect,
  node: Pick<UiElementNode, 'positivePoints' | 'negativePoints'>,
  segmentSam2: NonNullable<PreciseSplitIo['segmentSam2']>
): Promise<PreciseSplitSam2Candidate[] | null> {
  const { width: W, height: H } = img
  const ctxPad = Math.max(12, Math.round(Math.max(box.width, box.height) * 0.35))
  const ctxRect = clampRect(
    {
      left: box.left - ctxPad,
      top: box.top - ctxPad,
      width: box.width + ctxPad * 2,
      height: box.height + ctxPad * 2
    },
    W,
    H
  )
  const cw = ctxRect.width
  const ch = ctxRect.height
  const data = new Uint8ClampedArray(cw * ch * 4)
  for (let y = 0; y < ch; y++) {
    const srcOff = ((ctxRect.top + y) * W + ctxRect.left) * 4
    data.set(img.data.subarray(srcOff, srcOff + cw * 4), y * cw * 4)
  }
  const toCtx = (p: PixelPoint): PixelPoint => ({
    x: Math.max(0, Math.min(cw - 1, Math.round(p.x - ctxRect.left))),
    y: Math.max(0, Math.min(ch - 1, Math.round(p.y - ctxRect.top)))
  })
  const raw = await segmentSam2({
    image: { width: cw, height: ch, data },
    box: {
      left: box.left - ctxRect.left,
      top: box.top - ctxRect.top,
      width: box.width,
      height: box.height
    },
    positivePoints: (node.positivePoints ?? []).map(toCtx),
    negativePoints: (node.negativePoints ?? []).map(toCtx)
  })
  if (!raw?.length) return null
  const rw = rect.width
  const rh = rect.height
  const out: PreciseSplitSam2Candidate[] = []
  for (const cand of raw) {
    if (cand.mask.length !== cw * ch) continue
    const mask = new Uint8Array(rw * rh)
    let fg = 0
    for (let y = 0; y < rh; y++) {
      const cy = rect.top + y - ctxRect.top
      if (cy < 0 || cy >= ch) continue
      for (let x = 0; x < rw; x++) {
        const cx = rect.left + x - ctxRect.left
        if (cx < 0 || cx >= cw) continue
        if (cand.mask[cy * cw + cx]) {
          mask[y * rw + x] = 1
          fg++
        }
      }
    }
    if (fg > 0) out.push({ mask, samScore: cand.samScore })
  }
  return out.length ? out : null
}

/**
 * 检测槽位/头像框容器的内部腔体矩形（扣除四周 1~4px 边框线及底部品质色条）。
 */
export function detectSlotInnerRect(img: RgbaImage, slotBox: PixelRect): PixelRect {
  const box = clampRect(slotBox, img.width, img.height)
  const borderPad = Math.max(2, Math.min(6, Math.round(Math.min(box.width, box.height) * 0.018)))
  if (box.width <= borderPad * 4 || box.height <= borderPad * 4) return box

  // 检测底部是否存在水平品质色条（如紫色/金色稀有度横条：行内水平色差小，且与上方颜色跳变明显）
  const maxBarH = Math.min(20, Math.max(borderPad + 2, Math.round(box.height * 0.08)))
  let bottomInset = borderPad
  const xStart = box.left + borderPad * 2
  const xEnd = box.left + box.width - borderPad * 2
  if (xEnd > xStart + 8) {
    const rowMeans: Array<[number, number, number]> = []
    const rowSpreads: number[] = []
    for (let dy = 0; dy < maxBarH + 4; dy++) {
      const y = box.top + box.height - 1 - dy
      let sr = 0
      let sg = 0
      let sb = 0
      let cnt = 0
      for (let x = xStart; x < xEnd; x += 2) {
        const i = (y * img.width + x) * 4
        sr += img.data[i]!
        sg += img.data[i + 1]!
        sb += img.data[i + 2]!
        cnt++
      }
      const mr = sr / Math.max(1, cnt)
      const mg = sg / Math.max(1, cnt)
      const mb = sb / Math.max(1, cnt)
      rowMeans.push([mr, mg, mb])
      let dev = 0
      for (let x = xStart; x < xEnd; x += 2) {
        const i = (y * img.width + x) * 4
        dev +=
          Math.abs(img.data[i]! - mr) +
          Math.abs(img.data[i + 1]! - mg) +
          Math.abs(img.data[i + 2]! - mb)
      }
      rowSpreads.push(dev / Math.max(1, cnt))
    }
    for (let dy = borderPad; dy < maxBarH; dy++) {
      const curSpread = rowSpreads[dy]!
      const curMean = rowMeans[dy]!
      const aboveMean = rowMeans[dy + 2] ?? curMean
      const jump =
        Math.abs(curMean[0] - aboveMean[0]) +
        Math.abs(curMean[1] - aboveMean[1]) +
        Math.abs(curMean[2] - aboveMean[2])
      if (curSpread < 24 && jump >= 36) {
        bottomInset = dy + 2
        break
      }
    }
  }

  return clampRect(
    {
      left: box.left + borderPad,
      top: box.top + borderPad,
      width: Math.max(4, box.width - borderPad * 2),
      height: Math.max(4, box.height - borderPad - bottomInset)
    },
    img.width,
    img.height
  )
}

function pointInRects(x: number, y: number, rects: readonly PixelRect[]): boolean {
  for (const r of rects) {
    if (x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height) return true
  }
  return false
}

/**
 * 检测并分离「异形纯色角标底板（如棕色/紫色五边形碎片底板）+ 内部高对比图标（如白色拼图符号）」复合结构：
 * - 即使 VLM 给出的框只框住了内部白色拼图符号、或把整个角标合为一个框，
 *   都能通过符号外围环带采样 + 同色连通生长精确还原出完整的「碎片底板」掩码与「内部符号」掩码。
 */
export function decomposeCompositeBadge(
  img: RgbaImage,
  badgeBox: PixelRect,
  clipBox?: PixelRect
): {
  rect: PixelRect
  plateMask: Uint8Array
  plateBox: PixelRect
  symbolMask: Uint8Array
  symbolBox: PixelRect
} | null {
  const { width: W, height: H } = img
  const box = clampRect(badgeBox, W, H)
  if (box.width < 12 || box.height < 12) return null

  const maxSide = Math.max(box.width, box.height)
  const pad = Math.max(6, Math.min(28, Math.round(maxSide * 0.42)))
  let searchRect = clampRect(
    {
      left: box.left - pad,
      top: box.top - pad,
      width: box.width + pad * 2,
      height: box.height + pad * 2
    },
    W,
    H
  )
  if (clipBox) {
    const cx0 = Math.max(searchRect.left, clipBox.left)
    const cy0 = Math.max(searchRect.top, clipBox.top)
    const cx1 = Math.min(searchRect.left + searchRect.width, clipBox.left + clipBox.width)
    const cy1 = Math.min(searchRect.top + searchRect.height, clipBox.top + clipBox.height)
    if (cx1 - cx0 >= 12 && cy1 - cy0 >= 12) {
      searchRect = { left: cx0, top: cy0, width: cx1 - cx0, height: cy1 - cy0 }
    }
  }

  const rw = searchRect.width
  const rh = searchRect.height
  const n = rw * rh
  const bx0 = Math.max(0, box.left - searchRect.left)
  const by0 = Math.max(0, box.top - searchRect.top)
  const bx1 = Math.min(rw, box.left + box.width - searchRect.left)
  const by1 = Math.min(rh, box.top + box.height - searchRect.top)
  if (bx1 - bx0 < 8 || by1 - by0 < 8) return null

  // 1) 在 badgeBox 内寻找高亮度内部符号核心（如白色拼图符号）
  const rawSymbol = new Uint8Array(n)
  let symCount = 0
  const symRs: number[] = []
  const symGs: number[] = []
  const symBs: number[] = []
  for (let y = by0; y < by1; y++) {
    const cy = searchRect.top + y
    for (let x = bx0; x < bx1; x++) {
      const cx = searchRect.left + x
      const i = (cy * W + cx) * 4
      const r = img.data[i]!
      const g = img.data[i + 1]!
      const b = img.data[i + 2]!
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      if (lum >= 195) {
        rawSymbol[y * rw + x] = 1
        symCount++
        symRs.push(r)
        symGs.push(g)
        symBs.push(b)
      }
    }
  }
  const boxArea = (bx1 - bx0) * (by1 - by0)
  if (symCount < Math.max(9, boxArea * 0.05) || symCount > boxArea * 0.78) return null

  const centerPt: PixelPoint = {
    x: Math.round((bx0 + bx1) * 0.5),
    y: Math.round((by0 + by1) * 0.5)
  }
  const symbolCleaned = postProcessInstanceMask(rawSymbol, rw, rh, [centerPt])
  let cleanSymCount = 0
  for (let p = 0; p < n; p++) cleanSymCount += symbolCleaned[p]!
  if (cleanSymCount < Math.max(8, boxArea * 0.04)) return null

  const symColor = new Uint8ClampedArray([median(symRs), median(symGs), median(symBs), 255])

  // 2) 在符号外围 2..6px 环带内采样角标底板颜色（如棕色或紫色五边形底板）
  const innerDil = dilateMask(symbolCleaned, rw, rh, 1)
  const outerDil = dilateMask(symbolCleaned, rw, rh, 5)
  const plateRs: number[] = []
  const plateGs: number[] = []
  const plateBs: number[] = []
  const seedPixels: number[] = []

  for (let p = 0; p < n; p++) {
    if (!outerDil[p] || innerDil[p]) continue
    const y = Math.floor(p / rw)
    const x = p - y * rw
    const i = ((searchRect.top + y) * W + (searchRect.left + x)) * 4
    const r = img.data[i]!
    const g = img.data[i + 1]!
    const b = img.data[i + 2]!
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if (lum >= 190) continue
    plateRs.push(r)
    plateGs.push(g)
    plateBs.push(b)
    seedPixels.push(p)
  }
  if (plateRs.length < 10) return null

  const plateColor = new Uint8ClampedArray([median(plateRs), median(plateGs), median(plateBs), 255])
  if (pixelDistance(symColor, 0, plateColor, 0) < 48) return null

  const plateDists = seedPixels.map((p) => {
    const y = Math.floor(p / rw)
    const x = p - y * rw
    const i = ((searchRect.top + y) * W + (searchRect.left + x)) * 4
    return pixelDistance(img.data, i, plateColor, 0)
  })
  // 底板颜色必须均匀（排除直接把白字叠在杂乱头发上的普通文本）
  if (median(plateDists) > 22) return null

  // 3) 从底板种子向外连通生长，提取完整的五边形/盾形碎片底板掩码
  const rawPlate = new Uint8Array(n)
  const queue = new Int32Array(n)
  let qHead = 0
  let qTail = 0
  for (const p of seedPixels) {
    const y = Math.floor(p / rw)
    const x = p - y * rw
    const i = ((searchRect.top + y) * W + (searchRect.left + x)) * 4
    if (pixelDistance(img.data, i, plateColor, 0) <= 28) {
      rawPlate[p] = 1
      queue[qTail++] = p
    }
  }
  while (qHead < qTail) {
    const p = queue[qHead++]!
    const py = Math.floor(p / rw)
    const px = p - py * rw
    const pi = ((searchRect.top + py) * W + (searchRect.left + px)) * 4
    for (let dy = -1; dy <= 1; dy++) {
      const ny = py + dy
      if (ny < 0 || ny >= rh) continue
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = px + dx
        if (nx < 0 || nx >= rw) continue
        const np = ny * rw + nx
        if (rawPlate[np]) continue
        const ni = ((searchRect.top + ny) * W + (searchRect.left + nx)) * 4
        if (
          pixelDistance(img.data, ni, plateColor, 0) <= 32 &&
          pixelDistance(img.data, pi, img.data, ni) <= 16
        ) {
          rawPlate[np] = 1
          queue[qTail++] = np
        }
      }
    }
  }

  // 内部符号必须被底板包围：外围 2px 环带里底板像素占比 < 55% 的亮色连通块
  // （如紧贴角标的金发 / 高光）不属于符号，剔除，避免把相邻立绘像素拆进图标层
  {
    const { labels, stats } = labelComponents8(symbolCleaned, rw, rh)
    if (stats.length) {
      const maxLabel = stats.reduce((m, s) => Math.max(m, s.label), 0)
      const ringCount = new Int32Array(maxLabel + 1)
      const plateCount = new Int32Array(maxLabel + 1)
      const seen = new Int32Array(maxLabel + 1).fill(-1)
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          const p = y * rw + x
          if (symbolCleaned[p]) continue
          for (let dy = -2; dy <= 2; dy++) {
            const ny = y + dy
            if (ny < 0 || ny >= rh) continue
            for (let dx = -2; dx <= 2; dx++) {
              const nx = x + dx
              if (nx < 0 || nx >= rw) continue
              const lbl = labels[ny * rw + nx]!
              if (lbl <= 0 || seen[lbl] === p) continue
              seen[lbl] = p
              ringCount[lbl]!++
              if (rawPlate[p]) plateCount[lbl]!++
            }
          }
        }
      }
      let kept = 0
      for (let p = 0; p < n; p++) {
        const lbl = labels[p]!
        if (!symbolCleaned[p]) continue
        if (ringCount[lbl]! > 0 && plateCount[lbl]! / ringCount[lbl]! >= 0.55) kept++
        else symbolCleaned[p] = 0
      }
      if (kept < Math.max(8, boxArea * 0.02)) return null
      cleanSymCount = kept
    }
  }

  // 把内部符号并入底板并做闭运算 + 孔洞填充，得到完整无洞的碎片底板掩码
  for (let p = 0; p < n; p++) {
    if (symbolCleaned[p]) rawPlate[p] = 1
  }
  const plateMask = fillHoles(closeMask3x3(rawPlate, rw, rh), rw, rh)

  // 统计底板面积与边界框，确保底板确实包裹符号且未漫溢到整张画布
  let plateArea = 0
  let pMinX = rw
  let pMinY = rh
  let pMaxX = -1
  let pMaxY = -1
  let sMinX = rw
  let sMinY = rh
  let sMaxX = -1
  let sMaxY = -1
  for (let y = 0; y < rh; y++) {
    const row = y * rw
    for (let x = 0; x < rw; x++) {
      const p = row + x
      if (plateMask[p]) {
        plateArea++
        if (x < pMinX) pMinX = x
        if (x > pMaxX) pMaxX = x
        if (y < pMinY) pMinY = y
        if (y > pMaxY) pMaxY = y
      }
      if (symbolCleaned[p]) {
        if (x < sMinX) sMinX = x
        if (x > sMaxX) sMaxX = x
        if (y < sMinY) sMinY = y
        if (y > sMaxY) sMaxY = y
      }
    }
  }
  if (plateArea < cleanSymCount * 1.35 || plateArea > n * 0.92 || pMaxX < pMinX || sMaxX < sMinX) {
    return null
  }

  return {
    rect: searchRect,
    plateMask,
    plateBox: {
      left: searchRect.left + pMinX,
      top: searchRect.top + pMinY,
      width: pMaxX - pMinX + 1,
      height: pMaxY - pMinY + 1
    },
    symbolMask: symbolCleaned,
    symbolBox: {
      left: searchRect.left + sMinX,
      top: searchRect.top + sMinY,
      width: sMaxX - sMinX + 1,
      height: sMaxY - sMinY + 1
    }
  }
}

/**
 * 估算槽位内腔每一行的背景底板颜色（支持纯色或自上而下线性/发光渐变底板）。
 */
export function estimateSlotRowBackground(
  img: RgbaImage,
  innerRect: PixelRect,
  excludeRects: readonly PixelRect[] = []
): Array<[number, number, number]> {
  const { left, top, width: rw, height: rh } = innerRect
  const stripW = Math.max(3, Math.min(14, Math.round(rw * 0.08)))
  const rawRows: Array<[number, number, number] | null> = new Array(rh).fill(null)

  for (let y = 0; y < rh; y++) {
    const cy = top + y
    const leftSamples: Array<[number, number, number]> = []
    const rightSamples: Array<[number, number, number]> = []
    for (let dx = 0; dx < stripW; dx++) {
      const lx = left + dx
      if (!pointInRects(lx, cy, excludeRects)) {
        const li = (cy * img.width + lx) * 4
        const r = img.data[li]!
        const g = img.data[li + 1]!
        const b = img.data[li + 2]!
        // 过滤贴边的亮色白发/金发/肤色，只采集深色槽位底板像素
        if (0.2126 * r + 0.7152 * g + 0.0722 * b <= 118) {
          leftSamples.push([r, g, b])
        }
      }
      const rx = left + rw - 1 - dx
      if (!pointInRects(rx, cy, excludeRects)) {
        const ri = (cy * img.width + rx) * 4
        const r = img.data[ri]!
        const g = img.data[ri + 1]!
        const b = img.data[ri + 2]!
        if (0.2126 * r + 0.7152 * g + 0.0722 * b <= 118) {
          rightSamples.push([r, g, b])
        }
      }
    }
    const avg = (list: Array<[number, number, number]>): [number, number, number] | null => {
      if (!list.length) return null
      let r = 0
      let g = 0
      let b = 0
      for (const c of list) {
        r += c[0]
        g += c[1]
        b += c[2]
      }
      return [r / list.length, g / list.length, b / list.length]
    }
    const lAvg = avg(leftSamples)
    const rAvg = avg(rightSamples)
    if (lAvg && rAvg) {
      const lLum = 0.2126 * lAvg[0] + 0.7152 * lAvg[1] + 0.0722 * lAvg[2]
      const rLum = 0.2126 * rAvg[0] + 0.7152 * rAvg[1] + 0.0722 * rAvg[2]
      rawRows[y] = lLum <= rLum ? lAvg : rAvg
    } else {
      rawRows[y] = lAvg ?? rAvg
    }
  }

  // 在顶部 0..18% 区域（中点约 0.09*rh）与下部 68..86% 区域（中点约 0.77*rh）分别取深色中位数锚点，
  // 线性还原槽位真实垂直渐变，既消除白发贴边导致的水平扫描线条纹，又保持渐变斜率精确无偏！
  const topSliceEnd = Math.max(1, Math.floor(rh * 0.18))
  const topPool = rawRows
    .slice(0, topSliceEnd)
    .filter((r): r is [number, number, number] => r != null)
  const fallbackTop = rawRows.find((r) => r != null) ?? ([14, 18, 26] as [number, number, number])
  const topAnchor: [number, number, number] = topPool.length
    ? [
        median(topPool.map((c) => c[0])),
        median(topPool.map((c) => c[1])),
        median(topPool.map((c) => c[2]))
      ]
    : fallbackTop

  const botStart = Math.floor(rh * 0.66)
  const botEnd = Math.max(botStart + 1, Math.floor(rh * 0.86))
  const bottomPool = rawRows
    .slice(botStart, botEnd)
    .filter((r): r is [number, number, number] => r != null)
  const bottomAnchor: [number, number, number] = bottomPool.length
    ? [
        median(bottomPool.map((c) => c[0])),
        median(bottomPool.map((c) => c[1])),
        median(bottomPool.map((c) => c[2]))
      ]
    : topAnchor

  const y0 = rh * 0.08
  const ySpan = Math.max(1, rh * 0.7)
  const out: Array<[number, number, number]> = new Array(rh)
  for (let y = 0; y < rh; y++) {
    const t = rh > 1 ? Math.max(0, Math.min(1, (y - y0) / ySpan)) : 0
    out[y] = [
      Math.round(topAnchor[0] + (bottomAnchor[0] - topAnchor[0]) * t),
      Math.round(topAnchor[1] + (bottomAnchor[1] - topAnchor[1]) * t),
      Math.round(topAnchor[2] + (bottomAnchor[2] - topAnchor[2]) * t)
    ]
  }
  return out
}

/**
 * 在父槽位内腔（innerRect）中精确分割角色头像/物品立绘前景掩码（排除槽位渐变底板与外框）。
 */
export function segmentPortraitInParentSlot(
  img: RgbaImage,
  innerRect: PixelRect,
  excludeRects: readonly PixelRect[] = []
): {
  rect: PixelRect
  mask: Uint8Array
  fgRatio: number
  meanFgContrast: number
  rowBg: Array<[number, number, number]>
} {
  const { left, top, width: rw, height: rh } = innerRect
  const n = rw * rh
  const rowBg = estimateSlotRowBackground(img, innerRect, excludeRects)

  const distMap = new Float32Array(n)
  for (let y = 0; y < rh; y++) {
    const bg = rowBg[y]!
    const cy = top + y
    const rowOff = y * rw
    for (let x = 0; x < rw; x++) {
      const cx = left + x
      const i = (cy * img.width + cx) * 4
      const dr = img.data[i]! - bg[0]
      const dg = img.data[i + 1]! - bg[1]
      const db = img.data[i + 2]! - bg[2]
      distMap[rowOff + x] = Math.sqrt(dr * dr + dg * dg + db * db)
    }
  }

  // 从槽位内腔的上、左、右边缘（避开被角标/文字覆盖的排除框）向内泛洪标记槽位背景
  const slotBg = new Uint8Array(n)
  const queue = new Int32Array(n)
  let qHead = 0
  let qTail = 0
  const trySeed = (x: number, y: number): void => {
    const cx = left + x
    const cy = top + y
    if (pointInRects(cx, cy, excludeRects)) return
    const p = y * rw + x
    if (slotBg[p]) return
    if (distMap[p]! <= 28) {
      slotBg[p] = 1
      queue[qTail++] = p
    }
  }

  for (let x = 0; x < rw; x++) trySeed(x, 0)
  for (let y = 0; y < rh; y++) {
    trySeed(0, y)
    trySeed(rw - 1, y)
  }

  while (qHead < qTail) {
    const p = queue[qHead++]!
    const py = Math.floor(p / rw)
    const px = p - py * rw
    const pi = ((top + py) * img.width + (left + px)) * 4
    for (let dy = -1; dy <= 1; dy++) {
      const ny = py + dy
      if (ny < 0 || ny >= rh) continue
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = px + dx
        if (nx < 0 || nx >= rw) continue
        const np = ny * rw + nx
        if (slotBg[np]) continue
        if (distMap[np]! > 36) continue
        const ni = ((top + ny) * img.width + (left + nx)) * 4
        const step = pixelDistance(img.data, pi, img.data, ni)
        if (step <= 14) {
          slotBg[np] = 1
          queue[qTail++] = np
        }
      }
    }
  }

  const rawFg = new Uint8Array(n)
  for (let y = 0; y < rh; y++) {
    const cy = top + y
    const rowOff = y * rw
    for (let x = 0; x < rw; x++) {
      const cx = left + x
      const p = rowOff + x
      if (slotBg[p] || distMap[p]! < 22) continue
      // 排除左上/右上角标区域，防止把五边形碎片底板误并入角色立绘前景
      if (y < rh * 0.4 && (x < rw * 0.4 || x > rw * 0.6) && pointInRects(cx, cy, excludeRects)) {
        continue
      }
      rawFg[p] = 1
    }
  }

  const filled = fillHoles(closeMask3x3(rawFg, rw, rh), rw, rh)
  const centerPt: PixelPoint = { x: Math.round(rw * 0.5), y: Math.round(rh * 0.55) }
  const cleaned = postProcessInstanceMask(filled, rw, rh, [centerPt])

  let fgCount = 0
  let fgContrastSum = 0
  for (let p = 0; p < n; p++) {
    if (cleaned[p]) {
      fgCount++
      fgContrastSum += distMap[p]!
    }
  }
  const fgRatio = n > 0 ? fgCount / n : 0
  const meanFgContrast = fgCount > 0 ? fgContrastSum / fgCount : 0

  return {
    rect: innerRect,
    mask: cleaned,
    fgRatio,
    meanFgContrast,
    rowBg
  }
}
