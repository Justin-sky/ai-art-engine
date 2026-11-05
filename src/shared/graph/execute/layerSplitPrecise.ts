import {
  computeNineSliceFromRgbaBuffer,
  type ImageLayerSplitGroup,
  type ImageLayerSplitLayer
} from '../imageLayerSplit'
import type { UiSharedComponentItem } from '../uiComponentLibrary'
import {
  buildUiExportNames,
  extractCleanLayerFromSolidBgCanvas,
  groupableElementIds,
  nearestAspectRatio,
  resizeAreaAverage,
  runPreciseUiSplit,
  type PreciseSplitComponentCandidate,
  type PreciseSplitIo,
  type PreciseSplitResult,
  type RgbaImage
} from '../uiPreciseSplit'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'
import type { GraphImageItem, NodeExecuteContext } from './types'

/** 需要九宫格切边的结构类控件 */
const NINE_SLICE_KINDS: ReadonlySet<string> = new Set([
  'panel',
  'frame',
  'banner',
  'button',
  'tab',
  'item-slot',
  'progress-bar'
])

/**
 * 精准拆层（OCR + 多模态版面树 + 逐级剥层）在执行器里的适配层：
 * 负责把 ctx 能力注入成 {@link PreciseSplitIo}，再把流水线结果转换成
 * `ImageLayerSplitState` 需要的图层 / 分组 / 图片批次。
 */
export interface PreciseLayerSplitMapped {
  layers: ImageLayerSplitLayer[]
  groups: ImageLayerSplitGroup[]
  batch: GraphImageItem[]
  canvasWidth: number
  canvasHeight: number
  componentLibrary?: UiSharedComponentItem[]
  result: PreciseSplitResult
}

export function canRunPreciseLayerSplit(ctx: NodeExecuteContext): boolean {
  return Boolean(ctx.uiRgbaCodec && ctx.generateText)
}

function normalizeEditResolution(resolution: string | undefined): string {
  const r = String(resolution ?? '').trim()
  if (!r || r === 'auto' || r === '1.5K') return '2K'
  return r
}

export async function runPreciseLayerSplitForNode(
  ctx: NodeExecuteContext,
  input: {
    sourceUrl: string
    sourceTitle?: string
    userHint: string
    /** 生图模型（剥层补底） */
    model?: string
    providerInstanceId?: string
    resolution?: string
    stamp: number
    /** 上游共享组件库母本候选 */
    components?: readonly PreciseSplitComponentCandidate[]
    /** 把任意图片地址（https / TOS）转成 canvas 可解码地址 */
    toCanvasSafeUrl: (url: string, suffix: string) => Promise<string | undefined>
  }
): Promise<PreciseLayerSplitMapped> {
  const codec = ctx.uiRgbaCodec
  const generateText = ctx.generateText
  if (!codec || !generateText) {
    throw new Error('PRECISE_SPLIT_NO_CAPABILITY')
  }
  const generateImage = ctx.generateImage
  if (!generateImage) {
    throw fail(SHARED_ERRORS.capabilityImageGenerate)
  }
  const { stamp } = input
  const nodeId = ctx.node.id
  const visionModel = ctx.node.params.visionModel?.trim() || undefined
  const visionProviderInstanceId = ctx.node.params.visionProviderInstanceId?.trim() || undefined

  const safeSource = await input.toCanvasSafeUrl(input.sourceUrl, 'source')
  if (!safeSource) throw new Error('PRECISE_SPLIT_SOURCE_UNREADABLE')
  const source = await codec.decodeImageRgba(safeSource)

  const log = (message: string): void => {
    ctx.log?.(`[precise-split] ${message}`, 'info')
  }

  let editIndex = 0
  let sam2Ready = false
  if (codec.segmentSam2 && codec.hasSam2) {
    try {
      sam2Ready = await codec.hasSam2()
    } catch {
      sam2Ready = false
    }
  }
  log(
    `sam2: ${sam2Ready ? 'enabled (local SAM 2.1 ONNX)' : 'not installed, using studio solid-bg purification'}`
  )
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
    editImage: async (req): Promise<RgbaImage | null> => {
      const res = await generateImage({
        prompt: req.prompt,
        model: input.model,
        providerInstanceId: input.providerInstanceId,
        resolution: normalizeEditResolution(input.resolution),
        ...(req.aspectRatio ? { aspectRatio: req.aspectRatio } : {}),
        inputReferences: req.maskImage ? [req.image, req.maskImage] : [req.image]
      })
      const url = res.layers?.[0]?.url?.trim() || res.images?.[0]?.trim() || ''
      if (!url) return null
      editIndex += 1
      const safe = await input.toCanvasSafeUrl(url, `peel${editIndex}`)
      if (!safe) return null
      return codec.decodeImageRgba(safe)
    },
    purifyLayerImage: async (req): Promise<RgbaImage | null> => {
      const res = await generateImage({
        prompt: req.prompt,
        model: input.model,
        providerInstanceId: input.providerInstanceId,
        resolution: req.resolution ?? '1K',
        ...(req.aspectRatio ? { aspectRatio: req.aspectRatio } : {}),
        inputReferences: [req.referenceImage]
      })
      const url = res.layers?.[0]?.url?.trim() || res.images?.[0]?.trim() || ''
      if (!url) return null
      editIndex += 1
      const safe = await input.toCanvasSafeUrl(url, `purify${editIndex}`)
      if (!safe) return null
      return codec.decodeImageRgba(safe)
    },
    encodePng: (img) => codec.encodeRgbaPng(img),
    ...(sam2Ready && codec.segmentSam2
      ? {
          segmentSam2: (req) => codec.segmentSam2!(req)
        }
      : {}),
    ...(codec.recognizeImageText
      ? {
          ocr: async (img) => {
            const dataUrl = await codec.encodeRgbaPng(img)
            return (await codec.recognizeImageText?.(dataUrl)) ?? []
          }
        }
      : {}),
    log,
    signal: ctx.signal ?? null
  }

  const result = await runPreciseUiSplit(io, source, {
    locale: ctx.locale,
    userHint: input.userHint,
    sourceTitle: input.sourceTitle,
    ...(input.components?.length ? { components: input.components } : {})
  })
  log(
    `done: ${result.layers.length} layers, recon error ${result.reconstructionError.toFixed(2)}, peel ${result.peelReport
      .map((r) => `L${r.level}:${r.method}×${r.elementCount}`)
      .join(' ')}`
  )
  // 便于在控制台排查（宽高比用于确认生图模型输入尺寸）
  log(
    `canvas ${result.canvasWidth}x${result.canvasHeight} (${nearestAspectRatio(result.canvasWidth, result.canvasHeight)})`
  )

  const mergedComponents: PreciseSplitComponentCandidate[] = [
    ...(input.components ?? []),
    ...(result.synthesizedComponents ?? [])
  ]
  const effectiveComponents = mergedComponents.length > 0 ? mergedComponents : undefined

  return mapPreciseResultToLayers(result, {
    idPrefix: `layerSplit:${nodeId}:${stamp}`,
    encodePng: (img) => codec.encodeRgbaPng(img),
    components: effectiveComponents
  })
}

