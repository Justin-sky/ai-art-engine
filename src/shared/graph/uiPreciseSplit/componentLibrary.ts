import { computeNineSliceFromRgbaBuffer } from '../imageLayerSplit'
import {
  componentIdToPsdGuid,
  encodeUint8ToBase64,
  sanitizeComponentExportName,
  type UiComponentScalePolicy,
  type UiComponentVisualDescriptor,
  type UiSharedComponentItem
} from '../uiComponentLibrary'
import {
  clampRect,
  cloneImage,
  createImage,
  cropImage,
  inpaintPushPull,
  resizeBilinear
} from './pixels'
import type {
  PixelRect,
  PreciseSplitComponentCandidate,
  PreciseSplitLayer,
  PreciseSplitResult,
  RgbaImage,
  UiElementKind
} from './types'

const DESCRIPTOR_THUMB_SIZE = 24

const NINE_SLICE_ELIGIBLE_KINDS = new Set<string>([
  'panel',
  'frame',
  'banner',
  'button',
  'tab',
  'item-slot',
  'progress-bar',
  'card',
  'bar'
])

const REUSABLE_SINGLETON_KINDS = new Set<string>([
  'button',
  'close-button',
  'tab',
  'item-slot',
  'badge',
  'frame',
  'panel',
  'banner',
  'progress-bar'
])

const NON_COMPONENT_KINDS = new Set<string>(['text', 'art-text', 'illustration', 'effect'])

function kindFamily(kind: string): string {
  const k = kind.trim().toLowerCase()
  if (k === 'button' || k === 'tab' || k === 'banner') return 'action'
  if (k === 'close-button' || k === 'badge' || k === 'icon' || k === 'arrow') return 'glyph-widget'
  if (k === 'item-slot' || k === 'frame' || k === 'panel' || k === 'card') return 'container'
  if (k === 'progress-bar' || k === 'slider' || k === 'bar') return 'bar'
  return k || 'other'
}

export function areComponentKindsCompatible(
  elementKind: string,
  componentKind: string,
  explicitHintMatch = false
): boolean {
  if (NON_COMPONENT_KINDS.has(elementKind)) return false
  if (explicitHintMatch) return true
  const ek = elementKind.trim().toLowerCase()
  const ck = componentKind.trim().toLowerCase()
  if (ek === ck) return true
  if (ek === 'other' || ck === 'other') return true
  const ef = kindFamily(ek)
  const cf = kindFamily(ck)
  if (ef === cf) return true
  // Buttons and item-slots / small frames occasionally cross-classify in VLM
  if (
    (ek === 'button' && (ck === 'frame' || ck === 'close-button' || ck === 'badge')) ||
    (ck === 'button' && (ek === 'frame' || ek === 'close-button' || ek === 'badge'))
  ) {
    return true
  }
  return false
}

/**
 * Computes a compact 24x24 visual descriptor + color statistics for a canonical UI component master.
 */
export function computeComponentVisualDescriptor(master: RgbaImage): UiComponentVisualDescriptor {
  const thumb = resizeBilinear(master, DESCRIPTOR_THUMB_SIZE, DESCRIPTOR_THUMB_SIZE)
  const totalPx = Math.max(1, master.width * master.height)
  let opaqueCount = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let borderCount = 0
  let bSumR = 0
  let bSumG = 0
  let bSumB = 0
  const rx = Math.max(2, Math.round(master.width * 0.18))
  const ry = Math.max(2, Math.round(master.height * 0.18))

  for (let y = 0; y < master.height; y++) {
    const isBorderY = y < ry || y >= master.height - ry
    for (let x = 0; x < master.width; x++) {
      const i = (y * master.width + x) * 4
      const a = master.data[i + 3]!
      if (a < 32) continue
      const r = master.data[i]!
      const g = master.data[i + 1]!
      const b = master.data[i + 2]!
      opaqueCount++
      sumR += r
      sumG += g
      sumB += b
      if (isBorderY || x < rx || x >= master.width - rx) {
        borderCount++
        bSumR += r
        bSumG += g
        bSumB += b
      }
    }
  }

  const meanRgb: [number, number, number] =
    opaqueCount > 0
      ? [
          Math.round(sumR / opaqueCount),
          Math.round(sumG / opaqueCount),
          Math.round(sumB / opaqueCount)
        ]
      : [128, 128, 128]
  const borderMeanRgb: [number, number, number] =
    borderCount > 0
      ? [
          Math.round(bSumR / borderCount),
          Math.round(bSumG / borderCount),
          Math.round(bSumB / borderCount)
        ]
      : meanRgb

  return {
    thumbSize: DESCRIPTOR_THUMB_SIZE,
    thumbRgbaBase64: encodeUint8ToBase64(thumb.data),
    aspectRatio: Number((master.width / Math.max(1, master.height)).toFixed(4)),
    opaqueRatio: Number((opaqueCount / totalPx).toFixed(4)),
    meanRgb,
    borderMeanRgb
  }
}

