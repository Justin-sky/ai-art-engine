import { computeNineSliceFromRgbaBuffer } from '../imageLayerSplit'
import {
  componentIdToPsdGuid,
  decodeBase64ToUint8,
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
  dilateMask,
  erodeMask,
  fillHoles,
  inpaintPushPull,
  labelComponents,
  median,
  rectArea,
  rectIntersection,
  resizeBilinear
} from './pixels'
import { normalizeElementKind } from './layout'
import { bleedTransparentRgb } from './productize'
import { inferComponentKindFromLabel } from './prompts'
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

const BORDER_RING_CLUSTERABLE_KINDS = new Set<string>([
  'item-slot',
  'button',
  'tab',
  'frame',
  'panel',
  'banner',
  'card'
])

export const NON_COMPONENT_KINDS = new Set<string>([
  'text',
  'art-text',
  'illustration',
  'effect',
  'avatar',
  'icon',
  'decoration',
  'divider'
])

export function componentKindPriority(kind: string): number {
  const k = kind.trim().toLowerCase()
  if (k === 'button' || k === 'item-slot') return 10
  if (k === 'tab' || k === 'close-button') return 9
  if (k === 'progress-bar' || k === 'badge') return 8
  if (k === 'banner' || k === 'arrow') return 7
  if (k === 'frame' || k === 'card') return 6
  if (k === 'panel') return 3
  return 4
}

function kindFamily(kind: string): string {
  const k = kind.trim().toLowerCase()
  if (k === 'button' || k === 'tab' || k === 'banner') return 'action'
  if (k === 'close-button' || k === 'badge' || k === 'arrow') return 'glyph-widget'
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

/**
 * Strictly checks whether two cataloged component skins from different UI screens represent
 * the exact same reusable skin (matching kind, aspect ratio, border color, and interior fill/ring
 * chroma), preventing distinct buttons, active/inactive tabs, or different rarity slots from
 * being falsely collapsed just because they share a common dark/gold border theme.
 */
export function areComponentDescriptorsSameSkin(
  aKind: UiElementKind | string,
  aDesc: UiComponentVisualDescriptor,
  bKind: UiElementKind | string,
  bDesc: UiComponentVisualDescriptor
): boolean {
  if (aKind !== bKind) return false

  const ar1 = aDesc.aspectRatio
  const ar2 = bDesc.aspectRatio
  const arRatio = Math.max(ar1 / Math.max(0.01, ar2), ar2 / Math.max(0.01, ar1))
  const can9s = NINE_SLICE_ELIGIBLE_KINDS.has(aKind)
  if (arRatio > (can9s ? 1.35 : 1.16)) return false

  const bDiff =
    (Math.abs(aDesc.borderMeanRgb[0] - bDesc.borderMeanRgb[0]) +
      Math.abs(aDesc.borderMeanRgb[1] - bDesc.borderMeanRgb[1]) +
      Math.abs(aDesc.borderMeanRgb[2] - bDesc.borderMeanRgb[2])) /
    3
  if (bDiff > 18) return false
  const bChroma =
    (Math.abs(
      aDesc.borderMeanRgb[0] -
        aDesc.borderMeanRgb[1] -
        (bDesc.borderMeanRgb[0] - bDesc.borderMeanRgb[1])
    ) +
      Math.abs(
        aDesc.borderMeanRgb[1] -
          aDesc.borderMeanRgb[2] -
          (bDesc.borderMeanRgb[1] - bDesc.borderMeanRgb[2])
      )) *
    0.5
  if (bChroma > 16) return false

  const isHollowOrSlot = aKind === 'item-slot' || aKind === 'frame'
  if (!isHollowOrSlot) {
    const mDiff =
      (Math.abs(aDesc.meanRgb[0] - bDesc.meanRgb[0]) +
        Math.abs(aDesc.meanRgb[1] - bDesc.meanRgb[1]) +
        Math.abs(aDesc.meanRgb[2] - bDesc.meanRgb[2])) /
      3
    if (mDiff > 22) return false
    const mChroma =
      (Math.abs(aDesc.meanRgb[0] - aDesc.meanRgb[1] - (bDesc.meanRgb[0] - bDesc.meanRgb[1])) +
        Math.abs(aDesc.meanRgb[1] - aDesc.meanRgb[2] - (bDesc.meanRgb[1] - bDesc.meanRgb[2]))) *
      0.5
    if (mChroma > 18) return false
  }

  const side = aDesc.thumbSize
  if (side < 8 || bDesc.thumbSize !== side || !aDesc.thumbRgbaBase64 || !bDesc.thumbRgbaBase64) {
    return true
  }
  const bytesA = decodeBase64ToUint8(aDesc.thumbRgbaBase64)
  const bytesB = decodeBase64ToUint8(bDesc.thumbRgbaBase64)
  const expectedLen = side * side * 4
  if (bytesA.length < expectedLen || bytesB.length < expectedLen) return true

  const ringMargin = Math.max(2, Math.round(side * 0.25))
  const rgbErrs: number[] = []
  const chromaErrs: number[] = []
  for (let y = 0; y < side; y++) {
    const inRingY = y < ringMargin || y >= side - ringMargin
    for (let x = 0; x < side; x++) {
      if (isHollowOrSlot && !inRingY && x >= ringMargin && x < side - ringMargin) continue
      const i = (y * side + x) * 4
      if (bytesA[i + 3]! < 64 || bytesB[i + 3]! < 64) continue
      const r1 = bytesA[i]!
      const g1 = bytesA[i + 1]!
      const b1 = bytesA[i + 2]!
      const r2 = bytesB[i]!
      const g2 = bytesB[i + 1]!
      const b2 = bytesB[i + 2]!
      rgbErrs.push((Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)) / 3)
      chromaErrs.push((Math.abs(r1 - g1 - (r2 - g2)) + Math.abs(g1 - b1 - (g2 - b2))) * 0.5)
    }
  }
  if (rgbErrs.length < 12) return true

  rgbErrs.sort((x, y) => x - y)
  chromaErrs.sort((x, y) => x - y)
  const trimRatio = isHollowOrSlot ? 0.8 : 0.7
  const trimCnt = Math.max(8, Math.floor(rgbErrs.length * trimRatio))
  let rgbSum = 0
  let chSum = 0
  for (let k = 0; k < trimCnt; k++) {
    rgbSum += rgbErrs[k]!
    chSum += chromaErrs[k]!
  }
  return rgbSum / trimCnt <= 18 && chSum / trimCnt <= 15
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
  /**
   * When true, matches directly against `observedPatch` on `compOpaque ∩ knownMask` before local
   * instance segmentation runs, preventing noisy local masks from rejecting valid component masters.
   */
  allowMasklessBoxMatch?: boolean
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
      box.width >= Math.min(20, cw * 0.22) &&
      box.height >= Math.min(16, ch * 0.22) &&
      scaleX <= 4.5 &&
      scaleY <= 4.5
    )
  }
  // 'uniform'
  const maxAr = explicitHintMatch ? 1.32 : 1.22
  return arRatio <= maxAr && scaleX >= 0.22 && scaleX <= 2.8 && scaleY >= 0.22 && scaleY <= 2.8
}

/**
 * Supersampled premultiplied area-averaging downsampler (`INTER_AREA` equivalent).
 * Eliminates jagged stair-stepping and edge halos when shrinking high-res AI studio masters
 * down to canonical UI pixel dimensions; delegates to `resizeBilinear` when upscaling.
 */
