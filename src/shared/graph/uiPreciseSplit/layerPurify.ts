import { computeNineSliceFromRgbaBuffer } from '../imageLayerSplit'
import {
  componentIdToPsdGuid,
  sanitizeComponentExportName,
  type UiComponentScalePolicy,
  type UiComponentVisualDescriptor,
  type UiSharedComponentItem
} from '../uiComponentLibrary'
import {
  areComponentDescriptorsSameSkin,
  choosePurificationStudioBg,
  componentKindPriority,
  computeComponentVisualDescriptor,
  extractCleanComponentMatteFromSolidBg,
  matchElementToComponentLibrary,
  NON_COMPONENT_KINDS,
  renderComponentToRect,
  resizeAreaAverage,
  type ComponentMatchResult
} from './componentLibrary'
import { bleedTransparentRgb } from './productize'
import {
  boxBlurFloat,
  clampRect,
  cloneImage,
  createImage,
  cropImage,
  dilateMask,
  erodeMask,
  expandRect,
  inpaintPushPull,
  labelComponents,
  labelComponents8,
  nearestAspectRatio,
  pixelDistance,
  rectArea,
  rectIntersection,
  resizeBilinear
} from './pixels'
import type { LocalOcrTextBox } from '../uiControlSpec'
import { buildComponentPurifyPrompt, buildStandaloneLayerPurifyPrompt } from './prompts'
import type {
  PixelRect,
  PreciseSplitComponentCandidate,
  PreciseSplitIo,
  RgbaImage,
  UiElementKind,
  UiElementNode,
  UiLayoutTree
} from './types'

const NINE_SLICE_CONTROL_KINDS = new Set<string>([
  'panel',
  'frame',
  'banner',
  'button',
  'tab',
  'item-slot',
  'progress-bar'
])

const PURIFIABLE_CONTROL_KINDS = new Set<string>([
  'button',
  'close-button',
  'arrow',
  'item-slot',
  'tab',
  'badge',
  'progress-bar',
  'banner',
  'frame',
  'panel'
])

export const PUNCH_ENCLOSED_HOLE_KINDS = new Set<string>([
  'art-text',
  'icon',
  'decoration',
  'divider',
  'close-button',
  'arrow'
])

const TRANSLUCENT_ELIGIBLE_KINDS = new Set<string>([
  'panel',
  'banner',
  'frame',
  'item-slot',
  'button',
  'tab',
  'badge',
  'progress-bar',
  'decoration',
  'other'
])

export interface CompanionContentEntry {
  rect: PixelRect
  companionRgba: RgbaImage
  /** 1 = occluded in `source` by higher-paintIndex elements or plain text (`length = rect.width * rect.height`) */
  occludedMask: Uint8Array
}

export interface PurifySplitLayersInput {
  io: PreciseSplitIo
  source: RgbaImage
  textFree: RgbaImage
  tree: UiLayoutTree
  ocr: readonly LocalOcrTextBox[]
  ordered: readonly UiElementNode[]
  isTranslucentGlow: (el: UiElementNode) => boolean
  buildPreSegKnownMask: (box: PixelRect, el: UiElementNode) => Uint8Array
  existingMatches: Map<string, ComponentMatchResult>
  locale?: string
  maxCalls?: number
}

export interface PurifySplitLayersOutput {
  synthesizedComponents: PreciseSplitComponentCandidate[]
  companionContentById: Map<string, CompanionContentEntry>
  purifiedCount: number
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) return []
  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) break
      results[idx] = await worker(items[idx]!, idx)
    }
  })
  await Promise.all(runners)
  return results
}

function upscaleCropForStudioReference(crop: RgbaImage, minEdge = 320): RgbaImage {
  const shortSide = Math.max(1, Math.min(crop.width, crop.height))
  if (shortSide >= minEdge) return crop
  const scale = Math.min(4, Math.max(1, Math.ceil(minEdge / shortSide)))
  return scale > 1 ? resizeBilinear(crop, crop.width * scale, crop.height * scale) : crop
}

/**
 * Extracts a clean transparent matte from a studio render (`#FFFFFF` / `#141820`), falling back to
 * relaxed tolerance or native alpha tight-crop when an element has subtle studio contrast or native alpha.
 */
function extractStudioMatteRobust(
  genRgba: RgbaImage,
  expectedBgRgb: [number, number, number],
  allowHollowCenter: boolean,
  punchEnclosedBgHoles: boolean
): RgbaImage | null {
  const primary = extractCleanComponentMatteFromSolidBg(genRgba, {
    expectedBgRgb,
    allowHollowCenter,
    punchEnclosedBgHoles
  })
  if (primary) return primary

  const relaxed = extractCleanComponentMatteFromSolidBg(genRgba, {
    expectedBgRgb,
    allowHollowCenter,
    punchEnclosedBgHoles,
    tolerance: 6,
    feather: 16
  })
  if (relaxed) return relaxed

  const { width: W, height: H } = genRgba
  const n = W * H
  let opaque = 0
  let minX = W
  let minY = H
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (genRgba.data[(y * W + x) * 4 + 3]! >= 16) {
        opaque++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (opaque > 0 && opaque < n * 0.96 && maxX >= minX && maxY >= minY) {
    const cropped = cropImage(genRgba, {
      left: minX,
      top: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    })
    bleedTransparentRgb(cropped.data, cropped.width, cropped.height, 4)
    return cropped
  }

  return null
}

async function runStudioPurifyWithRetry(
  io: PreciseSplitIo,
  req: {
    prompt: string
    referenceImage: string
    aspectRatio: string
    resolution: '1K' | '2K'
  },
  expectedBgRgb: [number, number, number],
  allowHollowCenter: boolean,
  punchEnclosedBgHoles: boolean,
  label: string
): Promise<RgbaImage> {
  let lastDetail = 'empty image output'
  for (let attempt = 0; attempt < 2; attempt++) {
    throwIfAborted(io.signal)
    try {
      const genRgba = await io.purifyLayerImage!(req)
      if (!genRgba || genRgba.width < 4 || genRgba.height < 4) {
        lastDetail = 'purifyLayerImage returned null or undersized image'
        continue
      }
      const cleanMatte = extractStudioMatteRobust(
        genRgba,
        expectedBgRgb,
        allowHollowCenter,
        punchEnclosedBgHoles
      )
      if (cleanMatte) return cleanMatte
      lastDetail = 'unable to extract foreground matte from studio render'
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || io.signal?.aborted) throw err
      lastDetail = String((err as Error)?.message ?? err)
    }
  }
  const error = new Error(`PRECISE_SPLIT_PURIFY_FAILED (${label}): ${lastDetail}`)
  error.name = 'PreciseSplitPurifyError'
  throw error
}

/**
 * Computes masked 80%-trimmed RGB MAE and outer-20% border-ring MAE between `rendered` and `observed`
 * on unobstructed (`knownMask[p] === 1`) opaque (`rendered.alpha >= 96`) pixels.
 */
function measureUnobstructedControlFidelity(
  observed: RgbaImage,
  rendered: RgbaImage,
  knownMask: Uint8Array,
  borderOnly = false
): { trimmedMae: number; borderMae: number; samples: number } {
  const w = observed.width
  const h = observed.height
  const rx = Math.max(2, Math.round(w * 0.22))
  const ry = Math.max(2, Math.round(h * 0.22))
  const errs: number[] = []
  let borderSum = 0
  let borderCnt = 0

  for (let y = 0; y < h; y++) {
    const isBorderY = y < ry || y >= h - ry
    for (let x = 0; x < w; x++) {
      const isBorder = isBorderY || x < rx || x >= w - rx
      if (borderOnly && !isBorder) continue
      const p = y * w + x
      if (!knownMask[p]) continue
      const i = p * 4
      if (rendered.data[i + 3]! < 96) continue
      const err =
        (Math.abs(observed.data[i]! - rendered.data[i]!) +
          Math.abs(observed.data[i + 1]! - rendered.data[i + 1]!) +
          Math.abs(observed.data[i + 2]! - rendered.data[i + 2]!)) /
        3
      errs.push(err)
      if (isBorder) {
        borderSum += err
        borderCnt++
      }
    }
  }

  if (!errs.length) {
    return { trimmedMae: 0, borderMae: 0, samples: 0 }
  }
  errs.sort((a, b) => a - b)
  const trimN = Math.max(1, Math.floor(errs.length * 0.8))
  let sum = 0
  for (let k = 0; k < trimN; k++) sum += errs[k]!
  const trimmedMae = sum / trimN
  const borderMae = borderCnt >= 4 ? borderSum / borderCnt : trimmedMae
  return { trimmedMae, borderMae, samples: errs.length }
}

/**
 * Registers a purified control `master` onto `textFree` around `el.box` (searching `dx, dy` shifts
 * and symmetric border-recovery expansions `[-2..+3]`) so VLM / `refineElementBox` 1..4px drift or
 * chewed borders snap to the exact pixel coordinates of the control on the canvas.
 */
function alignControlInstanceToSource(input: {
  master: RgbaImage
  scalePolicy: UiComponentScalePolicy
  nineSliceBorders?: [number, number, number, number]
  el: UiElementNode
  textFree: RgbaImage
  buildPreSegKnownMask: (box: PixelRect, el: UiElementNode) => Uint8Array
}): { box: PixelRect; rendered: RgbaImage; patch: RgbaImage; known: Uint8Array } {
  const { master, scalePolicy, nineSliceBorders, el, textFree, buildPreSegKnownMask } = input
  const W = textFree.width
  const H = textFree.height
  const orig = el.box

  interface ShapeSeed {
    baseLeft: number
    baseTop: number
    width: number
    height: number
    maxShift: number
  }
  const seeds: ShapeSeed[] = [
    {
      baseLeft: orig.left,
      baseTop: orig.top,
      width: orig.width,
      height: orig.height,
      maxShift: 4
    }
  ]
  const pushSeed = (s: ShapeSeed): void => {
    if (s.width < 6 || s.height < 6 || s.width > W || s.height > H) return
    if (
      !seeds.some(
        (p) =>
          p.width === s.width &&
          p.height === s.height &&
          Math.abs(p.baseLeft - s.baseLeft) <= 1 &&
          Math.abs(p.baseTop - s.baseTop) <= 1
      )
    ) {
      seeds.push(s)
    }
  }
  if (
    el.rawBox &&
    Math.abs(el.rawBox.width - orig.width) <= 8 &&
    Math.abs(el.rawBox.height - orig.height) <= 8
  ) {
    pushSeed({
      baseLeft: el.rawBox.left,
      baseTop: el.rawBox.top,
      width: el.rawBox.width,
      height: el.rawBox.height,
      maxShift: 2
    })
  }
  for (const pad of [-2, -1, 1, 2, 3]) {
    const exp = expandRect(orig, pad, W, H)
    pushSeed({
      baseLeft: exp.left,
      baseTop: exp.top,
      width: exp.width,
      height: exp.height,
      maxShift: 2
    })
  }

  let bestScore = Infinity
  let bestBox: PixelRect = { ...orig }
  let bestRendered: RgbaImage | null = null
  const interiorErrs: number[] = []
  const rimErrs: number[] = []

  for (const seed of seeds) {
    const rendered = renderComponentToRect(
      master,
      seed.width,
      seed.height,
      scalePolicy,
      nineSliceBorders
    )
    const rw = rendered.width
    const rh = rendered.height
    const solidMask = new Uint8Array(rw * rh)
    for (let p = 0; p < rw * rh; p++) {
      if (rendered.data[p * 4 + 3]! >= 150) solidMask[p] = 1
    }
    const eroded2 = erodeMask(solidMask, rw, rh, 2)
    const eroded1 = erodeMask(solidMask, rw, rh, 1)

    for (let dy = -seed.maxShift; dy <= seed.maxShift; dy++) {
      const top = seed.baseTop + dy
      if (top < 0 || top + rh > H) continue
      for (let dx = -seed.maxShift; dx <= seed.maxShift; dx++) {
        const left = seed.baseLeft + dx
        if (left < 0 || left + rw > W) continue
        const candBox: PixelRect = { left, top, width: rw, height: rh }
        const known = buildPreSegKnownMask(candBox, el)

        interiorErrs.length = 0
        rimErrs.length = 0
        let edgeJumpSum = 0
        let edgeJumpCnt = 0

        for (let y = 0; y < rh; y++) {
          const cy = top + y
          const row = y * rw
          for (let x = 0; x < rw; x++) {
            const p = row + x
            if (!solidMask[p] || !known[p]) continue
            const cx = left + x
            const ri = p * 4
            const ti = (cy * W + cx) * 4
            const err =
              (Math.abs(textFree.data[ti]! - rendered.data[ri]!) +
                Math.abs(textFree.data[ti + 1]! - rendered.data[ri + 1]!) +
                Math.abs(textFree.data[ti + 2]! - rendered.data[ri + 2]!)) /
              3
            if (eroded2[p]) {
              interiorErrs.push(err)
            } else {
              rimErrs.push(err)
            }

            // Outer 1px foreground rim: measure step contrast to immediate exterior background
            if (!eroded1[p]) {
              const outCoords: Array<[number, number]> = []
              if (x === 0 || !solidMask[p - 1]) outCoords.push([cx - 2, cy])
              if (x === rw - 1 || !solidMask[p + 1]) outCoords.push([cx + 2, cy])
              if (y === 0 || !solidMask[p - rw]) outCoords.push([cx, cy - 2])
              if (y === rh - 1 || !solidMask[p + rw]) outCoords.push([cx, cy + 2])
              for (const [ox, oy] of outCoords) {
                if (ox < 0 || ox >= W || oy < 0 || oy >= H) continue
                const oi = (oy * W + ox) * 4
                edgeJumpSum += pixelDistance(textFree.data, ti, textFree.data, oi)
                edgeJumpCnt++
              }
            }
          }
        }

        if (interiorErrs.length + rimErrs.length < 8) continue

        let intMae = 0
        if (interiorErrs.length > 0) {
          interiorErrs.sort((a, b) => a - b)
          const trimN = Math.max(1, Math.floor(interiorErrs.length * 0.8))
          let s = 0
          for (let k = 0; k < trimN; k++) s += interiorErrs[k]!
          intMae = s / trimN
        }

        let rimScore = intMae
        if (rimErrs.length > 0) {
          rimErrs.sort((a, b) => a - b)
          const trimRim = Math.max(1, Math.floor(rimErrs.length * 0.9))
          let s = 0
          for (let k = 0; k < trimRim; k++) s += rimErrs[k]!
          rimScore = s / trimRim
        }

        const edgeContrast = edgeJumpCnt >= 4 ? Math.min(40, edgeJumpSum / edgeJumpCnt) : 0
        const regPenalty =
          (Math.abs(left - orig.left) +
            Math.abs(top - orig.top) +
            Math.abs(rw - orig.width) +
            Math.abs(rh - orig.height)) *
          0.85

        const isSlotOrFrame = el.kind === 'item-slot' || el.kind === 'frame'
        const score =
          (isSlotOrFrame ? rimScore * 1.35 : intMae * 0.45 + rimScore * 0.95) -
          edgeContrast * 0.12 +
          regPenalty

        if (score < bestScore) {
          bestScore = score
          bestBox = candBox
          bestRendered = rendered
        }
      }
    }
  }

  if (!bestRendered) {
    bestRendered = renderComponentToRect(
      master,
      orig.width,
      orig.height,
      scalePolicy,
      nineSliceBorders
    )
    bestBox = { ...orig }
  }
  bleedTransparentRgb(bestRendered.data, bestRendered.width, bestRendered.height, 3)
  return {
    box: bestBox,
    rendered: bestRendered,
    patch: cropImage(textFree, bestBox),
    known: buildPreSegKnownMask(bestBox, el)
  }
}