function blitPatch(dst: RgbaImage, src: RgbaImage, srcRect: PixelRect, dstRect: PixelRect): void {
  if (srcRect.width <= 0 || srcRect.height <= 0 || dstRect.width <= 0 || dstRect.height <= 0) {
    return
  }
  const patch = cropImage(src, srcRect)
  const scaled =
    patch.width === dstRect.width && patch.height === dstRect.height
      ? patch
      : resizeBilinear(patch, dstRect.width, dstRect.height)
  for (let y = 0; y < dstRect.height; y++) {
    const dy = dstRect.top + y
    if (dy < 0 || dy >= dst.height) continue
    const srcOff = y * scaled.width * 4
    const dstOff = (dy * dst.width + dstRect.left) * 4
    const copyW = Math.min(scaled.width, dst.width - dstRect.left)
    if (copyW > 0) {
      dst.data.set(scaled.data.subarray(srcOff, srcOff + copyW * 4), dstOff)
    }
  }
}

/**
 * Renders a canonical component master to `(targetWidth, targetHeight)` using either
 * lossless 9-slice corner preservation (`nine-slice`) or premultiplied bilinear resize (`uniform` / `exact`).
 *
 * `nineSliceBorders` follows CSS clockwise order `[top, right, bottom, left]`.
 */
export function renderComponentToRect(
  master: RgbaImage,
  targetWidth: number,
  targetHeight: number,
  policy: UiComponentScalePolicy,
  nineSliceBorders?: readonly [number, number, number, number]
): RgbaImage {
  const tw = Math.max(1, Math.round(targetWidth))
  const th = Math.max(1, Math.round(targetHeight))
  if (tw === master.width && th === master.height) return cloneImage(master)
  if (policy !== 'nine-slice' || !nineSliceBorders) {
    return resizeBilinear(master, tw, th)
  }

  const mw = master.width
  const mh = master.height
  const sT = Math.max(0, Math.min(Math.floor((mh - 1) * 0.48), Math.round(nineSliceBorders[0])))
  const sR = Math.max(0, Math.min(Math.floor((mw - 1) * 0.48), Math.round(nineSliceBorders[1])))
  const sB = Math.max(0, Math.min(Math.floor((mh - 1) * 0.48), Math.round(nineSliceBorders[2])))
  const sL = Math.max(0, Math.min(Math.floor((mw - 1) * 0.48), Math.round(nineSliceBorders[3])))

  const sMidW = mw - sL - sR
  const sMidH = mh - sT - sB
  if (sMidW < 2 || sMidH < 2 || (sT === 0 && sR === 0 && sB === 0 && sL === 0)) {
    return resizeBilinear(master, tw, th)
  }

  // Proportionally compress corner sizes only if target is narrower/shorter than sum of borders
  const xCornerSum = sL + sR
  const yCornerSum = sT + sB
  const xScale = xCornerSum > tw - 1 && xCornerSum > 0 ? Math.max(0.2, (tw - 1) / xCornerSum) : 1
  const yScale = yCornerSum > th - 1 && yCornerSum > 0 ? Math.max(0.2, (th - 1) / yCornerSum) : 1
  const dL = Math.round(sL * xScale)
  const dR = Math.round(sR * xScale)
  const dT = Math.round(sT * yScale)
  const dB = Math.round(sB * yScale)
  const dMidW = Math.max(0, tw - dL - dR)
  const dMidH = Math.max(0, th - dT - dB)

  const out = createImage(tw, th)
  // Top row
  blitPatch(
    out,
    master,
    { left: 0, top: 0, width: sL, height: sT },
    { left: 0, top: 0, width: dL, height: dT }
  )
  blitPatch(
    out,
    master,
    { left: sL, top: 0, width: sMidW, height: sT },
    { left: dL, top: 0, width: dMidW, height: dT }
  )
  blitPatch(
    out,
    master,
    { left: mw - sR, top: 0, width: sR, height: sT },
    { left: tw - dR, top: 0, width: dR, height: dT }
  )
  // Middle row
  blitPatch(
    out,
    master,
    { left: 0, top: sT, width: sL, height: sMidH },
    { left: 0, top: dT, width: dL, height: dMidH }
  )
  blitPatch(
    out,
    master,
    { left: sL, top: sT, width: sMidW, height: sMidH },
    { left: dL, top: dT, width: dMidW, height: dMidH }
  )
  blitPatch(
    out,
    master,
    { left: mw - sR, top: sT, width: sR, height: sMidH },
    { left: tw - dR, top: dT, width: dR, height: dMidH }
  )
  // Bottom row
  blitPatch(
    out,
    master,
    { left: 0, top: mh - sB, width: sL, height: sB },
    { left: 0, top: th - dB, width: dL, height: dB }
  )
  blitPatch(
    out,
    master,
    { left: sL, top: mh - sB, width: sMidW, height: sB },
    { left: dL, top: th - dB, width: dMidW, height: dB }
  )
  blitPatch(
    out,
    master,
    { left: mw - sR, top: mh - sB, width: sR, height: sB },
    { left: tw - dR, top: th - dB, width: dR, height: dB }
  )
  return out
}

