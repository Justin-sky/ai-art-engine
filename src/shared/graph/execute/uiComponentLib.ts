import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'
import {
  computeNineSliceFromRgbaBuffer,
  isCanvasSafeImageSrc,
  isLayerSplitBase,
  type ImageLayerSplitLayer
} from '../imageLayerSplit'
import {
  componentIdToPsdGuid,
  emptyUiComponentLibrary,
  mergeUiComponentLibraries,
  parseUiComponentLibrary,
  sanitizeComponentExportName,
  stringifyUiComponentLibrary,
  uiComponentItemImage,
  type UiComponentLibrary,
  type UiComponentScalePolicy,
  type UiComponentVisualDescriptor,
  type UiSharedComponentItem
} from '../uiComponentLibrary'
import {
  areComponentDescriptorsSameSkin,
  areComponentKindsCompatible,
  bleedTransparentRgb,
  choosePurificationStudioBg,
  componentKindPriority,
  computeComponentVisualDescriptor,
  createImage,
  cropImage,
  expandRect,
  extractCleanComponentMatteFromSolidBg,
  extractSharedComponentsFromSplitResults,
  matchElementToComponentLibrary,
  median,
  nearestAspectRatio,
  parseComponentCatalogResponse,
  rectArea,
  rectIntersection,
  refineElementBox,
  resizeAreaAverage,
  resizeBilinear,
  runPreciseUiSplit,
  segmentContainerSilhouette,
  type DetectedComponentFamilyEntry,
  type PixelRect,
  type PreciseSplitComponentCandidate,
  type PreciseSplitIo,
  type PreciseSplitLayer,
  type PreciseSplitResult,
  type RgbaImage,
  type UiElementKind
} from '../uiPreciseSplit'
import {
  buildComponentCatalogSystemPrompt,
  buildComponentCatalogUserPrompt,
  buildComponentPurifyPrompt
} from '../uiPreciseSplit/prompts'
import { canRunPreciseLayerSplit } from './layerSplitPrecise'
import { commitGeneratedImages, materializeGeneratedBatch } from './materialize'
import { collectImageItemsFromValue } from './mediaInputs'
import type {
  GraphImageItem,
  GraphUiComponentsValue,
  GraphValue,
  NodeExecuteContext
} from './types'

export function uiComponentsValue(doc: UiComponentLibrary): GraphUiComponentsValue {
  return {
    kind: 'uiComponents',
    doc,
    text: stringifyUiComponentLibrary(doc)
  }
}

export function readUpstreamUiComponentLibrary(
  values: readonly GraphValue[] | undefined
): UiComponentLibrary {
  const libs: UiComponentLibrary[] = []
  for (const val of values ?? []) {
    if (val.kind === 'uiComponents' && val.doc) {
      libs.push(val.doc)
    } else if (val.kind === 'text' && val.text?.trim()) {
      const parsed = parseUiComponentLibrary(val.text)
      if (parsed) libs.push(parsed)
    }
  }
  return mergeUiComponentLibraries(...libs)
}