/**
 * Checks whether two control elements on `textFree` belong to the same reusable skin family,
 * tolerating different interior item icons inside `item-slot` / `frame` by comparing their outer rings.
 */
function areScreenControlsSameFamily(
  a: { el: UiElementNode; desc: UiComponentVisualDescriptor; patch: RgbaImage; known: Uint8Array },
  b: { el: UiElementNode; desc: UiComponentVisualDescriptor; patch: RgbaImage; known: Uint8Array }
): boolean {
  if (a.el.kind !== b.el.kind) return false
  if (areComponentDescriptorsSameSkin(a.el.kind, a.desc, b.el.kind, b.desc)) return true

  const arA = a.el.box.width / Math.max(1, a.el.box.height)
  const arB = b.el.box.width / Math.max(1, b.el.box.height)
  const arRatio = Math.max(arA / Math.max(0.01, arB), arB / Math.max(0.01, arA))
  const can9s = NINE_SLICE_CONTROL_KINDS.has(a.el.kind)
  if (arRatio > (can9s ? 1.55 : 1.18)) return false

  const side = 24
  const thumbA = resizeBilinear(a.patch, side, side)
  const thumbB = resizeBilinear(b.patch, side, side)
  const margin = Math.max(3, Math.round(side * 0.22))
  const errs: number[] = []
  const chErrs: number[] = []
  for (let y = 0; y < side; y++) {
    const inY = y < margin || y >= side - margin
    for (let x = 0; x < side; x++) {
      if (!inY && x >= margin && x < side - margin) continue
      const ax = Math.min(a.patch.width - 1, Math.floor(((x + 0.5) * a.patch.width) / side))
      const ay = Math.min(a.patch.height - 1, Math.floor(((y + 0.5) * a.patch.height) / side))
      const bx = Math.min(b.patch.width - 1, Math.floor(((x + 0.5) * b.patch.width) / side))
      const by = Math.min(b.patch.height - 1, Math.floor(((y + 0.5) * b.patch.height) / side))
      if (!a.known[ay * a.patch.width + ax] || !b.known[by * b.patch.width + bx]) continue
      const i = (y * side + x) * 4
      const r1 = thumbA.data[i]!
      const g1 = thumbA.data[i + 1]!
      const b1 = thumbA.data[i + 2]!
      const r2 = thumbB.data[i]!
      const g2 = thumbB.data[i + 1]!
      const b2 = thumbB.data[i + 2]!
      errs.push((Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)) / 3)
      chErrs.push((Math.abs(r1 - g1 - (r2 - g2)) + Math.abs(g1 - b1 - (g2 - b2))) * 0.5)
    }
  }
  if (errs.length < 16) return false
  errs.sort((x, y) => x - y)
  chErrs.sort((x, y) => x - y)
  const trim = Math.max(8, Math.floor(errs.length * 0.78))
  let eSum = 0
  let cSum = 0
  for (let k = 0; k < trim; k++) {
    eSum += errs[k]!
    cSum += chErrs[k]!
  }
  return eSum / trim <= 18 && cSum / trim <= 15
}

function buildEmbeddedContentSummary(
  exemplar: UiElementNode,
  ordered: readonly UiElementNode[]
): { hasEmbeddedContent: boolean; embeddedContentDesc?: string } {
  const parts: string[] = []
  const selfPaint = exemplar.paintIndex ?? 0
  for (const other of ordered) {
    if (other.id === exemplar.id) continue
    if ((other.paintIndex ?? 0) <= selfPaint && other.parentId !== exemplar.id) continue
    const inter = rectIntersection(other.box, exemplar.box)
    if (inter <= 0) continue
    if (inter < Math.min(rectArea(other.box) * 0.35, rectArea(exemplar.box) * 0.04)) continue
    if (other.plainText) {
      const label = (other.text || other.name || '').trim()
      parts.push(label ? `text "${label.slice(0, 24)}"` : 'text label')
    } else {
      parts.push(`${other.kind} "${(other.name || other.kind).slice(0, 24)}"`)
    }
    if (parts.length >= 4) break
  }
  if (!parts.length) {
    return { hasEmbeddedContent: false }
  }
  return {
    hasEmbeddedContent: true,
    embeddedContentDesc: parts.join(', ').slice(0, 140)
  }
}

function buildGraphicalOcclusionMaskAndDesc(
  el: UiElementNode,
  ordered: readonly UiElementNode[],
  knownMask: Uint8Array
): { occludedMask: Uint8Array; occludedRatio: number; occluderDesc?: string } {
  const w = el.box.width
  const h = el.box.height
  const rawOcc = new Uint8Array(w * h)
  let occCount = 0
  for (let p = 0; p < rawOcc.length; p++) {
    if (!knownMask[p]) {
      rawOcc[p] = 1
      occCount++
    }
  }
  const dilated = occCount > 0 ? dilateMask(rawOcc, w, h, 2) : rawOcc

  const descParts: string[] = []
  const selfPaint = el.paintIndex ?? 0
  for (const upper of ordered) {
    if (upper.id === el.id) continue
    if ((upper.paintIndex ?? 0) <= selfPaint) continue
    const inter = rectIntersection(upper.box, el.box)
    if (inter <= 0) continue
    if (upper.plainText) {
      const txt = (upper.text || upper.name || '').trim()
      if (el.kind === 'art-text' && el.text && txt === el.text.trim()) continue
      descParts.push(txt ? `text "${txt.slice(0, 20)}"` : 'overlapping text')
    } else {
      descParts.push(`${upper.kind} "${(upper.name || upper.kind).slice(0, 24)}"`)
    }
    if (descParts.length >= 4) break
  }

  return {
    occludedMask: dilated,
    occludedRatio: rawOcc.length > 0 ? occCount / rawOcc.length : 0,
    ...(descParts.length ? { occluderDesc: descParts.join(', ').slice(0, 140) } : {})
  }
}

/**
 * Fits and sub-pixel aligns a tight-cropped studio matte (`cleanMatte`) onto `box` against
 * unoccluded pixels of `sourcePatch`, evaluating both exact box resize and aspect-preserving
 * centered placement across `dx, dy in [-4..4]` and picking the lowest 80%-trimmed RGB error.
 */
function alignStudioMatteToElementBox(
  cleanMatte: RgbaImage,
  sourcePatch: RgbaImage,
  knownMask: Uint8Array
): { aligned: RgbaImage; trimmedErr: number; matchedPixels: number } {
  const w = sourcePatch.width
  const h = sourcePatch.height
  const candidates: RgbaImage[] = [resizeAreaAverage(cleanMatte, w, h)]

  const scale = Math.min(w / Math.max(1, cleanMatte.width), h / Math.max(1, cleanMatte.height))
  const fitW = Math.max(1, Math.min(w, Math.round(cleanMatte.width * scale)))
  const fitH = Math.max(1, Math.min(h, Math.round(cleanMatte.height * scale)))
  if (fitW !== w || fitH !== h) {
    const fitted = resizeAreaAverage(cleanMatte, fitW, fitH)
    const padded = createImage(w, h)
    const ox = Math.floor((w - fitW) * 0.5)
    const oy = Math.floor((h - fitH) * 0.5)
    for (let y = 0; y < fitH; y++) {
      const srcOff = y * fitW * 4
      const dstOff = ((oy + y) * w + ox) * 4
      padded.data.set(fitted.data.subarray(srcOff, srcOff + fitW * 4), dstOff)
    }
    candidates.push(padded)
  }

  let bestImg: RgbaImage | null = null
  let bestErr = Infinity
  let bestMatched = 0
  const errs: number[] = []

  for (const baseCand of candidates) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        errs.length = 0
        for (let y = 0; y < h; y++) {
          const sy = y - dy
          if (sy < 0 || sy >= h) continue
          for (let x = 0; x < w; x++) {
            const sx = x - dx
            if (sx < 0 || sx >= w) continue
            const p = y * w + x
            if (!knownMask[p]) continue
            const si = (sy * w + sx) * 4
            if (baseCand.data[si + 3]! < 140) continue
            const oi = p * 4
            const e =
              (Math.abs(sourcePatch.data[oi]! - baseCand.data[si]!) +
                Math.abs(sourcePatch.data[oi + 1]! - baseCand.data[si + 1]!) +
                Math.abs(sourcePatch.data[oi + 2]! - baseCand.data[si + 2]!)) /
              3
            errs.push(e)
          }
        }
        if (errs.length < 4) continue
        errs.sort((a, b) => a - b)
        const trimN = Math.max(1, Math.floor(errs.length * 0.8))
        let sum = 0
        for (let k = 0; k < trimN; k++) sum += errs[k]!
        const err = sum / trimN + (Math.abs(dx) + Math.abs(dy)) * 0.35
        if (err < bestErr) {
          bestErr = err
          bestMatched = errs.length
          if (dx === 0 && dy === 0) {
            bestImg = baseCand
          } else {
            const shifted = createImage(w, h)
            for (let y = 0; y < h; y++) {
              const sy = y - dy
              if (sy < 0 || sy >= h) continue
              for (let x = 0; x < w; x++) {
                const sx = x - dx
                if (sx < 0 || sx >= w) continue
                const di = (y * w + x) * 4
                const si = (sy * w + sx) * 4
                shifted.data[di] = baseCand.data[si]!
                shifted.data[di + 1] = baseCand.data[si + 1]!
                shifted.data[di + 2] = baseCand.data[si + 2]!
                shifted.data[di + 3] = baseCand.data[si + 3]!
              }
            }
            bestImg = shifted
          }
        }
      }
    }
  }

  if (!bestImg) {
    const direct = candidates[0]!
    bleedTransparentRgb(direct.data, w, h, 3)
    return { aligned: direct, trimmedErr: 0, matchedPixels: 0 }
  }

  bleedTransparentRgb(bestImg.data, w, h, 3)
  return { aligned: bestImg, trimmedErr: bestErr, matchedPixels: bestMatched }
}

/**
 * Runs `ui.componentLib`-grade solid-studio purification directly inside `runPreciseUiSplit`
 * with zero per-screen element cap and zero local-segmentation fallback.
 */
