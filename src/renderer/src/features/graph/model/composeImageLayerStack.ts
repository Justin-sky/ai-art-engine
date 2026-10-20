import {
  computeNineSliceFromRgbaBuffer,
  decomposeControlIntoStandardParts,
  decomposeRgbaBufferToUiLayers,
  isCanvasSafeImageSrc,
  isLayerSplitBase,
  isLayerSplitLayerDrawable,
  sliceUiLayerFromRgbaRect,
  sortLayersForCompose,
  type ImageLayerSplitLayer,
  type ImageLayerSplitRect,
  type ImageLayerSplitState,
  type UiControlPartRole,
  type UiControlType,
  type UiEditableTextMeta
} from '@shared/graph'
import { SHARED_ERRORS } from '@shared/errors/catalog'
import { fail } from '@shared/errors/appError'
import { layerSplitToPsdUint8Array } from './layerSplitPsd'

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

  const decomposed = decomposeRgbaBufferToUiLayers({
    sourceRgba,
    width,
    height,
    cleanBaseRgba,
    maxLayers: input.maxLayers,
    apiLayerHints: input.apiLayerHints
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

  const nineSliceBorders =
    input.layer.nineSliceBorders ?? computeNineSliceFromRgbaBuffer(rgba, width, height)
  const controlId = input.layer.uiControlId?.trim() || `ctrl:${input.layer.id}`
  const controlName = input.layer.uiControlName?.trim() || input.layer.name

  const parts = decomposeControlIntoStandardParts({
    nameHint: controlName,
    descriptionHint: input.layer.description,
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

  const { layer: sliced, subParts } = sliceUiLayerFromRgbaRect({
    sourceRgba,
    width,
    height,
    rect: input.rect,
    baseRgba: cleanBaseRgba,
    zIndex: input.layerIndex
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