export function resizeAreaAverage(img: RgbaImage, width: number, height: number): RgbaImage {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  if (w === img.width && h === img.height) return cloneImage(img)
  if (w >= img.width && h >= img.height) return resizeBilinear(img, w, h)

  const out = createImage(w, h)
  const scaleX = img.width / w
  const scaleY = img.height / h
  const src = img.data
  const iw = img.width
  const ih = img.height

  for (let y = 0; y < h; y++) {
    const sy0 = y * scaleY
    const sy1 = (y + 1) * scaleY
    const iy0 = Math.max(0, Math.floor(sy0))
    const iy1 = Math.min(ih - 1, Math.ceil(sy1) - 1)
    for (let x = 0; x < w; x++) {
      const sx0 = x * scaleX
      const sx1 = (x + 1) * scaleX
      const ix0 = Math.max(0, Math.floor(sx0))
      const ix1 = Math.min(iw - 1, Math.ceil(sx1) - 1)

      let sumW = 0
      let sumA = 0
      let sumR = 0
      let sumG = 0
      let sumB = 0

      for (let iy = iy0; iy <= iy1; iy++) {
        const wy = Math.min(sy1, iy + 1) - Math.max(sy0, iy)
        if (wy <= 0) continue
        const rowOff = iy * iw
        for (let ix = ix0; ix <= ix1; ix++) {
          const wx = Math.min(sx1, ix + 1) - Math.max(sx0, ix)
          if (wx <= 0) continue
          const weight = wx * wy
          const idx = (rowOff + ix) * 4
          const sa = (src[idx + 3]! / 255) * weight
          sumW += weight
          sumA += sa
          sumR += src[idx]! * sa
          sumG += src[idx + 1]! * sa
          sumB += src[idx + 2]! * sa
        }
      }

      const o = (y * w + x) * 4
      const outA = sumW > 0 ? sumA / sumW : 0
      if (sumA > 1e-5 && outA >= 1 / 510) {
        out.data[o] = Math.round(sumR / sumA)
        out.data[o + 1] = Math.round(sumG / sumA)
        out.data[o + 2] = Math.round(sumB / sumA)
        out.data[o + 3] = Math.round(outA * 255)
      }
    }
  }
  return out
}

export interface SolidBgMatteOptions {
  /** Expected studio solid background RGB (e.g. `[255, 255, 255]` or `[20, 24, 32]`). */
  expectedBgRgb?: [number, number, number]
  /** Color distance tolerance treated as pure background (default auto-adapted from corner noise, min 14). */
  tolerance?: number
  /** Smooth alpha transition band width in RGB Euclidean units (default 26). */
  feather?: number
  /** Allow punching out a large uniform interior window (> 22% area) for hollow `frame` skins. */
  allowHollowCenter?: boolean
}

function smoothstep01(e0: number, e1: number, x: number): number {
  if (x <= e0) return 0
  if (x >= e1) return 1
  const t = (x - e0) / (e1 - e0)
  return t * t * (3 - 2 * t)
}

/**
 * Samples `patchSize × patchSize` patches at all 4 image corners (`bggg-creator-image2psd` `corner_color`)
 * to estimate the actual solid background RGB produced by an image generation model (which often outputs
 * `(252, 252, 250)` instead of exact `(255, 255, 255)`).
 */
export function sampleCornerBackgroundRgb(
  img: RgbaImage,
  patchSize = 12
): { bgRgb: [number, number, number]; cornerNoise: number } {
  const { width: W, height: H } = img
  const p = Math.max(1, Math.min(patchSize, Math.floor(Math.min(W, H) * 0.18)))
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  const corners: Array<[number, number]> = [
    [0, 0],
    [Math.max(0, W - p), 0],
    [0, Math.max(0, H - p)],
    [Math.max(0, W - p), Math.max(0, H - p)]
  ]

  for (const [cx, cy] of corners) {
    for (let y = cy; y < Math.min(H, cy + p); y++) {
      for (let x = cx; x < Math.min(W, cx + p); x++) {
        const i = (y * W + x) * 4
        if (img.data[i + 3]! < 32) continue
        rs.push(img.data[i]!)
        gs.push(img.data[i + 1]!)
        bs.push(img.data[i + 2]!)
      }
    }
  }

  const bgRgb: [number, number, number] = rs.length
    ? [median(rs), median(gs), median(bs)]
    : [255, 255, 255]

  const dists: number[] = []
  for (let k = 0; k < rs.length; k++) {
    dists.push(Math.hypot(rs[k]! - bgRgb[0], gs[k]! - bgRgb[1], bs[k]! - bgRgb[2]))
  }
  dists.sort((a, b) => a - b)
  const p90Idx = dists.length ? Math.min(dists.length - 1, Math.floor(dists.length * 0.9)) : 0
  return {
    bgRgb,
    cornerNoise: dists.length ? dists[p90Idx]! : 0
  }
}

/**
 * Picks `#FFFFFF` studio background by default (`bggg-creator-image2psd` standard), automatically
 * switching to dark `#141820` when the UI control itself has a pale/white/silver outer border.
 */
export function choosePurificationStudioBg(exemplar: RgbaImage): {
  bgHex: '#FFFFFF' | '#141820'
  bgRgb: [number, number, number]
} {
  const { width: W, height: H } = exemplar
  const rx = Math.max(2, Math.round(W * 0.18))
  const ry = Math.max(2, Math.round(H * 0.18))
  let count = 0
  let lumSum = 0
  let nearWhiteCount = 0

  for (let y = 0; y < H; y++) {
    const borderY = y < ry || y >= H - ry
    for (let x = 0; x < W; x++) {
      if (!borderY && x >= rx && x < W - rx) continue
      const i = (y * W + x) * 4
      if (exemplar.data[i + 3]! < 48) continue
      const r = exemplar.data[i]!
      const g = exemplar.data[i + 1]!
      const b = exemplar.data[i + 2]!
      count++
      lumSum += 0.2126 * r + 0.7152 * g + 0.0722 * b
      if (r >= 210 && g >= 210 && b >= 205) nearWhiteCount++
    }
  }

  if (count > 0 && (lumSum / count >= 200 || nearWhiteCount / count >= 0.22)) {
    return { bgHex: '#141820', bgRgb: [20, 24, 32] }
  }
  return { bgHex: '#FFFFFF', bgRgb: [255, 255, 255] }
}

/**
 * Structure-protected solid-background-to-alpha extraction (`bggg-creator-image2psd`
 * `corner_color` + `preserve_light_foreground_to_alpha` + `background_to_alpha`):
 * 1. Estimates solid background RGB from the 4 corners.
 * 2. Builds a closed foreground structure silhouette and flood-fills exterior background from image
 *    borders (`fillHoles`) so white/pale/gold interior specular highlights stay 100% opaque (`alpha=255`).
 * 3. Analytically unmixes foreground RGB on the outer anti-aliased transition band (`(rgb - bg*(1-a))/a`)
 *    so zero white/dark edge halo remains, then tight-crops and applies 4px `bleedTransparentRgb`.
 */