export interface ComponentMatchInput {
  elementKind: UiElementKind | string
  box: PixelRect
  /** Cropped plate RGBA of size `(box.width, box.height)` (preferably text-cleaned plate at `el.level`). */
  observedPatch: RgbaImage
  /** Foreground mask of `el` (`1` = foreground, length = `box.width * box.height`). */
  detectedMask: Uint8Array
  /** Unobstructed pixel mask (`1` = NOT occluded by upper/child/text elements, length = `box.width * box.height`). */
  knownMask: Uint8Array
  /** Optional VLM hint pointing to a candidate `item.id`. */
  hintedComponentId?: string
  candidates: readonly PreciseSplitComponentCandidate[]
  /** Minimum match confidence in `[0, 1]` (default `0.72`). */
  minScore?: number
}

export interface ComponentMatchResult {
  candidate: PreciseSplitComponentCandidate
  rendered: RgbaImage
  score: number
}

function isAspectAndScaleCompatible(
  box: PixelRect,
  item: UiSharedComponentItem,
  explicitHintMatch: boolean
): boolean {
  const cw = Math.max(1, item.canonicalWidth)
  const ch = Math.max(1, item.canonicalHeight)
  const arMaster = cw / ch
  const arTarget = box.width / Math.max(1, box.height)
  const arRatio = Math.max(arMaster / arTarget, arTarget / arMaster)
  const scaleX = box.width / cw
  const scaleY = box.height / ch

  if (item.scalePolicy === 'exact') {
    const tol = explicitHintMatch ? 0.18 : 0.12
    return Math.abs(scaleX - 1) <= tol && Math.abs(scaleY - 1) <= tol
  }
  if (item.scalePolicy === 'nine-slice') {
    const maxAr = explicitHintMatch ? 4.2 : 3.4
    return (
      arRatio <= maxAr &&
      box.width >= Math.min(24, cw * 0.45) &&
      box.height >= Math.min(20, ch * 0.45) &&
      scaleX <= 4.5 &&
      scaleY <= 4.5
    )
  }
  // 'uniform'
  const maxAr = explicitHintMatch ? 1.32 : 1.22
  return arRatio <= maxAr && scaleX >= 0.35 && scaleX <= 2.8 && scaleY >= 0.35 && scaleY <= 2.8
}

/**
 * Matches a segmented UI element against `candidates` using only unobstructed (`knownMask === 1`) pixels,
 * combining silhouette IoU, 80%-trimmed RGB MAE, border-ring MAE, and chroma consistency.
 */
export function matchElementToComponentLibrary(
  input: ComponentMatchInput
): ComponentMatchResult | null {
  const {
    elementKind,
    box,
    observedPatch,
    detectedMask,
    knownMask,
    hintedComponentId,
    candidates,
    minScore = 0.72
  } = input
  if (!candidates.length || NON_COMPONENT_KINDS.has(elementKind)) return null
  if (box.width < 10 || box.height < 10) return null

  const w = observedPatch.width
  const h = observedPatch.height
  if (w !== box.width || h !== box.height) return null

  const borderRx = Math.max(2, Math.round(w * 0.2))
  const borderRy = Math.max(2, Math.round(h * 0.2))

  let best: ComponentMatchResult | null = null

  for (const cand of candidates) {
    const { item, rgba: master } = cand
    if (master.width < 4 || master.height < 4) continue
    const explicitHint = Boolean(
      hintedComponentId && (hintedComponentId === item.id || hintedComponentId === item.exportName)
    )
    if (!areComponentKindsCompatible(elementKind, item.kind, explicitHint)) continue
    if (!isAspectAndScaleCompatible(box, item, explicitHint)) continue

    const rendered = renderComponentToRect(master, w, h, item.scalePolicy, item.nineSliceBorders)

    let inter = 0
    let union = 0
    let borderErrSum = 0
    let borderCnt = 0
    let chromaErrSum = 0
    let chromaCnt = 0
    const pixelErrors: number[] = []

    // Subsample step for large panels so matching stays O(<= 4096 samples)
    const step = w * h > 8192 ? 2 : 1
    for (let y = 0; y < h; y += step) {
      const isBorderY = y < borderRy || y >= h - borderRy
      for (let x = 0; x < w; x += step) {
        const p = y * w + x
        if (!knownMask[p]) continue
        const i = p * 4
        const compA = rendered.data[i + 3]!
        const compOpaque = compA >= 48
        const obsOpaque = detectedMask[p] === 1
        if (compOpaque && obsOpaque) inter++
        if (compOpaque || obsOpaque) union++

        if (compA >= 96 && obsOpaque) {
          const r1 = observedPatch.data[i]!
          const g1 = observedPatch.data[i + 1]!
          const b1 = observedPatch.data[i + 2]!
          const r2 = rendered.data[i]!
          const g2 = rendered.data[i + 1]!
          const b2 = rendered.data[i + 2]!
          const rgbErr = (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)) / 3
          pixelErrors.push(rgbErr)
          const chErr = (Math.abs(r1 - g1 - (r2 - g2)) + Math.abs(g1 - b1 - (g2 - b2))) * 0.5
          chromaErrSum += chErr
          chromaCnt++
          if (isBorderY || x < borderRx || x >= w - borderRx) {
            borderErrSum += rgbErr
            borderCnt++
          }
        }
      }
    }

    if (union < 8 || pixelErrors.length < 8) continue
    const iou = inter / union
    const minIou = explicitHint ? 0.56 : 0.62
    if (iou < minIou) continue

    pixelErrors.sort((a, b) => a - b)
    // 80% trimmed mean ignores small residual highlights or unmasked micro-details in the center
    const trimCount = Math.max(4, Math.floor(pixelErrors.length * 0.8))
    let trimSum = 0
    for (let k = 0; k < trimCount; k++) trimSum += pixelErrors[k]!
    const trimmedMae = trimSum / trimCount
    const borderMae = borderCnt >= 4 ? borderErrSum / borderCnt : trimmedMae
    const chromaMae = chromaCnt >= 4 ? chromaErrSum / chromaCnt : trimmedMae

    const maxAllowedMae = explicitHint ? 31 : 27
    const maxAllowedBorderMae = explicitHint ? 33 : 29
    const maxAllowedChroma = explicitHint ? 28 : 24
    if (
      trimmedMae > maxAllowedMae ||
      borderMae > maxAllowedBorderMae ||
      chromaMae > maxAllowedChroma
    ) {
      continue
    }

    const colorSim = Math.max(0, 1 - trimmedMae / 45)
    const borderSim = Math.max(0, 1 - borderMae / 45)
    const chromaSim = Math.max(0, 1 - chromaMae / 40)
    const rawScore =
      0.36 * colorSim + 0.24 * borderSim + 0.16 * chromaSim + 0.24 * iou + (explicitHint ? 0.04 : 0)
    const score = Math.min(1, Number(rawScore.toFixed(4)))

    if (score >= minScore && (!best || score > best.score)) {
      best = { candidate: cand, rendered, score }
    }
  }

  return best
}

