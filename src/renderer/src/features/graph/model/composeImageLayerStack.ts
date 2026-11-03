import {
  computeNineSliceFromRgbaBuffer,
  decomposeControlIntoStandardParts,
  decomposeRgbaBufferToUiLayers,
  isCanvasSafeImageSrc,
  isLayerSplitBase,
  isLayerSplitLayerDrawable,
  sliceUiLayerFromRgbaRect,
  sortLayersForCompose,
  stripOpaqueRepairBackgroundInPlace,
  type ImageLayerSplitLayer,
  type ImageLayerSplitRect,
  type ImageLayerSplitState,
  type LocalOcrTextBox,
  type UiControlPartRole,
  type UiControlType,
  type UiEditableTextMeta
} from '@shared/graph'
import {
  fillHoles,
  inpaintPushPull,
  type PreciseSplitSam2Candidate,
  type PreciseSplitSam2Request
} from '@shared/graph/uiPreciseSplit'
import { getYoloStatus, yoloSam2 } from '../../yolo/api'
import { SHARED_ERRORS } from '@shared/errors/catalog'
import { fail } from '@shared/errors/appError'
import { layerSplitToPsdUint8Array } from './layerSplitPsd'

async function runLocalOcrIfAvailable(dataUrl: string): Promise<LocalOcrTextBox[]> {
  try {
    const studio = (
      globalThis as {
        studio?: {
          recognizeImageText?: (input: { dataUrl: string }) => Promise<LocalOcrTextBox[]>
        }
      }
    ).studio
    if (!studio?.recognizeImageText) return []
    const boxes = await studio.recognizeImageText({ dataUrl })
    return Array.isArray(boxes) ? boxes : []
  } catch {
    return []
  }
}

function uint8ArrayToDataUrl(bytes: Uint8Array, mime: string): string {
  const chunkSize = 0x8000
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize)
    chunks.push(String.fromCharCode(...sub))
  }
  return `data:${mime};base64,${btoa(chunks.join(''))}`
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const url = src.trim()
  if (!isCanvasSafeImageSrc(url)) {
    return Promise.reject(new Error('LAYER_SPLIT_SOURCE_LOAD_FAILED'))
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (!url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('file:')) {
      img.crossOrigin = 'anonymous'
    }
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('LAYER_SPLIT_SOURCE_LOAD_FAILED'))
    img.src = url
  })
}

export async function composeImageLayerStack(input: {
  state: ImageLayerSplitState
  layerUrls: Record<string, string>
}): Promise<{ dataUrl: string; width: number; height: number; psdDataUrl?: string }> {
  const layers = sortLayersForCompose(input.state.layers).filter((layer) =>
    isLayerSplitLayerDrawable(input.state, layer)
  )
  if (!layers.length) throw fail(SHARED_ERRORS.imageComposeNoLayers)

  const base = layers.find((layer) => isLayerSplitBase(layer)) ?? layers[0]!
  const baseUrl = input.layerUrls[base.imageId]?.trim() || input.layerUrls[base.id]?.trim()
  if (!baseUrl) throw fail(SHARED_ERRORS.imageComposeBaseMissing)
  const baseImg = await loadImage(baseUrl)

  const canvasWidth = Math.max(1, Math.round(input.state.canvasWidth) || baseImg.naturalWidth || 1)
  const canvasHeight = Math.max(
    1,
    Math.round(input.state.canvasHeight) || baseImg.naturalHeight || 1
  )
  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('LAYER_SPLIT_CANVAS_UNAVAILABLE')

  for (const layer of layers) {
    const url =
      layer.id === base.id
        ? baseUrl
        : input.layerUrls[layer.imageId]?.trim() || input.layerUrls[layer.id]?.trim()
    if (!url) continue
    const img = layer.id === base.id ? baseImg : await loadImage(url)
    if (isLayerSplitBase(layer)) {
      ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight)
      continue
    }
    ctx.drawImage(img, layer.left, layer.top, Math.max(1, layer.width), Math.max(1, layer.height))
  }

  let psdDataUrl: string | undefined
  try {
    const psdBytes = await layerSplitToPsdUint8Array({
      state: input.state,
      layerUrls: input.layerUrls
    })
    psdDataUrl = uint8ArrayToDataUrl(psdBytes, 'image/vnd.adobe.photoshop')
  } catch {
    psdDataUrl = undefined
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvasWidth,
    height: canvasHeight,
    ...(psdDataUrl ? { psdDataUrl } : {})
  }
}