export function extractCleanComponentMatteFromSolidBg(
  img: RgbaImage,
  options?: SolidBgMatteOptions
): RgbaImage | null {
  const { width: W, height: H } = img
  if (W < 8 || H < 8) return null
  const n = W * H

  let { bgRgb, cornerNoise } = sampleCornerBackgroundRgb(img)
  if (options?.expectedBgRgb) {
    const exp = options.expectedBgRgb
    const drift = Math.hypot(bgRgb[0] - exp[0], bgRgb[1] - exp[1], bgRgb[2] - exp[2])
    if (drift > 95) {
      // Corner touched foreground; sample 2px outer perimeter pixels closest to expected studio bg
      const nearRs: number[] = []
      const nearGs: number[] = []
      const nearBs: number[] = []
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (x >= 2 && x < W - 2 && y >= 2 && y < H - 2) continue
          const i = (y * W + x) * 4
          if (img.data[i + 3]! < 32) continue
          const d = Math.hypot(
            img.data[i]! - exp[0],
            img.data[i + 1]! - exp[1],
            img.data[i + 2]! - exp[2]
          )
          if (d <= 65) {
            nearRs.push(img.data[i]!)
            nearGs.push(img.data[i + 1]!)
            nearBs.push(img.data[i + 2]!)
          }
        }
      }
      bgRgb = nearRs.length >= 8 ? [median(nearRs), median(nearGs), median(nearBs)] : [...exp]
      cornerNoise = Math.min(cornerNoise, 8)
    }
  }

  const tol = Math.max(options?.tolerance ?? 14, Math.min(24, Math.ceil(cornerNoise + 5)))
  const feather = Math.max(8, options?.feather ?? 26)

  const dist = new Float32Array(n)
  const fgRaw = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (img.data[i + 3]! < 24) continue
    const d = Math.hypot(
      img.data[i]! - bgRgb[0],
      img.data[i + 1]! - bgRgb[1],
      img.data[i + 2]! - bgRgb[2]
    )
    dist[p] = d
    if (d > tol + 3) fgRaw[p] = 1
  }

  // 5x5 morphological close seals small pale/white highlight gaps on the outer control rim
  const closed = erodeMask(dilateMask(fgRaw, W, H, 2), W, H, 2)
  const { labels, stats } = labelComponents(closed, W, H)
  if (!stats.length) return null

  const centerBox: PixelRect = {
    left: Math.floor(W * 0.14),
    top: Math.floor(H * 0.14),
    width: Math.max(1, Math.ceil(W * 0.72)),
    height: Math.max(1, Math.ceil(H * 0.72))
  }
  const largestArea = stats.reduce((m, s) => Math.max(m, s.area), 0)
  const minKeepArea = Math.max(12, Math.round(n * 0.0012))
  const keepLabel = new Uint8Array(stats.length + 1)
  for (const s of stats) {
    const sr: PixelRect = {
      left: s.minX,
      top: s.minY,
      width: s.maxX - s.minX + 1,
      height: s.maxY - s.minY + 1
    }
    if (
      (s.area >= minKeepArea && rectIntersection(sr, centerBox) > 0) ||
      s.area >= largestArea * 0.35
    ) {
      keepLabel[s.label] = 1
    }
  }

  const fgBody = new Uint8Array(n)
  let fgCount = 0
  let bMinX = W
  let bMinY = H
  let bMaxX = -1
  let bMaxY = -1
  for (let p = 0; p < n; p++) {
    const lbl = labels[p]!
    if (lbl && keepLabel[lbl]) {
      fgBody[p] = 1
      fgCount++
      const x = p % W
      const y = (p - x) / W
      if (x < bMinX) bMinX = x
      if (x > bMaxX) bMaxX = x
      if (y < bMinY) bMinY = y
      if (y > bMaxY) bMaxY = y
    }
  }
  if (fgCount < 16 || bMaxX < bMinX || bMaxY < bMinY) return null

  // Exterior flood-fill (`fillHoles`): every enclosed interior cavity stays opaque (`silhouette = 1`)
  const silhouette = fillHoles(fgBody, W, H)

  // Only for hollow `frame` skins: allow genuinely large uniform empty center windows (>= 22% bbox area)
  if (options?.allowHollowCenter) {
    const bboxArea = Math.max(1, (bMaxX - bMinX + 1) * (bMaxY - bMinY + 1))
    const cavity = new Uint8Array(n)
    for (let p = 0; p < n; p++) {
      if (silhouette[p] && !fgBody[p] && dist[p]! <= tol + 4) cavity[p] = 1
    }
    const cavComp = labelComponents(cavity, W, H)
    const punchLabel = new Uint8Array(cavComp.stats.length + 1)
    for (const cs of cavComp.stats) {
      if (cs.area >= bboxArea * 0.22) punchLabel[cs.label] = 1
    }
    for (let p = 0; p < n; p++) {
      const cl = cavComp.labels[p]!
      if (cl && punchLabel[cl]) silhouette[p] = 0
    }
  }

  const coreInterior = erodeMask(silhouette, W, H, 2)
  const outerBand = dilateMask(silhouette, W, H, 2)
  const matte = createImage(W, H)

  let minX = W
  let minY = H
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < H; y++) {
    const row = y * W
    for (let x = 0; x < W; x++) {
      const p = row + x
      if (!outerBand[p]) continue
      const i = p * 4
      const srcA = img.data[i + 3]! / 255
      if (srcA < 0.02) continue

      if (coreInterior[p]) {
        // Protected interior: preserve 100% opacity & exact RGB (white/gold specular highlights intact!)
        matte.data[i] = img.data[i]!
        matte.data[i + 1] = img.data[i + 1]!
        matte.data[i + 2] = img.data[i + 2]!
        matte.data[i + 3] = Math.round(srcA * 255)
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        continue
      }

      const d = dist[p]!
      if (d <= tol * 0.55) continue

      // Sample nearest solid `coreInterior` foreground neighbor (within 3px) to solve exact sub-pixel
      // Porter-Duff linear coverage `obs = fg * a + bg * (1 - a)` along the vector `(fg - bg)`.
      let fgSumR = 0
      let fgSumG = 0
      let fgSumB = 0
      let fgCnt = 0
      for (let dy = -3; dy <= 3; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= H) continue
        const nRow = ny * W
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= W) continue
          const np = nRow + nx
          if (!coreInterior[np]) continue
          const ni = np * 4
          fgSumR += img.data[ni]!
          fgSumG += img.data[ni + 1]!
          fgSumB += img.data[ni + 2]!
          fgCnt++
        }
      }

      let baseAlpha: number
      if (fgCnt > 0) {
        const vr = fgSumR / fgCnt - bgRgb[0]
        const vg = fgSumG / fgCnt - bgRgb[1]
        const vb = fgSumB / fgCnt - bgRgb[2]
        const vLen2 = vr * vr + vg * vg + vb * vb
        if (vLen2 >= 400) {
          const ur = img.data[i]! - bgRgb[0]
          const ug = img.data[i + 1]! - bgRgb[1]
          const ub = img.data[i + 2]! - bgRgb[2]
          const proj = Math.max(0, Math.min(1, (ur * vr + ug * vg + ub * vb) / vLen2))
          const perp = Math.hypot(ur - proj * vr, ug - proj * vg, ub - proj * vb)
          if (perp <= 28) {
            baseAlpha = proj
          } else {
            baseAlpha = Math.max(0, Math.min(1, (d - tol * 0.6) / feather))
          }
        } else {
          baseAlpha = silhouette[p] ? 1 : Math.max(0, Math.min(1, (d - tol * 0.6) / feather))
        }
      } else {
        const rawAlpha = Math.max(0, Math.min(1, (d - tol * 0.6) / feather))
        baseAlpha = silhouette[p]
          ? Math.max(rawAlpha, Math.max(0, Math.min(1, (d - tol * 0.3) / (feather * 0.8))))
          : rawAlpha * 0.92
      }

      const ea = baseAlpha * srcA
      if (ea < 0.03) continue

      let trust = smoothstep01(0.05, 0.32, ea)
      if (silhouette[p] && d <= tol + feather * 0.35) {
        trust *= 0.35
      }
      for (let c = 0; c < 3; c++) {
        const sc = img.data[i + c]!
        const solved = Math.max(0, Math.min(255, (sc - bgRgb[c]! * (1 - ea)) / Math.max(0.05, ea)))
        matte.data[i + c] = Math.round(solved * trust + sc * (1 - trust))
      }
      const outA = Math.round(ea * 255)
      matte.data[i + 3] = outA
      if (outA >= 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < minX || maxY < minY) return null
  const cropped = cropImage(matte, {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  })
  if (cropped.width < 8 || cropped.height < 8) return null
  bleedTransparentRgb(cropped.data, cropped.width, cropped.height, 4)
  return cropped
}