export interface ExtractSharedComponentsOptions {
  /**
   * `'repeated'` only extracts components appearing >= 2 times across the input screen(s);
   * `'all-controls'` (default when 1 screen is supplied) also extracts standalone reusable UI controls
   * (`button`, `close-button`, `tab`, `item-slot`, `frame`, `panel`, `badge`, `progress-bar`).
   */
  mode?: 'auto' | 'repeated' | 'all-controls'
  /** Maximum number of shared components to emit (default 48). */
  maxComponents?: number
}

interface ExtractedInstanceSample {
  screenIndex: number
  layer: PreciseSplitLayer
  rgba: RgbaImage
  /** 1 = unobstructed valid pixel, 0 = occluded by upper text / child icon / sibling */
  knownMask: Uint8Array
  descriptor: UiComponentVisualDescriptor
  prefabKey?: string
}

function resizeBinaryMaskNearest(
  mask: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return new Uint8Array(mask)
  const out = new Uint8Array(dstW * dstH)
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(((y + 0.5) * srcH) / dstH))
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(((x + 0.5) * srcW) / dstW))
      out[y * dstW + x] = mask[sy * srcW + sx]!
    }
  }
  return out
}

function medianOfSorted(arr: number[]): number {
  if (!arr.length) return 0
  const mid = arr.length >> 1
  return arr.length % 2 === 1 ? arr[mid]! : Math.round((arr[mid - 1]! + arr[mid]!) * 0.5)
}

/**
 * Fuses N instances of a UI component into a single clean, de-texted, de-occluded canonical master RGBA:
 * - Warps each instance and its unobstructed `knownMask` to canonical median dimensions
 * - Computes per-pixel median RGBA across unobstructed (`known=1`) samples
 * - Fills any remaining occluded pixels via horizontal/vertical mirror symmetry + `inpaintPushPull`
 */
