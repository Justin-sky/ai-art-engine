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
  cloneImage,
  createImage,
  cropImage,
  dilateMask,
  expandRect,
  inpaintPushPull,
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
  allowHollowCenter: boolean
): RgbaImage | null {
  const primary = extractCleanComponentMatteFromSolidBg(genRgba, {
    expectedBgRgb,
    allowHollowCenter
  })
  if (primary) return primary

  const relaxed = extractCleanComponentMatteFromSolidBg(genRgba, {
    expectedBgRgb,
    allowHollowCenter,
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
      const cleanMatte = extractStudioMatteRobust(genRgba, expectedBgRgb, allowHollowCenter)
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
      const isBorder = isBorderY || x < rx || (x >= rx && x >= w - rx)
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
 * with zero per-screen element cap and zero local-segmentation fallback:
 * 1. Purifies all screen UI control families (`button`, `close-button`, `arrow`, `item-slot`, `tab`,
 *    `badge`, `progress-bar`, `banner`, `frame`, `panel`) onto `#FFFFFF` / `#141820` studio backgrounds,
 *    registering shared Smart Object / 9-slice masters in `synthesizedComponents` + `existingMatches`
 *    (and purifying any non-matching sibling variants individually).
 * 2. Purifies all remaining standalone graphical / preserved-raster-text foreground elements onto solid
 *    studio backgrounds for analytical matting and hybrid pixel-locked composition.
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
    // Controls carrying intentional baked raster text (`raster_text_ids`) are routed to Part B
    // so their baked emblem text is preserved while still getting solid-studio matting.
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
    const padCropRect = expandRect(exEl.box, 3, W, H)
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

    const renderedExemplar = renderComponentToRect(
      master,
      exEl.box.width,
      exEl.box.height,
      scalePolicy,
      nineSliceBorders
    )
    const borderOnlyCheck =
      kind === 'item-slot' ||
      kind === 'frame' ||
      (kind === 'panel' && exemplar.unobstructedRatio < 0.55)
    const fidelity = measureUnobstructedControlFidelity(
      exemplar.patch,
      renderedExemplar,
      exemplar.known,
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
      const rendered = renderComponentToRect(
        res.master,
        sample.el.box.width,
        sample.el.box.height,
        res.scalePolicy,
        res.nineSliceBorders
      )
      if (i > 0) {
        const borderOnlyCheck = res.kind === 'item-slot' || res.kind === 'frame'
        const sibFidelity = measureUnobstructedControlFidelity(
          sample.patch,
          rendered,
          sample.known,
          borderOnlyCheck
        )
        if (
          sibFidelity.samples >= 12 &&
          (sibFidelity.trimmedMae > 32 || sibFidelity.borderMae > 34)
        ) {
          const fallbackMatch = matchElementToComponentLibrary({
            elementKind: sample.el.kind,
            box: sample.el.box,
            observedPatch: sample.patch,
            detectedMask: new Uint8Array(sample.el.box.width * sample.el.box.height),
            knownMask: sample.known,
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
      bleedTransparentRgb(rendered.data, rendered.width, rendered.height, 3)
      const score = Number(Math.max(0.78, Math.min(0.99, 1 - res.fidelityMae / 120)).toFixed(4))
      existingMatches.set(sample.el.id, { candidate, rendered, score })
      applied++
      purifiedControlInstances++
    }

    if (applied > 0) {
      candidate.item.sourceCount = applied
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
      const { el, known, occludedMask, occluderDesc } = target
      const padRect = expandRect(el.box, 3, W, H)
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
 * Hybrid pixel-locked composition for studio-purified graphical layers:
 * - Uses the studio-purified `companionRgba` alpha as a clean, halo-free outer silhouette.
 * - Locks 100% of unoccluded core pixels (`compA >= 216`) directly to `source` RGB so stylized glyphs,
 *   numbers, and character faces suffer zero AI re-rendering drift.
 * - Uses foreground-harmonized studio-unmixed `harmonizedCompanion` RGB + `compA` along anti-aliased
 *   boundary pixels (`8 <= compA < 216`) and occluded regions (`occludedMask` / `aboveAlpha`), with
 *   zero reliance on locally inpainted intermediate plates.
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

  let harmonizedCompanion = companionRgba
  if (visibleRingCount >= 8) {
    // Sample (source - companion) RGB offset strictly on unoccluded opaque foreground pixels
    // (`companionRgba.alpha >= 180`), harmonizing both occluded pixels and anti-aliased edge pixels.
    const ring = holeCount > 0 ? dilateMask(hole, w, h, 4) : null
    const offset = createImage(w, h)
    const unknown = new Uint8Array(w * h)
    let seedCount = 0
    for (let p = 0; p < w * h; p++) {
      const i = p * 4
      const inSeedBand = ring ? Boolean(ring[p] && !hole[p]) : !hole[p]
      if (
        inSeedBand &&
        companionRgba.data[i + 3]! >= 180 &&
        pixelDistance(sourceCrop.data, i, companionRgba.data, i) <= 45
      ) {
        for (let c = 0; c < 3; c++) {
          offset.data[i + c] = Math.max(
            0,
            Math.min(255, 128 + sourceCrop.data[i + c]! - companionRgba.data[i + c]!)
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
        for (let c = 0; c < 3; c++) {
          harmonizedCompanion.data[i + c] = Math.max(
            0,
            Math.min(255, companionRgba.data[i + c]! + offset.data[i + c]! - 128)
          )
        }
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