export interface SolidBgCanvasLayerOptions {
  /** Maximum corner noise to classify the image as having a uniform studio background (default 15). */
  maxCornerNoise?: number
  /** Minimum fraction of 2px perimeter matching the sampled corner background (default 0.62). */
  minPerimeterBgRatio?: number
  tolerance?: number
  feather?: number
  /** Punch large enclosed solid-bg windows (e.g. hollow frames). Default true. */
  allowLargeHollowWindows?: boolean
}

export interface ExtractedSolidBgCanvasLayer {
  cropped: RgbaImage
  box: PixelRect
  bgRgb: [number, number, number]
  cornerNoise: number
}

/**
 * Full-canvas / region solid-background-to-alpha matting (`bggg-creator-image2psd` `white-preserve`
 * mode for AI-emitted layers). Automatically skips layers that already carry genuine alpha
 * transparency or full-bleed heterogeneous backgrounds, while stripping uniform white / dark /
 * colored studio backgrounds without punching holes inside pale or white foreground interiors,
 * and returning the exact tight canvas bounding box `box` so layer coordinates never drift.
 */
export function extractCleanLayerFromSolidBgCanvas(
  img: RgbaImage,
  options?: SolidBgCanvasLayerOptions
): ExtractedSolidBgCanvasLayer | null {
  const { width: W, height: H } = img
  if (W < 8 || H < 8) return null
  const n = W * H

  // 1) Skip images that already carry genuine alpha transparency in corners or along the perimeter
  const cornerPatch = Math.min(3, Math.max(1, Math.floor(Math.min(W, H) * 0.08)))
  let cornerTotal = 0
  let cornerTransparent = 0
  for (const [ox, oy] of [
    [0, 0],
    [W - cornerPatch, 0],
    [0, H - cornerPatch],
    [W - cornerPatch, H - cornerPatch]
  ] as const) {
    for (let dy = 0; dy < cornerPatch; dy++) {
      for (let dx = 0; dx < cornerPatch; dx++) {
        cornerTotal++
        if (img.data[((oy + dy) * W + (ox + dx)) * 4 + 3]! < 200) cornerTransparent++
      }
    }
  }
  if (cornerTotal > 0 && cornerTransparent / cornerTotal >= 0.1) return null

  let perimTotal = 0
  let perimTransparent = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x >= 2 && x < W - 2 && y >= 2 && y < H - 2) continue
      perimTotal++
      if (img.data[(y * W + x) * 4 + 3]! < 200) perimTransparent++
    }
  }
  if (perimTotal > 0 && perimTransparent / perimTotal > 0.08) return null

  // 2) Require uniform solid background across corners + majority of outer perimeter
  const { bgRgb, cornerNoise } = sampleCornerBackgroundRgb(img)
  const maxCornerNoise = options?.maxCornerNoise ?? 15
  if (cornerNoise > maxCornerNoise) return null

  const tol = Math.max(options?.tolerance ?? 14, Math.min(24, Math.ceil(cornerNoise + 5)))
  const feather = Math.max(8, options?.feather ?? 26)

  let perimBgMatch = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x >= 2 && x < W - 2 && y >= 2 && y < H - 2) continue
      const i = (y * W + x) * 4
      const d = Math.hypot(
        img.data[i]! - bgRgb[0],
        img.data[i + 1]! - bgRgb[1],
        img.data[i + 2]! - bgRgb[2]
      )
      if (d <= tol + 8) perimBgMatch++
    }
  }
  const minPerimRatio = options?.minPerimeterBgRatio ?? 0.62
  if (perimTotal > 0 && perimBgMatch / perimTotal < minPerimRatio) return null

  const dist = new Float32Array(n)
  const fgRaw = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (img.data[i + 3]! < 24) continue
    const d = Math.hypot(
      img.data[i]! - bgRgb[0],
      img.data[i + 1]! - bgRgb[1],
      img.data[i + 2]! - bgRgb[2]
    )
    dist[p] = d
    if (d > tol + 3) fgRaw[p] = 1
  }

  const closed = erodeMask(dilateMask(fgRaw, W, H, 2), W, H, 2)
  const { labels, stats } = labelComponents(closed, W, H)
  if (!stats.length) return null

  const minKeepArea = Math.max(8, Math.round(n * 0.00035))
  const keepLabel = new Uint8Array(stats.length + 1)
  for (const s of stats) {
    if (s.area >= minKeepArea) keepLabel[s.label] = 1
  }

  const fgBody = new Uint8Array(n)
  let fgCount = 0
  let bMinX = W
  let bMinY = H
  let bMaxX = -1
  let bMaxY = -1
  for (let p = 0; p < n; p++) {
    const lbl = labels[p]!
    if (lbl && keepLabel[lbl]) {
      fgBody[p] = 1
      fgCount++
      const x = p % W
      const y = (p - x) / W
      if (x < bMinX) bMinX = x
      if (x > bMaxX) bMaxX = x
      if (y < bMinY) bMinY = y
      if (y > bMaxY) bMaxY = y
    }
  }
  if (fgCount < 12 || fgCount > n * 0.88 || bMaxX < bMinX || bMaxY < bMinY) return null

  // Exterior flood-fill (`white-preserve` cavity protection): enclosed highlights/text stay solid
  const silhouette = fillHoles(fgBody, W, H)

  // Allow genuinely large empty window cavities inside hollow frames (>= 32% of foreground bbox)
  if (options?.allowLargeHollowWindows !== false) {
    const bboxArea = Math.max(1, (bMaxX - bMinX + 1) * (bMaxY - bMinY + 1))
    const cavity = new Uint8Array(n)
    for (let p = 0; p < n; p++) {
      if (silhouette[p] && !fgBody[p] && dist[p]! <= tol + 2) cavity[p] = 1
    }
    const cavComp = labelComponents(cavity, W, H)
    const punchLabel = new Uint8Array(cavComp.stats.length + 1)
    for (const cs of cavComp.stats) {
      if (cs.area >= bboxArea * 0.32) punchLabel[cs.label] = 1
    }
    for (let p = 0; p < n; p++) {
      const cl = cavComp.labels[p]!
      if (cl && punchLabel[cl]) silhouette[p] = 0
    }
  }

  const coreInterior = erodeMask(silhouette, W, H, 2)
  const outerBand = dilateMask(silhouette, W, H, 2)
  const matte = createImage(W, H)

  let minX = W
  let minY = H
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < H; y++) {
    const row = y * W
    for (let x = 0; x < W; x++) {
      const p = row + x
      if (!outerBand[p]) continue
      const i = p * 4
      const srcA = img.data[i + 3]! / 255
      if (srcA < 0.02) continue

      if (coreInterior[p]) {
        matte.data[i] = img.data[i]!
        matte.data[i + 1] = img.data[i + 1]!
        matte.data[i + 2] = img.data[i + 2]!
        matte.data[i + 3] = Math.round(srcA * 255)
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        continue
      }

      const d = dist[p]!
      if (d <= tol * 0.55) continue

      let fgSumR = 0
      let fgSumG = 0
      let fgSumB = 0
      let fgCnt = 0
      for (let dy = -3; dy <= 3; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= H) continue
        const nRow = ny * W
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= W) continue
          const np = nRow + nx
          if (!coreInterior[np]) continue
          const ni = np * 4
          fgSumR += img.data[ni]!
          fgSumG += img.data[ni + 1]!
          fgSumB += img.data[ni + 2]!
          fgCnt++
        }
      }

      let baseAlpha: number
      if (fgCnt > 0) {
        const vr = fgSumR / fgCnt - bgRgb[0]
        const vg = fgSumG / fgCnt - bgRgb[1]
        const vb = fgSumB / fgCnt - bgRgb[2]
        const vLen2 = vr * vr + vg * vg + vb * vb
        if (vLen2 >= 400) {
          const ur = img.data[i]! - bgRgb[0]
          const ug = img.data[i + 1]! - bgRgb[1]
          const ub = img.data[i + 2]! - bgRgb[2]
          const proj = Math.max(0, Math.min(1, (ur * vr + ug * vg + ub * vb) / vLen2))
          const perp = Math.hypot(ur - proj * vr, ug - proj * vg, ub - proj * vb)
          if (perp <= 28) {
            baseAlpha = proj
          } else {
            baseAlpha = Math.max(0, Math.min(1, (d - tol * 0.6) / feather))
          }
        } else {
          baseAlpha = silhouette[p] ? 1 : Math.max(0, Math.min(1, (d - tol * 0.6) / feather))
        }
      } else {
        const rawAlpha = Math.max(0, Math.min(1, (d - tol * 0.6) / feather))
        baseAlpha = silhouette[p]
          ? Math.max(rawAlpha, Math.max(0, Math.min(1, (d - tol * 0.3) / (feather * 0.8))))
          : rawAlpha * 0.92
      }

      const ea = baseAlpha * srcA
      if (ea < 0.03) continue

      let trust = smoothstep01(0.05, 0.32, ea)
      if (silhouette[p] && d <= tol + feather * 0.35) {
        trust *= 0.35
      }
      for (let c = 0; c < 3; c++) {
        const sc = img.data[i + c]!
        const solved = Math.max(0, Math.min(255, (sc - bgRgb[c]! * (1 - ea)) / Math.max(0.05, ea)))
        matte.data[i + c] = Math.round(solved * trust + sc * (1 - trust))
      }
      const outA = Math.round(ea * 255)
      matte.data[i + 3] = outA
      if (outA >= 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < minX || maxY < minY) return null
  const box: PixelRect = {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  }
  if (box.width < 6 || box.height < 6) return null
  const cropped = cropImage(matte, box)
  bleedTransparentRgb(cropped.data, cropped.width, cropped.height, 4)
  return { cropped, box, bgRgb, cornerNoise }
}