function fuseClusterMasterRgba(samples: readonly ExtractedInstanceSample[]): {
  master: RgbaImage
  canonicalWidth: number
  canonicalHeight: number
} {
  const widths = samples.map((s) => s.rgba.width).sort((a, b) => a - b)
  const heights = samples.map((s) => s.rgba.height).sort((a, b) => a - b)
  const canonicalWidth = Math.max(8, medianOfSorted(widths))
  const canonicalHeight = Math.max(8, medianOfSorted(heights))

  if (samples.length === 1) {
    const single = samples[0]!
    const out =
      single.rgba.width === canonicalWidth && single.rgba.height === canonicalHeight
        ? cloneImage(single.rgba)
        : resizeBilinear(single.rgba, canonicalWidth, canonicalHeight)
    const warpedKnown = resizeBinaryMaskNearest(
      single.knownMask,
      single.rgba.width,
      single.rgba.height,
      canonicalWidth,
      canonicalHeight
    )
    repairResidualOccludedHoles(out, warpedKnown)
    return { master: out, canonicalWidth, canonicalHeight }
  }

  const warpedImgs = samples.map((s) =>
    s.rgba.width === canonicalWidth && s.rgba.height === canonicalHeight
      ? s.rgba
      : resizeBilinear(s.rgba, canonicalWidth, canonicalHeight)
  )
  const warpedKnowns = samples.map((s) =>
    resizeBinaryMaskNearest(
      s.knownMask,
      s.rgba.width,
      s.rgba.height,
      canonicalWidth,
      canonicalHeight
    )
  )

  const master = createImage(canonicalWidth, canonicalHeight)
  const fusedKnown = new Uint8Array(canonicalWidth * canonicalHeight)
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  const as: number[] = []

  for (let p = 0; p < canonicalWidth * canonicalHeight; p++) {
    rs.length = 0
    gs.length = 0
    bs.length = 0
    as.length = 0
    for (let k = 0; k < warpedImgs.length; k++) {
      if (!warpedKnowns[k]![p]) continue
      const i = p * 4
      const img = warpedImgs[k]!
      as.push(img.data[i + 3]!)
      if (img.data[i + 3]! >= 16) {
        rs.push(img.data[i]!)
        gs.push(img.data[i + 1]!)
        bs.push(img.data[i + 2]!)
      }
    }
    if (as.length > 0) {
      fusedKnown[p] = 1
      as.sort((a, b) => a - b)
      const medA = medianOfSorted(as)
      const o = p * 4
      master.data[o + 3] = medA
      if (medA >= 8 && rs.length > 0) {
        rs.sort((a, b) => a - b)
        gs.sort((a, b) => a - b)
        bs.sort((a, b) => a - b)
        master.data[o] = medianOfSorted(rs)
        master.data[o + 1] = medianOfSorted(gs)
        master.data[o + 2] = medianOfSorted(bs)
      }
    } else {
      // Fallback if every instance was occluded at pixel p: take median of all instances and mark hole
      for (let k = 0; k < warpedImgs.length; k++) {
        const i = p * 4
        const img = warpedImgs[k]!
        as.push(img.data[i + 3]!)
        if (img.data[i + 3]! >= 16) {
          rs.push(img.data[i]!)
          gs.push(img.data[i + 1]!)
          bs.push(img.data[i + 2]!)
        }
      }
      const o = p * 4
      as.sort((a, b) => a - b)
      master.data[o + 3] = medianOfSorted(as)
      if (rs.length > 0) {
        rs.sort((a, b) => a - b)
        gs.sort((a, b) => a - b)
        bs.sort((a, b) => a - b)
        master.data[o] = medianOfSorted(rs)
        master.data[o + 1] = medianOfSorted(gs)
        master.data[o + 2] = medianOfSorted(bs)
      }
    }
  }

  repairResidualOccludedHoles(master, fusedKnown)
  return { master, canonicalWidth, canonicalHeight }
}

/**
 * Repairs pixels where `knownMask[p] === 0` first via left-right / top-bottom mirror symmetry
 * (when the component is symmetric) and then via `inpaintPushPull`.
 */
function repairResidualOccludedHoles(img: RgbaImage, knownMask: Uint8Array): void {
  const { width, height } = img
  const hole = new Uint8Array(width * height)
  let holeCount = 0
  for (let p = 0; p < hole.length; p++) {
    if (!knownMask[p]) {
      hole[p] = 1
      holeCount++
    }
  }
  if (holeCount === 0 || holeCount >= hole.length * 0.92) return

  // Check horizontal mirror symmetry on known pixels
  let symDiff = 0
  let symPairs = 0
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width >> 1; x += 2) {
      const mx = width - 1 - x
      const p1 = y * width + x
      const p2 = y * width + mx
      if (!knownMask[p1] || !knownMask[p2]) continue
      const i1 = p1 * 4
      const i2 = p2 * 4
      symDiff +=
        (Math.abs(img.data[i1]! - img.data[i2]!) +
          Math.abs(img.data[i1 + 1]! - img.data[i2 + 1]!) +
          Math.abs(img.data[i1 + 2]! - img.data[i2 + 2]!) +
          Math.abs(img.data[i1 + 3]! - img.data[i2 + 3]!)) /
        4
      symPairs++
    }
  }
  if (symPairs >= 12 && symDiff / symPairs <= 18) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x
        if (!hole[p]) continue
        const mp = y * width + (width - 1 - x)
        if (!hole[mp]) {
          const dst = p * 4
          const src = mp * 4
          img.data[dst] = img.data[src]!
          img.data[dst + 1] = img.data[src + 1]!
          img.data[dst + 2] = img.data[src + 2]!
          img.data[dst + 3] = img.data[src + 3]!
          hole[p] = 0
          holeCount--
        }
      }
    }
  }

  if (holeCount > 0) {
    inpaintPushPull(img, hole)
  }
}