async function resolveSafeImageUrl(
  ctx: NodeExecuteContext,
  rawUrlOrRel: { relativePath?: string; url?: string },
  stamp: number,
  suffix: string
): Promise<string | undefined> {
  const rel = rawUrlOrRel.relativePath?.trim()
  if (rel && ctx.resolveImageUrls) {
    const resolved = await ctx.resolveImageUrls([{ relativePath: rel }])
    const u = resolved[0]?.trim()
    if (u && isCanvasSafeImageSrc(u)) return u
  }
  const url = rawUrlOrRel.url?.trim() || ''
  if (!url) return undefined
  if (isCanvasSafeImageSrc(url)) return url
  if (ctx.resolveImageUrls && !url.startsWith('http://') && !url.startsWith('https://')) {
    const resolved = await ctx.resolveImageUrls([{ relativePath: url }])
    const u = resolved[0]?.trim()
    if (u && isCanvasSafeImageSrc(u)) return u
  }
  if (ctx.saveRunMedia && ctx.resolveImageUrls) {
    try {
      const [mat] = await materializeGeneratedBatch(
        ctx,
        [{ id: `uiComp:${ctx.node.id}:${stamp}:${suffix}`, dataUrl: url }],
        `uiComp:${ctx.node.id}:${stamp}:${suffix}`
      )
      if (mat?.relativePath) {
        const resolved = await ctx.resolveImageUrls([{ relativePath: mat.relativePath }])
        const u = resolved[0]?.trim()
        if (u && isCanvasSafeImageSrc(u)) return u
      }
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Resolves and decodes upstream `in-components` into `PreciseSplitComponentCandidate[]`
 * ready for pixel-accurate matching & 9-slice / uniform replacement.
 */
export async function resolveUpstreamComponentCandidates(
  ctx: NodeExecuteContext,
  stamp: number
): Promise<{
  library: UiComponentLibrary
  candidates: PreciseSplitComponentCandidate[]
}> {
  const library = readUpstreamUiComponentLibrary(ctx.inputs['in-components'])
  if (!library.items.length || !ctx.uiRgbaCodec) {
    return { library, candidates: [] }
  }
  const codec = ctx.uiRgbaCodec
  const candidates: PreciseSplitComponentCandidate[] = []
  for (let i = 0; i < library.items.length; i++) {
    const item = library.items[i]!
    const safeUrl = await resolveSafeImageUrl(
      ctx,
      { relativePath: item.imageRelativePath, url: item.imageUrl },
      stamp,
      `cand${i}`
    )
    if (!safeUrl) continue
    try {
      const rgba = await codec.decodeImageRgba(safeUrl)
      if (rgba.width > 0 && rgba.height > 0) {
        candidates.push({ item, rgba })
      }
    } catch {
      // Skip unreadable component entry
    }
  }
  return { library, candidates }
}

function mapControlTypeToElementKind(ctrlType: string | undefined, name: string): UiElementKind {
  const t = (ctrlType ?? '').toLowerCase()
  if (t === 'button') return 'button'
  if (t === 'tabs') return 'tab'
  if (t === 'badge') return 'badge'
  if (t === 'icon') return 'icon'
  if (t === 'progress-bar' || t === 'slider') return 'progress-bar'
  if (t === 'card' || t === 'grid-slot') return 'item-slot'
  if (t === 'panel' || t === 'dialog' || t === 'modal') return 'panel'
  const lower = name.toLowerCase()
  if (lower.includes('close')) return 'close-button'
  if (lower.includes('slot') || lower.includes('grid')) return 'item-slot'
  if (lower.includes('btn') || lower.includes('button')) return 'button'
  if (lower.includes('tab')) return 'tab'
  if (lower.includes('badge')) return 'badge'
  if (lower.includes('frame') || lower.includes('border')) return 'frame'
  if (lower.includes('panel')) return 'panel'
  return 'other'
}

/**
 * Post-processes layers produced by non-precise fallback engines (`local-slice` / `ai-inpaint-slice` / `ai-layers`)
 * against `candidates`, replacing matched UI controls with clean component masters while preserving `originalImageId`.
 */
export async function applyComponentLibraryToFallbackLayers(
  ctx: NodeExecuteContext,
  stamp: number,
  mapped: {
    layers: ImageLayerSplitLayer[]
    batch: GraphImageItem[]
    canvasWidth: number
    canvasHeight: number
  },
  candidates: readonly PreciseSplitComponentCandidate[]
): Promise<UiSharedComponentItem[]> {
  const codec = ctx.uiRgbaCodec
  if (!codec || !candidates.length) return []

  const createdAt = new Date().toISOString()
  const componentLibrary: UiSharedComponentItem[] = []
  for (const cand of candidates) {
    const compImgId = `layerSplit:${ctx.node.id}:${stamp}:comp:${cand.item.id}`
    const compUrl = await codec.encodeRgbaPng(cand.rgba)
    mapped.batch.push({
      id: compImgId,
      title: `Master · ${cand.item.name}`,
      dataUrl: compUrl,
      createdAt
    })
    componentLibrary.push({
      ...cand.item,
      imageId: compImgId
    })
  }

  const batchById = new Map(mapped.batch.map((b) => [b.id, b]))
  for (let i = 0; i < mapped.layers.length; i++) {
    const layer = mapped.layers[i]!
    if (isLayerSplitBase(layer) || layer.editableText) continue
    const batchItem = batchById.get(layer.imageId)
    const rawUrl = batchItem?.dataUrl?.trim()
    if (!rawUrl || !isCanvasSafeImageSrc(rawUrl)) continue
    let decoded: RgbaImage
    try {
      decoded = await codec.decodeImageRgba(rawUrl)
    } catch {
      continue
    }
    if (decoded.width < 10 || decoded.height < 10) continue
    const n = decoded.width * decoded.height
    const detectedMask = new Uint8Array(n)
    const knownMask = new Uint8Array(n)
    for (let p = 0; p < n; p++) {
      if (decoded.data[p * 4 + 3]! >= 32) {
        detectedMask[p] = 1
        knownMask[p] = 1
      }
    }
    const kind = mapControlTypeToElementKind(layer.uiControlType, layer.name)
    const match = matchElementToComponentLibrary({
      elementKind: kind,
      box: { left: layer.left, top: layer.top, width: decoded.width, height: decoded.height },
      observedPatch: decoded,
      detectedMask,
      knownMask,
      candidates
    })
    if (!match) continue
    const renderedUrl = await codec.encodeRgbaPng(match.rendered)
    const origId = `${layer.id}:orig`
    mapped.batch.push({
      id: origId,
      title: `${layer.name} (orig)`,
      dataUrl: rawUrl,
      createdAt
    })
    if (batchItem) {
      batchItem.dataUrl = renderedUrl
    }
    mapped.layers[i] = {
      ...layer,
      componentId: match.candidate.item.id,
      componentMatchScore: match.score,
      componentImageId: layer.imageId,
      originalImageId: origId,
      prefabKey: match.candidate.item.id,
      ...(match.candidate.item.nineSliceBorders
        ? { nineSliceBorders: match.candidate.item.nineSliceBorders }
        : {})
    }
  }

  return componentLibrary
}

function buildSourceHash(
  urls: readonly string[],
  mode: string,
  visionKey: string,
  generateKey: string,
  userHint: string
): string {
  const sig = urls
    .map((u) => `${u.length}:${u.slice(0, 48)}:${u.length > 64 ? u.slice(-24) : ''}`)
    .join('|')
  let h = 0x811c9dc5
  const full = `v3::${mode}::${visionKey}::${generateKey}::${userHint}::${sig}`
  for (let i = 0; i < full.length; i++) {
    h ^= full.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `v3:${urls.length}:${(h >>> 0).toString(16)}`
}

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

const NON_COMPONENT_SPLIT_KINDS = new Set<string>([
  'text',
  'art-text',
  'avatar',
  'illustration',
  'icon',
  'decoration',
  'divider',
  'other'
])

interface MergedCatalogFamily {
  name: string
  kind: UiElementKind
  screenIndex: number
  screenRgba: RgbaImage
  exemplarBox: PixelRect
  allInstanceBoxes: PixelRect[]
  instances: Array<{ screenRgba: RgbaImage; box: PixelRect }>
  hasEmbeddedContent: boolean
  embeddedContentDesc?: string
  skinDesc?: string
  descriptor: UiComponentVisualDescriptor
}

function computeBoxIoU(a: PixelRect, b: PixelRect): number {
  const inter = rectIntersection(a, b)
  if (inter <= 0) return 0
  const union = rectArea(a) + rectArea(b) - inter
  return union > 0 ? inter / union : 0
}

function cropInstanceWithLocalSilhouette(screenRgba: RgbaImage, box: PixelRect): RgbaImage {
  const cropped = cropImage(screenRgba, box)
  const sil = segmentContainerSilhouette(screenRgba, box)
  if (!sil) return cropped

  let fgCount = 0
  for (let y = 0; y < box.height; y++) {
    const sy = box.top + y - sil.rect.top
    if (sy < 0 || sy >= sil.rect.height) continue
    for (let x = 0; x < box.width; x++) {
      const sx = box.left + x - sil.rect.left
      if (sx < 0 || sx >= sil.rect.width) continue
      if (sil.mask[sy * sil.rect.width + sx]) fgCount++
    }
  }
  const area = Math.max(1, box.width * box.height)
  if (fgCount < area * 0.35) return cropped

  for (let y = 0; y < box.height; y++) {
    const sy = box.top + y - sil.rect.top
    for (let x = 0; x < box.width; x++) {
      const sx = box.left + x - sil.rect.left
      const inside =
        sy >= 0 &&
        sy < sil.rect.height &&
        sx >= 0 &&
        sx < sil.rect.width &&
        sil.mask[sy * sil.rect.width + sx] === 1
      if (!inside) {
        cropped.data[(y * box.width + x) * 4 + 3] = 0
      }
    }
  }
  return cropped
}

/**
 * Local deterministic master fallback when per-component `generateImage` purification fails,
 * times out, or drifts aspect ratio — ensures cataloged UI components are never silently lost.
 */
function buildLocalFallbackMasterForFamily(
  fam: MergedCatalogFamily,
  canonicalWidth: number,
  canonicalHeight: number
): {
  fam: MergedCatalogFamily
  master: RgbaImage
  canonicalWidth: number
  canonicalHeight: number
  descriptor: UiComponentVisualDescriptor
} | null {
  const paddedRect = expandRect(fam.exemplarBox, 3, fam.screenRgba.width, fam.screenRgba.height)
  const paddedCrop = cropImage(fam.screenRgba, paddedRect)
  const solidMatte = extractCleanComponentMatteFromSolidBg(paddedCrop, {
    allowHollowCenter: fam.kind === 'frame'
  })
  if (solidMatte && solidMatte.width >= 12 && solidMatte.height >= 12) {
    const arTarget = canonicalWidth / Math.max(1, canonicalHeight)
    const arMatte = solidMatte.width / Math.max(1, solidMatte.height)
    const drift = Math.max(arTarget / Math.max(0.01, arMatte), arMatte / Math.max(0.01, arTarget))
    if (drift <= 1.45) {
      const master = resizeAreaAverage(solidMatte, canonicalWidth, canonicalHeight)
      bleedTransparentRgb(master.data, canonicalWidth, canonicalHeight, 3)
      const descriptor = computeComponentVisualDescriptor(master)
      if (descriptor.opaqueRatio >= (fam.kind === 'frame' ? 0.05 : 0.1)) {
        return { fam, master, canonicalWidth, canonicalHeight, descriptor }
      }
    }
  }

  const samples = fam.instances.slice(0, 7).map((inst) => {
    const cut = cropInstanceWithLocalSilhouette(inst.screenRgba, inst.box)
    return cut.width === canonicalWidth && cut.height === canonicalHeight
      ? cut
      : resizeBilinear(cut, canonicalWidth, canonicalHeight)
  })
  if (!samples.length) return null

  let master: RgbaImage
  if (samples.length === 1) {
    master = samples[0]!
  } else {
    master = createImage(canonicalWidth, canonicalHeight)
    const rs: number[] = []
    const gs: number[] = []
    const bs: number[] = []
    const as: number[] = []
    for (let p = 0; p < canonicalWidth * canonicalHeight; p++) {
      rs.length = 0
      gs.length = 0
      bs.length = 0
      as.length = 0
      const i = p * 4
      for (const s of samples) {
        const a = s.data[i + 3]!
        as.push(a)
        if (a >= 32) {
          rs.push(s.data[i]!)
          gs.push(s.data[i + 1]!)
          bs.push(s.data[i + 2]!)
        }
      }
      const medA = Math.round(median(as))
      if (medA >= 24 && rs.length > 0) {
        master.data[i] = Math.round(median(rs))
        master.data[i + 1] = Math.round(median(gs))
        master.data[i + 2] = Math.round(median(bs))
        master.data[i + 3] = medA
      }
    }
  }

  bleedTransparentRgb(master.data, canonicalWidth, canonicalHeight, 3)
  const descriptor = computeComponentVisualDescriptor(master)
  if (descriptor.opaqueRatio < 0.05) return null
  return { fam, master, canonicalWidth, canonicalHeight, descriptor }
}

async function runBoundedConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (cursor < items.length) {
        const idx = cursor++
        out[idx] = await worker(items[idx]!, idx)
      }
    }
  )
  await Promise.all(runners)
  return out
}

/**
 * Primary AI extraction path inspired by `bggg-creator-image2psd`:
 * 1. VLM Component Architect pass identifies reusable UI skin families & picks the cleanest exemplar box.
 * 2. ImageGen regenerates each UI skin as a crisp, text-free, icon-free standalone companion asset centered
 *    on a flat high-contrast solid studio background (`#FFFFFF` or `#141820` for pale/white-rimmed controls).
 * 3. `extractCleanComponentMatteFromSolidBg` applies corner background estimation + exterior flood-fill
 *    interior highlight protection (`white-preserve`) + analytical anti-aliased edge unmixing, followed by
 *    supersampled `resizeAreaAverage` downsampling to exact canonical 1:1 UI pixel dimensions.
 */
async function extractComponentsViaVlmAndSolidBgPurify(
  ctx: NodeExecuteContext,
  resolvedScreens: ReadonlyArray<{ safeUrl: string; title?: string }>,
  extractMode: 'auto' | 'repeated' | 'all-controls',
  stamp: number
): Promise<PreciseSplitComponentCandidate[]> {
  const codec = ctx.uiRgbaCodec
  const generateText = ctx.generateText
  const generateImage = ctx.generateImage
  if (!codec || !generateText || !generateImage || !canRunPreciseLayerSplit(ctx)) {
    return []
  }

  const visionModel = ctx.node.params.visionModel?.trim() || undefined
  const visionProviderInstanceId = ctx.node.params.visionProviderInstanceId?.trim() || undefined
  const generateModel = ctx.node.params.generateModel?.trim() || undefined
  const generateProviderInstanceId = ctx.node.params.generateProviderInstanceId?.trim() || undefined
  const userHint = ctx.node.params.generateInstruction?.trim() || undefined

  const mergedFamilies: MergedCatalogFamily[] = []

  for (let sIdx = 0; sIdx < resolvedScreens.length; sIdx++) {
    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const screen = resolvedScreens[sIdx]!
    const screenRgba = await codec.decodeImageRgba(screen.safeUrl)
    let rawEntries: DetectedComponentFamilyEntry[] = []
    try {
      const vlmRes = await generateText({
        system: buildComponentCatalogSystemPrompt(ctx.locale),
        prompt: buildComponentCatalogUserPrompt({
          locale: ctx.locale,
          width: screenRgba.width,
          height: screenRgba.height,
          extractMode,
          userHint,
          sourceTitle: screen.title
        }),
        images: [screen.safeUrl],
        visionGrounding: true,
        ...(visionModel ? { model: visionModel } : {}),
        ...(visionProviderInstanceId ? { providerInstanceId: visionProviderInstanceId } : {})
      })
      rawEntries = parseComponentCatalogResponse(
        vlmRes?.text ?? '',
        screenRgba.width,
        screenRgba.height,
        32
      )
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || ctx.signal?.aborted) throw err
      ctx.log?.(
        `[ui.componentLib S${sIdx + 1}] VLM catalog warning, falling back to layout split: ${String((err as Error)?.message ?? err)}`,
        'warn'
      )
    }

    if (!rawEntries.length) {
      try {
        const splitFallback = await splitScreenForComponentExtraction(
          ctx,
          screen.safeUrl,
          screen.title,
          stamp,
          sIdx
        )
        if (splitFallback?.layers.length) {
          const canvasArea = Math.max(1, splitFallback.canvasWidth * splitFallback.canvasHeight)
          for (const layer of splitFallback.layers) {
            if (layer.editableText || NON_COMPONENT_SPLIT_KINDS.has(layer.kind)) continue
            if (layer.width < 14 || layer.height < 14) continue
            if (layer.width * layer.height > canvasArea * 0.45) continue
            const box: PixelRect = {
              left: layer.left,
              top: layer.top,
              width: layer.width,
              height: layer.height
            }
            rawEntries.push({
              id: layer.id,
              name: layer.name,
              kind: layer.kind,
              exemplarBox: box,
              instanceBoxes: [box],
              hasEmbeddedContent: false
            })
          }
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError' || ctx.signal?.aborted) throw err
      }
    }

    ctx.log?.(
      `[ui.componentLib S${sIdx + 1}] cataloged ${rawEntries.length} reusable component families`,
      'info'
    )

    for (const entry of rawEntries) {
      const snappedExemplar = refineElementBox(screenRgba, entry.exemplarBox)
      const snappedInstances = (
        entry.instanceBoxes.length ? entry.instanceBoxes : [entry.exemplarBox]
      ).map((b) => refineElementBox(screenRgba, b))
      if (snappedExemplar.width < 14 || snappedExemplar.height < 14) continue
      const exCrop = cropImage(screenRgba, snappedExemplar)
      const desc = computeComponentVisualDescriptor(exCrop)

      // Deduplicate identical skin families across screens without collapsing distinct controls:
      // - Within the SAME screen, VLM already grouped identical skins into `instance_boxes_2d`,
      //   so only merge duplicate overlapping boxes (`IoU > 0.55`).
      // - Across DIFFERENT screens, require strict kind + border + interior/ring visual match.
      const existing = mergedFamilies.find((prev) => {
        if (prev.screenIndex === sIdx) {
          return (
            areComponentKindsCompatible(prev.kind, entry.kind, false) &&
            computeBoxIoU(prev.exemplarBox, snappedExemplar) > 0.55
          )
        }
        return areComponentDescriptorsSameSkin(prev.kind, prev.descriptor, entry.kind, desc)
      })

      if (existing) {
        existing.allInstanceBoxes.push(...snappedInstances)
        for (const b of snappedInstances) {
          existing.instances.push({ screenRgba, box: b })
        }
        // Prefer an empty/unoccluded exemplar over one with embedded text/icons
        if (existing.hasEmbeddedContent && !entry.hasEmbeddedContent) {
          existing.screenIndex = sIdx
          existing.screenRgba = screenRgba
          existing.exemplarBox = snappedExemplar
          existing.hasEmbeddedContent = false
          existing.embeddedContentDesc = entry.embeddedContentDesc
          existing.skinDesc = entry.skinDesc ?? existing.skinDesc
          existing.descriptor = desc
        }
      } else {
        mergedFamilies.push({
          name: entry.name,
          kind: entry.kind,
          screenIndex: sIdx,
          screenRgba,
          exemplarBox: snappedExemplar,
          allInstanceBoxes: snappedInstances,
          instances: snappedInstances.map((box) => ({ screenRgba, box })),
          hasEmbeddedContent: entry.hasEmbeddedContent,
          ...(entry.embeddedContentDesc ? { embeddedContentDesc: entry.embeddedContentDesc } : {}),
          ...(entry.skinDesc ? { skinDesc: entry.skinDesc } : {}),
          descriptor: desc
        })
      }
    }
  }

  if (!mergedFamilies.length) return []

  const includeSingletons = extractMode !== 'repeated'

  const isEligibleSingleton = (fam: MergedCatalogFamily): boolean => {
    const canvasArea = Math.max(1, fam.screenRgba.width * fam.screenRgba.height)
    const ratio = (fam.exemplarBox.width * fam.exemplarBox.height) / canvasArea
    if ((fam.kind === 'panel' || fam.kind === 'frame') && ratio > 0.4) return false
    return true
  }

  const rankFamily = (a: MergedCatalogFamily, b: MergedCatalogFamily): number => {
    const aRep = a.allInstanceBoxes.length >= 2 ? 1 : 0
    const bRep = b.allInstanceBoxes.length >= 2 ? 1 : 0
    if (bRep !== aRep) return bRep - aRep
    if (b.allInstanceBoxes.length !== a.allInstanceBoxes.length) {
      return b.allInstanceBoxes.length - a.allInstanceBoxes.length
    }
    return componentKindPriority(b.kind) - componentKindPriority(a.kind)
  }

  let selected = mergedFamilies
    .filter((f) => f.allInstanceBoxes.length >= 2 || (includeSingletons && isEligibleSingleton(f)))
    .sort(rankFamily)
  if (!selected.length) {
    selected = mergedFamilies.filter(isEligibleSingleton).sort(rankFamily)
  }
  const maxTotalComponents = Math.min(72, Math.max(24, resolvedScreens.length * 18))
  selected = selected.slice(0, maxTotalComponents)
  if (!selected.length) return []

  let purifyCallSeq = 0
  const purifiedResults = await runBoundedConcurrency(selected, 3, async (fam, idx) => {
    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const { screenRgba, exemplarBox } = fam
    const tightExemplar = cropImage(screenRgba, exemplarBox)
    const paddedRect = expandRect(exemplarBox, 3, screenRgba.width, screenRgba.height)
    const paddedCrop = cropImage(screenRgba, paddedRect)

    const { bgHex, bgRgb } = choosePurificationStudioBg(tightExemplar)

    // Upscale small exemplars before feeding as reference so fine bevels/corners remain sharp
    const maxDim = Math.max(paddedCrop.width, paddedCrop.height)
    const upFactor = maxDim < 320 ? Math.min(4, Math.ceil(320 / Math.max(1, maxDim))) : 1
    const refImg =
      upFactor > 1
        ? resizeBilinear(paddedCrop, paddedCrop.width * upFactor, paddedCrop.height * upFactor)
        : paddedCrop
    const refDataUrl = await codec.encodeRgbaPng(refImg)

    const canonicalWidth = Math.max(
      16,
      Math.round(median(fam.allInstanceBoxes.map((b) => b.width)) || exemplarBox.width)
    )
    const canonicalHeight = Math.max(
      16,
      Math.round(median(fam.allInstanceBoxes.map((b) => b.height)) || exemplarBox.height)
    )

    try {
      const genRes = await generateImage({
        prompt: buildComponentPurifyPrompt({
          locale: ctx.locale,
          name: fam.name,
          kind: fam.kind,
          skinDesc: fam.skinDesc,
          embeddedContentDesc: fam.embeddedContentDesc,
          bgHex,
          userHint
        }),
        ...(generateModel ? { model: generateModel } : {}),
        ...(generateProviderInstanceId ? { providerInstanceId: generateProviderInstanceId } : {}),
        resolution: '1K',
        aspectRatio: nearestAspectRatio(canonicalWidth, canonicalHeight),
        inputReferences: [refDataUrl]
      })

      const rawGenUrl = genRes.layers?.[0]?.url?.trim() || genRes.images?.[0]?.trim() || ''
      if (!rawGenUrl) {
        return buildLocalFallbackMasterForFamily(fam, canonicalWidth, canonicalHeight)
      }
      const seq = ++purifyCallSeq
      const safeGenUrl = await resolveSafeImageUrl(
        ctx,
        { url: rawGenUrl },
        stamp,
        `purify_${idx + 1}_${seq}`
      )
      if (!safeGenUrl) {
        return buildLocalFallbackMasterForFamily(fam, canonicalWidth, canonicalHeight)
      }
      const genRgba = await codec.decodeImageRgba(safeGenUrl)

      const matte = extractCleanComponentMatteFromSolidBg(genRgba, {
        expectedBgRgb: bgRgb,
        allowHollowCenter: fam.kind === 'frame'
      })
      if (!matte || matte.width < 12 || matte.height < 12) {
        return buildLocalFallbackMasterForFamily(fam, canonicalWidth, canonicalHeight)
      }

      const arTarget = canonicalWidth / Math.max(1, canonicalHeight)
      const arMatte = matte.width / Math.max(1, matte.height)
      const arDrift = Math.max(
        arTarget / Math.max(0.01, arMatte),
        arMatte / Math.max(0.01, arTarget)
      )
      if (arDrift > 1.55) {
        ctx.log?.(
          `[ui.componentLib] purified "${fam.name}" drifted (${arMatte.toFixed(2)} vs ${arTarget.toFixed(2)}), using local exemplar fallback`,
          'warn'
        )
        return buildLocalFallbackMasterForFamily(fam, canonicalWidth, canonicalHeight)
      }

      const master = resizeAreaAverage(matte, canonicalWidth, canonicalHeight)
      bleedTransparentRgb(master.data, canonicalWidth, canonicalHeight, 3)
      const descriptor = computeComponentVisualDescriptor(master)
      const minOpaque = fam.kind === 'frame' ? 0.05 : 0.12
      if (descriptor.opaqueRatio < minOpaque) {
        return buildLocalFallbackMasterForFamily(fam, canonicalWidth, canonicalHeight)
      }

      return { fam, master, canonicalWidth, canonicalHeight, descriptor }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || ctx.signal?.aborted) throw err
      ctx.log?.(
        `[ui.componentLib] purify warning for "${fam.name}", using local exemplar fallback: ${String((err as Error)?.message ?? err)}`,
        'warn'
      )
      return buildLocalFallbackMasterForFamily(fam, canonicalWidth, canonicalHeight)
    }
  })

  const candidates: PreciseSplitComponentCandidate[] = []
  const kindCounters = new Map<string, number>()

  for (let i = 0; i < purifiedResults.length; i++) {
    const entry = purifiedResults[i]
    if (!entry) continue
    const { fam, master, canonicalWidth, canonicalHeight, descriptor } = entry
    const kind = fam.kind
    const kindSeq = (kindCounters.get(kind) ?? 0) + 1
    kindCounters.set(kind, kindSeq)

    const nineSliceBorders = NINE_SLICE_ELIGIBLE_KINDS.has(kind)
      ? computeNineSliceFromRgbaBuffer(master.data, canonicalWidth, canonicalHeight)
      : undefined
    const scalePolicy: UiComponentScalePolicy = nineSliceBorders ? 'nine-slice' : 'uniform'
    const kindSlug = kind.replace(/[^a-z0-9]+/gi, '_').toLowerCase()
    const id = `comp_${kindSlug}_${String(kindSeq).padStart(2, '0')}`
    const exportName = sanitizeComponentExportName(
      `Comp_${kind
        .split('-')
        .map((s) => (s ? s[0]!.toUpperCase() + s.slice(1) : ''))
        .join('')}_${String(kindSeq).padStart(2, '0')}`,
      candidates.length + 1
    )

    candidates.push({
      item: {
        id,
        psdGuid: componentIdToPsdGuid(id),
        name: fam.name || `${kind} ${kindSeq}`,
        exportName,
        kind,
        canonicalWidth,
        canonicalHeight,
        scalePolicy,
        ...(nineSliceBorders ? { nineSliceBorders } : {}),
        sourceCount: fam.allInstanceBoxes.length,
        descriptor
      },
      rgba: master
    })
  }

  return candidates
}