export interface DetectedComponentFamilyEntry {
  id: string
  name: string
  kind: UiElementKind
  exemplarBox: PixelRect
  instanceBoxes: PixelRect[]
  hasEmbeddedContent: boolean
  embeddedContentDesc?: string
  skinDesc?: string
}

function parseJsonObjectOrArray(raw: string): unknown {
  const trimmed = raw?.trim() ?? ''
  if (!trimmed) return null
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  const body = fence ? fence[1]!.trim() : trimmed
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s)
    } catch {
      return undefined
    }
  }
  const direct = tryParse(body)
  if (direct !== undefined) return direct
  const o0 = body.indexOf('{')
  const o1 = body.lastIndexOf('}')
  if (o0 >= 0 && o1 > o0) {
    const obj = tryParse(body.slice(o0, o1 + 1))
    if (obj !== undefined) return obj
  }
  const a0 = body.indexOf('[')
  const a1 = body.lastIndexOf(']')
  if (a0 >= 0 && a1 > a0) {
    const arr = tryParse(body.slice(a0, a1 + 1))
    if (arr !== undefined) return arr
  }
  return null
}

function parseBox2dOrBbox(raw: unknown, width: number, height: number): PixelRect | null {
  if (!Array.isArray(raw) || raw.length < 4) return null
  const [v0, v1, v2, v3] = raw.slice(0, 4).map(Number) as [number, number, number, number]
  if (![v0, v1, v2, v3].every(Number.isFinite)) return null
  // `box_2d` convention across VLM prompts is `[ymin, xmin, ymax, xmax]` in `0..1000` (or `0..1`)
  const maxV = Math.max(v0, v1, v2, v3)
  const sx = maxV <= 1.05 ? width : maxV <= 1000.5 ? width / 1000 : 1
  const sy = maxV <= 1.05 ? height : maxV <= 1000.5 ? height / 1000 : 1
  const x0 = Math.min(v1, v3) * sx
  const x1 = Math.max(v1, v3) * sx
  const y0 = Math.min(v0, v2) * sy
  const y1 = Math.max(v0, v2) * sy
  if (x1 - x0 < 12 || y1 - y0 < 12) return null
  return clampRect({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }, width, height)
}

/**
 * Parses the VLM reusable component catalog response into validated pixel-space component families,
 * filtering out non-component kinds (`text`, `avatar`, `icon`, `illustration`, full-screen backdrops).
 */
