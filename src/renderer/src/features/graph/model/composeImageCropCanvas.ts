import {
  normalizeImageCrop,
  type ImageCropState
} from '@shared/graph'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('CROP_SOURCE_LOAD_FAILED'))
    img.src = src
  })
}

/** 按归一化裁切框裁出 PNG data URL（本地，不调模型）。 */
export async function composeImageCropCanvas(input: {
  sourceDataUrl: string
  state: ImageCropState
}): Promise<{ dataUrl: string; width: number; height: number }> {
  const state = normalizeImageCrop(input.state)
  const img = await loadImage(input.sourceDataUrl)
  const sw = img.naturalWidth || 1
  const sh = img.naturalHeight || 1
  const sx = Math.round(state.cropX * sw)
  const sy = Math.round(state.cropY * sh)
  const cw = Math.max(1, Math.round(state.cropW * sw))
  const ch = Math.max(1, Math.round(state.cropH * sh))
  const width = Math.min(cw, sw - sx)
  const height = Math.min(ch, sh - sy)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('CROP_CANVAS_UNAVAILABLE')
  ctx.drawImage(img, sx, sy, width, height, 0, 0, width, height)
  return { dataUrl: canvas.toDataURL('image/png'), width, height }
}
