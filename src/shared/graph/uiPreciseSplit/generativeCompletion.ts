/**
 * 复杂画面遮挡区的单图层生成式补全（UI 精准拆层 v2 · P3）。
 *
 * 立绘 / 插画 / 场景类元素被角标、文字、按钮挡住的部分，结构化规则（P2）无能为力，
 * 本地推拉补底只能给出一团糊色。旧路径的生成式剥层把**整张底板**送模型重绘，
 * 模型对可见区域的任何改动都会经差分抠图变成图层污染。这里改成：
 *
 * 1. **按需触发**：只在遮挡区「明显比周围糊」（拉普拉斯纹理能量比 < 0.45，且周围本身有纹理）时调用，
 *    纯色 / 渐变底或已被生成式剥层补好的区域不重复花钱；
 * 2. **单图层局部裁剪**：只送该元素包围盒（外扩 12%）的裁剪图，遮挡区涂黑 + 二值掩码；
 * 3. **对齐校验**：在可见区上估计整体位移并校验色差，构图被改动的结果直接丢弃；
 * 4. **只回贴遮挡区 + 偏移场接缝融合**：遮挡区外一个像素都不取；在遮挡区边界上计算
 *    「原底板 − 生成结果」的颜色偏移，平滑扩散到遮挡区内部后叠加（等价于泊松克隆的膜插值），
 *    消除色差接缝。
 */

import { buildLayerCompletionPrompt } from './prompts'
import type { CanvasMask, OwnershipMap } from './ownership'
import { estimateShift } from './plates'
import {
  clampRect,
  createImage,
  cropImage,
  dilateMask,
  erodeMask,
  inpaintPushPull,
  nearestAspectRatio,
  pixelDistance,
  resizeBilinear
} from './pixels'
import type { PixelRect, PreciseSplitIo, RgbaImage } from './types'

export interface GenerativeCompletionTarget {
  id: string
  name: string
  kind: string
  repairMode?: string
  entryIndex: number
  mask: CanvasMask
  /** 元素自身底板（plates[level + 1]），原地修改 */
  plate: RgbaImage
}

export interface GenerativeCompletionReport {
  attempted: number
  accepted: number
  rejected: number
  /** 回贴的像素数 */
  pixels: number
}

/** 需要内容级补全（而非结构化补全）的元素类别 */
export const IMAGE_CONTENT_KINDS: ReadonlySet<string> = new Set(['avatar', 'illustration'])

export function needsImageCompletion(kind: string, repairMode?: string): boolean {
  return IMAGE_CONTENT_KINDS.has(kind) || repairMode === 'image'
}

function lum(d: Uint8ClampedArray, i: number): number {
  return 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!
}

/**
 * 纹理能量比：遮挡区内的拉普拉斯方差 / 遮挡区外 6px 可见环带的拉普拉斯方差。
 * 推拉补底的糊块 ≈ 0；与周围纹理一致 ≈ 1。ringVar 为环带的纹理能量（太小说明周围是平涂）。
 */
export function occludedTextureRatio(
  plate: RgbaImage,
  rect: PixelRect,
  target: Uint8Array,
  known: Uint8Array
): { ratio: number; ringVar: number; holeVar: number } {
  const W = plate.width
  const w = rect.width
  const h = rect.height
  const ring = dilateMask(target, w, h, 6)
  let hs = 0
  let hn = 0
  let rs = 0
  let rn = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      const inHole = target[p]
      const inRing = !inHole && ring[p] && known[p]
      if (!inHole && !inRing) continue
      const gi = ((rect.top + y) * W + rect.left + x) * 4
      const c = lum(plate.data, gi)
      const lap =
        4 * c -
        lum(plate.data, gi - 4) -
        lum(plate.data, gi + 4) -
        lum(plate.data, gi - W * 4) -
        lum(plate.data, gi + W * 4)
      if (inHole) {
        hs += lap * lap
        hn++
      } else {
        rs += lap * lap
        rn++
      }
    }
  }
  const holeVar = hn ? hs / hn : 0
  const ringVar = rn ? rs / rn : 0
  return { ratio: ringVar > 0 ? holeVar / ringVar : 1, ringVar, holeVar }
}

interface Plan {
  t: GenerativeCompletionTarget
  /** 局部（mask.rect）坐标的补全区 / 可见区 / 遮挡核心 */
  target: Uint8Array
  known: Uint8Array
  core: Uint8Array
  count: number
}

/**
 * 元素轮廓内「被上层遮挡（外扩 2px）」的补全区与可信可见区（局部 mask.rect 坐标）。
 */