export function parseComponentCatalogResponse(
  raw: string,
  width: number,
  height: number,
  maxFamilies = 20
): DetectedComponentFamilyEntry[] {
  const parsed = parseJsonObjectOrArray(raw)
  let list: unknown[] = []
  if (Array.isArray(parsed)) {
    list = parsed
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    const arr =
      (Array.isArray(obj.components) && obj.components) ||
      (Array.isArray(obj.families) && obj.families) ||
      (Array.isArray(obj.items) && obj.items) ||
      (Array.isArray(obj.elements) && obj.elements) ||
      Object.values(obj).find((v) => Array.isArray(v))
    list = Array.isArray(arr) ? arr : []
  }

  const canvasArea = Math.max(1, width * height)
  const out: DetectedComponentFamilyEntry[] = []
  for (let idx = 0; idx < list.length && out.length < maxFamilies; idx++) {
    const entry = list[idx]
    if (!entry || typeof entry !== 'object') continue
    const rec = entry as Record<string, unknown>
    let kind = normalizeElementKind(rec.kind ?? rec.type ?? rec.controlType)
    const rawName = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : ''
    if (kind === 'other' && rawName) {
      kind = inferComponentKindFromLabel(rawName)
    }
    if (NON_COMPONENT_KINDS.has(kind) || kind === 'other') continue

    const rawInstList = Array.isArray(rec.instance_boxes_2d)
      ? rec.instance_boxes_2d
      : Array.isArray(rec.instanceBoxes2d)
        ? rec.instanceBoxes2d
        : Array.isArray(rec.instances)
          ? rec.instances.map((it) =>
              it && typeof it === 'object' ? (it as Record<string, unknown>).box_2d : it
            )
          : []
    const parsedInstances: PixelRect[] = []
    for (const rawBox of rawInstList) {
      const b = parseBox2dOrBbox(rawBox, width, height)
      if (!b) continue
      if (rectArea(b) > canvasArea * 0.5) continue
      const dup = parsedInstances.some((prev) => {
        const inter = rectIntersection(prev, b)
        const union = rectArea(prev) + rectArea(b) - inter
        return union > 0 && inter / union > 0.72
      })
      if (!dup) parsedInstances.push(b)
    }

    const exemplarRaw =
      rec.exemplar_box_2d ?? rec.exemplarBox2d ?? rec.box_2d ?? rec.box2d ?? rawInstList[0]
    const exemplarBox = parseBox2dOrBbox(exemplarRaw, width, height) ?? parsedInstances[0] ?? null
    if (!exemplarBox) continue
    if (rectArea(exemplarBox) > canvasArea * (kind === 'panel' ? 0.42 : 0.5)) continue

    if (
      !parsedInstances.some((prev) => {
        const inter = rectIntersection(prev, exemplarBox)
        const union = rectArea(prev) + rectArea(exemplarBox) - inter
        return union > 0 && inter / union > 0.72
      })
    ) {
      parsedInstances.unshift(exemplarBox)
    }

    const embeddedDesc =
      typeof rec.embedded_content_desc === 'string'
        ? rec.embedded_content_desc.trim()
        : typeof rec.embeddedContentDesc === 'string'
          ? rec.embeddedContentDesc.trim()
          : ''
    const skinDesc =
      typeof rec.skin_desc === 'string'
        ? rec.skin_desc.trim()
        : typeof rec.skinDesc === 'string'
          ? rec.skinDesc.trim()
          : ''
    const hasEmbedded =
      typeof rec.has_embedded_content === 'boolean'
        ? rec.has_embedded_content
        : typeof rec.hasEmbeddedContent === 'boolean'
          ? rec.hasEmbeddedContent
          : Boolean(embeddedDesc)

    out.push({
      id:
        typeof rec.id === 'string' && rec.id.trim()
          ? rec.id.trim()
          : `fam_${kind}_${out.length + 1}`,
      name: (rawName || `${kind} ${out.length + 1}`).slice(0, 48),
      kind,
      exemplarBox,
      instanceBoxes: parsedInstances,
      hasEmbeddedContent: hasEmbedded,
      ...(embeddedDesc ? { embeddedContentDesc: embeddedDesc.slice(0, 140) } : {}),
      ...(skinDesc ? { skinDesc: skinDesc.slice(0, 180) } : {})
    })
  }
  return out
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
    minScore = 0.72,
    allowMasklessBoxMatch = false
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
        const obsOpaque = allowMasklessBoxMatch ? compOpaque : detectedMask[p] === 1
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

    const maxAllowedMae = allowMasklessBoxMatch ? (explicitHint ? 26 : 22) : explicitHint ? 31 : 27
    const maxAllowedBorderMae = allowMasklessBoxMatch
      ? explicitHint
        ? 27
        : 23
      : explicitHint
        ? 33
        : 29
    const maxAllowedChroma = allowMasklessBoxMatch
      ? explicitHint
        ? 23
        : 19
      : explicitHint
        ? 28
        : 24
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
  canvasArea: number
  layer: PreciseSplitLayer
  rgba: RgbaImage
  /** 1 = unobstructed valid pixel for matching/median fusion */
  knownMask: Uint8Array
  /** 1 = valid pixel NOT occluded by non-text child cutouts (avoids destructive push-pull over already de-texted glyphs) */
  repairMask: Uint8Array
  /** Interior high-frequency clutter score (lower = cleaner/emptier interior) */
  clutterScore: number
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
 * Measures interior visual clutter (mean horizontal/vertical RGB gradient inside the central 56% box
 * plus occlusion penalty) so empty/clean component exemplars always sort ahead of icon-filled ones.
 */
function computeInteriorClutterScore(img: RgbaImage, knownMask: Uint8Array): number {
  const { width: w, height: h } = img
  const x0 = Math.max(1, Math.floor(w * 0.22))
  const x1 = Math.min(w - 1, Math.ceil(w * 0.78))
  const y0 = Math.max(1, Math.floor(h * 0.22))
  const y1 = Math.min(h - 1, Math.ceil(h * 0.78))
  if (x1 <= x0 || y1 <= y0) return 0

  let gradSum = 0
  let count = 0
  let occluded = 0
  let total = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * w + x
      total++
      if (!knownMask[p]) {
        occluded++
        continue
      }
      const i = p * 4
      if (img.data[i + 3]! < 32) continue
      const ir = (p - 1) * 4
      const iu = (p - w) * 4
      const gx =
        (Math.abs(img.data[i]! - img.data[ir]!) +
          Math.abs(img.data[i + 1]! - img.data[ir + 1]!) +
          Math.abs(img.data[i + 2]! - img.data[ir + 2]!)) /
        3
      const gy =
        (Math.abs(img.data[i]! - img.data[iu]!) +
          Math.abs(img.data[i + 1]! - img.data[iu + 1]!) +
          Math.abs(img.data[i + 2]! - img.data[iu + 2]!)) /
        3
      gradSum += (gx + gy) * 0.5
      count++
    }
  }
  const meanGrad = count > 0 ? gradSum / count : 0
  const occludedPenalty = total > 0 ? (occluded / total) * 18 : 0
  return meanGrad + occludedPenalty
}

/**
 * Fuses N instances of a UI component into a single clean, de-texted, de-occluded canonical master RGBA:
 * - Orders samples from cleanest least-cluttered interior to most cluttered
 * - Warps each instance and its unobstructed mask to canonical median dimensions
 * - Excludes unseparated interior icons/art-text in cluttered instances when a clean exemplar exists
 * - Preserves single-sample interiors untouched unless explicit non-text cutout holes require repair
 */