export async function purifySplitLayersOnSolidBg(
  input: PurifySplitLayersInput
): Promise<PurifySplitLayersOutput> {
  const {
    io,
    source,
    textFree,
    tree,
    ocr,
    ordered,
    isTranslucentGlow,
    buildPreSegKnownMask,
    existingMatches,
    locale
  } = input
  const synthesizeOut: PreciseSplitComponentCandidate[] = []
  const companionContentById = new Map<string, CompanionContentEntry>()

  if (!io.purifyLayerImage) {
    return { synthesizedComponents: synthesizeOut, companionContentById, purifiedCount: 0 }
  }
  const budgetTotal =
    input.maxCalls === undefined ? Number.POSITIVE_INFINITY : Math.max(0, input.maxCalls)
  if (budgetTotal <= 0) {
    return { synthesizedComponents: synthesizeOut, companionContentById, purifiedCount: 0 }
  }

  const W = source.width
  const H = source.height
  const log = (msg: string): void => io.log?.(msg)

  const preservedRasterRects: PixelRect[] = (tree.rasterTextIds ?? [])
    .filter((idx) => idx >= 0 && idx < ocr.length)
    .map((idx) => ocr[idx]!)

  const hasPreservedRasterTextOnControl = (el: UiElementNode): boolean => {
    for (const rb of preservedRasterRects) {
      const inter = rectIntersection(el.box, rb)
      if (inter < rectArea(rb) * 0.5) continue
      const ownedByChild = ordered.some(
        (c) =>
          c.id !== el.id &&
          !c.plainText &&
          (c.paintIndex ?? 0) > (el.paintIndex ?? 0) &&
          rectIntersection(c.box, rb) >= rectArea(rb) * 0.5
      )
      if (!ownedByChild) return true
    }
    return false
  }

  // ---------------- Part A: Screen-Level UI Control Skin Purification ----------------
  interface ControlSample {
    el: UiElementNode
    patch: RgbaImage
    known: Uint8Array
    desc: UiComponentVisualDescriptor
    unobstructedRatio: number
  }

  const controlSamples: ControlSample[] = []
  for (const el of ordered) {
    if (el.plainText || NON_COMPONENT_KINDS.has(el.kind) || isTranslucentGlow(el)) continue
    if (!PURIFIABLE_CONTROL_KINDS.has(el.kind)) continue
    if (existingMatches.has(el.id)) continue
    if (el.box.width < 6 || el.box.height < 6) continue
    if (el.box.width >= W * 0.99 && el.box.height >= H * 0.99 && !el.parentId) continue
    if (hasPreservedRasterTextOnControl(el)) continue

    const patch = cropImage(textFree, el.box)
    const known = buildPreSegKnownMask(el.box, el)
    let knownCnt = 0
    for (let p = 0; p < known.length; p++) {
      if (known[p]) knownCnt++
    }
    const unobstructedRatio = known.length > 0 ? knownCnt / known.length : 0
    const desc = computeComponentVisualDescriptor(patch)
    controlSamples.push({ el, patch, known, desc, unobstructedRatio })
  }

  controlSamples.sort((a, b) => b.unobstructedRatio - a.unobstructedRatio)

  const controlClusters: ControlSample[][] = []
  for (const sample of controlSamples) {
    let joined = false
    for (const cluster of controlClusters) {
      if (areScreenControlsSameFamily(sample, cluster[0]!)) {
        cluster.push(sample)
        joined = true
        break
      }
    }
    if (!joined) controlClusters.push([sample])
  }

  controlClusters.sort((a, b) => {
    const aRep = a.length >= 2 ? 1 : 0
    const bRep = b.length >= 2 ? 1 : 0
    if (bRep !== aRep) return bRep - aRep
    if (b.length !== a.length) return b.length - a.length
    return componentKindPriority(b[0]!.el.kind) - componentKindPriority(a[0]!.el.kind)
  })

  const controlBudget = Number.isFinite(budgetTotal)
    ? Math.min(controlClusters.length, budgetTotal)
    : controlClusters.length
  const selectedControlClusters = controlClusters.slice(0, controlBudget)
  let callsUsed = 0

  const purifyControlCluster = async (cluster: ControlSample[]) => {
    throwIfAborted(io.signal)
    const exemplar = cluster[0]!
    const exEl = exemplar.el
    const kind = exEl.kind
    const refPad = Math.max(
      4,
      Math.min(10, Math.round(Math.min(exEl.box.width, exEl.box.height) * 0.08))
    )
    const padCropRect = expandRect(exEl.box, refPad, W, H)
    const rawCrop = cropImage(source, padCropRect)
    const studioRef = upscaleCropForStudioReference(rawCrop, 320)
    const { bgHex, bgRgb } = choosePurificationStudioBg(exemplar.patch)
    const embedded = buildEmbeddedContentSummary(exEl, ordered)

    const prompt = buildComponentPurifyPrompt({
      locale,
      name: exEl.name || kind,
      kind,
      ...(embedded.embeddedContentDesc
        ? { embeddedContentDesc: embedded.embeddedContentDesc }
        : {}),
      bgHex
    })

    const refDataUrl = await io.encodePng(studioRef)
    const cleanMatte = await runStudioPurifyWithRetry(
      io,
      {
        prompt,
        referenceImage: refDataUrl,
        aspectRatio: nearestAspectRatio(exEl.box.width, exEl.box.height),
        resolution: Math.max(exEl.box.width, exEl.box.height) >= 640 ? '2K' : '1K'
      },
      bgRgb,
      kind === 'frame',
      PUNCH_ENCLOSED_HOLE_KINDS.has(kind),
      exEl.name || kind
    )

    const widths = cluster.map((s) => s.el.box.width).sort((a, b) => a - b)
    const heights = cluster.map((s) => s.el.box.height).sort((a, b) => a - b)
    const canonicalWidth = Math.max(6, widths[widths.length >> 1]!)
    const canonicalHeight = Math.max(6, heights[heights.length >> 1]!)
    const master = resizeAreaAverage(cleanMatte, canonicalWidth, canonicalHeight)
    bleedTransparentRgb(master.data, canonicalWidth, canonicalHeight, 4)

    const nineSliceBorders = NINE_SLICE_CONTROL_KINDS.has(kind)
      ? computeNineSliceFromRgbaBuffer(master.data, canonicalWidth, canonicalHeight)
      : undefined
    const scalePolicy: UiComponentScalePolicy = nineSliceBorders ? 'nine-slice' : 'uniform'

    const alignedEx = alignControlInstanceToSource({
      master,
      scalePolicy,
      nineSliceBorders,
      el: exEl,
      textFree,
      buildPreSegKnownMask
    })
    const borderOnlyCheck =
      kind === 'item-slot' ||
      kind === 'frame' ||
      (kind === 'panel' && exemplar.unobstructedRatio < 0.55)
    const fidelity = measureUnobstructedControlFidelity(
      alignedEx.patch,
      alignedEx.rendered,
      alignedEx.known,
      borderOnlyCheck
    )

    return {
      cluster,
      kind,
      master,
      canonicalWidth,
      canonicalHeight,
      scalePolicy,
      nineSliceBorders,
      fidelityMae: fidelity.trimmedMae
    }
  }

  const kindCounters = new Map<string, number>()
  let purifiedControlInstances = 0

  const registerPurifiedClusterResult = (
    res: Awaited<ReturnType<typeof purifyControlCluster>>,
    unmatchedSiblingsOut: ControlSample[]
  ): void => {
    const seq = (kindCounters.get(res.kind) ?? 0) + 1
    kindCounters.set(res.kind, seq)
    const kindSlug = res.kind.replace(/[^a-z0-9]+/gi, '_').toLowerCase()
    const id = `comp_split_${kindSlug}_${String(seq).padStart(2, '0')}`
    const exportName = sanitizeComponentExportName(
      `Comp_${res.kind
        .split('-')
        .map((s) => (s ? s[0]!.toUpperCase() + s.slice(1) : ''))
        .join('')}_${String(seq).padStart(2, '0')}`,
      synthesizeOut.length + 1
    )
    const repEl = res.cluster[0]!.el
    const item: UiSharedComponentItem = {
      id,
      psdGuid: componentIdToPsdGuid(id),
      name: repEl.name?.trim() || `${res.kind} ${seq}`,
      exportName,
      kind: res.kind as UiElementKind,
      canonicalWidth: res.canonicalWidth,
      canonicalHeight: res.canonicalHeight,
      scalePolicy: res.scalePolicy,
      ...(res.nineSliceBorders ? { nineSliceBorders: res.nineSliceBorders } : {}),
      sourceCount: res.cluster.length,
      descriptor: computeComponentVisualDescriptor(res.master)
    }
    const candidate: PreciseSplitComponentCandidate = { item, rgba: res.master }

    let applied = 0
    for (let i = 0; i < res.cluster.length; i++) {
      const sample = res.cluster[i]!
      const alignedInst = alignControlInstanceToSource({
        master: res.master,
        scalePolicy: res.scalePolicy,
        nineSliceBorders: res.nineSliceBorders,
        el: sample.el,
        textFree,
        buildPreSegKnownMask
      })
      if (i > 0) {
        const borderOnlyCheck = res.kind === 'item-slot' || res.kind === 'frame'
        const sibFidelity = measureUnobstructedControlFidelity(
          alignedInst.patch,
          alignedInst.rendered,
          alignedInst.known,
          borderOnlyCheck
        )
        if (
          sibFidelity.samples >= 12 &&
          (sibFidelity.trimmedMae > 32 || sibFidelity.borderMae > 34)
        ) {
          const fallbackMatch = matchElementToComponentLibrary({
            elementKind: sample.el.kind,
            box: alignedInst.box,
            observedPatch: alignedInst.patch,
            detectedMask: new Uint8Array(alignedInst.box.width * alignedInst.box.height),
            knownMask: alignedInst.known,
            candidates: [candidate],
            minScore: 0.68,
            allowMasklessBoxMatch: true
          })
          if (!fallbackMatch) {
            unmatchedSiblingsOut.push(sample)
            continue
          }
        }
      }
      sample.el.box = alignedInst.box
      sample.patch = alignedInst.patch
      sample.known = alignedInst.known
      const score = Number(Math.max(0.78, Math.min(0.99, 1 - res.fidelityMae / 120)).toFixed(4))
      existingMatches.set(sample.el.id, { candidate, rendered: alignedInst.rendered, score })
      applied++
      purifiedControlInstances++
    }

    if (applied > 0) {
      candidate.item.sourceCount = applied
      // Keep singleton master dimensions synchronized with its sub-pixel aligned instance box
      if (applied === 1) {
        const singleMatch = existingMatches.get(repEl.id)
        if (singleMatch) {
          candidate.rgba = singleMatch.rendered
          candidate.item.canonicalWidth = singleMatch.rendered.width
          candidate.item.canonicalHeight = singleMatch.rendered.height
        }
      }
      synthesizeOut.push(candidate)
    }
  }

  const purifiedControls = await mapWithConcurrency(selectedControlClusters, 4, (cluster) =>
    purifyControlCluster(cluster)
  )
  callsUsed += selectedControlClusters.length

  const unmatchedSiblings: ControlSample[] = []
  for (const res of purifiedControls) {
    registerPurifiedClusterResult(res, unmatchedSiblings)
  }

  // Purify any non-matching cluster siblings individually so zero controls fall back to local segmentation
  if (unmatchedSiblings.length > 0 && callsUsed < budgetTotal) {
    const sibLimit = Number.isFinite(budgetTotal)
      ? Math.min(unmatchedSiblings.length, budgetTotal - callsUsed)
      : unmatchedSiblings.length
    const sibTargets = unmatchedSiblings.slice(0, sibLimit)
    const purifiedSibs = await mapWithConcurrency(sibTargets, 4, (sib) =>
      purifyControlCluster([sib])
    )
    callsUsed += sibTargets.length
    const ignored: ControlSample[] = []
    for (const res of purifiedSibs) {
      registerPurifiedClusterResult(res, ignored)
    }
  }

  // ---------------- Part B: Standalone Graphical Content Layer Purification ----------------
  const remainingBudget = Number.isFinite(budgetTotal)
    ? Math.max(0, budgetTotal - callsUsed)
    : Number.POSITIVE_INFINITY
  if (remainingBudget > 0) {
    interface GraphicalTarget {
      el: UiElementNode
      known: Uint8Array
      occludedMask: Uint8Array
      occludedRatio: number
      occluderDesc?: string
      priority: number
    }

    const graphicalTargets: GraphicalTarget[] = []
    for (const el of ordered) {
      if (el.plainText || isTranslucentGlow(el)) continue
      if (existingMatches.has(el.id)) continue
      if (el.box.width < 4 || el.box.height < 4) continue
      if (el.box.width >= W * 0.99 && el.box.height >= H * 0.99 && !el.parentId) continue

      const known = buildPreSegKnownMask(el.box, el)
      const occ = buildGraphicalOcclusionMaskAndDesc(el, ordered, known)

      const kindBonus =
        el.kind === 'art-text' ? 30 : el.kind === 'avatar' || el.kind === 'illustration' ? 24 : 18
      const priority =
        kindBonus + occ.occludedRatio * 100 + Math.min(16, Math.sqrt(rectArea(el.box)) * 0.05)
      graphicalTargets.push({
        el,
        known,
        occludedMask: occ.occludedMask,
        occludedRatio: occ.occludedRatio,
        occluderDesc: occ.occluderDesc,
        priority
      })
    }

    graphicalTargets.sort((a, b) => b.priority - a.priority)
    const selectedGraphical = Number.isFinite(remainingBudget)
      ? graphicalTargets.slice(0, remainingBudget)
      : graphicalTargets

    const graphicalResults = await mapWithConcurrency(selectedGraphical, 4, async (target) => {
      throwIfAborted(io.signal)
      const { el, known, occludedMask, occluderDesc, occludedRatio } = target
      const padScale = occludedRatio >= 0.2 ? 0.22 : 0.1
      const maxPad = occludedRatio >= 0.2 ? 28 : 12
      const refPad = Math.max(
        4,
        Math.min(maxPad, Math.round(Math.min(el.box.width, el.box.height) * padScale))
      )
      const padRect = expandRect(el.box, refPad, W, H)
      const rawCrop = cropImage(source, padRect)
      const studioRef = upscaleCropForStudioReference(rawCrop, 320)
      const sourcePatch = cropImage(source, el.box)
      const { bgHex, bgRgb } = choosePurificationStudioBg(sourcePatch)

      const prompt = buildStandaloneLayerPurifyPrompt({
        locale,
        name: el.name || el.kind,
        kind: el.kind,
        bgHex,
        ...(occluderDesc ? { occluderDesc } : {}),
        ...(el.kind === 'art-text' && el.text ? { artTextValue: el.text } : {})
      })

      const refDataUrl = await io.encodePng(studioRef)
      const cleanMatte = await runStudioPurifyWithRetry(
        io,
        {
          prompt,
          referenceImage: refDataUrl,
          aspectRatio: nearestAspectRatio(el.box.width, el.box.height),
          resolution: Math.max(el.box.width, el.box.height) >= 640 ? '2K' : '1K'
        },
        bgRgb,
        el.kind === 'frame',
        PUNCH_ENCLOSED_HOLE_KINDS.has(el.kind),
        el.name || el.kind
      )

      const aligned = alignStudioMatteToElementBox(cleanMatte, sourcePatch, known)

      return {
        id: el.id,
        entry: {
          rect: { ...el.box },
          companionRgba: aligned.aligned,
          occludedMask
        } satisfies CompanionContentEntry
      }
    })

    for (const gr of graphicalResults) {
      companionContentById.set(gr.id, gr.entry)
    }
  }

  const purifiedCount = purifiedControlInstances + companionContentById.size
  if (purifiedCount > 0) {
    log(
      `companion solid-bg purification: ${synthesizeOut.length} control master(s) (${purifiedControlInstances} instance(s)), ${companionContentById.size} graphical layer(s)`
    )
  }

  return {
    synthesizedComponents: synthesizeOut,
    companionContentById,
    purifiedCount
  }
}