function samplesAreSameComponent(a: ExtractedInstanceSample, b: ExtractedInstanceSample): boolean {
  if (a.screenIndex === b.screenIndex && a.prefabKey && a.prefabKey === b.prefabKey) {
    return true
  }
  if (!areComponentKindsCompatible(a.layer.kind, b.layer.kind, false)) return false

  const arA = a.descriptor.aspectRatio
  const arB = b.descriptor.aspectRatio
  const arRatio = Math.max(arA / Math.max(0.01, arB), arB / Math.max(0.01, arA))
  const canNineSlice =
    NINE_SLICE_ELIGIBLE_KINDS.has(a.layer.kind) || NINE_SLICE_ELIGIBLE_KINDS.has(b.layer.kind)
  if (arRatio > (canNineSlice ? 2.4 : 1.2)) return false

  // Fast border mean RGB pre-check
  const bDiff =
    (Math.abs(a.descriptor.borderMeanRgb[0] - b.descriptor.borderMeanRgb[0]) +
      Math.abs(a.descriptor.borderMeanRgb[1] - b.descriptor.borderMeanRgb[1]) +
      Math.abs(a.descriptor.borderMeanRgb[2] - b.descriptor.borderMeanRgb[2])) /
    3
  if (bDiff > 28) return false

  // Full unobstructed match verification
  const bNine = computeNineSliceFromRgbaBuffer(b.rgba.data, b.rgba.width, b.rgba.height)
  const scalePolicy: UiComponentScalePolicy = bNine && canNineSlice ? 'nine-slice' : 'uniform'
  const detectedA = new Uint8Array(a.rgba.width * a.rgba.height)
  for (let p = 0; p < detectedA.length; p++) {
    if (a.rgba.data[p * 4 + 3]! >= 32) detectedA[p] = 1
  }
  const candB: PreciseSplitComponentCandidate = {
    item: {
      id: 'probe',
      psdGuid: componentIdToPsdGuid('probe'),
      name: 'probe',
      exportName: 'Comp_Probe',
      kind: b.layer.kind,
      canonicalWidth: b.rgba.width,
      canonicalHeight: b.rgba.height,
      scalePolicy,
      ...(bNine ? { nineSliceBorders: bNine } : {})
    },
    rgba: b.rgba
  }
  const match = matchElementToComponentLibrary({
    elementKind: a.layer.kind,
    box: { left: 0, top: 0, width: a.rgba.width, height: a.rgba.height },
    observedPatch: a.rgba,
    detectedMask: detectedA,
    knownMask: a.knownMask,
    candidates: [candB],
    minScore: 0.75
  })
  return match !== null
}

function buildKnownMaskForSplitLayer(
  target: PreciseSplitLayer,
  allLayers: readonly PreciseSplitLayer[]
): Uint8Array {
  const w = Math.max(1, target.width)
  const h = Math.max(1, target.height)
  const known = new Uint8Array(w * h)
  known.fill(1)

  for (const upper of allLayers) {
    if (upper.id === target.id) continue
    const isAbove =
      upper.paintIndex > target.paintIndex ||
      upper.parentElementId === target.elementId ||
      Boolean(upper.editableText)
    if (!isAbove) continue
    const ox0 = Math.max(target.left, upper.left)
    const oy0 = Math.max(target.top, upper.top)
    const ox1 = Math.min(target.left + target.width, upper.left + upper.width)
    const oy1 = Math.min(target.top + target.height, upper.top + upper.height)
    if (ox1 <= ox0 || oy1 <= oy0) continue

    if (upper.editableText) {
      // Expand plain-text bbox by 2px so text strokes/anti-aliased halos are marked unknown
      const padX0 = Math.max(target.left, ox0 - 2)
      const padY0 = Math.max(target.top, oy0 - 2)
      const padX1 = Math.min(target.left + target.width, ox1 + 2)
      const padY1 = Math.min(target.top + target.height, oy1 + 2)
      for (let y = padY0; y < padY1; y++) {
        const ty = y - target.top
        for (let x = padX0; x < padX1; x++) {
          known[ty * w + (x - target.left)] = 0
        }
      }
      continue
    }

    for (let y = oy0; y < oy1; y++) {
      const ty = y - target.top
      const uy = y - upper.top
      for (let x = ox0; x < ox1; x++) {
        const ux = x - upper.left
        const ua = upper.rgba[(uy * upper.width + ux) * 4 + 3]!
        if (ua >= 24) {
          known[ty * w + (x - target.left)] = 0
        }
      }
    }
  }

  return known
}

/**
 * Extracts canonical, de-texted, de-occluded shared UI components across 1 or N `PreciseSplitResult` screens.
 */
