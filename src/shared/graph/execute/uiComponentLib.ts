import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'
import {
  computeNineSliceFromRgbaBuffer,
  isCanvasSafeImageSrc,
  isLayerSplitBase,
  type ImageLayerSplitLayer
} from '../imageLayerSplit'
import {
  emptyUiComponentLibrary,
  mergeUiComponentLibraries,
  parseUiComponentLibrary,
  stringifyUiComponentLibrary,
  uiComponentItemImage,
  type UiComponentLibrary,
  type UiSharedComponentItem
} from '../uiComponentLibrary'
import {
  extractSharedComponentsFromSplitResults,
  matchElementToComponentLibrary,
  runPreciseUiSplit,
  type PreciseSplitComponentCandidate,
  type PreciseSplitIo,
  type PreciseSplitLayer,
  type PreciseSplitResult,
  type RgbaImage,
  type UiElementKind
} from '../uiPreciseSplit'
import { canRunPreciseLayerSplit } from './layerSplitPrecise'
import { commitGeneratedImages, materializeGeneratedBatch } from './materialize'
import { collectIncomingImageItems } from './mediaInputs'
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

function buildSourceHash(urls: readonly string[], mode: string, visionKey: string): string {
  const sig = urls
    .map((u) => `${u.length}:${u.slice(0, 48)}:${u.length > 64 ? u.slice(-24) : ''}`)
    .join('|')
  let h = 0x811c9dc5
  const full = `${mode}::${visionKey}::${sig}`
  for (let i = 0; i < full.length; i++) {
    h ^= full.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${urls.length}:${(h >>> 0).toString(16)}`
}

async function splitScreenForComponentExtraction(
  ctx: NodeExecuteContext,
  safeUrl: string,
  title: string | undefined,
  stamp: number,
  screenIdx: number
): Promise<PreciseSplitResult | null> {
  const codec = ctx.uiRgbaCodec
  if (!codec) return null
  const source = await codec.decodeImageRgba(safeUrl)

  if (canRunPreciseLayerSplit(ctx) && ctx.generateText) {
    const generateText = ctx.generateText
    const visionModel = ctx.node.params.visionModel?.trim() || undefined
    const visionProviderInstanceId = ctx.node.params.visionProviderInstanceId?.trim() || undefined
    const generateModel = ctx.node.params.generateModel?.trim() || undefined
    const generateProviderInstanceId =
      ctx.node.params.generateProviderInstanceId?.trim() || undefined
    let editIdx = 0
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
      ...(generateModel && ctx.generateImage
        ? {
            editImage: async (req) => {
              const res = await ctx.generateImage!({
                prompt: req.prompt,
                model: generateModel,
                providerInstanceId: generateProviderInstanceId,
                resolution: '2K',
                ...(req.aspectRatio ? { aspectRatio: req.aspectRatio } : {}),
                inputReferences: req.maskImage ? [req.image, req.maskImage] : [req.image]
              })
              const u = res.layers?.[0]?.url?.trim() || res.images?.[0]?.trim() || ''
              if (!u) return null
              editIdx += 1
              const safe = await resolveSafeImageUrl(
                ctx,
                { url: u },
                stamp,
                `s${screenIdx}_p${editIdx}`
              )
              return safe ? codec.decodeImageRgba(safe) : null
            }
          }
        : {}),
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
      // Component extraction prioritizes deterministic multi-instance/mirror/local surface cleanups
      generativePeel: Boolean(generateModel && ctx.generateImage),
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

  // Gather screen images from `in`, `in-images`, or asset references
  const incomingItems = await collectIncomingImageItems(ctx)
  for (const val of ctx.inputs['in-images'] ?? []) {
    if (val.kind === 'images') {
      for (const it of val.items ?? []) {
        incomingItems.push(it)
      }
    } else if (val.kind === 'image') {
      incomingItems.push(val)
    }
  }

  // Deduplicate incoming screen items by relativePath or dataUrl
  const uniqueScreenItems: GraphImageItem[] = []
  const seenKeys = new Set<string>()
  for (const it of incomingItems) {
    const key = it.relativePath?.trim() || it.dataUrl?.trim() || it.id?.trim() || ''
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
  const sourceHash = buildSourceHash(
    resolvedScreens.map((s) => s.safeUrl),
    extractMode,
    visionKey
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

  const extracted = extractSharedComponentsFromSplitResults(splits, { mode: extractMode })
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