/**
 * Transfers ground-truth `sourceCrop` pixels across verified horizontal or vertical bilateral
 * symmetry axes into occluded `hole` pixels before AI push-pull harmonization.
 * Ensures half-occluded symmetric frames, ornate banners, plaques, and emblems recover exact
 * original grain/pattern rather than smoothed AI approximations.
 */
function transferBilateralMirrorTextureIntoHole(
  sourceCrop: RgbaImage,
  companionRgba: RgbaImage,
  hole: Uint8Array
): { mirrorRgb: Uint8ClampedArray; mirrorFilled: Uint8Array; filledCount: number } {
  const w = sourceCrop.width
  const h = sourceCrop.height
  const n = w * h
  const mirrorRgb = new Uint8ClampedArray(n * 4)
  const mirrorFilled = new Uint8Array(n)
  let filledCount = 0
  if (w < 10 || h < 10) return { mirrorRgb, mirrorFilled, filledCount }

  // 1) Test horizontal bilateral symmetry (`mx = w - 1 - x + shift`)
  let bestHShift: number | null = null
  let bestHP80 = Infinity
  for (const shift of [0, -1, 1]) {
    let alphaInter = 0
    let alphaUnion = 0
    const srcDists: number[] = []
    const compDists: number[] = []
    for (let y = 0; y < h; y++) {
      const row = y * w
      for (let x = 0; x < w; x++) {
        const mx = w - 1 - x + shift
        if (mx <= x || mx >= w || mx < 0) continue
        const p = row + x
        const mp = row + mx
        const a1 = companionRgba.data[p * 4 + 3]! >= 180
        const a2 = companionRgba.data[mp * 4 + 3]! >= 180
        if (a1 || a2) {
          alphaUnion++
          if (a1 && a2) alphaInter++
        }
        if (
          !hole[p] &&
          !hole[mp] &&
          companionRgba.data[p * 4 + 3]! >= 200 &&
          companionRgba.data[mp * 4 + 3]! >= 200
        ) {
          srcDists.push(pixelDistance(sourceCrop.data, p * 4, sourceCrop.data, mp * 4))
          compDists.push(pixelDistance(companionRgba.data, p * 4, companionRgba.data, mp * 4))
        }
      }
    }
    if (alphaUnion < 24 || alphaInter / alphaUnion < 0.86 || srcDists.length < 24) continue
    srcDists.sort((a, b) => a - b)
    compDists.sort((a, b) => a - b)
    const medSrc = srcDists[srcDists.length >> 1]!
    const p80Src = srcDists[Math.floor(srcDists.length * 0.8)]!
    const p80Comp = compDists[Math.floor(compDists.length * 0.8)]!
    if (medSrc <= 8.5 && p80Src <= 12.5 && p80Comp <= 18 && p80Src < bestHP80) {
      bestHP80 = p80Src
      bestHShift = shift
    }
  }

  if (bestHShift !== null) {
    for (let y = 0; y < h; y++) {
      const row = y * w
      for (let x = 0; x < w; x++) {
        const p = row + x
        if (!hole[p] || mirrorFilled[p]) continue
        const mx = w - 1 - x + bestHShift
        if (mx < 0 || mx >= w || mx === x) continue
        const mp = row + mx
        if (hole[mp]) continue
        const pi = p * 4
        const mpi = mp * 4
        if (companionRgba.data[pi + 3]! < 196 || companionRgba.data[mpi + 3]! < 216) continue
        if (pixelDistance(companionRgba.data, pi, companionRgba.data, mpi) > 22) continue
        mirrorRgb[pi] = sourceCrop.data[mpi]!
        mirrorRgb[pi + 1] = sourceCrop.data[mpi + 1]!
        mirrorRgb[pi + 2] = sourceCrop.data[mpi + 2]!
        mirrorRgb[pi + 3] = 255
        mirrorFilled[p] = 1
        filledCount++
      }
    }
  }

  // 2) Test vertical bilateral symmetry (`my = h - 1 - y + shift`) for remaining hole pixels
  let bestVShift: number | null = null
  let bestVP80 = Infinity
  for (const shift of [0, -1, 1]) {
    let alphaInter = 0
    let alphaUnion = 0
    const srcDists: number[] = []
    const compDists: number[] = []
    for (let y = 0; y < h; y++) {
      const my = h - 1 - y + shift
      if (my <= y || my >= h || my < 0) continue
      const row = y * w
      const mrow = my * w
      for (let x = 0; x < w; x++) {
        const p = row + x
        const mp = mrow + x
        const a1 = companionRgba.data[p * 4 + 3]! >= 180
        const a2 = companionRgba.data[mp * 4 + 3]! >= 180
        if (a1 || a2) {
          alphaUnion++
          if (a1 && a2) alphaInter++
        }
        if (
          !hole[p] &&
          !hole[mp] &&
          companionRgba.data[p * 4 + 3]! >= 200 &&
          companionRgba.data[mp * 4 + 3]! >= 200
        ) {
          srcDists.push(pixelDistance(sourceCrop.data, p * 4, sourceCrop.data, mp * 4))
          compDists.push(pixelDistance(companionRgba.data, p * 4, companionRgba.data, mp * 4))
        }
      }
    }
    if (alphaUnion < 24 || alphaInter / alphaUnion < 0.86 || srcDists.length < 24) continue
    srcDists.sort((a, b) => a - b)
    compDists.sort((a, b) => a - b)
    const medSrc = srcDists[srcDists.length >> 1]!
    const p80Src = srcDists[Math.floor(srcDists.length * 0.8)]!
    const p80Comp = compDists[Math.floor(compDists.length * 0.8)]!
    if (medSrc <= 8.5 && p80Src <= 12.5 && p80Comp <= 18 && p80Src < bestVP80) {
      bestVP80 = p80Src
      bestVShift = shift
    }
  }

  if (bestVShift !== null) {
    for (let y = 0; y < h; y++) {
      const my = h - 1 - y + bestVShift
      if (my < 0 || my >= h || my === y) continue
      const row = y * w
      const mrow = my * w
      for (let x = 0; x < w; x++) {
        const p = row + x
        if (!hole[p] || mirrorFilled[p]) continue
        const mp = mrow + x
        if (hole[mp]) continue
        const pi = p * 4
        const mpi = mp * 4
        if (companionRgba.data[pi + 3]! < 196 || companionRgba.data[mpi + 3]! < 216) continue
        if (pixelDistance(companionRgba.data, pi, companionRgba.data, mpi) > 22) continue
        mirrorRgb[pi] = sourceCrop.data[mpi]!
        mirrorRgb[pi + 1] = sourceCrop.data[mpi + 1]!
        mirrorRgb[pi + 2] = sourceCrop.data[mpi + 2]!
        mirrorRgb[pi + 3] = 255
        mirrorFilled[p] = 1
        filledCount++
      }
    }
  }

  return { mirrorRgb, mirrorFilled, filledCount }
}

/**
 * Hybrid pixel-locked composition for studio-purified graphical layers AND singleton UI containers:
 * - Uses the studio-purified `companionRgba` alpha as a clean, halo-free outer silhouette.
 * - Locks 100% of unoccluded core pixels (`compA >= 216`) directly to `source` RGB so stylized glyphs,
 *   numbers, character faces, and complex panel textures suffer zero AI re-rendering drift.
 * - Transfers exact bilateral mirror `source` texture into occluded holes on symmetric banners/frames.
 * - Uses foreground-harmonized studio-unmixed `harmonizedCompanion` RGB + `compA` along anti-aliased
 *   boundary pixels (`8 <= compA < 216`) and remaining non-symmetric occluded regions.
 */
export function composeHybridCompanionContentLayer(input: {
  source: RgbaImage
  lower: RgbaImage
  entry: CompanionContentEntry
  aboveAlpha: Float32Array
}): { rect: PixelRect; rgba: Uint8ClampedArray } | null {
  const { source, entry, aboveAlpha } = input
  const { rect, companionRgba, occludedMask } = entry
  const w = rect.width
  const h = rect.height
  const W = source.width
  const H = source.height
  if (w <= 0 || h <= 0 || companionRgba.width !== w || companionRgba.height !== h) return null

  const sourceCrop = cropImage(source, rect)
  const hole = new Uint8Array(w * h)
  let holeCount = 0
  let visibleRingCount = 0
  for (let y = 0; y < h; y++) {
    const cy = rect.top + y
    for (let x = 0; x < w; x++) {
      const cx = rect.left + x
      const p = y * w + x
      if (companionRgba.data[p * 4 + 3]! < 16) continue
      const g = cy >= 0 && cy < H && cx >= 0 && cx < W ? cy * W + cx : -1
      const isOcc = occludedMask[p] === 1 || (g >= 0 && aboveAlpha[g]! >= 0.05)
      if (isOcc) {
        hole[p] = 1
        holeCount++
      } else {
        visibleRingCount++
      }
    }
  }

  const mirror =
    holeCount >= 4 && visibleRingCount >= 24
      ? transferBilateralMirrorTextureIntoHole(sourceCrop, companionRgba, hole)
      : { mirrorRgb: new Uint8ClampedArray(0), mirrorFilled: new Uint8Array(w * h), filledCount: 0 }

  let harmonizedCompanion = companionRgba
  if (visibleRingCount >= 8) {
    const remainingHole = new Uint8Array(w * h)
    let remHoleCnt = 0
    for (let p = 0; p < w * h; p++) {
      if (hole[p] && !mirror.mirrorFilled[p]) {
        remainingHole[p] = 1
        remHoleCnt++
      }
    }
    const ring = remHoleCnt > 0 ? dilateMask(remainingHole, w, h, 4) : null
    const offset = createImage(w, h)
    const unknown = new Uint8Array(w * h)
    let seedCount = 0
    for (let p = 0; p < w * h; p++) {
      const i = p * 4
      const hasKnownRef = !hole[p] || mirror.mirrorFilled[p] === 1
      const inSeedBand = ring ? Boolean(ring[p] && hasKnownRef) : hasKnownRef
      const refBuf = mirror.mirrorFilled[p] ? mirror.mirrorRgb : sourceCrop.data
      if (
        inSeedBand &&
        companionRgba.data[i + 3]! >= 180 &&
        pixelDistance(refBuf, i, companionRgba.data, i) <= 45
      ) {
        for (let c = 0; c < 3; c++) {
          offset.data[i + c] = Math.max(
            0,
            Math.min(255, 128 + refBuf[i + c]! - companionRgba.data[i + c]!)
          )
        }
        offset.data[i + 3] = 255
        seedCount++
      } else {
        unknown[p] = 1
        offset.data[i + 3] = 255
      }
    }
    if (seedCount >= 4) {
      inpaintPushPull(offset, unknown)
      harmonizedCompanion = cloneImage(companionRgba)
      for (let p = 0; p < w * h; p++) {
        if (!hole[p] && companionRgba.data[p * 4 + 3]! >= 216) continue
        const i = p * 4
        if (mirror.mirrorFilled[p]) {
          harmonizedCompanion.data[i] = mirror.mirrorRgb[i]!
          harmonizedCompanion.data[i + 1] = mirror.mirrorRgb[i + 1]!
          harmonizedCompanion.data[i + 2] = mirror.mirrorRgb[i + 2]!
          continue
        }
        for (let c = 0; c < 3; c++) {
          harmonizedCompanion.data[i + c] = Math.max(
            0,
            Math.min(255, companionRgba.data[i + c]! + offset.data[i + c]! - 128)
          )
        }
      }
    } else if (mirror.filledCount > 0) {
      harmonizedCompanion = cloneImage(companionRgba)
      for (let p = 0; p < w * h; p++) {
        if (!mirror.mirrorFilled[p]) continue
        const i = p * 4
        harmonizedCompanion.data[i] = mirror.mirrorRgb[i]!
        harmonizedCompanion.data[i + 1] = mirror.mirrorRgb[i + 1]!
        harmonizedCompanion.data[i + 2] = mirror.mirrorRgb[i + 2]!
      }
    }
  }

  const out = new Uint8ClampedArray(w * h * 4)
  let written = 0

  for (let y = 0; y < h; y++) {
    const cy = rect.top + y
    if (cy < 0 || cy >= H) continue
    for (let x = 0; x < w; x++) {
      const cx = rect.left + x
      if (cx < 0 || cx >= W) continue
      const p = y * w + x
      const ci = p * 4
      const compA = companionRgba.data[ci + 3]!
      if (compA < 8) continue

      const g = cy * W + cx
      const gi = g * 4
      const isOcc = hole[p] === 1

      if (mirror.mirrorFilled[p] && compA >= 216) {
        out[ci] = mirror.mirrorRgb[ci]!
        out[ci + 1] = mirror.mirrorRgb[ci + 1]!
        out[ci + 2] = mirror.mirrorRgb[ci + 2]!
        out[ci + 3] = 255
        written++
        continue
      }

      if (isOcc || compA < 216) {
        out[ci] = harmonizedCompanion.data[ci]!
        out[ci + 1] = harmonizedCompanion.data[ci + 1]!
        out[ci + 2] = harmonizedCompanion.data[ci + 2]!
        out[ci + 3] = compA
        written++
        continue
      }

      // 100% pixel-locked to original `source` RGB on unoccluded solid foreground (`compA >= 216`)
      out[ci] = source.data[gi]!
      out[ci + 1] = source.data[gi + 1]!
      out[ci + 2] = source.data[gi + 2]!
      out[ci + 3] = 255
      written++
    }
  }

  if (written === 0) return null
  bleedTransparentRgb(out, w, h, 3)
  return { rect: { ...rect }, rgba: out }
}

