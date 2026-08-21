import {
  isCanvasSafeImageSrc,
  isLayerSplitBase,
  isLayerSplitLayerDrawable,
  sortLayersForCompose,
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

export async function composeImageLayerStack(input: {
  state: ImageLayerSplitState
  layerUrls: Record<string, string>
}): Promise<{ dataUrl: string; width: number; height: number }> {
  const layers = sortLayersForCompose(input.state.layers).filter((layer) =>
    isLayerSplitLayerDrawable(input.state, layer)
  )
  if (!layers.length) throw new Error('没有可合成的图层')

  const base = layers.find((layer) => isLayerSplitBase(layer)) ?? layers[0]!
  const baseUrl = input.layerUrls[base.imageId]?.trim() || input.layerUrls[base.id]?.trim()
  if (!baseUrl) throw new Error('缺少底图，无法合成图层')
  const baseImg = await loadImage(baseUrl)

  const canvasWidth = Math.max(
    1,
    Math.round(input.state.canvasWidth) || baseImg.naturalWidth || 1
  )
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
    ctx.drawImage(
      img,
      layer.left,
      layer.top,
      Math.max(1, layer.width),
      Math.max(1, layer.height)
    )
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvasWidth,
    height: canvasHeight
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