export function extractSharedComponentsFromSplitResults(
  screens: ReadonlyArray<{ split: PreciseSplitResult; title?: string }>,
  options?: ExtractSharedComponentsOptions
): PreciseSplitComponentCandidate[] {
  const maxComponents = Math.max(1, Math.min(128, options?.maxComponents ?? 48))
  const mode = options?.mode ?? 'auto'
  const includeSingletons = mode === 'all-controls' || (mode === 'auto' && screens.length <= 1)

  const samples: ExtractedInstanceSample[] = []
  for (let sIdx = 0; sIdx < screens.length; sIdx++) {
    const { split } = screens[sIdx]!
    const canvasArea = Math.max(1, split.canvasWidth * split.canvasHeight)
    for (const layer of split.layers) {
      if (layer.editableText || NON_COMPONENT_KINDS.has(layer.kind)) continue
      if (layer.width < 14 || layer.height < 14) continue
      if (layer.width * layer.height > canvasArea * 0.75) continue
      const rgba: RgbaImage = {
        width: layer.width,
        height: layer.height,
        data: new Uint8ClampedArray(layer.rgba)
      }
      const descriptor = computeComponentVisualDescriptor(rgba)
      if (descriptor.opaqueRatio < 0.06) continue
      const knownMask = buildKnownMaskForSplitLayer(layer, split.layers)
      samples.push({
        screenIndex: sIdx,
        layer,
        rgba,
        knownMask,
        descriptor,
        ...(layer.prefabKey ? { prefabKey: layer.prefabKey } : {})
      })
    }
  }

  // Greedy similarity clustering (largest/cleanest samples first)
  const clusters: ExtractedInstanceSample[][] = []
  for (const sample of samples) {
    let placed = false
    for (const cluster of clusters) {
      if (samplesAreSameComponent(sample, cluster[0]!)) {
        cluster.push(sample)
        placed = true
        break
      }
    }
    if (!placed) clusters.push([sample])
  }

  // Sort clusters: multi-instance repeated components first, then reusable singletons by area
  const eligibleClusters = clusters
    .filter(
      (c) => c.length >= 2 || (includeSingletons && REUSABLE_SINGLETON_KINDS.has(c[0]!.layer.kind))
    )
    .sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length
      const areaA = a[0]!.rgba.width * a[0]!.rgba.height
      const areaB = b[0]!.rgba.width * b[0]!.rgba.height
      return areaB - areaA
    })
    .slice(0, maxComponents)

  // If mode === 'repeated' produced 0 clusters on a single screen, gracefully fall back to reusable controls
  const finalClusters =
    eligibleClusters.length > 0
      ? eligibleClusters
      : clusters
          .filter((c) => REUSABLE_SINGLETON_KINDS.has(c[0]!.layer.kind))
          .slice(0, maxComponents)

  const out: PreciseSplitComponentCandidate[] = []
  const kindCounters = new Map<string, number>()

  for (let idx = 0; idx < finalClusters.length; idx++) {
    const cluster = finalClusters[idx]!
    const rep = cluster[0]!
    const kind = rep.layer.kind
    const kindSeq = (kindCounters.get(kind) ?? 0) + 1
    kindCounters.set(kind, kindSeq)

    const { master, canonicalWidth, canonicalHeight } = fuseClusterMasterRgba(cluster)
    const nineSliceBorders = NINE_SLICE_ELIGIBLE_KINDS.has(kind)
      ? computeNineSliceFromRgbaBuffer(master.data, canonicalWidth, canonicalHeight)
      : undefined
    const scalePolicy: UiComponentScalePolicy = nineSliceBorders
      ? 'nine-slice'
      : kind === 'close-button' || kind === 'icon' || kind === 'badge'
        ? 'uniform'
        : 'uniform'
    const descriptor = computeComponentVisualDescriptor(master)
    const kindSlug = kind.replace(/[^a-z0-9]+/gi, '_').toLowerCase()
    const id = `comp_${kindSlug}_${String(kindSeq).padStart(2, '0')}`
    const exportName = sanitizeComponentExportName(
      `Comp_${kind
        .split('-')
        .map((s) => (s ? s[0]!.toUpperCase() + s.slice(1) : ''))
        .join('')}_${String(kindSeq).padStart(2, '0')}`,
      idx + 1
    )
    const baseName = rep.layer.name?.trim() || `${kind} ${kindSeq}`
    const item: UiSharedComponentItem = {
      id,
      psdGuid: componentIdToPsdGuid(id),
      name: baseName,
      exportName,
      kind,
      canonicalWidth,
      canonicalHeight,
      scalePolicy,
      ...(nineSliceBorders ? { nineSliceBorders } : {}),
      sourceCount: cluster.length,
      descriptor
    }
    out.push({ item, rgba: master })
  }

  return out
}

/**
 * Expands an element's detected foreground mask on the canvas by unioning with the placed
 * component master's alpha mask (`alpha >= 16`), returning both the new rect-local mask and
 * any newly uncovered canvas-space pixels that need local background repair on lower plates.
 */