const RIM_REFINE_KINDS = new Set<string>([
  'avatar',
  'illustration',
  'art-text',
  'icon',
  'decoration',
  'badge',
  'close-button',
  'arrow'
])

const DROP_SHADOW_ELIGIBLE_KINDS = new Set<string>([
  'panel',
  'banner',
  'frame',
  'button',
  'tab',
  'badge',
  'item-slot',
  'avatar',
  'illustration',
  'art-text',
  'icon',
  'close-button'
])

const CANDIDATE_BLUR_RADII = [0, 2, 5, 10, 16] as const

interface LocalBackdropSampler {
  radius: number
  padRect: PixelRect
  data: Uint8ClampedArray
}

function buildMultiScaleBlurredBackdrops(
  backdrop: RgbaImage,
  rect: PixelRect
): LocalBackdropSampler[] {
  const padRect = expandRect(rect, 18, backdrop.width, backdrop.height)
  const pw = padRect.width
  const ph = padRect.height
  const crop = cropImage(backdrop, padRect)
  const r0 = new Float32Array(pw * ph)
  const g0 = new Float32Array(pw * ph)
  const b0 = new Float32Array(pw * ph)
  for (let p = 0; p < pw * ph; p++) {
    const i = p * 4
    r0[p] = crop.data[i]!
    g0[p] = crop.data[i + 1]!
    b0[p] = crop.data[i + 2]!
  }

  const out: LocalBackdropSampler[] = [{ radius: 0, padRect, data: crop.data }]
  for (let bi = 1; bi < CANDIDATE_BLUR_RADII.length; bi++) {
    const rad = CANDIDATE_BLUR_RADII[bi]!
    const boxR = Math.max(1, Math.round(rad * 0.75))
    // Two-pass separable box blur approximates isotropic Gaussian backdrop-filter blur
    const rb = boxBlurFloat(boxBlurFloat(r0, pw, ph, boxR), pw, ph, boxR)
    const gb = boxBlurFloat(boxBlurFloat(g0, pw, ph, boxR), pw, ph, boxR)
    const bb = boxBlurFloat(boxBlurFloat(b0, pw, ph, boxR), pw, ph, boxR)
    const buf = new Uint8ClampedArray(pw * ph * 4)
    for (let p = 0; p < pw * ph; p++) {
      const i = p * 4
      buf[i] = Math.round(rb[p]!)
      buf[i + 1] = Math.round(gb[p]!)
      buf[i + 2] = Math.round(bb[p]!)
      buf[i + 3] = 255
    }
    out.push({ radius: rad, padRect, data: buf })
  }
  return out
}

function solve3x3Linear(
  m00: number,
  m01: number,
  m02: number,
  m11: number,
  m12: number,
  m22: number,
  b0: number,
  b1: number,
  b2: number
): [number, number, number] | null {
  const a = [
    [m00, m01, m02, b0],
    [m01, m11, m12, b1],
    [m02, m12, m22, b2]
  ]
  for (let col = 0; col < 3; col++) {
    let piv = col
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[piv]![col]!)) piv = r
    }
    if (Math.abs(a[piv]![col]!) < 1e-7) return null
    if (piv !== col) {
      const tmp = a[col]!
      a[col] = a[piv]!
      a[piv] = tmp
    }
    const diag = a[col]![col]!
    for (let j = col; j < 4; j++) a[col]![j]! /= diag
    for (let r = 0; r < 3; r++) {
      if (r === col) continue
      const f = a[r]![col]!
      for (let j = col; j < 4; j++) a[r]![j]! -= f * a[col]![j]!
    }
  }
  return [a[0]![3]!, a[1]![3]!, a[2]![3]!]
}

/**
 * Fallback solver for continuous spatially-varying gradient alpha (`alpha(x, y) = c0 + cx*u + cy*v`)
 * on scrims, fade banners, and glass cards where continuous spatial opacity prevented discrete
 * studio-color bucket clustering.
 * Uses strictly local pixel pairs (`dist <= 15px`) across backdrop edges so opaque color gradients
 * (`t_local ~ 0`) never false-positive.
 */
function solveContinuousGradientTranslucency(input: {
  rect: PixelRect
  out: Uint8ClampedArray
  studioSkin: RgbaImage
  occludedMask: Uint8Array
  source: RgbaImage
  samplers: LocalBackdropSampler[]
}): { applied: boolean; blurRadius: number } {
  const { rect, out, studioSkin, occludedMask, source, samplers } = input
  const w = rect.width
  const h = rect.height
  const n = w * h
  const W = source.width
  const H = source.height
  if (w < 16 || h < 12) return { applied: false, blurRadius: 0 }

  // Identify optional opaque border rim in `studioSkin` so crisp borders stay at alpha = 255
  const solidMask = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    if (out[p * 4 + 3]! >= 180 && studioSkin.data[p * 4 + 3]! >= 180) solidMask[p] = 1
  }
  const innerMask = erodeMask(solidMask, w, h, 3)
  const intRs: number[] = []
  const intGs: number[] = []
  const intBs: number[] = []
  for (let p = 0; p < n; p++) {
    if (!innerMask[p] || occludedMask[p]) continue
    const si = p * 4
    intRs.push(studioSkin.data[si]!)
    intGs.push(studioSkin.data[si + 1]!)
    intBs.push(studioSkin.data[si + 2]!)
  }
  if (intRs.length < 24) return { applied: false, blurRadius: 0 }
  intRs.sort((a, b) => a - b)
  intGs.sort((a, b) => a - b)
  intBs.sort((a, b) => a - b)
  const medIntStudio = new Uint8ClampedArray([
    intRs[intRs.length >> 1]!,
    intGs[intGs.length >> 1]!,
    intBs[intBs.length >> 1]!,
    255
  ])

  const opaqueBorder = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    if (!solidMask[p] || innerMask[p]) continue
    if (pixelDistance(studioSkin.data, p * 4, medIntStudio, 0) >= 28) {
      opaqueBorder[p] = 1
    }
  }

  // Subsample unobstructed interior pixels on a regular stride for local pair probing
  const stepX = Math.max(2, Math.floor(w / 24))
  const stepY = Math.max(2, Math.floor(h / 24))
  const probePts: number[] = []
  for (let y = 2; y < h - 2; y += stepY) {
    const cy = rect.top + y
    if (cy < 0 || cy >= H) continue
    for (let x = 2; x < w - 2; x += stepX) {
      const cx = rect.left + x
      if (cx < 0 || cx >= W) continue
      const p = y * w + x
      if (occludedMask[p] || opaqueBorder[p] || !solidMask[p]) continue
      probePts.push(p)
    }
  }
  if (probePts.length < 16) return { applied: false, blurRadius: 0 }

  interface PairObs {
    u: number
    v: number
    alpha: number
    perp: number
  }

  let bestSampler: LocalBackdropSampler | null = null
  let bestCoeffs: [number, number, number] | null = null
  let bestScore = Infinity

  for (const sampler of samplers) {
    const { padRect, data: bgData } = sampler
    const pw = padRect.width
    const obs: PairObs[] = []

    for (let i = 0; i < probePts.length; i++) {
      const pa = probePts[i]!
      const ax = pa % w
      const ay = (pa - ax) / w
      const ga = ((rect.top + ay) * W + (rect.left + ax)) * 4
      const ba = ((rect.top + ay - padRect.top) * pw + (rect.left + ax - padRect.left)) * 4
      for (let j = i + 1; j < probePts.length; j++) {
        const pb = probePts[j]!
        const bx = pb % w
        const by = (pb - bx) / w
        const dx = ax - bx
        const dy = ay - by
        const dist2 = dx * dx + dy * dy
        if (dist2 > 256 || dist2 < 4) continue

        const bb = ((rect.top + by - padRect.top) * pw + (rect.left + bx - padRect.left)) * 4
        const dBgR = bgData[ba]! - bgData[bb]!
        const dBgG = bgData[ba + 1]! - bgData[bb + 1]!
        const dBgB = bgData[ba + 2]! - bgData[bb + 2]!
        const bgLen2 = dBgR * dBgR + dBgG * dBgG + dBgB * dBgB
        if (bgLen2 < 1200) continue

        const gb = ((rect.top + by) * W + (rect.left + bx)) * 4
        const dObsR = source.data[ga]! - source.data[gb]!
        const dObsG = source.data[ga + 1]! - source.data[gb + 1]!
        const dObsB = source.data[ga + 2]! - source.data[gb + 2]!

        const t = (dObsR * dBgR + dObsG * dBgG + dObsB * dBgB) / bgLen2
        if (t < 0.05 || t > 0.96) continue
        const resR = dObsR - t * dBgR
        const resG = dObsG - t * dBgG
        const resB = dObsB - t * dBgB
        const perp = Math.sqrt((resR * resR + resG * resG + resB * resB) / 3)
        if (perp > 13.5) continue

        obs.push({
          u: (ax + bx + 1) / (2 * w) - 0.5,
          v: (ay + by + 1) / (2 * h) - 0.5,
          alpha: 1 - t,
          perp
        })
      }
    }

    if (obs.length < 16) continue

    // 2-round IRLS plane fit: `alpha(u, v) = c0 + cx * u + cy * v`
    let coeffs: [number, number, number] | null = null
    for (let iter = 0; iter < 2; iter++) {
      let m00 = 0
      let m01 = 0
      let m02 = 0
      let m11 = 1e-3
      let m12 = 0
      let m22 = 1e-3
      let r0 = 0
      let r1 = 0
      let r2 = 0
      for (const o of obs) {
        const wt =
          coeffs === null
            ? 1
            : 1 /
              Math.max(0.035, Math.abs(o.alpha - (coeffs[0] + coeffs[1] * o.u + coeffs[2] * o.v)))
        m00 += wt
        m01 += wt * o.u
        m02 += wt * o.v
        m11 += wt * o.u * o.u
        m12 += wt * o.u * o.v
        m22 += wt * o.v * o.v
        r0 += wt * o.alpha
        r1 += wt * o.u * o.alpha
        r2 += wt * o.v * o.alpha
      }
      coeffs = solve3x3Linear(m00, m01, m02, m11, m12, m22, r0, r1, r2)
      if (!coeffs) break
    }
    if (!coeffs) continue

    const [c0, cx, cy] = coeffs
    if (c0 < 0.06 || c0 > 0.92) continue

    const absErrs: number[] = []
    const perps: number[] = []
    for (const o of obs) {
      const pred = Math.max(0.02, Math.min(0.98, c0 + cx * o.u + cy * o.v))
      absErrs.push(Math.abs(o.alpha - pred))
      perps.push(o.perp)
    }
    absErrs.sort((a, b) => a - b)
    perps.sort((a, b) => a - b)
    const medErr = absErrs[absErrs.length >> 1]!
    const p80Err = absErrs[Math.floor(absErrs.length * 0.8)]!
    const medPerp = perps[perps.length >> 1]!
    if (medErr > 0.095 || p80Err > 0.16 || medPerp > 11.5) continue

    const score = medPerp + medErr * 45
    const allowBlur = sampler.radius === 0 || bestSampler === null || score <= bestScore * 0.72
    if (allowBlur && score < bestScore) {
      bestScore = score
      bestSampler = sampler
      bestCoeffs = coeffs
    }
  }

  if (!bestSampler || !bestCoeffs) return { applied: false, blurRadius: 0 }

  const [c0, cx, cy] = bestCoeffs
  const { padRect, data: bgData } = bestSampler
  const pw = padRect.width

  // Estimate clean anchor foreground tint from higher-alpha (`>= 0.28`) unobstructed pixels
  const tintRs: number[] = []
  const tintGs: number[] = []
  const tintBs: number[] = []
  for (let y = 0; y < h; y++) {
    const gy = rect.top + y
    if (gy < 0 || gy >= H) continue
    const v = (y + 0.5) / h - 0.5
    for (let x = 0; x < w; x++) {
      const gx = rect.left + x
      if (gx < 0 || gx >= W) continue
      const p = y * w + x
      if (occludedMask[p] || opaqueBorder[p] || !solidMask[p]) continue
      const u = (x + 0.5) / w - 0.5
      const a = Math.max(0.04, Math.min(0.96, c0 + cx * u + cy * v))
      if (a < 0.28) continue
      const gi = (gy * W + gx) * 4
      const bi = ((gy - padRect.top) * pw + (gx - padRect.left)) * 4
      tintRs.push(
        Math.max(0, Math.min(255, Math.round((source.data[gi]! - bgData[bi]! * (1 - a)) / a)))
      )
      tintGs.push(
        Math.max(
          0,
          Math.min(255, Math.round((source.data[gi + 1]! - bgData[bi + 1]! * (1 - a)) / a))
        )
      )
      tintBs.push(
        Math.max(
          0,
          Math.min(255, Math.round((source.data[gi + 2]! - bgData[bi + 2]! * (1 - a)) / a))
        )
      )
    }
  }
  const anchorTint: [number, number, number] =
    tintRs.length >= 8
      ? [
          tintRs.sort((a, b) => a - b)[tintRs.length >> 1]!,
          tintGs.sort((a, b) => a - b)[tintGs.length >> 1]!,
          tintBs.sort((a, b) => a - b)[tintBs.length >> 1]!
        ]
      : [medIntStudio[0]!, medIntStudio[1]!, medIntStudio[2]!]

  const fgCanvas = createImage(w, h)
  const unknown = new Uint8Array(n)
  let seeds = 0
  for (let y = 0; y < h; y++) {
    const gy = rect.top + y
    const v = (y + 0.5) / h - 0.5
    for (let x = 0; x < w; x++) {
      const gx = rect.left + x
      const p = y * w + x
      const pi = p * 4
      if (
        gy < 0 ||
        gy >= H ||
        gx < 0 ||
        gx >= W ||
        occludedMask[p] ||
        opaqueBorder[p] ||
        out[pi + 3]! < 8
      ) {
        unknown[p] = 1
        continue
      }
      const u = (x + 0.5) / w - 0.5
      const planeA = Math.max(0.03, Math.min(0.96, c0 + cx * u + cy * v))
      const gi = (gy * W + gx) * 4
      const bi = ((gy - padRect.top) * pw + (gx - padRect.left)) * 4
      const trustDirect = Math.max(0, Math.min(1, (planeA - 0.14) / 0.24))
      for (let ch = 0; ch < 3; ch++) {
        const direct = Math.max(
          0,
          Math.min(255, (source.data[gi + ch]! - bgData[bi + ch]! * (1 - planeA)) / planeA)
        )
        fgCanvas.data[pi + ch] = Math.round(
          direct * trustDirect + anchorTint[ch]! * (1 - trustDirect)
        )
      }
      fgCanvas.data[pi + 3] = 255
      seeds++
    }
  }
  if (seeds >= 8) {
    inpaintPushPull(fgCanvas, unknown)
  }

  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h - 0.5
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (opaqueBorder[p]) continue
      const pi = p * 4
      const curA = Math.min(out[pi + 3]!, studioSkin.data[pi + 3]!)
      if (curA < 8) {
        out[pi + 3] = 0
        continue
      }
      const u = (x + 0.5) / w - 0.5
      const planeA = Math.max(0.03, Math.min(0.96, c0 + cx * u + cy * v))
      const aByte = Math.min(curA, Math.round(planeA * (curA / 255) * 255))
      out[pi] = fgCanvas.data[pi]!
      out[pi + 1] = fgCanvas.data[pi + 1]!
      out[pi + 2] = fgCanvas.data[pi + 2]!
      out[pi + 3] = aByte < 6 ? 0 : aByte
    }
  }

  bleedTransparentRgb(out, w, h, 3)
  return { applied: true, blurRadius: bestSampler.radius }
}