function fuseClusterMasterRgba(samples: readonly ExtractedInstanceSample[]): {
  master: RgbaImage
  canonicalWidth: number
  canonicalHeight: number
} {
  const ordered = [...samples].sort((a, b) => a.clutterScore - b.clutterScore)
  const widths = ordered.map((s) => s.rgba.width).sort((a, b) => a - b)
  const heights = ordered.map((s) => s.rgba.height).sort((a, b) => a - b)
  const canonicalWidth = Math.max(8, medianOfSorted(widths))
  const canonicalHeight = Math.max(8, medianOfSorted(heights))

  if (ordered.length === 1) {
    const single = ordered[0]!
    const out =
      single.rgba.width === canonicalWidth && single.rgba.height === canonicalHeight
        ? cloneImage(single.rgba)
        : resizeBilinear(single.rgba, canonicalWidth, canonicalHeight)
    const warpedRepair = resizeBinaryMaskNearest(
      single.repairMask,
      single.rgba.width,
      single.rgba.height,
      canonicalWidth,
      canonicalHeight
    )
    repairResidualOccludedHoles(out, warpedRepair)
    return { master: out, canonicalWidth, canonicalHeight }
  }

  const warpedImgs = ordered.map((s) =>
    s.rgba.width === canonicalWidth && s.rgba.height === canonicalHeight
      ? s.rgba
      : resizeBilinear(s.rgba, canonicalWidth, canonicalHeight)
  )
  const warpedKnowns = ordered.map((s) =>
    resizeBinaryMaskNearest(
      s.knownMask,
      s.rgba.width,
      s.rgba.height,
      canonicalWidth,
      canonicalHeight
    )
  )
  const warpedRepairs = ordered.map((s) =>
    resizeBinaryMaskNearest(
      s.repairMask,
      s.rgba.width,
      s.rgba.height,
      canonicalWidth,
      canonicalHeight
    )
  )

  // If the cleanest exemplar has a calm uniform/gradient interior while sibling instances hold
  // unseparated item icons (high interior clutter), suppress high-deviation interior pixels in cluttered siblings.
  const cleanest = warpedImgs[0]!
  const cleanestKnown = warpedKnowns[0]!
  const cleanClutter = ordered[0]!.clutterScore
  const ix0 = Math.floor(canonicalWidth * 0.22)
  const ix1 = Math.ceil(canonicalWidth * 0.78)
  const iy0 = Math.floor(canonicalHeight * 0.22)
  const iy1 = Math.ceil(canonicalHeight * 0.78)
  for (let k = 1; k < warpedImgs.length; k++) {
    if (ordered[k]!.clutterScore <= cleanClutter + 8) continue
    const wk = warpedKnowns[k]!
    const imgK = warpedImgs[k]!
    for (let y = iy0; y < iy1; y++) {
      const row = y * canonicalWidth
      for (let x = ix0; x < ix1; x++) {
        const p = row + x
        if (!cleanestKnown[p] || !wk[p]) continue
        const i = p * 4
        const diff =
          (Math.abs(imgK.data[i]! - cleanest.data[i]!) +
            Math.abs(imgK.data[i + 1]! - cleanest.data[i + 1]!) +
            Math.abs(imgK.data[i + 2]! - cleanest.data[i + 2]!)) /
          3
        if (diff > 26) wk[p] = 0
      }
    }
  }

  const master = createImage(canonicalWidth, canonicalHeight)
  const fusedRepair = new Uint8Array(canonicalWidth * canonicalHeight)
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
      fusedRepair[p] = 1
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
      let anyCleanDeTexted = false
      for (let k = 0; k < warpedRepairs.length; k++) {
        if (warpedRepairs[k]![p]) {
          anyCleanDeTexted = true
          break
        }
      }
      if (anyCleanDeTexted) fusedRepair[p] = 1
      for (let k = 0; k < warpedImgs.length; k++) {
        if (anyCleanDeTexted && !warpedRepairs[k]![p]) continue
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
      if (as.length > 0) {
        as.sort((a, b) => a - b)
        master.data[o + 3] = medianOfSorted(as)
      }
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

  repairResidualOccludedHoles(master, fusedRepair)
  bleedTransparentRgb(master.data, canonicalWidth, canonicalHeight, 3)
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

/**
 * Matches two UI skin instances by their outer 22% border frame ring so slots holding different
 * item icons or buttons with different embedded art-text still cluster into one shared component.
 */
function samplesMatchByBorderRing(
  a: ExtractedInstanceSample,
  b: ExtractedInstanceSample,
  scalePolicy: UiComponentScalePolicy,
  bNine?: readonly [number, number, number, number]
): boolean {
  if (
    !BORDER_RING_CLUSTERABLE_KINDS.has(a.layer.kind) &&
    !BORDER_RING_CLUSTERABLE_KINDS.has(b.layer.kind)
  ) {
    return false
  }
  const w = a.rgba.width
  const h = a.rgba.height
  if (w < 18 || h < 18) return false

  const renderedB = renderComponentToRect(b.rgba, w, h, scalePolicy, bNine)
  const rx = Math.max(3, Math.min(18, Math.round(w * 0.22)))
  const ry = Math.max(3, Math.min(18, Math.round(h * 0.22)))

  let ringInter = 0
  let ringUnion = 0
  let chromaSum = 0
  const ringErrors: number[] = []

  for (let y = 0; y < h; y++) {
    const borderY = y < ry || y >= h - ry
    for (let x = 0; x < w; x++) {
      if (!borderY && x >= rx && x < w - rx) continue
      const p = y * w + x
      if (!a.knownMask[p]) continue
      const i = p * 4
      const opA = a.rgba.data[i + 3]! >= 48
      const opB = renderedB.data[i + 3]! >= 48
      if (opA && opB) ringInter++
      if (opA || opB) ringUnion++
      if (a.rgba.data[i + 3]! >= 96 && renderedB.data[i + 3]! >= 96) {
        const r1 = a.rgba.data[i]!
        const g1 = a.rgba.data[i + 1]!
        const b1 = a.rgba.data[i + 2]!
        const r2 = renderedB.data[i]!
        const g2 = renderedB.data[i + 1]!
        const b2 = renderedB.data[i + 2]!
        ringErrors.push((Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)) / 3)
        chromaSum += (Math.abs(r1 - g1 - (r2 - g2)) + Math.abs(g1 - b1 - (g2 - b2))) * 0.5
      }
    }
  }

  if (ringUnion < 16 || ringErrors.length < 16) return false
  if (ringInter / ringUnion < 0.78) return false

  ringErrors.sort((x, y) => x - y)
  const trimCnt = Math.max(8, Math.floor(ringErrors.length * 0.85))
  let sum = 0
  for (let k = 0; k < trimCnt; k++) sum += ringErrors[k]!
  const trimmedRingMae = sum / trimCnt
  const chromaMae = chromaSum / ringErrors.length
  return trimmedRingMae <= 19 && chromaMae <= 16
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
  if (match !== null) return true

  return samplesMatchByBorderRing(a, b, scalePolicy, bNine)
}

function buildMasksForSplitLayer(
  target: PreciseSplitLayer,
  allLayers: readonly PreciseSplitLayer[]
): { knownMask: Uint8Array; repairMask: Uint8Array } {
  const w = Math.max(1, target.width)
  const h = Math.max(1, target.height)
  const n = w * h
  const knownMask = new Uint8Array(n)
  const repairMask = new Uint8Array(n)
  knownMask.fill(1)
  repairMask.fill(1)

  if (target.knownMask && target.knownMask.length === n) {
    for (let p = 0; p < n; p++) {
      if (!target.knownMask[p]) {
        knownMask[p] = 0
        repairMask[p] = 0
      }
    }
  }

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
      let hasGlyphAlpha = false
      const glyphHits = new Uint8Array(n)
      for (let y = oy0; y < oy1; y++) {
        const ty = y - target.top
        const uy = y - upper.top
        for (let x = ox0; x < ox1; x++) {
          const ux = x - upper.left
          if (upper.rgba[(uy * upper.width + ux) * 4 + 3]! >= 16) {
            glyphHits[ty * w + (x - target.left)] = 1
            hasGlyphAlpha = true
          }
        }
      }
      if (hasGlyphAlpha) {
        const dilated = dilateMask(glyphHits, w, h, 2)
        for (let p = 0; p < n; p++) {
          if (dilated[p]) knownMask[p] = 0
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
          const idx = ty * w + (x - target.left)
          knownMask[idx] = 0
          if (target.rgba[idx * 4 + 3]! < 32) {
            repairMask[idx] = 0
          }
        }
      }
    }
  }

  return { knownMask, repairMask }
}

/**
 * Extracts canonical, de-texted, de-occluded shared UI components across 1 or N `PreciseSplitResult` screens.
 */