/** 纯转换：流水线结果 → 图层 / 分组 / 批次（导出供测试） */
export async function mapPreciseResultToLayers(
  result: PreciseSplitResult,
  opts: {
    idPrefix: string
    encodePng: (img: RgbaImage) => Promise<string>
    components?: readonly PreciseSplitComponentCandidate[]
  }
): Promise<PreciseLayerSplitMapped> {
  const W = result.canvasWidth
  const H = result.canvasHeight
  const createdAt = new Date().toISOString()
  const layers: ImageLayerSplitLayer[] = []
  const batch: GraphImageItem[] = []
  const componentLibrary: UiSharedComponentItem[] = []
  const compById = new Map<string, UiSharedComponentItem>()

  if (opts.components?.length) {
    for (const cand of opts.components) {
      const compImgId = `${opts.idPrefix}:comp:${cand.item.id}`
      const compUrl = await opts.encodePng(cand.rgba)
      batch.push({
        id: compImgId,
        title: `Master · ${cand.item.name}`,
        dataUrl: compUrl,
        createdAt
      })
      const enriched: UiSharedComponentItem = {
        ...cand.item,
        imageId: compImgId
      }
      componentLibrary.push(enriched)
      compById.set(enriched.id, enriched)
    }
  }

  const baseId = `${opts.idPrefix}:base`
  const baseUrl = await opts.encodePng(result.base)
  layers.push({
    id: baseId,
    imageId: baseId,
    zIndex: 0,
    name: 'Base',
    description: '',
    visible: true,
    left: 0,
    top: 0,
    width: W,
    height: H,
    role: 'canvas-base',
    uiPartRole: 'canvas-base'
  })
  batch.push({ id: baseId, title: 'Base', dataUrl: baseUrl, createdAt })

  const layerIdByElement = new Map<string, string>()
  result.layers.forEach((layer, i) => {
    layerIdByElement.set(layer.elementId, `${opts.idPrefix}:e${i + 1}`)
  })

  // 分组：有子图层的元素各成一组；元素本体图层放在自己的组内
  const groupable = groupableElementIds(result.layers)
  const groupIdByElement = new Map<string, string>()
  for (const elementId of groupable) {
    groupIdByElement.set(elementId, `${opts.idPrefix}:g:${elementId}`)
  }
  const groups: ImageLayerSplitGroup[] = []
  for (const layer of result.layers) {
    const groupId = groupIdByElement.get(layer.elementId)
    if (!groupId) continue
    const parentGroupId = layer.parentElementId
      ? groupIdByElement.get(layer.parentElementId)
      : undefined
    groups.push({
      id: groupId,
      name: layer.name,
      collapsed: false,
      visible: true,
      sourceLayerId: layerIdByElement.get(layer.elementId)!,
      ...(parentGroupId ? { parentGroupId } : {})
    })
  }

  const qaById = new Map((result.qa?.layers ?? []).map((q) => [q.elementId, q.issues]))
  const exportNames = buildUiExportNames(
    result.layers.map((l) => ({
      id: l.elementId,
      kind: l.kind,
      name: l.name,
      ...(l.editableText?.text ? { text: l.editableText.text } : {})
    }))
  )
  for (const layer of result.layers) {
    const id = layerIdByElement.get(layer.elementId)!
    const ownGroup = groupIdByElement.get(layer.elementId)
    const parentGroup = layer.parentElementId
      ? groupIdByElement.get(layer.parentElementId)
      : undefined
    const groupId = ownGroup ?? parentGroup
    const dataUrl = await opts.encodePng({
      width: layer.width,
      height: layer.height,
      data: layer.rgba
    })
    const right = layer.left + layer.width
    const bottom = layer.top + layer.height
    const matchedComp = layer.componentId ? compById.get(layer.componentId) : undefined
    // 结构类控件按像素自相似度测算九宫格切边（若命中九宫格组件母本则优先继承母本九宫格）
    const nineSliceBorders =
      matchedComp?.nineSliceBorders ??
      (NINE_SLICE_KINDS.has(layer.kind)
        ? computeNineSliceFromRgbaBuffer(layer.rgba, layer.width, layer.height)
        : undefined)
    const qaIssues = qaById.get(layer.elementId)
    const exportName = exportNames.get(layer.elementId)
    let originalImageId: string | undefined
    if (layer.componentId && layer.originalRgba) {
      originalImageId = `${id}:orig`
      const origUrl = await opts.encodePng({
        width: layer.width,
        height: layer.height,
        data: layer.originalRgba
      })
      batch.push({
        id: originalImageId,
        title: `${layer.name} (orig)`,
        dataUrl: origUrl,
        createdAt
      })
    }
    layers.push({
      id,
      imageId: id,
      zIndex: Math.max(1, layer.paintIndex),
      name: layer.name,
      description: layer.kind,
      visible: true,
      left: layer.left,
      top: layer.top,
      width: layer.width,
      height: layer.height,
      role: 'layer',
      originalAbsolute: [layer.left, layer.top, right, bottom],
      originalNormalized: [
        Math.round((layer.left / W) * 1000),
        Math.round((layer.top / H) * 1000),
        Math.round((right / W) * 1000),
        Math.round((bottom / H) * 1000)
      ],
      uiControlId: ownGroup ? layer.elementId : (layer.parentElementId ?? layer.elementId),
      uiControlName: layer.name,
      ...(groupId ? { groupId } : {}),
      ...(layer.uiControlType ? { uiControlType: layer.uiControlType } : {}),
      ...(layer.uiPartRole ? { uiPartRole: layer.uiPartRole } : {}),
      ...(layer.editableText ? { editableText: layer.editableText } : {}),
      ...(layer.blendMode && layer.blendMode !== 'normal' ? { blendMode: layer.blendMode } : {}),
      ...(layer.backdropBlurRadius ? { backdropBlurRadius: layer.backdropBlurRadius } : {}),
      ...(nineSliceBorders ? { nineSliceBorders } : {}),
      ...(exportName ? { exportName } : {}),
      ...(layer.prefabKey ? { prefabKey: layer.prefabKey } : {}),
      ...(layer.componentId
        ? {
            componentId: layer.componentId,
            componentImageId: id,
            ...(layer.componentMatchScore !== undefined
              ? { componentMatchScore: layer.componentMatchScore }
              : {}),
            ...(originalImageId ? { originalImageId } : {})
          }
        : {}),
      ...(qaIssues?.length ? { qaIssues: [...qaIssues] } : {})
    })
    batch.push({ id, title: layer.name, dataUrl, createdAt })
  }

  return {
    layers,
    groups,
    batch,
    canvasWidth: W,
    canvasHeight: H,
    ...(componentLibrary.length ? { componentLibrary } : {}),
    result
  }
}

