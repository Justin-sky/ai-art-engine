import { writePsdUint8Array, type Layer, type Psd } from 'ag-psd'
import {
  isCanvasSafeImageSrc,
  isLayerSplitBase,
  isLayerSplitLayerDrawable,
  sortLayersForCompose,
  type ImageLayerSplitLayer,
  type ImageLayerSplitState
} from '@shared/graph'

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

function layerDisplayName(layer: ImageLayerSplitLayer, isBase: boolean): string {
  const name = layer.name?.trim()
  if (name) return name
  return isBase ? 'Base' : `Layer ${layer.zIndex}`
}

/** 把图层拆分结果序列化为 PSD（底图 + 透明图层，保留层级/位置/尺寸/透明度/名称）。 */
export async function layerSplitToPsdUint8Array(input: {
  state: ImageLayerSplitState
  layerUrls: Record<string, string>
}): Promise<Uint8Array> {
  const layers = sortLayersForCompose(input.state.layers).filter((layer) => {
    return Boolean(
      input.layerUrls[layer.imageId]?.trim() || input.layerUrls[layer.id]?.trim()
    )
  })
  if (!layers.length) throw new Error('没有可导出的图层')

  const base = layers.find((layer) => isLayerSplitBase(layer)) ?? layers[0]!
  const baseUrl = input.layerUrls[base.imageId]?.trim() || input.layerUrls[base.id]?.trim()
  if (!baseUrl) throw new Error('缺少底图，无法导出 PSD')
  const baseImg = await loadImage(baseUrl)

  const canvasWidth = Math.max(
    1,
    Math.round(input.state.canvasWidth) || baseImg.naturalWidth || 1
  )
  const canvasHeight = Math.max(
    1,
    Math.round(input.state.canvasHeight) || baseImg.naturalHeight || 1
  )

  // ag-psd 的 children 按「顶 → 底」排列；sortLayersForCompose 是「底 → 顶」，反转后写入。
  const children: Layer[] = []
  for (const layer of [...layers].reverse()) {
    const url =
      layer.id === base.id
        ? baseUrl
        : input.layerUrls[layer.imageId]?.trim() || input.layerUrls[layer.id]?.trim()
    if (!url) continue
    const img = layer.id === base.id ? baseImg : await loadImage(url)

    const isBase = isLayerSplitBase(layer)
    const width = isBase ? canvasWidth : Math.max(1, layer.width)
    const height = isBase ? canvasHeight : Math.max(1, layer.height)
    const left = isBase ? 0 : layer.left
    const top = isBase ? 0 : layer.top

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('LAYER_SPLIT_CANVAS_UNAVAILABLE')
    ctx.drawImage(img, 0, 0, width, height)
    const imageData = ctx.getImageData(0, 0, width, height)

    children.push({
      name: layerDisplayName(layer, isBase),
      left,
      top,
      blendMode: 'normal',
      opacity: 1,
      hidden: !isLayerSplitLayerDrawable(input.state, layer),
      imageData: { data: imageData.data, width, height }
    })
  }

  const psd: Psd = {
    width: canvasWidth,
    height: canvasHeight,
    children
  }

  return writePsdUint8Array(psd, { noBackground: true })
}