/**
 * Step C: Closed-form Color-Line fine hair/silhouette matting + neutral soft drop-shadow recovery.
 * Expands `rect` by up to `6px` ONLY if real protruding hair strands or verified neutral drop shadows
 * exist outside `rect`; otherwise preserves exact `rect`.
 */
function applyRimMattingAndDropShadow(input: {
  kind: UiElementKind
  rect: PixelRect
  rgba: Uint8ClampedArray
  studioSkin: RgbaImage
  occludedMask: Uint8Array
  buildOccMask?: (r: PixelRect) => Uint8Array
  allowOuterExpansion: boolean
  source: RgbaImage
  backdrop: RgbaImage
}): { rect: PixelRect; rgba: Uint8ClampedArray; rimRefinedPx: number } {
  const {
    kind,
    rect,
    rgba,
    studioSkin,
    occludedMask,
    buildOccMask,
    allowOuterExpansion,
    source,
    backdrop
  } = input
  const doRim = RIM_REFINE_KINDS.has(kind)
  const doShadow = allowOuterExpansion && DROP_SHADOW_ELIGIBLE_KINDS.has(kind)
  if (!doRim && !doShadow) {
    return { rect, rgba, rimRefinedPx: 0 }
  }

  const W = source.width
  const H = source.height
  const pad = allowOuterExpansion ? 6 : 0
  const workRect = pad > 0 ? expandRect(rect, pad, W, H) : { ...rect }
  const ww = workRect.width
  const wh = workRect.height
  const wn = ww * wh
  const ox = rect.left - workRect.left
  const oy = rect.top - workRect.top

  const workRgba = new Uint8ClampedArray(wn * 4)
  for (let y = 0; y < rect.height; y++) {
    const wy = oy + y
    for (let x = 0; x < rect.width; x++) {
      const si = (y * rect.width + x) * 4
      const di = (wy * ww + (ox + x)) * 4
      workRgba[di] = rgba[si]!
      workRgba[di + 1] = rgba[si + 1]!
      workRgba[di + 2] = rgba[si + 2]!
      workRgba[di + 3] = rgba[si + 3]!
    }
  }

  const workOcc =
    pad > 0 && buildOccMask
      ? buildOccMask(workRect)
      : (() => {
          const m = new Uint8Array(wn)
          for (let y = 0; y < rect.height; y++) {
            for (let x = 0; x < rect.width; x++) {
              if (occludedMask[y * rect.width + x]) m[(oy + y) * ww + (ox + x)] = 1
            }
          }
          return m
        })()

  let rimRefinedPx = 0

  // ---- Part C1: Sub-pixel Rim & Protruding Hair Strand Color-Line Matting ----
  if (doRim) {
    const coreMask = new Uint8Array(wn)
    let coreCnt = 0
    for (let wp = 0; wp < wn; wp++) {
      if (!workOcc[wp] && workRgba[wp * 4 + 3]! >= 200) {
        coreMask[wp] = 1
        coreCnt++
      }
    }
    if (coreCnt >= 16) {
      const innerCore = erodeMask(coreMask, ww, wh, 1)
      const outerBand = dilateMask(coreMask, ww, wh, 3)
      const strandCand = new Uint8Array(wn)
      const strandRgba = new Uint8ClampedArray(wn * 4)

      for (let wy = 0; wy < wh; wy++) {
        const cy = workRect.top + wy
        if (cy < 0 || cy >= H) continue
        for (let wx = 0; wx < ww; wx++) {
          const cx = workRect.left + wx
          if (cx < 0 || cx >= W) continue
          const wp = wy * ww + wx
          if (!outerBand[wp] || innerCore[wp] || workOcc[wp]) continue

          const wpi = wp * 4
          const curA = workRgba[wpi + 3]!
          const gi = (cy * W + cx) * 4
          const dBg = pixelDistance(source.data, gi, backdrop.data, gi)

          // 1) Trim over-grown studio soft fringe where `source` is pure `backdrop`
          if (curA > 0 && curA < 216 && dBg <= 6) {
            const lx = wx - ox
            const ly = wy - oy
            const dCompBg =
              lx >= 0 && lx < rect.width && ly >= 0 && ly < rect.height
                ? pixelDistance(studioSkin.data, (ly * rect.width + lx) * 4, backdrop.data, gi)
                : pixelDistance(workRgba, wpi, backdrop.data, gi)
            if (dCompBg >= 36) {
              workRgba[wpi + 3] = 0
              rimRefinedPx++
              continue
            }
          }

          // 2) Recover clipped fine hair strand / feather tip outside silhouette (`curA < 24`)
          if (curA < 24 && dBg >= 22) {
            const bgR = backdrop.data[gi]!
            const bgG = backdrop.data[gi + 1]!
            const bgB = backdrop.data[gi + 2]!
            const obsR = source.data[gi]!
            const obsG = source.data[gi + 1]!
            const obsB = source.data[gi + 2]!
            // Reject neutral darkening here so drop shadows are handled as `[0,0,0,a]` in Part C2
            const bgLum = 0.2126 * bgR + 0.7152 * bgG + 0.0722 * bgB
            const obsLum = 0.2126 * obsR + 0.7152 * obsG + 0.0722 * obsB
            const bgNorm2 = bgR * bgR + bgG * bgG + bgB * bgB
            if (bgLum >= 48 && obsLum < bgLum && bgNorm2 >= 6500) {
              const kSh = (obsR * bgR + obsG * bgG + obsB * bgB) / bgNorm2
              const rCh = Math.sqrt(
                ((obsR - kSh * bgR) ** 2 + (obsG - kSh * bgG) ** 2 + (obsB - kSh * bgB) ** 2) / 3
              )
              if (kSh >= 0.3 && kSh <= 0.95 && rCh <= 5.5) continue
            }

            let bestPerp = Infinity
            let bestAlpha = 0
            let bestFg: [number, number, number] | null = null
            for (let dy = -4; dy <= 4; dy++) {
              const ny = wy + dy
              if (ny < 0 || ny >= wh) continue
              for (let dx = -4; dx <= 4; dx++) {
                const nx = wx + dx
                if (nx < 0 || nx >= ww) continue
                const np = ny * ww + nx
                if (!coreMask[np]) continue
                const ni = np * 4
                const fR = workRgba[ni]!
                const fG = workRgba[ni + 1]!
                const fB = workRgba[ni + 2]!
                const vR = fR - bgR
                const vG = fG - bgG
                const vB = fB - bgB
                const vLen2 = vR * vR + vG * vG + vB * vB
                if (vLen2 < 1936) continue // Euclidean contrast >= 44
                const aProj = ((obsR - bgR) * vR + (obsG - bgG) * vG + (obsB - bgB) * vB) / vLen2
                if (aProj < 0.18 || aProj > 1.04) continue
                const aClamped = Math.min(1, aProj)
                const eR = obsR - bgR - aClamped * vR
                const eG = obsG - bgG - aClamped * vG
                const eB = obsB - bgB - aClamped * vB
                const perp = Math.sqrt((eR * eR + eG * eG + eB * eB) / 3)
                if (perp < bestPerp) {
                  bestPerp = perp
                  bestAlpha = aClamped
                  bestFg = [fR, fG, fB]
                }
              }
            }

            if (bestFg && bestPerp <= 7.5 && bestAlpha >= 0.18) {
              const aByte = Math.max(28, Math.min(255, Math.round(bestAlpha * 255)))
              const a = aByte / 255
              const trust = Math.max(0, Math.min(1, (a - 0.35) / 0.45))
              strandCand[wp] = 1
              strandRgba[wpi] = Math.round(
                Math.max(0, Math.min(255, (obsR - bgR * (1 - a)) / a)) * trust +
                  bestFg[0] * (1 - trust)
              )
              strandRgba[wpi + 1] = Math.round(
                Math.max(0, Math.min(255, (obsG - bgG * (1 - a)) / a)) * trust +
                  bestFg[1] * (1 - trust)
              )
              strandRgba[wpi + 2] = Math.round(
                Math.max(0, Math.min(255, (obsB - bgB * (1 - a)) / a)) * trust +
                  bestFg[2] * (1 - trust)
              )
              strandRgba[wpi + 3] = aByte
            }
          }
        }
      }

      // Keep only recovered hair/strand components 8-connected to `coreMask`
      const coreTouch = dilateMask(coreMask, ww, wh, 1)
      const comp = labelComponents8(strandCand, ww, wh)
      if (comp.stats.length > 0) {
        const keep = new Uint8Array(comp.stats.length + 1)
        for (let wp = 0; wp < wn; wp++) {
          const lbl = comp.labels[wp]!
          if (lbl && coreTouch[wp]) keep[lbl] = 1
        }
        for (let wp = 0; wp < wn; wp++) {
          const lbl = comp.labels[wp]!
          if (!lbl || !keep[lbl]) continue
          const wpi = wp * 4
          workRgba[wpi] = strandRgba[wpi]!
          workRgba[wpi + 1] = strandRgba[wpi + 1]!
          workRgba[wpi + 2] = strandRgba[wpi + 2]!
          workRgba[wpi + 3] = strandRgba[wpi + 3]!
          rimRefinedPx++
        }
      }
    }
  }

  // ---- Part C2: Pure Soft Drop Shadow Recovery (`[0, 0, 0, alpha_sh]`) ----
  if (doShadow) {
    // Exclude outer 6px rim pixels whose baked `source` RGB is actually a swallowed neutral drop shadow
    // (`studioSkin` disagrees strongly with `source` while `source` is pure multiplicative `k * backdrop`)
    const solidMask = new Uint8Array(wn)
    let solidCnt = 0
    for (let wy = 0; wy < wh; wy++) {
      const cy = workRect.top + wy
      for (let wx = 0; wx < ww; wx++) {
        const wp = wy * ww + wx
        if (workRgba[wp * 4 + 3]! < 180) continue
        const cx = workRect.left + wx
        const lx = wx - ox
        const ly = wy - oy
        const inOuterRim =
          lx >= 0 &&
          lx < rect.width &&
          ly >= 0 &&
          ly < rect.height &&
          (lx < 6 || lx >= rect.width - 6 || ly < 6 || ly >= rect.height - 6)
        if (inOuterRim && !workOcc[wp] && cy >= 0 && cy < H && cx >= 0 && cx < W) {
          const gi = (cy * W + cx) * 4
          const si = (ly * rect.width + lx) * 4
          const bgR = backdrop.data[gi]!
          const bgG = backdrop.data[gi + 1]!
          const bgB = backdrop.data[gi + 2]!
          const obsR = source.data[gi]!
          const obsG = source.data[gi + 1]!
          const obsB = source.data[gi + 2]!
          const bgLum = 0.2126 * bgR + 0.7152 * bgG + 0.0722 * bgB
          const obsLum = 0.2126 * obsR + 0.7152 * obsG + 0.0722 * obsB
          const bgNorm2 = bgR * bgR + bgG * bgG + bgB * bgB
          if (
            bgLum >= 52 &&
            bgNorm2 >= 7500 &&
            obsR <= bgR + 1 &&
            obsG <= bgG + 1 &&
            obsB <= bgB + 1 &&
            bgLum - obsLum >= 8 &&
            pixelDistance(studioSkin.data, si, source.data, gi) >= 36
          ) {
            const k = (obsR * bgR + obsG * bgG + obsB * bgB) / bgNorm2
            const aSh = 1 - k
            const rCh = Math.sqrt(
              ((obsR - k * bgR) ** 2 + (obsG - k * bgG) ** 2 + (obsB - k * bgB) ** 2) / 3
            )
            if (aSh >= 0.07 && aSh <= 0.65 && rCh <= 5.0) {
              continue
            }
          }
        }
        solidMask[wp] = 1
        solidCnt++
      }
    }
    if (solidCnt >= 20) {
      const near1 = dilateMask(solidMask, ww, wh, 2)
      const near6 = dilateMask(solidMask, ww, wh, 6)
      const shCand = new Uint8Array(wn)
      const shAlpha = new Float32Array(wn)

      for (let wy = 0; wy < wh; wy++) {
        const cy = workRect.top + wy
        if (cy < 0 || cy >= H) continue
        for (let wx = 0; wx < ww; wx++) {
          const cx = workRect.left + wx
          if (cx < 0 || cx >= W) continue
          const wp = wy * ww + wx
          if (!near6[wp] || solidMask[wp] || workOcc[wp]) continue
          const lx = wx - ox
          const ly = wy - oy
          if (workRgba[wp * 4 + 3]! >= 12) {
            // Only replace opaque/semi-opaque pixels inside `rect` if they were excluded above as swallowed shadow
            if (lx < 0 || lx >= rect.width || ly < 0 || ly >= rect.height) continue
          }

          const gi = (cy * W + cx) * 4
          const bgR = backdrop.data[gi]!
          const bgG = backdrop.data[gi + 1]!
          const bgB = backdrop.data[gi + 2]!
          const bgLum = 0.2126 * bgR + 0.7152 * bgG + 0.0722 * bgB
          const bgNorm2 = bgR * bgR + bgG * bgG + bgB * bgB
          if (bgLum < 52 || bgNorm2 < 7500) continue

          const obsR = source.data[gi]!
          const obsG = source.data[gi + 1]!
          const obsB = source.data[gi + 2]!
          if (obsR > bgR + 1 || obsG > bgG + 1 || obsB > bgB + 1) continue
          const obsLum = 0.2126 * obsR + 0.7152 * obsG + 0.0722 * obsB
          if (bgLum - obsLum < 8) continue

          const k = (obsR * bgR + obsG * bgG + obsB * bgB) / bgNorm2
          const aSh = 1 - k
          if (aSh < 0.07 || aSh > 0.65) continue

          const rChroma = Math.sqrt(
            ((obsR - k * bgR) ** 2 + (obsG - k * bgG) ** 2 + (obsB - k * bgB) ** 2) / 3
          )
          if (rChroma > 5.0) continue

          shCand[wp] = 1
          shAlpha[wp] = aSh
        }
      }

      const comp = labelComponents8(shCand, ww, wh)
      const minShArea = Math.max(10, Math.round((rect.width + rect.height) * 0.14))
      for (const cs of comp.stats) {
        if (cs.area < minShArea) continue
        let innerSum = 0
        let innerCnt = 0
        let outerSum = 0
        let outerCnt = 0
        for (let wy = cs.minY; wy <= cs.maxY; wy++) {
          const row = wy * ww
          for (let wx = cs.minX; wx <= cs.maxX; wx++) {
            const wp = row + wx
            if (comp.labels[wp] !== cs.label) continue
            if (near1[wp]) {
              innerSum += shAlpha[wp]!
              innerCnt++
            } else {
              outerSum += shAlpha[wp]!
              outerCnt++
            }
          }
        }
        if (innerCnt < 4) continue
        const innerMean = innerSum / innerCnt
        const outerMean = outerCnt > 0 ? outerSum / outerCnt : innerMean
        // Real drop shadows decay or hold steady outward; reject external dark objects growing inward
        if (outerCnt >= 4 && innerMean + 0.025 < outerMean) continue

        for (let wy = cs.minY; wy <= cs.maxY; wy++) {
          const row = wy * ww
          for (let wx = cs.minX; wx <= cs.maxX; wx++) {
            const wp = row + wx
            if (comp.labels[wp] !== cs.label) continue
            const wpi = wp * 4
            workRgba[wpi] = 0
            workRgba[wpi + 1] = 0
            workRgba[wpi + 2] = 0
            workRgba[wpi + 3] = Math.max(12, Math.min(180, Math.round(shAlpha[wp]! * 255)))
            rimRefinedPx++
          }
        }
      }
    }
  }

  if (rimRefinedPx === 0) {
    return { rect, rgba, rimRefinedPx: 0 }
  }

  // Compute tight union of `rect` and any newly recovered outer hair/shadow pixels
  let minX = ox
  let minY = oy
  let maxX = ox + rect.width - 1
  let maxY = oy + rect.height - 1
  for (let wy = 0; wy < wh; wy++) {
    for (let wx = 0; wx < ww; wx++) {
      if (workRgba[(wy * ww + wx) * 4 + 3]! === 0) continue
      if (wx < minX) minX = wx
      if (wx > maxX) maxX = wx
      if (wy < minY) minY = wy
      if (wy > maxY) maxY = wy
    }
  }
  const finalRect = clampRect(
    {
      left: workRect.left + minX,
      top: workRect.top + minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    },
    W,
    H
  )
  const fw = finalRect.width
  const fh = finalRect.height
  const finalRgba = new Uint8ClampedArray(fw * fh * 4)
  const fx0 = finalRect.left - workRect.left
  const fy0 = finalRect.top - workRect.top
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const si = ((fy0 + y) * ww + (fx0 + x)) * 4
      const di = (y * fw + x) * 4
      finalRgba[di] = workRgba[si]!
      finalRgba[di + 1] = workRgba[si + 1]!
      finalRgba[di + 2] = workRgba[si + 2]!
      finalRgba[di + 3] = workRgba[si + 3]!
    }
  }
  bleedTransparentRgb(finalRgba, fw, fh, 3)
  return { rect: finalRect, rgba: finalRgba, rimRefinedPx }
}