/**
 * Post-processes full-canvas AI-generated foreground layers (`ai-layers` / `ai-inpaint-slice` API fallback)
 * that were returned on an opaque uniform white/dark studio background rather than genuine PNG alpha,
 * applying `bggg-creator-image2psd`'s `white-preserve` cavity-protected matting and tight-cropping
 * to exact canvas coordinates without moving pixels.
 */
export async function purifySolidBgFallbackSplitLayers(
  ctx: Pick<NodeExecuteContext, 'uiRgbaCodec' | 'log' | 'signal'>,
  mapped: {
    layers: ImageLayerSplitLayer[]
    batch: GraphImageItem[]
    canvasWidth: number
    canvasHeight: number
  },
  toCanvasSafeUrl?: (url: string, suffix: string) => Promise<string | undefined>
): Promise<number> {
  const codec = ctx.uiRgbaCodec
  if (!codec || !mapped.layers.length) return 0
  const baseLayer = mapped.layers.find(
    (l) => l.role === 'canvas-base' || l.uiPartRole === 'canvas-base' || l.zIndex <= 0
  )
  const rawCw =
    Number.isFinite(mapped.canvasWidth) && mapped.canvasWidth > 1 ? mapped.canvasWidth : 0
  const rawCh =
    Number.isFinite(mapped.canvasHeight) && mapped.canvasHeight > 1 ? mapped.canvasHeight : 0
  const cw = Math.max(rawCw, baseLayer?.width ?? 0)
  const ch = Math.max(rawCh, baseLayer?.height ?? 0)
  if (cw < 32 || ch < 32) return 0
  const batchById = new Map<string, GraphImageItem>()
  for (const item of mapped.batch) {
    if (item.id) batchById.set(item.id, item)
  }

  let purified = 0
  let fgIdx = 0
  for (const layer of mapped.layers) {
    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (layer.role === 'canvas-base' || layer.uiPartRole === 'canvas-base' || layer.zIndex <= 0) {
      continue
    }
    // Only run on uncropped full-canvas AI layer outputs sitting at (0, 0)
    if (
      layer.left !== 0 ||
      layer.top !== 0 ||
      layer.width < cw * 0.95 ||
      layer.height < ch * 0.95
    ) {
      continue
    }
    const item = layer.imageId ? batchById.get(layer.imageId) : undefined
    const rawUrl = item?.dataUrl?.trim()
    if (!item || !rawUrl) continue

    fgIdx += 1
    let rgba: RgbaImage
    try {
      const safeUrl = toCanvasSafeUrl ? await toCanvasSafeUrl(rawUrl, `aifg${fgIdx}`) : rawUrl
      if (!safeUrl) continue
      rgba = await codec.decodeImageRgba(safeUrl)
    } catch {
      continue
    }
    if (rgba.width < 64 || rgba.height < 64) continue

    const allowHollow =
      layer.uiControlType === 'panel' || /\bframe\b/i.test(layer.name || layer.description || '')
    const cleaned = extractCleanLayerFromSolidBgCanvas(rgba, {
      allowLargeHollowWindows: allowHollow
    })
    if (!cleaned) continue

    const scaleX = layer.width / Math.max(1, rgba.width)
    const scaleY = layer.height / Math.max(1, rgba.height)
    const nextLeft = Math.max(0, Math.round(layer.left + cleaned.box.left * scaleX))
    const nextTop = Math.max(0, Math.round(layer.top + cleaned.box.top * scaleY))
    const nextW = Math.max(1, Math.min(cw - nextLeft, Math.round(cleaned.box.width * scaleX)))
    const nextH = Math.max(1, Math.min(ch - nextTop, Math.round(cleaned.box.height * scaleY)))
    const outImg =
      cleaned.cropped.width === nextW && cleaned.cropped.height === nextH
        ? cleaned.cropped
        : resizeAreaAverage(cleaned.cropped, nextW, nextH)

    item.dataUrl = await codec.encodeRgbaPng(outImg)
    layer.left = nextLeft
    layer.top = nextTop
    layer.width = nextW
    layer.height = nextH
    const right = nextLeft + nextW
    const bottom = nextTop + nextH
    layer.originalAbsolute = [nextLeft, nextTop, right, bottom]
    layer.originalNormalized = [
      Math.round((nextLeft / cw) * 1000),
      Math.round((nextTop / ch) * 1000),
      Math.round((right / cw) * 1000),
      Math.round((bottom / ch) * 1000)
    ]
    purified += 1
  }

  if (purified > 0) {
    ctx.log?.(
      `[layer-split] white-preserve solid-bg matte purified ${purified} full-canvas AI foreground layer(s)`,
      'info'
    )
  }
  return purified
}