export function extractSharedComponentsFromSplitResults(
  screens: ReadonlyArray<{ split: PreciseSplitResult; title?: string }>,
  options?: ExtractSharedComponentsOptions
): PreciseSplitComponentCandidate[] {
  const maxComponents = Math.max(1, Math.min(128, options?.maxComponents ?? 64))
  const mode = options?.mode ?? 'auto'
  const includeSingletons = mode !== 'repeated'

  const samples: ExtractedInstanceSample[] = []
  for (let sIdx = 0; sIdx < screens.length; sIdx++) {
    const { split } = screens[sIdx]!
    const canvasArea = Math.max(1, split.canvasWidth * split.canvasHeight)
    for (const layer of split.layers) {
      if (layer.editableText || NON_COMPONENT_KINDS.has(layer.kind)) continue
      if (layer.width < 14 || layer.height < 14) continue
      if (layer.width * layer.height > canvasArea * 0.55) continue
      const rgba: RgbaImage = {
        width: layer.width,
        height: layer.height,
        data: new Uint8ClampedArray(layer.rgba)
      }
      const descriptor = computeComponentVisualDescriptor(rgba)
      if (descriptor.opaqueRatio < 0.06) continue
      const { knownMask, repairMask } = buildMasksForSplitLayer(layer, split.layers)
      const clutterScore = computeInteriorClutterScore(rgba, knownMask)
      samples.push({
        screenIndex: sIdx,
        canvasArea,
        layer,
        rgba,
        knownMask,
        repairMask,
        clutterScore,
        descriptor,
        ...(layer.prefabKey ? { prefabKey: layer.prefabKey } : {})
      })
    }
  }

  samples.sort((a, b) => a.clutterScore - b.clutterScore)

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

  const isEligibleSingleton = (s: ExtractedInstanceSample): boolean => {
    if (!REUSABLE_SINGLETON_KINDS.has(s.layer.kind)) return false
    const areaRatio = (s.rgba.width * s.rgba.height) / Math.max(1, s.canvasArea)
    if ((s.layer.kind === 'panel' || s.layer.kind === 'frame') && areaRatio > 0.4) return false
    return true
  }

  const rankClusters = (a: ExtractedInstanceSample[], b: ExtractedInstanceSample[]): number => {
    const aRep = a.length >= 2 ? 1 : 0
    const bRep = b.length >= 2 ? 1 : 0
    if (bRep !== aRep) return bRep - aRep
    if (b.length !== a.length) return b.length - a.length
    const prioDiff =
      componentKindPriority(b[0]!.layer.kind) - componentKindPriority(a[0]!.layer.kind)
    if (prioDiff !== 0) return prioDiff
    return a[0]!.clutterScore - b[0]!.clutterScore
  }

  const eligibleClusters = clusters
    .filter((c) => c.length >= 2 || (includeSingletons && isEligibleSingleton(c[0]!)))
    .sort(rankClusters)
    .slice(0, maxComponents)

  const finalClusters =
    eligibleClusters.length > 0
      ? eligibleClusters
      : clusters
          .filter((c) => isEligibleSingleton(c[0]!))
          .sort(rankClusters)
          .slice(0, maxComponents)

  const out: PreciseSplitComponentCandidate[] = []
  const kindCounters = new Map<string, number>()

  for (let idx = 0; idx < finalClusters.length; idx++) {
    const cluster = finalClusters[idx]!
    cluster.sort((a, b) => a.clutterScore - b.clutterScore)
    const rep = cluster[0]!
    const kind = rep.layer.kind
    const kindSeq = (kindCounters.get(kind) ?? 0) + 1
    kindCounters.set(kind, kindSeq)

    const { master, canonicalWidth, canonicalHeight } = fuseClusterMasterRgba(cluster)
    const nineSliceBorders = NINE_SLICE_ELIGIBLE_KINDS.has(kind)
      ? computeNineSliceFromRgbaBuffer(master.data, canonicalWidth, canonicalHeight)
      : undefined
    const scalePolicy: UiComponentScalePolicy = nineSliceBorders ? 'nine-slice' : 'uniform'
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

/**
 * Automatically discovers genuinely repeated (`>= 2` instances) UI control skins inside a single
 * `PreciseSplitResult` when no external upstream component library was wired, promotes clean
 * unified masters (preferring the lowest-clutter / empty instance via border-ring clustering),
 * and links matching layers as shared PSD Smart Object / 9-slice prefab instances.
 */
export function unifyRepeatedComponentsInSplitResult(
  split: PreciseSplitResult,
  options?: { maxComponents?: number }
): PreciseSplitComponentCandidate[] {
  const rawCandidates = extractSharedComponentsFromSplitResults([{ split }], {
    mode: 'repeated',
    maxComponents: options?.maxComponents ?? 16
  }).filter((c) => (c.item.sourceCount ?? 0) >= 2)
  if (!rawCandidates.length) return []

  const canvasArea = Math.max(1, split.canvasWidth * split.canvasHeight)
  const usedCandidates: PreciseSplitComponentCandidate[] = []

  for (const cand of rawCandidates) {
    const matches: Array<{
      layer: PreciseSplitLayer
      rendered: RgbaImage
      layerClutter: number
      masterClutter: number
    }> = []

    for (const layer of split.layers) {
      if (layer.componentId || layer.editableText || NON_COMPONENT_KINDS.has(layer.kind)) continue
      if (layer.kind !== cand.item.kind) continue
      if (layer.width < 14 || layer.height < 14) continue
      if (
        (layer.kind === 'panel' || layer.kind === 'frame') &&
        layer.width * layer.height > canvasArea * 0.25
      ) {
        continue
      }
      const wRatio = layer.width / Math.max(1, cand.item.canonicalWidth)
      const hRatio = layer.height / Math.max(1, cand.item.canonicalHeight)
      if (cand.item.scalePolicy !== 'nine-slice') {
        if (wRatio < 0.8 || wRatio > 1.25 || hRatio < 0.8 || hRatio > 1.25) continue
      } else {
        if (wRatio < 0.55 || wRatio > 2.2 || hRatio < 0.55 || hRatio > 2.2) continue
      }

      const layerImg: RgbaImage = {
        width: layer.width,
        height: layer.height,
        data: layer.rgba
      }
      const { knownMask, repairMask } = buildMasksForSplitLayer(layer, split.layers)
      const detectedMask = new Uint8Array(layer.width * layer.height)
      for (let p = 0; p < detectedMask.length; p++) {
        if (layer.rgba[p * 4 + 3]! >= 32) detectedMask[p] = 1
      }
      const fullMatch = matchElementToComponentLibrary({
        elementKind: layer.kind,
        box: { left: layer.left, top: layer.top, width: layer.width, height: layer.height },
        observedPatch: layerImg,
        detectedMask,
        knownMask,
        candidates: [cand],
        minScore: 0.76
      })

      let rendered: RgbaImage
      if (fullMatch) {
        rendered = fullMatch.rendered
      } else {
        const masterKnown = new Uint8Array(cand.rgba.width * cand.rgba.height).fill(1)
        const sampleA: ExtractedInstanceSample = {
          screenIndex: 0,
          canvasArea,
          layer,
          rgba: layerImg,
          knownMask,
          repairMask,
          clutterScore: 0,
          descriptor: computeComponentVisualDescriptor(layerImg)
        }
        const sampleB: ExtractedInstanceSample = {
          screenIndex: 0,
          canvasArea,
          layer: {
            ...layer,
            width: cand.rgba.width,
            height: cand.rgba.height,
            rgba: cand.rgba.data
          },
          rgba: cand.rgba,
          knownMask: masterKnown,
          repairMask: masterKnown,
          clutterScore: 0,
          descriptor: cand.item.descriptor ?? computeComponentVisualDescriptor(cand.rgba)
        }
        if (
          !samplesMatchByBorderRing(
            sampleA,
            sampleB,
            cand.item.scalePolicy,
            cand.item.nineSliceBorders
          )
        ) {
          continue
        }
        rendered = renderComponentToRect(
          cand.rgba,
          layer.width,
          layer.height,
          cand.item.scalePolicy,
          cand.item.nineSliceBorders
        )
      }

      const renderedKnown = new Uint8Array(rendered.width * rendered.height).fill(1)
      const layerClutter = computeInteriorClutterScore(layerImg, knownMask)
      const masterClutter = computeInteriorClutterScore(rendered, renderedKnown)
      matches.push({ layer, rendered, layerClutter, masterClutter })
    }

    if (matches.length < 2) continue

    for (const m of matches) {
      m.layer.componentId = cand.item.id
      m.layer.componentMatchScore = 0.94
      m.layer.prefabKey = cand.item.id
      if (m.masterClutter <= m.layerClutter + 2.5) {
        bleedTransparentRgb(m.rendered.data, m.rendered.width, m.rendered.height, 4)
        m.layer.originalRgba = new Uint8ClampedArray(m.layer.rgba)
        m.layer.rgba = new Uint8ClampedArray(m.rendered.data)
      }
    }
    usedCandidates.push({
      item: { ...cand.item, sourceCount: matches.length },
      rgba: cand.rgba
    })
  }

  return usedCandidates
}