async function splitScreenForComponentExtraction(
  ctx: NodeExecuteContext,
  safeUrl: string,
  title: string | undefined,
  _stamp: number,
  screenIdx: number
): Promise<PreciseSplitResult | null> {
  const codec = ctx.uiRgbaCodec
  if (!codec) return null
  const source = await codec.decodeImageRgba(safeUrl)

  if (canRunPreciseLayerSplit(ctx) && ctx.generateText) {
    const generateText = ctx.generateText
    const visionModel = ctx.node.params.visionModel?.trim() || undefined
    const visionProviderInstanceId = ctx.node.params.visionProviderInstanceId?.trim() || undefined
    let sam2Ready = false
    if (codec.segmentSam2 && codec.hasSam2) {
      try {
        sam2Ready = await codec.hasSam2()
      } catch {
        sam2Ready = false
      }
    }
    const io: PreciseSplitIo = {
      vlm: async (req) => {
        const res = await generateText({
          system: req.system,
          prompt: req.prompt,
          images: req.images,
          visionGrounding: true,
          ...(visionModel ? { model: visionModel } : {}),
          ...(visionProviderInstanceId ? { providerInstanceId: visionProviderInstanceId } : {})
        })
        return res?.text ?? ''
      },
      encodePng: (img) => codec.encodeRgbaPng(img),
      ...(sam2Ready && codec.segmentSam2 ? { segmentSam2: (req) => codec.segmentSam2!(req) } : {}),
      ...(codec.recognizeImageText
        ? {
            ocr: async (img) => {
              const d = await codec.encodeRgbaPng(img)
              return (await codec.recognizeImageText?.(d)) ?? []
            }
          }
        : {}),
      log: (m) => ctx.log?.(`[ui.componentLib S${screenIdx + 1}] ${m}`, 'info'),
      signal: ctx.signal ?? null
    }
    return runPreciseUiSplit(io, source, {
      locale: ctx.locale,
      sourceTitle: title,
      userHint: ctx.node.params.generateInstruction?.trim() || undefined,
      // Never waste 2K background inpainting calls on `result.base` which component extraction discards!
      generativePeel: false,
      maxLayerCompletions: 0
    })
  }

  // Offline / non-VLM fallback: extract widgets via local UI decomposition
  if (ctx.decomposeImageUiLayers) {
    const decomposed = await ctx.decomposeImageUiLayers({ sourceDataUrl: safeUrl })
    const layers: PreciseSplitLayer[] = []
    for (let i = 0; i < decomposed.widgets.length; i++) {
      const w = decomposed.widgets[i]!
      if (!w.dataUrl || !isCanvasSafeImageSrc(w.dataUrl)) continue
      try {
        const img = await codec.decodeImageRgba(w.dataUrl)
        const kind = mapControlTypeToElementKind(w.uiControlType, w.name)
        layers.push({
          id: `w_${i + 1}`,
          elementId: `w_${i + 1}`,
          name: w.name || `Control_${i + 1}`,
          kind,
          parentElementId: null,
          paintIndex: i + 1,
          left: Math.round(w.left),
          top: Math.round(w.top),
          width: img.width,
          height: img.height,
          rgba: img.data,
          ...(w.uiControlType ? { uiControlType: w.uiControlType } : {}),
          ...(w.uiPartRole ? { uiPartRole: w.uiPartRole } : {}),
          ...(w.editableText ? { editableText: w.editableText } : {})
        })
      } catch {
        // skip unreadable widget
      }
    }
    if (layers.length > 0) {
      return {
        canvasWidth: source.width,
        canvasHeight: source.height,
        base: source,
        layers,
        tree: {
          canvasWidth: source.width,
          canvasHeight: source.height,
          elements: []
        },
        reconstructionError: 0,
        peelReport: [],
        notes: ['local-fallback']
      }
    }
  }

  return null
}

