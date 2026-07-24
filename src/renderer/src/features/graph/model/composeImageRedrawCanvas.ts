import {
  apiAspectRatioForRedraw,
  expandCanvasPixelSize,
  normalizeImageRedraw,
  redrawAspectRatioValue,
  type ImageEraseState,
  type ImageMatteState,
  type ImageRedrawState
} from '@shared/graph'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('REDRAW_SOURCE_LOAD_FAILED'))
    img.src = src
  })
}

export type MaskComposePunch = 'white' | 'black'

/**
 * 按蒙版挖空合成参考图，并导出对齐尺寸的黑白 mask。
 * - punch=white（默认）：白区透明（重绘/擦除）
 * - punch=black：黑区透明、白区保留（抠图 refinement）
 */
export async function composeImageRedrawCanvas(input: {
  sourceDataUrl: string
  state: ImageRedrawState | ImageEraseState | ImageMatteState
  /** 挖空哪一侧蒙版；默认 white */
  punch?: MaskComposePunch
}): Promise<{
  dataUrl: string
  maskDataUrl?: string
  aspectRatio?: string
  width: number
  height: number
}> {
  const state = normalizeImageRedraw(input.state)
  const punch = input.punch ?? 'white'
  const img = await loadImage(input.sourceDataUrl)
  const sourceAspect = img.naturalWidth / Math.max(1, img.naturalHeight)
  const targetAspect =
    redrawAspectRatioValue(state.aspectId, sourceAspect) ?? sourceAspect
  const { width, height } = expandCanvasPixelSize(targetAspect, state.resolution)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('REDRAW_CANVAS_UNAVAILABLE')

  const canvasAr = width / Math.max(1, height)
  let dw = width
  let dh = height
  let dx = 0
  let dy = 0
  if (Math.abs(canvasAr - sourceAspect) > 0.001) {
    if (canvasAr > sourceAspect) {
      dh = height
      dw = Math.round(height * sourceAspect)
      dx = Math.round((width - dw) / 2)
    } else {
      dw = width
      dh = Math.round(width / sourceAspect)
      dy = Math.round((height - dh) / 2)
    }
  }
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(img, dx, dy, dw, dh)

  let maskDataUrl: string | undefined
  if (state.maskDataUrl.startsWith('data:image')) {
    const maskImg = await loadImage(state.maskDataUrl)
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = width
    maskCanvas.height = height
    const mctx = maskCanvas.getContext('2d')
    if (!mctx) throw new Error('REDRAW_CANVAS_UNAVAILABLE')
    mctx.fillStyle = '#000'
    mctx.fillRect(0, 0, width, height)
    mctx.drawImage(maskImg, dx, dy, dw, dh)
    maskDataUrl = maskCanvas.toDataURL('image/png')

    const src = ctx.getImageData(0, 0, width, height)
    const mask = mctx.getImageData(0, 0, width, height)
    const s = src.data
    const m = mask.data
    for (let i = 0; i < s.length; i += 4) {
      const white = m[i]! > 127
      if (punch === 'white' ? white : !white) {
        s[i + 3] = 0
      }
    }
    ctx.putImageData(src, 0, 0)
  }

  const dataUrl = canvas.toDataURL('image/png')
  const aspectRatio = apiAspectRatioForRedraw(state)
  return { dataUrl, maskDataUrl, aspectRatio, width, height }
}