export function occludedRegionOf(
  mask: CanvasMask,
  ownership: OwnershipMap,
  entryIndex: number
): { target: Uint8Array; known: Uint8Array; count: number; maskArea: number; core: Uint8Array } {
  const { rect } = mask
  const w = rect.width
  const h = rect.height
  const W = ownership.width
  const selfPaint = ownership.entries[entryIndex]!.paintIndex
  const occ = new Uint8Array(w * h)
  let maskArea = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (!mask.mask[p]) continue
      maskArea++
      const own = ownership.owner[(rect.top + y) * W + rect.left + x]!
      if (own >= 0 && own !== entryIndex && (ownership.entries[own]?.paintIndex ?? -1) > selfPaint)
        occ[p] = 1
    }
  }
  const grown = dilateMask(occ, w, h, 2)
  const target = new Uint8Array(w * h)
  const known = new Uint8Array(w * h)
  let count = 0
  for (let p = 0; p < w * h; p++) {
    if (!mask.mask[p]) continue
    if (grown[p]) {
      target[p] = 1
      count++
    } else known[p] = 1
  }
  // 纹理统计只看遮挡核心（内缩 1px）：外扩带和边界像素的拉普拉斯会混入可见纹理
  const core = erodeMask(occ, w, h, 1)
  return { target, known, count, maskArea, core }
}

function planTarget(t: GenerativeCompletionTarget, ownership: OwnershipMap): Plan | null {
  const r = occludedRegionOf(t.mask, ownership, t.entryIndex)
  if (r.count < 64 || r.count < r.maskArea * 0.015) return null
  return { t, target: r.target, known: r.known, core: r.core, count: r.count }
}

/**
 * 偏移场接缝融合：在补全区外 3px 环带上取 (plate − gen)，平滑扩散到补全区内部后叠加到 gen 上。
 * plate / gen / hole 均为同一局部坐标系（crop）。
 */
export function blendWithOffsetField(
  plateCrop: RgbaImage,
  genCrop: RgbaImage,
  hole: Uint8Array
): RgbaImage {
  const w = plateCrop.width
  const h = plateCrop.height
  const n = w * h
  const ring = dilateMask(hole, w, h, 3)
  const offset = createImage(w, h)
  const unknown = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (ring[p] && !hole[p]) {
      for (let c = 0; c < 3; c++) {
        offset.data[i + c] = Math.max(
          0,
          Math.min(255, 128 + plateCrop.data[i + c]! - genCrop.data[i + c]!)
        )
      }
      offset.data[i + 3] = 255
    } else {
      unknown[p] = 1
      offset.data[i + 3] = 255
    }
  }
  inpaintPushPull(offset, unknown)
  const out = createImage(w, h)
  out.data.set(plateCrop.data)
  for (let p = 0; p < n; p++) {
    if (!hole[p]) continue
    const i = p * 4
    for (let c = 0; c < 3; c++) {
      out.data[i + c] = Math.max(0, Math.min(255, genCrop.data[i + c]! + offset.data[i + c]! - 128))
    }
    out.data[i + 3] = 255
  }
  return out
}