function rgbaBufferToPngDataUrl(rgba: Uint8ClampedArray, width: number, height: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('LAYER_SPLIT_CANVAS_UNAVAILABLE')
  const imageData = ctx.createImageData(canvas.width, canvas.height)
  imageData.data.set(rgba)
  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

export async function decomposeImageUiLayers(input: {
  sourceDataUrl: string
  cleanBaseDataUrl?: string
  maxLayers?: number
  diffThreshold?: number
  apiLayerHints?: Array<{
    name?: string
    description?: string
    left: number
    top: number
    width: number
    height: number
    controlType?: UiControlType
    ocrText?: string
  }>
}): Promise<{
  width: number
  height: number
  baseDataUrl: string
  widgets: Array<{
    name: string
    description?: string
    left: number
    top: number
    width: number
    height: number
    dataUrl: string
    visible?: boolean
    uiControlId?: string
    uiControlName?: string
    uiControlType?: UiControlType
    uiPartRole?: UiControlPartRole
    nineSliceBorders?: [number, number, number, number]
    editableText?: UiEditableTextMeta
  }>
}> {
  const srcImg = await loadImage(input.sourceDataUrl)
  const width = Math.max(1, srcImg.naturalWidth || srcImg.width || 1)
  const height = Math.max(1, srcImg.naturalHeight || srcImg.height || 1)

  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = width
  srcCanvas.height = height
  const srcCtx = srcCanvas.getContext('2d')
  if (!srcCtx) throw new Error('LAYER_SPLIT_CANVAS_UNAVAILABLE')
  srcCtx.drawImage(srcImg, 0, 0, width, height)
  const sourceRgba = srcCtx.getImageData(0, 0, width, height).data

  const ocrPromise = runLocalOcrIfAvailable(srcCanvas.toDataURL('image/png'))

  let cleanBaseRgba: Uint8ClampedArray | undefined
  if (input.cleanBaseDataUrl?.trim()) {
    try {
      const baseImg = await loadImage(input.cleanBaseDataUrl.trim())
      const baseCanvas = document.createElement('canvas')
      baseCanvas.width = width
      baseCanvas.height = height
      const baseCtx = baseCanvas.getContext('2d')
      if (baseCtx) {
        baseCtx.drawImage(baseImg, 0, 0, width, height)
        cleanBaseRgba = baseCtx.getImageData(0, 0, width, height).data
      }
    } catch {
      cleanBaseRgba = undefined
    }
  }

  const ocrBoxes = await ocrPromise

  const decomposed = decomposeRgbaBufferToUiLayers({
    sourceRgba,
    width,
    height,
    cleanBaseRgba,
    maxLayers: input.maxLayers,
    apiLayerHints: input.apiLayerHints,
    ocrBoxes
  })

  const baseDataUrl = rgbaBufferToPngDataUrl(decomposed.baseRgba, width, height)
  const widgets = decomposed.layers.map((widget) => ({
    name: widget.name,
    description: widget.description,
    left: widget.left,
    top: widget.top,
    width: widget.width,
    height: widget.height,
    dataUrl: rgbaBufferToPngDataUrl(widget.rgba, widget.width, widget.height),
    ...(widget.visible !== undefined ? { visible: widget.visible } : {}),
    ...(widget.uiControlId ? { uiControlId: widget.uiControlId } : {}),
    ...(widget.uiControlName ? { uiControlName: widget.uiControlName } : {}),
    ...(widget.uiControlType ? { uiControlType: widget.uiControlType } : {}),
    ...(widget.uiPartRole ? { uiPartRole: widget.uiPartRole } : {}),
    ...(widget.nineSliceBorders ? { nineSliceBorders: widget.nineSliceBorders } : {}),
    ...(widget.editableText ? { editableText: widget.editableText } : {})
  }))

  return {
    width,
    height,
    baseDataUrl,
    widgets
  }
}

/**
 * 将单个已切出的 UI 控件图层（如按钮、滑动条、面板）按 HTML5 / Unity UI Toolkit 标准控件规范拆解为结构化子部件图层。
 */
export async function decomposeSingleLayerUrlToControlParts(input: {
  layer: ImageLayerSplitLayer
  layerUrl: string
  canvasWidth: number
  canvasHeight: number
  locale?: string
}): Promise<
  Array<{
    idSuffix: string
    name: string
    description: string
    left: number
    top: number
    width: number
    height: number
    dataUrl: string
    visible: boolean
    uiControlId: string
    uiControlName: string
    uiControlType: UiControlType
    uiPartRole: UiControlPartRole
    nineSliceBorders?: [number, number, number, number]
    editableText?: UiEditableTextMeta
  }>
> {
  const img = await loadImage(input.layerUrl)
  const width = Math.max(1, Math.round(input.layer.width) || img.naturalWidth || img.width || 1)
  const height = Math.max(1, Math.round(input.layer.height) || img.naturalHeight || img.height || 1)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('LAYER_SPLIT_CANVAS_UNAVAILABLE')
  ctx.drawImage(img, 0, 0, width, height)
  const rgba = ctx.getImageData(0, 0, width, height).data

  const localOcrBoxes = await runLocalOcrIfAvailable(canvas.toDataURL('image/png'))
  const shiftedOcrBoxes: LocalOcrTextBox[] = localOcrBoxes.map((b) => ({
    ...b,
    left: input.layer.left + b.left,
    top: input.layer.top + b.top
  }))

  const nineSliceBorders =
    input.layer.nineSliceBorders ?? computeNineSliceFromRgbaBuffer(rgba, width, height)
  const controlId = input.layer.uiControlId?.trim() || `ctrl:${input.layer.id}`
  const controlName = input.layer.uiControlName?.trim() || input.layer.name

  const parts = decomposeControlIntoStandardParts({
    nameHint: controlName,
    descriptionHint: input.layer.description,
    controlType: input.layer.uiControlType,
    ocrText: input.layer.editableText?.text,
    ocrBoxes: shiftedOcrBoxes,
    left: input.layer.left,
    top: input.layer.top,
    width,
    height,
    canvasWidth: Math.max(1, input.canvasWidth),
    canvasHeight: Math.max(1, input.canvasHeight),
    rgba,
    nineSliceBorders,
    locale: input.locale
  })

  return parts.map((part) => ({
    idSuffix: part.idSuffix,
    name: part.name,
    description: part.description,
    left: part.left,
    top: part.top,
    width: part.width,
    height: part.height,
    dataUrl: rgbaBufferToPngDataUrl(part.rgba, part.width, part.height),
    visible: part.visible,
    uiControlId: controlId,
    uiControlName: controlName,
    uiControlType: part.uiControlType,
    uiPartRole: part.uiPartRole,
    ...(part.nineSliceBorders ? { nineSliceBorders: part.nineSliceBorders } : {}),
    ...(part.editableText ? { editableText: part.editableText } : {})
  }))
}

/**
 * 手动框选切层（Box-Slice）：从源图（或基底图）按给定画布矩形框智能抠出独立透明图层 PNG 及其结构化控件子部件。
 */
export async function sliceUiLayerFromSourceCanvas(input: {
  sourceUrl: string
  baseUrl?: string
  canvasWidth: number
  canvasHeight: number
  rect: ImageLayerSplitRect
  layerIndex: number
}): Promise<{
  name: string
  description: string
  left: number
  top: number
  width: number
  height: number
  dataUrl: string
  uiControlId?: string
  uiControlName?: string
  uiControlType?: UiControlType
  nineSliceBorders?: [number, number, number, number]
  subParts: Array<{
    name: string
    description: string
    left: number
    top: number
    width: number
    height: number
    dataUrl: string
    visible: boolean
    uiControlId?: string
    uiControlName?: string
    uiControlType?: UiControlType
    uiPartRole?: UiControlPartRole
    nineSliceBorders?: [number, number, number, number]
    editableText?: UiEditableTextMeta
  }>
}> {
  const srcImg = await loadImage(input.sourceUrl)
  const width = Math.max(1, input.canvasWidth || srcImg.naturalWidth || srcImg.width || 1)
  const height = Math.max(1, input.canvasHeight || srcImg.naturalHeight || srcImg.height || 1)

  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = width
  srcCanvas.height = height
  const srcCtx = srcCanvas.getContext('2d')
  if (!srcCtx) throw new Error('LAYER_SPLIT_CANVAS_UNAVAILABLE')
  srcCtx.drawImage(srcImg, 0, 0, width, height)
  const sourceRgba = srcCtx.getImageData(0, 0, width, height).data

  const ocrPromise = runLocalOcrIfAvailable(srcCanvas.toDataURL('image/png'))

  let cleanBaseRgba: Uint8ClampedArray | undefined
  if (input.baseUrl?.trim() && input.baseUrl.trim() !== input.sourceUrl.trim()) {
    try {
      const baseImg = await loadImage(input.baseUrl.trim())
      const baseCanvas = document.createElement('canvas')
      baseCanvas.width = width
      baseCanvas.height = height
      const baseCtx = baseCanvas.getContext('2d')
      if (baseCtx) {
        baseCtx.drawImage(baseImg, 0, 0, width, height)
        cleanBaseRgba = baseCtx.getImageData(0, 0, width, height).data
      }
    } catch {
      cleanBaseRgba = undefined
    }
  }

  const ocrBoxes = await ocrPromise

  const { layer: sliced, subParts } = sliceUiLayerFromRgbaRect({
    sourceRgba,
    width,
    height,
    rect: input.rect,
    baseRgba: cleanBaseRgba,
    zIndex: input.layerIndex,
    ocrBoxes
  })

  return {
    name: sliced.name,
    description: sliced.description,
    left: sliced.left,
    top: sliced.top,
    width: sliced.width,
    height: sliced.height,
    dataUrl: rgbaBufferToPngDataUrl(sliced.rgba, sliced.width, sliced.height),
    ...(sliced.uiControlId ? { uiControlId: sliced.uiControlId } : {}),
    ...(sliced.uiControlName ? { uiControlName: sliced.uiControlName } : {}),
    ...(sliced.uiControlType ? { uiControlType: sliced.uiControlType } : {}),
    ...(sliced.nineSliceBorders ? { nineSliceBorders: sliced.nineSliceBorders } : {}),
    subParts: subParts.map((sp) => ({
      name: sp.name,
      description: sp.description,
      left: sp.left,
      top: sp.top,
      width: sp.width,
      height: sp.height,
      dataUrl: rgbaBufferToPngDataUrl(sp.rgba, sp.width, sp.height),
      visible: sp.visible !== false,
      ...(sp.uiControlId ? { uiControlId: sp.uiControlId } : {}),
      ...(sp.uiControlName ? { uiControlName: sp.uiControlName } : {}),
      ...(sp.uiControlType ? { uiControlType: sp.uiControlType } : {}),
      ...(sp.uiPartRole ? { uiPartRole: sp.uiPartRole } : {}),
      ...(sp.nineSliceBorders ? { nineSliceBorders: sp.nineSliceBorders } : {}),
      ...(sp.editableText ? { editableText: sp.editableText } : {})
    }))
  }
}

/**
 * 将上下两个控件图层按各自的画布坐标融合为单张透明 PNG（向下合并图层）。
 */
export async function mergeTwoLayerImagesToDataUrl(input: {
  upperLayer: ImageLayerSplitLayer
  upperUrl: string
  lowerLayer: ImageLayerSplitLayer
  lowerUrl: string
}): Promise<{ dataUrl: string; mergedRect: ImageLayerSplitRect }> {
  const [lowerImg, upperImg] = await Promise.all([
    loadImage(input.lowerUrl),
    loadImage(input.upperUrl)
  ])
  const left = Math.min(input.lowerLayer.left, input.upperLayer.left)
  const top = Math.min(input.lowerLayer.top, input.upperLayer.top)
  const right = Math.max(
    input.lowerLayer.left + Math.max(1, input.lowerLayer.width),
    input.upperLayer.left + Math.max(1, input.upperLayer.width)
  )
  const bottom = Math.max(
    input.lowerLayer.top + Math.max(1, input.lowerLayer.height),
    input.upperLayer.top + Math.max(1, input.upperLayer.height)
  )
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('LAYER_SPLIT_CANVAS_UNAVAILABLE')

  ctx.drawImage(
    lowerImg,
    input.lowerLayer.left - left,
    input.lowerLayer.top - top,
    Math.max(1, input.lowerLayer.width),
    Math.max(1, input.lowerLayer.height)
  )
  ctx.drawImage(
    upperImg,
    input.upperLayer.left - left,
    input.upperLayer.top - top,
    Math.max(1, input.upperLayer.width),
    Math.max(1, input.upperLayer.height)
  )

  return {
    dataUrl: canvas.toDataURL('image/png'),
    mergedRect: { left, top, width, height }
  }
}

export function layerUrlMapFromItems(
  items: Array<{ id?: string; dataUrl?: string }>,
  extra?: Record<string, string>
): Record<string, string> {
  const map: Record<string, string> = { ...(extra ?? {}) }
  for (const item of items) {
    const id = item.id?.trim()
    const url = item.dataUrl?.trim()
    if (!id || !url) continue
    map[id] = url
  }
  return map
}

/**
 * 精准 UI 拆层的像素编解码（执行器 `ctx.uiRgbaCodec` 的落地）：
 * shared 流水线只认 RGBA 缓冲区，解码 / PNG 编码 / 本地 OCR 在这里用 canvas 与 IPC 完成。
 */
export const uiRgbaCodec = {
  async decodeImageRgba(
    url: string
  ): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
    const img = await loadImage(url)
    const width = Math.max(1, img.naturalWidth || img.width || 1)
    const height = Math.max(1, img.naturalHeight || img.height || 1)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('LAYER_SPLIT_CANVAS_UNAVAILABLE')
    ctx.drawImage(img, 0, 0, width, height)
    return {
      width,
      height,
      data: new Uint8ClampedArray(ctx.getImageData(0, 0, width, height).data)
    }
  },
  async encodeRgbaPng(img: {
    width: number
    height: number
    data: Uint8ClampedArray
  }): Promise<string> {
    return rgbaBufferToPngDataUrl(img.data, img.width, img.height)
  },
  recognizeImageText(dataUrl: string): Promise<LocalOcrTextBox[]> {
    return runLocalOcrIfAvailable(dataUrl)
  },
  hasSam2(): Promise<boolean> {
    return isSam2Available()
  },
  /**
   * 本地 SAM 2.1 点 / 框提示分割：未安装模型、推理进程不可用或连续失败时返回 null，
   * 由精准拆层流水线回退到本地多候选分割。
   */
  async segmentSam2(req: PreciseSplitSam2Request): Promise<PreciseSplitSam2Candidate[] | null> {
    if (!(await isSam2Available())) return null
    const { image, box } = req
    try {
      const res = await yoloSam2({
        image: {
          kind: 'raw',
          width: image.width,
          height: image.height,
          rgba: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength)
        },
        box: {
          x0: box.left,
          y0: box.top,
          x1: box.left + box.width,
          y1: box.top + box.height
        },
        points: [
          ...req.positivePoints.map((p) => ({ x: p.x, y: p.y, label: 1 as const })),
          ...req.negativePoints.map((p) => ({ x: p.x, y: p.y, label: 0 as const }))
        ]
      })
      sam2FailureCount = 0
      const n = image.width * image.height
      const out: PreciseSplitSam2Candidate[] = []
      res.masks.forEach((m, i) => {
        if (m.width !== image.width || m.height !== image.height) return
        const mask = new Uint8Array(n)
        let fg = 0
        for (let p = 0; p < n; p++) {
          if (m.data[p]! >= 128) {
            mask[p] = 1
            fg++
          }
        }
        if (fg > 0) out.push({ mask, samScore: res.scores[i] ?? 0.5 })
      })
      return out.length ? out : null
    } catch (err) {
      sam2FailureCount += 1
      if (sam2FailureCount >= 2) sam2DisabledUntil = Date.now() + 60_000
      console.warn('[precise-split] SAM 2.1 segmentation failed, falling back to local:', err)
      return null
    }
  }
}

