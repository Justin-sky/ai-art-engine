/**
 * 逐图层质检闸门（UI 精准拆层 v2 · P1）。
 *
 * 旧版只有一个「全部图层叠回去 vs 原图」的平均误差：残留和缺口叠回去会相互抵消，
 * 指标好看但单看每个图层是脏的。这里改成对每个图层 / 底板单独打分：
 * - edge_halo：图层边缘像素颜色更接近下层底色而不是元素内部色（带底色光晕 / 黑边）；
 * - base_residue：最终底板上元素轮廓外环带仍有元素主色残留；
 * - occluded_not_completed：被上层遮挡的区域仍是上层元素原像素（子元素没从父图层剥掉，重复）；
 * - under_extracted：图层不透明像素远少于元素轮廓（被切掉一部分）。
 */

import type { CanvasMask, OwnershipMap } from './ownership'
import { scanPlateResidue } from './ownership'
import {
  needsImageCompletion,
  occludedRegionOf,
  occludedTextureRatio
} from './generativeCompletion'
import { pixelDistance } from './pixels'
import type { PixelRect, RgbaImage } from './types'

export type UiSplitQaIssue =
  'edge_halo' | 'base_residue' | 'occluded_not_completed' | 'occluded_blurry' | 'under_extracted'

export interface UiSplitLayerQa {
  elementId: string
  name: string
  issues: UiSplitQaIssue[]
  scores: {
    /** 边缘像素中偏向底色的比例 0..1 */
    edgeHalo: number
    /** 底板外环带残留像素比例 0..1 */
    baseResidue: number
    /** 遮挡区仍是上层原像素的比例 0..1 */
    occludedDup: number
    /** 图层不透明像素 / 轮廓像素 */
    coverage: number
    /** 复杂画面类元素：遮挡区纹理能量 / 周围纹理能量（< 0.3 = 糊块）；不适用时为 1 */
    occludedTexture: number
  }
}

export interface UiSplitQaReport {
  layers: UiSplitLayerQa[]
  /** 有问题的图层数 */
  flagged: number
  passed: boolean
}

export interface QaLayerInput {
  elementId: string
  name: string
  /** 元素类别（立绘 / 插画额外检查遮挡区是否是糊块） */
  kind?: string
  repairMode?: string
  plainText: boolean
  entryIndex: number
  mask: CanvasMask
  layer: { rect: PixelRect; rgba: Uint8ClampedArray }
  /** 元素被剥离后的底板（plates[k]） */
  lower: RgbaImage
  /** 元素仍在的底板（plates[k+1]） */
  upper: RgbaImage
  haloRadius: number
}

function edgeHaloScore(input: QaLayerInput, source: RgbaImage): number {
  const { rect, rgba } = input.layer
  const W = source.width
  const w = rect.width
  const h = rect.height
  const L = input.lower
  const n = w * h
  // 内部像素：alpha≈1 且四邻都不透明
  const interior = new Uint8Array(n)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      if (
        rgba[p * 4 + 3]! >= 250 &&
        rgba[(p - 1) * 4 + 3]! >= 250 &&
        rgba[(p + 1) * 4 + 3]! >= 250 &&
        rgba[(p - w) * 4 + 3]! >= 250 &&
        rgba[(p + w) * 4 + 3]! >= 250
      )
        interior[p] = 1
    }
  }
  let edgeN = 0
  let tinted = 0
  const px = new Uint8ClampedArray(4)
  const ref = new Uint8ClampedArray(4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const a = rgba[p * 4 + 3]!
      if (a < 200) continue
      const isEdge =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        rgba[(p - 1) * 4 + 3]! < 128 ||
        rgba[(p + 1) * 4 + 3]! < 128 ||
        rgba[(p - w) * 4 + 3]! < 128 ||
        rgba[(p + w) * 4 + 3]! < 128
      if (!isEdge) continue
      // 局部内部参考色：距离 2~3px 内的内部像素均值（多色元素不能用全局均值）
      let sr = 0
      let sg = 0
      let sb = 0
      let sn = 0
      for (let dy = -3; dy <= 3; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const np = ny * w + nx
          if (!interior[np]) continue
          sr += rgba[np * 4]!
          sg += rgba[np * 4 + 1]!
          sb += rgba[np * 4 + 2]!
          sn++
        }
      }
      if (sn < 3) continue
      ref[0] = sr / sn
      ref[1] = sg / sn
      ref[2] = sb / sn
      ref[3] = 255
      const gi = ((rect.top + y) * W + rect.left + x) * 4
      px[0] = rgba[p * 4]!
      px[1] = rgba[p * 4 + 1]!
      px[2] = rgba[p * 4 + 2]!
      px[3] = 255
      const dEl = pixelDistance(px, 0, ref, 0)
      const dBg = pixelDistance(px, 0, L.data, gi)
      const dRefBg = pixelDistance(ref, 0, L.data, gi)
      edgeN++
      // 元素色与底色差异足够大、且边缘像素明显偏向底色 → 带了底色
      if (dRefBg >= 30 && dBg + 10 < dEl) tinted++
    }
  }
  return edgeN >= 8 ? tinted / edgeN : 0
}