/**
 * Bottom-to-top backdrop-guided refinement for studio-purified layers:
 * 1. Punches enclosed counters/holes (`area >= 4px`) in `art-text` / `icon` / `decoration` where
 *    `source` exposes `backdrop` while `studioSkin` trapped solid studio background.
 * 2. Recovers semi-transparency (`alpha in 0..255`), multi-scale `backdrop-filter: blur(R)` frosted
 *    glass unmixing, and continuous spatial gradient alpha (`alpha(x, y)`) while keeping opaque
 *    borders crisp at `alpha = 255`.
 * 3. Refines sub-pixel hair/rim silhouettes via closed-form Color-Line matting and recovers pure
 *    `[0, 0, 0, alpha]` soft drop shadows outside standalone controls/illustrations.
 */
export function refineLayerTranslucencyAndHolesAgainstBackdrop(input: {
  kind: UiElementKind
  rect: PixelRect
  rgba: Uint8ClampedArray
  studioSkin: RgbaImage
  occludedMask: Uint8Array
  buildOccMask?: (r: PixelRect) => Uint8Array
  allowOuterExpansion?: boolean
  source: RgbaImage
  backdrop: RgbaImage
}): {
  rect: PixelRect
  rgba: Uint8ClampedArray
  translucentUnmixed: boolean
  backdropBlurRadius?: number
  holesPunched: number
  rimRefinedPx: number
} {
  const {
    kind,
    rect,
    rgba,
    studioSkin,
    occludedMask,
    buildOccMask,
    allowOuterExpansion = true,
    source,
    backdrop
  } = input
  const w = rect.width
  const h = rect.height
  const n = w * h
  const W = source.width
  const H = source.height
  if (w < 4 || h < 4 || studioSkin.width !== w || studioSkin.height !== h) {
    return { rect, rgba, translucentUnmixed: false, holesPunched: 0, rimRefinedPx: 0 }
  }

  const out = new Uint8ClampedArray(rgba)
  let holesPunched = 0

  // ---- Step A: Backdrop-verified enclosed hole punching (`art-text`, `icon`, `decoration`, etc.) ----
  if (PUNCH_ENCLOSED_HOLE_KINDS.has(kind)) {
    const trapped = new Uint8Array(n)
    let trappedCnt = 0
    for (let y = 0; y < h; y++) {
      const cy = rect.top + y
      if (cy < 0 || cy >= H) continue
      for (let x = 0; x < w; x++) {
        const cx = rect.left + x
        if (cx < 0 || cx >= W) continue
        const p = y * w + x
        if (occludedMask[p] || out[p * 4 + 3]! < 64) continue
        const gi = (cy * W + cx) * 4
        const pi = p * 4
        const dBg = pixelDistance(source.data, gi, backdrop.data, gi)
        const dStudio = pixelDistance(source.data, gi, studioSkin.data, pi)
        if (dBg <= 10 && dStudio >= 38) {
          trapped[p] = 1
          trappedCnt++
        }
      }
    }
    if (trappedCnt >= 4) {
      const comp = labelComponents(trapped, w, h)
      const punchLbl = new Uint8Array(comp.stats.length + 1)
      for (const cs of comp.stats) {
        if (cs.area >= 4) punchLbl[cs.label] = 1
      }
      const holeMask = new Uint8Array(n)
      for (let p = 0; p < n; p++) {
        const lbl = comp.labels[p]!
        if (lbl && punchLbl[lbl]) {
          holeMask[p] = 1
          out[p * 4 + 3] = 0
          holesPunched++
        }
      }
      if (holesPunched > 0) {
        const rim = dilateMask(holeMask, w, h, 1)
        for (let y = 0; y < h; y++) {
          const cy = rect.top + y
          if (cy < 0 || cy >= H) continue
          for (let x = 0; x < w; x++) {
            const cx = rect.left + x
            if (cx < 0 || cx >= W) continue
            const p = y * w + x
            if (!rim[p] || holeMask[p] || occludedMask[p]) continue
            const pi = p * 4
            if (out[pi + 3]! < 16) continue
            const gi = (cy * W + cx) * 4
            const dBg = pixelDistance(source.data, gi, backdrop.data, gi)
            if (dBg < 28) {
              const newA = Math.max(0, Math.min(out[pi + 3]!, Math.round((dBg / 28) * 255)))
              out[pi + 3] = newA
              if (newA >= 16) {
                const a = newA / 255
                for (let c = 0; c < 3; c++) {
                  out[pi + c] = Math.max(
                    0,
                    Math.min(
                      255,
                      Math.round((source.data[gi + c]! - backdrop.data[gi + c]! * (1 - a)) / a)
                    )
                  )
                }
              }
            }
          }
        }
        bleedTransparentRgb(out, w, h, 3)
      }
    }
  }

  let translucentUnmixed = false
  let detectedBlurRadius = 0

  // ---- Step B: Multi-scale blurred frosted glass + per-stratum & continuous gradient translucency ----
  if (TRANSLUCENT_ELIGIBLE_KINDS.has(kind) && n >= 36) {
    const buckets = new Map<number, number[]>()
    let totalUnoccludedSolid = 0
    for (let y = 0; y < h; y++) {
      const cy = rect.top + y
      if (cy < 0 || cy >= H) continue
      for (let x = 0; x < w; x++) {
        const cx = rect.left + x
        if (cx < 0 || cx >= W) continue
        const p = y * w + x
        if (occludedMask[p]) continue
        const si = p * 4
        if (out[si + 3]! < 180 || studioSkin.data[si + 3]! < 180) continue
        totalUnoccludedSolid++
        const key =
          ((studioSkin.data[si]! >> 4) << 8) |
          ((studioSkin.data[si + 1]! >> 4) << 4) |
          (studioSkin.data[si + 2]! >> 4)
        let arr = buckets.get(key)
        if (!arr) {
          arr = []
          buckets.set(key, arr)
        }
        arr.push(p)
      }
    }

    if (totalUnoccludedSolid >= 24) {
      const samplers = buildMultiScaleBlurredBackdrops(backdrop, rect)
      const minTransPx = Math.max(20, Math.round(totalUnoccludedSolid * 0.2))

      interface BucketStats {
        transmission: number
        confirmedTranslucent: boolean
        confirmedOpaque: boolean
        repStudioRgb: [number, number, number]
        pixelCount: number
      }

      interface ScaleEval {
        sampler: LocalBackdropSampler
        bucketStats: Map<number, BucketStats>
        translucentPixelCount: number
        weightedScore: number
        weightedPerp: number
      }

      const evalScale = (sampler: LocalBackdropSampler): ScaleEval => {
        const { padRect, data: bgData } = sampler
        const pw = padRect.width
        const bucketStats = new Map<number, BucketStats>()
        let translucentPixelCount = 0
        let scoreNum = 0
        let perpNum = 0

        for (const [key, pixels] of buckets) {
          const repIdx = pixels[pixels.length >> 1]! * 4
          const repStudioRgb: [number, number, number] = [
            studioSkin.data[repIdx]!,
            studioSkin.data[repIdx + 1]!,
            studioSkin.data[repIdx + 2]!
          ]
          if (pixels.length < 12) {
            bucketStats.set(key, {
              transmission: 0,
              confirmedTranslucent: false,
              confirmedOpaque: false,
              repStudioRgb,
              pixelCount: pixels.length
            })
            continue
          }

          const maxSamples = 72
          const step = Math.max(1, Math.floor(pixels.length / maxSamples))
          const sampleP: number[] = []
          for (let i = 0; i < pixels.length && sampleP.length < maxSamples; i += step) {
            sampleP.push(pixels[i]!)
          }

          const slopes: number[] = []
          const perps: number[] = []
          for (let i = 0; i < sampleP.length; i++) {
            const pa = sampleP[i]!
            const ax = pa % w
            const ay = (pa - ax) / w
            const ga = ((rect.top + ay) * W + (rect.left + ax)) * 4
            const ba = ((rect.top + ay - padRect.top) * pw + (rect.left + ax - padRect.left)) * 4
            const sa = pa * 4
            for (let j = i + 1; j < sampleP.length; j++) {
              const pb = sampleP[j]!
              const sb = pb * 4
              if (pixelDistance(studioSkin.data, sa, studioSkin.data, sb) > 14) continue
              const bx = pb % w
              const by = (pb - bx) / w
              const gb = ((rect.top + by) * W + (rect.left + bx)) * 4
              const bb = ((rect.top + by - padRect.top) * pw + (rect.left + bx - padRect.left)) * 4

              const dBgR = bgData[ba]! - bgData[bb]!
              const dBgG = bgData[ba + 1]! - bgData[bb + 1]!
              const dBgB = bgData[ba + 2]! - bgData[bb + 2]!
              const bgLen2 = dBgR * dBgR + dBgG * dBgG + dBgB * dBgB
              if (bgLen2 < 1000) continue

              const dObsR = source.data[ga]! - source.data[gb]!
              const dObsG = source.data[ga + 1]! - source.data[gb + 1]!
              const dObsB = source.data[ga + 2]! - source.data[gb + 2]!

              const t = (dObsR * dBgR + dObsG * dBgG + dObsB * dBgB) / bgLen2
              const resR = dObsR - t * dBgR
              const resG = dObsG - t * dBgG
              const resB = dObsB - t * dBgB
              const perp = Math.sqrt((resR * resR + resG * resG + resB * resB) / 3)
              slopes.push(t)
              perps.push(perp)
            }
          }

          if (slopes.length < 16) {
            bucketStats.set(key, {
              transmission: 0,
              confirmedTranslucent: false,
              confirmedOpaque: false,
              repStudioRgb,
              pixelCount: pixels.length
            })
            continue
          }

          slopes.sort((a, b) => a - b)
          perps.sort((a, b) => a - b)
          const medT = slopes[slopes.length >> 1]!
          const q25 = slopes[Math.floor(slopes.length * 0.25)]!
          const q75 = slopes[Math.floor(slopes.length * 0.75)]!
          const iqrT = q75 - q25
          const medPerp = perps[perps.length >> 1]!

          if (medT >= 0.08 && medT <= 0.92 && iqrT <= 0.28 && medPerp <= 15) {
            // Measure per-pixel backdrop-subtraction residual `||(source - t*bg_R) - (1-t)*F_med||_1 / 3`
            // across `sampleP` so collinear 2-color step-edge blur ghosts (`perp == 0`!) are penalized accurately.
            const remRs: number[] = []
            const remGs: number[] = []
            const remBs: number[] = []
            for (const sp of sampleP) {
              const sx = sp % w
              const sy = (sp - sx) / w
              const gs = ((rect.top + sy) * W + (rect.left + sx)) * 4
              const bs = ((rect.top + sy - padRect.top) * pw + (rect.left + sx - padRect.left)) * 4
              remRs.push(source.data[gs]! - medT * bgData[bs]!)
              remGs.push(source.data[gs + 1]! - medT * bgData[bs + 1]!)
              remBs.push(source.data[gs + 2]! - medT * bgData[bs + 2]!)
            }
            const sortedR = [...remRs].sort((a, b) => a - b)
            const sortedG = [...remGs].sort((a, b) => a - b)
            const sortedB = [...remBs].sort((a, b) => a - b)
            const midRemR = sortedR[sortedR.length >> 1]!
            const midRemG = sortedG[sortedG.length >> 1]!
            const midRemB = sortedB[sortedB.length >> 1]!
            const reconErrs: number[] = []
            let reconSum = 0
            for (let k = 0; k < remRs.length; k++) {
              const e =
                (Math.abs(remRs[k]! - midRemR) +
                  Math.abs(remGs[k]! - midRemG) +
                  Math.abs(remBs[k]! - midRemB)) /
                3
              reconErrs.push(e)
              reconSum += e
            }
            reconErrs.sort((a, b) => a - b)
            const p85Recon = reconErrs[Math.floor(reconErrs.length * 0.85)]!
            const meanRecon = reconSum / Math.max(1, reconErrs.length)
            const effErr = p85Recon * 0.65 + meanRecon * 0.35

            bucketStats.set(key, {
              transmission: medT,
              confirmedTranslucent: true,
              confirmedOpaque: false,
              repStudioRgb,
              pixelCount: pixels.length
            })
            translucentPixelCount += pixels.length
            scoreNum += pixels.length * (effErr + iqrT * 28)
            perpNum += pixels.length * effErr
          } else if (Math.abs(medT) < 0.08 && iqrT <= 0.18) {
            bucketStats.set(key, {
              transmission: 0,
              confirmedTranslucent: false,
              confirmedOpaque: true,
              repStudioRgb,
              pixelCount: pixels.length
            })
          } else {
            bucketStats.set(key, {
              transmission: 0,
              confirmedTranslucent: false,
              confirmedOpaque: false,
              repStudioRgb,
              pixelCount: pixels.length
            })
          }
        }

        return {
          sampler,
          bucketStats,
          translucentPixelCount,
          weightedScore: translucentPixelCount > 0 ? scoreNum / translucentPixelCount : Infinity,
          weightedPerp: translucentPixelCount > 0 ? perpNum / translucentPixelCount : Infinity
        }
      }

      const eval0 = evalScale(samplers[0]!)
      const eval0Valid = eval0.translucentPixelCount >= minTransPx
      let chosen: ScaleEval | null = eval0Valid ? eval0 : null

      for (let bi = 1; bi < samplers.length; bi++) {
        const ev = evalScale(samplers[bi]!)
        if (ev.translucentPixelCount < minTransPx) continue
        const beatsZero =
          !eval0Valid ||
          (ev.weightedScore <= eval0.weightedScore * 0.78 &&
            ev.weightedPerp + 1.8 < eval0.weightedPerp)
        if (beatsZero && (!chosen || ev.weightedScore < chosen.weightedScore)) {
          chosen = ev
        }
      }

      if (chosen) {
        const { sampler, bucketStats } = chosen
        const { padRect, data: bgData } = sampler
        const pw = padRect.width
        detectedBlurRadius = sampler.radius

        const confirmedBuckets = [...bucketStats.values()].filter((b) => b.confirmedTranslucent)
        for (const st of bucketStats.values()) {
          if (st.confirmedTranslucent || st.confirmedOpaque) continue
          let bestT = 0
          let bestDist = 22
          for (const cb of confirmedBuckets) {
            const d = Math.hypot(
              st.repStudioRgb[0] - cb.repStudioRgb[0],
              st.repStudioRgb[1] - cb.repStudioRgb[1],
              st.repStudioRgb[2] - cb.repStudioRgb[2]
            )
            if (d < bestDist) {
              bestDist = d
              bestT = cb.transmission
            }
          }
          if (bestT > 0) {
            st.transmission = bestT
            st.confirmedTranslucent = true
          }
        }

        const allBuckets = [...bucketStats.values()]
        const resolveStudioStratum = (pi: number): BucketStats | undefined => {
          const r = studioSkin.data[pi]!
          const g = studioSkin.data[pi + 1]!
          const b = studioSkin.data[pi + 2]!
          const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
          const direct = bucketStats.get(key)
          if (direct) return direct
          let best: BucketStats | undefined
          let bestDist = 24
          for (const cand of allBuckets) {
            const d = Math.hypot(
              r - cand.repStudioRgb[0],
              g - cand.repStudioRgb[1],
              b - cand.repStudioRgb[2]
            )
            if (d < bestDist) {
              bestDist = d
              best = cand
            }
          }
          return best
        }

        const fgCanvas = createImage(w, h)
        const alphaField = createImage(w, h)
        const unknownMask = new Uint8Array(n)
        let knownSeedCnt = 0

        for (let y = 0; y < h; y++) {
          const cy = rect.top + y
          for (let x = 0; x < w; x++) {
            const cx = rect.left + x
            const p = y * w + x
            const pi = p * 4
            const curA = Math.min(out[pi + 3]!, studioSkin.data[pi + 3]!)
            if (curA < 8 || cy < 0 || cy >= H || cx < 0 || cx >= W || occludedMask[p]) {
              unknownMask[p] = 1
              continue
            }

            const st = resolveStudioStratum(pi)
            if (st?.confirmedTranslucent && st.transmission > 0) {
              const gi = (cy * W + cx) * 4
              const bi = ((cy - padRect.top) * pw + (cx - padRect.left)) * 4
              const effAlpha = Math.max(0.06, Math.min(1, (curA / 255) * (1 - st.transmission)))
              const aByte = Math.max(8, Math.min(255, Math.round(effAlpha * 255)))
              for (let c = 0; c < 3; c++) {
                const solved = Math.max(
                  0,
                  Math.min(
                    255,
                    Math.round((source.data[gi + c]! - bgData[bi + c]! * (1 - effAlpha)) / effAlpha)
                  )
                )
                fgCanvas.data[pi + c] = solved
              }
              fgCanvas.data[pi + 3] = 255
              alphaField.data[pi] = aByte
              alphaField.data[pi + 1] = aByte
              alphaField.data[pi + 2] = aByte
              alphaField.data[pi + 3] = 255
              knownSeedCnt++
            } else {
              // Keep opaque border strata out of `fgCanvas` / `alphaField` so they never bleed into
              // occluded translucent interiors during push-pull inpainting.
              unknownMask[p] = 1
            }
          }
        }

        if (knownSeedCnt >= 8) {
          inpaintPushPull(fgCanvas, unknownMask)
          inpaintPushPull(alphaField, unknownMask)
        }

        for (let p = 0; p < n; p++) {
          const pi = p * 4
          const curA = Math.min(out[pi + 3]!, studioSkin.data[pi + 3]!)
          if (curA < 8) {
            out[pi + 3] = 0
            continue
          }
          const st = resolveStudioStratum(pi)
          if (st?.confirmedTranslucent && st.transmission > 0) {
            const aByte = Math.min(curA, alphaField.data[pi]!)
            out[pi] = fgCanvas.data[pi]!
            out[pi + 1] = fgCanvas.data[pi + 1]!
            out[pi + 2] = fgCanvas.data[pi + 2]!
            out[pi + 3] = aByte < 6 ? 0 : aByte
          }
        }

        bleedTransparentRgb(out, w, h, 3)
        translucentUnmixed = true
      } else {
        // Fallback Step B2: Continuous spatial gradient-alpha plane solver (`alpha(x, y)`)
        const grad = solveContinuousGradientTranslucency({
          rect,
          out,
          studioSkin,
          occludedMask,
          source,
          samplers
        })
        if (grad.applied) {
          translucentUnmixed = true
          detectedBlurRadius = grad.blurRadius
        }
      }
    }
  }

  // ---- Step C: Sub-pixel rim/hair Color-Line matting + pure soft drop-shadow recovery ----
  const rimRes = applyRimMattingAndDropShadow({
    kind,
    rect,
    rgba: out,
    studioSkin,
    occludedMask,
    buildOccMask,
    allowOuterExpansion: allowOuterExpansion && !translucentUnmixed,
    source,
    backdrop
  })

  return {
    rect: rimRes.rect,
    rgba: rimRes.rgba,
    translucentUnmixed,
    ...(detectedBlurRadius > 0 ? { backdropBlurRadius: detectedBlurRadius } : {}),
    holesPunched,
    rimRefinedPx: rimRes.rimRefinedPx
  }
}