let sam2StatusCache: { at: number; available: boolean } | null = null
let sam2FailureCount = 0
let sam2DisabledUntil = 0

async function isSam2Available(): Promise<boolean> {
  if (Date.now() < sam2DisabledUntil) return false
  if (sam2StatusCache && Date.now() - sam2StatusCache.at < 30_000) return sam2StatusCache.available
  let available = false
  try {
    const status = await getYoloStatus()
    available = status.ready && (status.sam2Models?.length ?? 0) > 0
  } catch {
    available = false
  }
  sam2StatusCache = { at: Date.now(), available }
  return available
}

/**
 * 在选中图层上应用手动画笔轨迹（擦除杂边像素 erase / 从原图还原漏抠像素 restore）。
 */
export async function applyLayerBrushStrokeToDataUrl(input: {
  layer: ImageLayerSplitLayer
  layerUrl: string
  sourceUrl?: string
  canvasWidth: number
  canvasHeight: number
  mode: 'erase' | 'restore'
  radius: number
  points: ReadonlyArray<{ x: number; y: number }>
}): Promise<string> {
  if (!input.points.length) return input.layerUrl
  const isBase = isLayerSplitBase(input.layer)
  const cw = Math.max(1, Math.round(input.canvasWidth))
  const ch = Math.max(1, Math.round(input.canvasHeight))
  const layerDecoded = await uiRgbaCodec.decodeImageRgba(input.layerUrl)
  const originLeft = isBase ? 0 : input.layer.left
  const originTop = isBase ? 0 : input.layer.top
  const lw = isBase
    ? Math.max(1, cw || layerDecoded.width)
    : Math.max(1, Math.round(input.layer.width) || layerDecoded.width)
  const lh = isBase
    ? Math.max(1, ch || layerDecoded.height)
    : Math.max(1, Math.round(input.layer.height) || layerDecoded.height)

  const canvas = document.createElement('canvas')
  canvas.width = lw
  canvas.height = lh
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('LAYER_SPLIT_CANVAS_UNAVAILABLE')
  const layerImg = await loadImage(input.layerUrl)
  ctx.drawImage(layerImg, 0, 0, lw, lh)
  const imgData = ctx.getImageData(0, 0, lw, lh)
  const data = imgData.data

  let srcData: Uint8ClampedArray | null = null
  if (input.mode === 'restore') {
    const trimmedSrc = input.sourceUrl?.trim()
    if (!trimmedSrc) return input.layerUrl
    const srcImg = await loadImage(trimmedSrc)
    const srcCanvas = document.createElement('canvas')
    srcCanvas.width = cw
    srcCanvas.height = ch
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })
    if (srcCtx) {
      srcCtx.drawImage(srcImg, 0, 0, cw, ch)
      srcData = srcCtx.getImageData(0, 0, cw, ch).data
    }
    if (!srcData) return input.layerUrl
  }

  const r = Math.max(2, Math.min(80, Math.round(input.radius)))
  const rSq = r * r
  // 底图擦除模式：用周围底图像素推拉插值平滑抹除残留阴影/外发光，避免在整幅底图上挖出透明破洞
  const baseHealStrength = isBase && input.mode === 'erase' ? new Float32Array(lw * lh) : null
  const paintDisk = (cxCanvas: number, cyCanvas: number): void => {
    const lx = cxCanvas - originLeft
    const ly = cyCanvas - originTop
    const x0 = Math.max(0, Math.floor(lx - r))
    const x1 = Math.min(lw - 1, Math.ceil(lx + r))
    const y0 = Math.max(0, Math.floor(ly - r))
    const y1 = Math.min(lh - 1, Math.ceil(ly + r))
    for (let y = y0; y <= y1; y++) {
      const dy = y - ly
      for (let x = x0; x <= x1; x++) {
        const dx = x - lx
        const dSq = dx * dx + dy * dy
        if (dSq > rSq) continue
        const dist = Math.sqrt(dSq)
        // 外圈 25% 柔和羽化
        const strength = dist <= r * 0.75 ? 1 : Math.max(0, (r - dist) / (r * 0.25))
        const p = y * lw + x
        if (baseHealStrength) {
          if (strength > baseHealStrength[p]!) baseHealStrength[p] = strength
          continue
        }
        const di = p * 4
        if (input.mode === 'erase') {
          data[di + 3] = Math.round(data[di + 3]! * (1 - strength))
        } else if (srcData) {
          const sx = Math.max(0, Math.min(cw - 1, Math.round(originLeft + x)))
          const sy = Math.max(0, Math.min(ch - 1, Math.round(originTop + y)))
          const si = (sy * cw + sx) * 4
          const curA = data[di + 3]! / 255
          const nextA = Math.min(1, curA + strength * (1 - curA))
          data[di] = Math.round(data[di]! * (1 - strength) + srcData[si]! * strength)
          data[di + 1] = Math.round(data[di + 1]! * (1 - strength) + srcData[si + 1]! * strength)
          data[di + 2] = Math.round(data[di + 2]! * (1 - strength) + srcData[si + 2]! * strength)
          data[di + 3] = Math.round(nextA * 255)
        }
      }
    }
  }

  for (let i = 0; i < input.points.length; i++) {
    const p0 = input.points[i]!
    paintDisk(p0.x, p0.y)
    if (i > 0) {
      const prev = input.points[i - 1]!
      const dist = Math.hypot(p0.x - prev.x, p0.y - prev.y)
      const steps = Math.max(1, Math.ceil(dist / Math.max(1, r * 0.35)))
      for (let s = 1; s < steps; s++) {
        const t = s / steps
        paintDisk(prev.x + (p0.x - prev.x) * t, prev.y + (p0.y - prev.y) * t)
      }
    }
  }

  if (baseHealStrength) {
    const n = lw * lh
    const holeMask = new Uint8Array(n)
    let count = 0
    for (let p = 0; p < n; p++) {
      if (baseHealStrength[p]! > 0.02) {
        holeMask[p] = 1
        count++
      }
    }
    if (count > 0 && count < n) {
      const healed = { width: lw, height: lh, data: new Uint8ClampedArray(data) }
      inpaintPushPull(healed, holeMask)
      for (let p = 0; p < n; p++) {
        const s = baseHealStrength[p]!
        if (s <= 0.02) continue
        const di = p * 4
        data[di] = Math.round(data[di]! * (1 - s) + healed.data[di]! * s)
        data[di + 1] = Math.round(data[di + 1]! * (1 - s) + healed.data[di + 1]! * s)
        data[di + 2] = Math.round(data[di + 2]! * (1 - s) + healed.data[di + 2]! * s)
        const curA = data[di + 3]!
        const targetA = Math.max(curA, healed.data[di + 3]!)
        data[di + 3] = Math.round(curA * (1 - s) + targetA * s)
      }
    }
  }

  ctx.putImageData(imgData, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * 一键修补单图层内部的闭合残缺孔洞（利用形态学闭合孔洞检测 + 推拉金字塔平滑插值）。
 */
export async function inpaintSingleLayerHolesToDataUrl(layerUrl: string): Promise<string> {
  const decoded = await uiRgbaCodec.decodeImageRgba(layerUrl)
  const { width, height, data } = decoded
  const n = width * height
  const fg = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    if (data[p * 4 + 3]! >= 96) fg[p] = 1
  }
  const filled = fillHoles(fg, width, height)
  const hole = new Uint8Array(n)
  let holeCount = 0
  for (let p = 0; p < n; p++) {
    if (filled[p] && !fg[p]) {
      hole[p] = 1
      holeCount++
    }
  }
  if (!holeCount) return layerUrl
  inpaintPushPull(decoded, hole)
  for (let p = 0; p < n; p++) {
    if (hole[p]) decoded.data[p * 4 + 3] = 255
  }
  return uiRgbaCodec.encodeRgbaPng(decoded)
}

/**
 * 将单层 AI 修补后生图模型返回的不透明底图（纯黑/纯白/纯灰/棋盘格或原透明区底色）自动抠除还原为透明通道，
 * 同时对边缘 1~2px 做软边羽化与去色污染（color decontamination）。
 */
export function removeGeneratedLayerBackground(
  generated: { width: number; height: number; data: Uint8ClampedArray },
  original?: { width: number; height: number; data: Uint8ClampedArray }
): void {
  stripOpaqueRepairBackgroundInPlace(generated, original, { forceCutout: !original })
}