/**
 * Executes `ui.componentLib`:
 * Extracts shared, de-texted, de-occluded canonical UI component masters across 1 or N UI screens,
 * computing 9-slice borders, visual descriptors, and deterministic PSD Smart Object GUIDs.
 */
export async function executeUiComponentLibNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const upstreamLib = readUpstreamUiComponentLibrary(ctx.inputs['in-components'])
  const localPrev = parseUiComponentLibrary(ctx.node.params.uiComponentLibrary ?? '')
  const lockedPrev = localPrev
    ? {
        ...localPrev,
        items: localPrev.items.filter((item) => item.locked)
      }
    : null

  // Gather ALL screen images across `in`, `in-image`, `in-images`, and asset/svg references,
  // avoiding generic `item.id` collisions across separate upstream nodes.
  const allPortValues: GraphValue[] = [
    ...(ctx.inputs.in ?? []),
    ...(ctx.inputs['in-image'] ?? []),
    ...(ctx.inputs['in-images'] ?? []),
    ...Object.entries(ctx.inputs)
      .filter(
        ([port]) =>
          port !== 'in' && port !== 'in-image' && port !== 'in-images' && port !== 'in-components'
      )
      .flatMap(([, vals]) => vals ?? [])
  ]
  const incomingItems: GraphImageItem[] = []
  for (const val of allPortValues) {
    const extractedItems = await collectImageItemsFromValue(val, ctx)
    incomingItems.push(...extractedItems)
  }

  // If an upstream gallery node with multiple `generatedImages` was wired via its default `out` port
  // directly into `in-images` (`UI Batch`) or came from `ui.gen`, expand all its screen images.
  if (ctx.document) {
    const nodeById = new Map(ctx.document.nodes.map((n) => [n.id, n]))
    for (const edge of ctx.document.edges) {
      if (edge.target !== ctx.node.id) continue
      const srcNode = nodeById.get(edge.source)
      if (!srcNode) continue
      if (srcNode.typeId === 'image.layerSplit' || srcNode.typeId === 'ui.componentLib') continue
      const targetPort = edge.targetPort ?? 'in'
      const sourcePort = edge.sourcePort ?? 'out'
      const wantsFullGallery =
        (targetPort === 'in-images' && sourcePort === 'out') ||
        (srcNode.typeId === 'ui.gen' && sourcePort === 'out')
      if (!wantsFullGallery) continue
      const gallery = srcNode.params?.generatedImages
      if (Array.isArray(gallery) && gallery.length > 1) {
        for (const g of gallery) {
          incomingItems.push({
            id: g.id,
            ...(g.title ? { title: g.title } : {}),
            dataUrl: g.dataUrl ?? '',
            ...(g.relativePath ? { relativePath: g.relativePath } : {}),
            createdAt: g.createdAt
          })
        }
      }
    }
  }

  // Deduplicate incoming screen items strictly by image payload (`relativePath` or `dataUrl`)
  const uniqueScreenItems: GraphImageItem[] = []
  const seenKeys = new Set<string>()
  for (const it of incomingItems) {
    const key = it.relativePath?.trim() || it.dataUrl?.trim() || ''
    if (!key || seenKeys.has(key)) continue
    seenKeys.add(key)
    uniqueScreenItems.push(it)
  }

  if (!uniqueScreenItems.length) {
    const fallbackDoc = mergeUiComponentLibraries(upstreamLib, localPrev)
    if (fallbackDoc.items.length > 0) {
      const existingImages = ctx.node.params.generatedImages ?? []
      return {
        out: uiComponentsValue(fallbackDoc),
        'out-images': { kind: 'images', items: existingImages }
      }
    }
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  if (!ctx.uiRgbaCodec) {
    throw fail(SHARED_ERRORS.layerSplitPreciseFailed, { detail: 'no RGBA codec' })
  }

  const stamp = Date.now()
  const resolvedScreens: Array<{ safeUrl: string; title?: string }> = []
  for (let i = 0; i < uniqueScreenItems.length; i++) {
    const item = uniqueScreenItems[i]!
    const safeUrl = await resolveSafeImageUrl(
      ctx,
      { relativePath: item.relativePath, url: item.dataUrl },
      stamp,
      `screen${i}`
    )
    if (safeUrl) {
      resolvedScreens.push({ safeUrl, title: item.title })
    }
  }
  if (!resolvedScreens.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const extractMode = ctx.node.params.uiComponentExtractMode ?? 'auto'
  const visionKey = [
    ctx.node.params.visionProviderInstanceId?.trim(),
    ctx.node.params.visionModel?.trim()
  ]
    .filter(Boolean)
    .join(':')
  const generateKey = [
    Boolean(ctx.generateImage) ? 'imgGen' : 'noImgGen',
    ctx.node.params.generateProviderInstanceId?.trim(),
    ctx.node.params.generateModel?.trim()
  ]
    .filter(Boolean)
    .join(':')
  const userHint = ctx.node.params.generateInstruction?.trim() || ''
  const sourceHash = buildSourceHash(
    resolvedScreens.map((s) => s.safeUrl),
    extractMode,
    visionKey,
    generateKey,
    userHint
  )

  const force = ctx.node.params.filmForce === true
  if (
    !force &&
    localPrev?.items?.length &&
    ctx.node.params.uiComponentLibSourceHash === sourceHash
  ) {
    const mergedCached = mergeUiComponentLibraries(upstreamLib, localPrev)
    const prevImages = ctx.node.params.generatedImages ?? []
    return {
      out: uiComponentsValue(mergedCached),
      'out-images': { kind: 'images', items: prevImages }
    }
  }

  let extracted: PreciseSplitComponentCandidate[] = []
  if (canRunPreciseLayerSplit(ctx) && ctx.generateText && ctx.generateImage) {
    try {
      extracted = await extractComponentsViaVlmAndSolidBgPurify(
        ctx,
        resolvedScreens,
        extractMode,
        stamp
      )
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || ctx.signal?.aborted) throw err
      ctx.log?.(
        `[ui.componentLib] VLM+solid-bg purification fallback: ${String((err as Error)?.message ?? err)}`,
        'warn'
      )
    }
  }

  if (!extracted.length) {
    const splits: Array<{ split: PreciseSplitResult; title?: string }> = []
    for (let i = 0; i < resolvedScreens.length; i++) {
      if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const screen = resolvedScreens[i]!
      try {
        const split = await splitScreenForComponentExtraction(
          ctx,
          screen.safeUrl,
          screen.title,
          stamp,
          i
        )
        if (split && split.layers.length > 0) {
          splits.push({ split, title: screen.title })
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError' || ctx.signal?.aborted) throw err
        ctx.log?.(
          `[ui.componentLib] screen ${i + 1} extraction warning: ${String((err as Error)?.message ?? err)}`,
          'warn'
        )
      }
    }
    extracted = extractSharedComponentsFromSplitResults(splits, { mode: extractMode })
  }
  const createdAt = new Date().toISOString()
  const rawBatch: GraphImageItem[] = []
  const items: UiSharedComponentItem[] = []

  for (const cand of extracted) {
    const imgId = `uiComp:${ctx.node.id}:${stamp}:${cand.item.id}`
    const dataUrl = await ctx.uiRgbaCodec.encodeRgbaPng(cand.rgba)
    const nineSliceBorders =
      cand.item.nineSliceBorders ??
      computeNineSliceFromRgbaBuffer(cand.rgba.data, cand.rgba.width, cand.rgba.height)
    rawBatch.push({
      id: imgId,
      title: cand.item.name,
      dataUrl,
      createdAt
    })
    items.push({
      ...cand.item,
      ...(nineSliceBorders ? { nineSliceBorders } : {}),
      imageId: imgId,
      imageUrl: dataUrl
    })
  }

  const materialized = rawBatch.length
    ? await materializeGeneratedBatch(ctx, rawBatch, `uiComp:${ctx.node.id}:${stamp}`)
    : []
  const matById = new Map(materialized.map((m) => [m.id, m]))
  const persistedItems: UiSharedComponentItem[] = items.map((item) => {
    const mat = item.imageId ? matById.get(item.imageId) : undefined
    const rel = mat?.relativePath?.trim()
    if (rel) {
      // Strip inline base64 dataUrl from JSON param once materialized to relativePath
      const { imageUrl: _drop, ...rest } = item
      void _drop
      return {
        ...rest,
        imageRelativePath: rel
      }
    }
    return item
  })

  const extractedDoc: UiComponentLibrary = {
    ...emptyUiComponentLibrary(ctx.node.title || undefined),
    items: persistedItems,
    updatedAt: createdAt
  }
  const finalDoc = mergeUiComponentLibraries(upstreamLib, lockedPrev, extractedDoc)
  const docJson = stringifyUiComponentLibrary(finalDoc)

  const galleryImages =
    materialized.length > 0
      ? materialized
      : finalDoc.items
          .filter((i) => uiComponentItemImage(i))
          .map((i) => ({
            id: i.imageId || `uiComp:${i.id}`,
            title: i.name,
            dataUrl: i.imageUrl?.startsWith('data:') ? i.imageUrl : '',
            ...(i.imageRelativePath ? { relativePath: i.imageRelativePath } : {}),
            createdAt
          }))

  const previewPath = galleryImages[0]?.relativePath?.trim()
  if (galleryImages.length > 0) {
    commitGeneratedImages(ctx, galleryImages, previewPath, {
      uiComponentLibrary: docJson,
      uiComponentLibSourceHash: sourceHash,
      ...(force ? { filmForce: false } : {})
    })
  } else {
    ctx.patchNode?.({
      params: {
        uiComponentLibrary: docJson,
        uiComponentLibSourceHash: sourceHash,
        ...(force ? { filmForce: false } : {})
      }
    })
  }

  return {
    out: uiComponentsValue(finalDoc),
    'out-images': { kind: 'images', items: galleryImages }
  }
}