export function buildComponentUnionPeelMask(
  box: PixelRect,
  detectedMask: Uint8Array,
  renderedComponent: RgbaImage,
  plate?: RgbaImage,
  knownMask?: Uint8Array
): {
  unionMask: Uint8Array
  extraMask: Uint8Array
  extraPixelCount: number
} {
  const n = box.width * box.height
  const unionMask = new Uint8Array(n)
  const extraMask = new Uint8Array(n)
  let extraPixelCount = 0

  // Sample median exterior ring color just outside `box` so any stray corner/halo pixels inside `box`
  // that were dropped by connected-component pruning are also swept into `unionMask`.
  let extR = -1
  let extG = -1
  let extB = -1
  if (plate) {
    const rs: number[] = []
    const gs: number[] = []
    const bs: number[] = []
    const x0 = Math.max(0, box.left - 2)
    const y0 = Math.max(0, box.top - 2)
    const x1 = Math.min(plate.width, box.left + box.width + 2)
    const y1 = Math.min(plate.height, box.top + box.height + 2)
    for (let cy = y0; cy < y1; cy++) {
      for (let cx = x0; cx < x1; cx++) {
        if (
          cx >= box.left &&
          cx < box.left + box.width &&
          cy >= box.top &&
          cy < box.top + box.height
        ) {
          continue
        }
        const off = (cy * plate.width + cx) * 4
        if (plate.data[off + 3]! < 32) continue
        rs.push(plate.data[off]!)
        gs.push(plate.data[off + 1]!)
        bs.push(plate.data[off + 2]!)
      }
    }
    if (rs.length >= 4) {
      rs.sort((a, b) => a - b)
      gs.sort((a, b) => a - b)
      bs.sort((a, b) => a - b)
      const mid = rs.length >> 1
      extR = rs[mid]!
      extG = gs[mid]!
      extB = bs[mid]!
    }
  }

  for (let p = 0; p < n; p++) {
    const wasFg = detectedMask[p] === 1
    const compFg = renderedComponent.data[p * 4 + 3]! >= 16
    let strayCornerFg = false
    if (!wasFg && !compFg && plate && extR >= 0 && (!knownMask || knownMask[p] === 1)) {
      const lx = p % box.width
      const ly = Math.floor(p / box.width)
      const cx = box.left + lx
      const cy = box.top + ly
      if (cx >= 0 && cx < plate.width && cy >= 0 && cy < plate.height) {
        const off = (cy * plate.width + cx) * 4
        const maxDiff = Math.max(
          Math.abs(plate.data[off]! - extR),
          Math.abs(plate.data[off + 1]! - extG),
          Math.abs(plate.data[off + 2]! - extB)
        )
        if (maxDiff > 24) strayCornerFg = true
      }
    }
    if (wasFg || compFg || strayCornerFg) {
      unionMask[p] = 1
      if (!wasFg && (compFg || strayCornerFg)) {
        extraMask[p] = 1
        extraPixelCount++
      }
    }
  }
  return { unionMask, extraMask, extraPixelCount }
}

/**
 * Locally inpaints any extra border pixels covered by the placed component master (`extraMask === 1`)
 * on a lower plate so no old rim/shadow double-contour remains underneath the replaced component.
 */
export function eraseExtraComponentFootprintOnPlate(
  plate: RgbaImage,
  box: PixelRect,
  extraMask: Uint8Array,
  extraPixelCount: number
): void {
  if (extraPixelCount <= 0) return
  const padRect = clampRect(
    {
      left: box.left - 8,
      top: box.top - 8,
      width: box.width + 16,
      height: box.height + 16
    },
    plate.width,
    plate.height
  )
  const sub = cropImage(plate, padRect)
  const hole = new Uint8Array(padRect.width * padRect.height)
  // Mark only newly covered extra border pixels (`extraMask`, dilated by 2px) as hole
  for (let y = 0; y < box.height; y++) {
    const py = box.top + y - padRect.top
    if (py < 0 || py >= padRect.height) continue
    for (let x = 0; x < box.width; x++) {
      const idx = y * box.width + x
      if (!extraMask[idx]) continue
      const px = box.left + x - padRect.left
      if (px < 0 || px >= padRect.width) continue
      for (let dy = -2; dy <= 2; dy++) {
        const ny = py + dy
        if (ny < 0 || ny >= padRect.height) continue
        for (let dx = -2; dx <= 2; dx++) {
          const nx = px + dx
          if (nx < 0 || nx >= padRect.width) continue
          hole[ny * padRect.width + nx] = 1
        }
      }
    }
  }
  inpaintPushPull(sub, hole)
  // Write back ONLY where extra pixels (plus 2px feather ring outside original detected hole) were newly covered
  for (let y = 0; y < padRect.height; y++) {
    const cy = padRect.top + y
    for (let x = 0; x < padRect.width; x++) {
      if (!hole[y * padRect.width + x]) continue
      const cx = padRect.left + x
      const srcOff = (y * padRect.width + x) * 4
      const dstOff = (cy * plate.width + cx) * 4
      plate.data[dstOff] = sub.data[srcOff]!
      plate.data[dstOff + 1] = sub.data[srcOff + 1]!
      plate.data[dstOff + 2] = sub.data[srcOff + 2]!
      plate.data[dstOff + 3] = sub.data[srcOff + 3]!
    }
  }
}