function occludedDupScore(input: QaLayerInput, source: RgbaImage, ownership: OwnershipMap): number {
  const { rect, mask } = input.mask
  const W = source.width
  const selfPaint = ownership.entries[input.entryIndex]!.paintIndex
  let occ = 0
  let dup = 0
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      if (!mask[y * rect.width + x]) continue
      const cx = rect.left + x
      const cy = rect.top + y
      const own = ownership.owner[cy * W + cx]!
      if (own < 0 || own === input.entryIndex) continue
      if ((ownership.entries[own]?.paintIndex ?? -1) <= selfPaint) continue
      occ++
      const i = (cy * W + cx) * 4
      if (pixelDistance(input.upper.data, i, source.data, i) < 4) dup++
    }
  }
  return occ >= 40 ? dup / occ : 0
}

export function runSplitQa(input: {
  source: RgbaImage
  base: RgbaImage
  ownership: OwnershipMap
  layers: readonly QaLayerInput[]
}): UiSplitQaReport {
  const out: UiSplitLayerQa[] = []
  for (const l of input.layers) {
    const issues: UiSplitQaIssue[] = []
    let maskN = 0
    for (let i = 0; i < l.mask.mask.length; i++) maskN += l.mask.mask[i] ? 1 : 0
    let opaqueN = 0
    for (let i = 3; i < l.layer.rgba.length; i += 4) opaqueN += l.layer.rgba[i]! >= 128 ? 1 : 0
    const coverage = maskN ? opaqueN / maskN : 1
    const edgeHalo = l.plainText ? 0 : edgeHaloScore(l, input.source)
    const occludedDup = l.plainText ? 0 : occludedDupScore(l, input.source, input.ownership)
    let baseResidue = 0
    if (!l.plainText) {
      const scan = scanPlateResidue({
        plate: l.lower,
        upper: l.upper,
        mask: l.mask,
        ownership: input.ownership,
        entryIndex: l.entryIndex,
        radius: Math.min(3, l.haloRadius)
      })
      baseResidue = scan.ringSize ? scan.pixels.length / scan.ringSize : 0
    }
    if (edgeHalo > 0.25) issues.push('edge_halo')
    if (baseResidue > 0.06) issues.push('base_residue')
    if (occludedDup > 0.4) issues.push('occluded_not_completed')
    let occludedTexture = 1
    if (!l.plainText && l.kind && needsImageCompletion(l.kind, l.repairMode)) {
      const reg = occludedRegionOf(l.mask, input.ownership, l.entryIndex)
      if (reg.count >= 64) {
        const tex = occludedTextureRatio(l.upper, l.mask.rect, reg.core, reg.known)
        if (tex.ringVar >= 25) {
          occludedTexture = tex.ratio
          if (tex.ratio < 0.3) issues.push('occluded_blurry')
        }
      }
    }
    if (!l.plainText && maskN >= 30 && coverage < 0.6) issues.push('under_extracted')
    out.push({
      elementId: l.elementId,
      name: l.name,
      issues,
      scores: { edgeHalo, baseResidue, occludedDup, coverage, occludedTexture }
    })
  }
  const flagged = out.filter((l) => l.issues.length > 0).length
  return { layers: out, flagged, passed: flagged === 0 }
}