export async function completeOccludedGenerative(input: {
  io: Pick<PreciseSplitIo, 'editImage' | 'encodePng' | 'log' | 'signal'>
  targets: readonly GenerativeCompletionTarget[]
  ownership: OwnershipMap
  locale?: string
  /** 单次拆层最多调用生图次数（成本上限），默认 4 */
  maxCalls?: number
}): Promise<GenerativeCompletionReport> {
  const report: GenerativeCompletionReport = { attempted: 0, accepted: 0, rejected: 0, pixels: 0 }
  const { io } = input
  if (!io.editImage) return report
  const plans: Plan[] = []
  for (const t of input.targets) {
    if (!needsImageCompletion(t.kind, t.repairMode)) continue
    const plan = planTarget(t, input.ownership)
    if (!plan) continue
    const tex = occludedTextureRatio(t.plate, t.mask.rect, plan.core, plan.known)
    // 周围是平涂（纹理能量低）→ 推拉补底已足够；遮挡区纹理已接近周围 → 已被补好
    if (tex.ringVar < 25 || tex.ratio >= 0.45) continue
    plans.push(plan)
  }
  plans.sort((a, b) => b.count - a.count)
  const maxCalls = Math.max(0, input.maxCalls ?? 4)
  for (const plan of plans.slice(0, maxCalls)) {
    if (io.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const { t } = plan
    const { rect } = t.mask
    const W = t.plate.width
    const H = t.plate.height
    const pad = Math.max(8, Math.round(Math.max(rect.width, rect.height) * 0.12))
    const crop = clampRect(
      {
        left: rect.left - pad,
        top: rect.top - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2
      },
      W,
      H
    )
    const cw = crop.width
    const ch = crop.height
    const hole = new Uint8Array(cw * ch)
    for (let y = 0; y < rect.height; y++) {
      for (let x = 0; x < rect.width; x++) {
        if (!plan.target[y * rect.width + x]) continue
        const lx = rect.left + x - crop.left
        const ly = rect.top + y - crop.top
        if (lx < 0 || ly < 0 || lx >= cw || ly >= ch) continue
        hole[ly * cw + lx] = 1
      }
    }
    const plateCrop = cropImage(t.plate, crop)
    const diag = cropImage(t.plate, crop)
    const maskImg = createImage(cw, ch)
    for (let p = 0; p < cw * ch; p++) {
      const i = p * 4
      const v = hole[p] ? 255 : 0
      if (hole[p]) {
        diag.data[i] = 0
        diag.data[i + 1] = 0
        diag.data[i + 2] = 0
        diag.data[i + 3] = 255
      }
      maskImg.data[i] = v
      maskImg.data[i + 1] = v
      maskImg.data[i + 2] = v
      maskImg.data[i + 3] = 255
    }
    report.attempted++
    let gen: RgbaImage | null = null
    try {
      const [image, maskImage] = await Promise.all([io.encodePng(diag), io.encodePng(maskImg)])
      gen = await io.editImage({
        prompt: buildLayerCompletionPrompt({ locale: input.locale, name: t.name, kind: t.kind }),
        image,
        maskImage,
        aspectRatio: nearestAspectRatio(cw, ch)
      })
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err
      io.log?.(
        `layer completion "${t.name}": generation failed (${String((err as Error)?.message ?? err)})`
      )
      gen = null
    }
    if (!gen) {
      report.rejected++
      continue
    }
    const resized = gen.width === cw && gen.height === ch ? gen : resizeBilinear(gen, cw, ch)
    const shift = estimateShift(plateCrop, resized, hole)
    if (!Number.isFinite(shift.error) || shift.error > 18) {
      io.log?.(
        `layer completion "${t.name}": rejected (misaligned / recomposed, err=${shift.error.toFixed(1)})`
      )
      report.rejected++
      continue
    }
    const aligned = shiftCrop(resized, shift.dx, shift.dy)
    // 遮挡区边界 3px 的色差也要可接受（模型整体调色时偏移场能修，但差太多说明内容不连贯）
    const ring = dilateMask(hole, cw, ch, 3)
    let rs = 0
    let rn = 0
    for (let p = 0; p < cw * ch; p++) {
      if (!ring[p] || hole[p]) continue
      rs += pixelDistance(plateCrop.data, p * 4, aligned.data, p * 4)
      rn++
    }
    if (rn && rs / rn > 28) {
      io.log?.(
        `layer completion "${t.name}": rejected (seam colour mismatch ${(rs / rn).toFixed(1)})`
      )
      report.rejected++
      continue
    }
    const blended = blendWithOffsetField(plateCrop, aligned, hole)
    let written = 0
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const lp = y * cw + x
        if (!hole[lp]) continue
        const gi = ((crop.top + y) * W + crop.left + x) * 4
        const li = lp * 4
        t.plate.data[gi] = blended.data[li]!
        t.plate.data[gi + 1] = blended.data[li + 1]!
        t.plate.data[gi + 2] = blended.data[li + 2]!
        t.plate.data[gi + 3] = 255
        written++
      }
    }
    report.accepted++
    report.pixels += written
  }
  return report
}

function shiftCrop(img: RgbaImage, dx: number, dy: number): RgbaImage {
  if (!dx && !dy) return img
  const out = createImage(img.width, img.height)
  for (let y = 0; y < img.height; y++) {
    const sy = Math.min(img.height - 1, Math.max(0, y + dy))
    for (let x = 0; x < img.width; x++) {
      const sx = Math.min(img.width - 1, Math.max(0, x + dx))
      const si = (sy * img.width + sx) * 4
      const o = (y * img.width + x) * 4
      out.data[o] = img.data[si]!
      out.data[o + 1] = img.data[si + 1]!
      out.data[o + 2] = img.data[si + 2]!
      out.data[o + 3] = img.data[si + 3]!
    }
  }
  return out
}
