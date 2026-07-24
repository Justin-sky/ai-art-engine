import {
  contentAspectFromExpand,
  expandCanvasPixelSize,
  expandAspectRatioValue,
  normalizeImageExpand,
  type ImageExpandState
} from '@shared/graph'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('EXPAND_SOURCE_LOAD_FAILED'))
    img.src = src
  })
}

/**
 * 将原图按扩展边距贴到画布上（原图像素比例不变），空白区透明。
 */
export async function composeImageExpandCanvas(input: {
  sourceDataUrl: string
  state: ImageExpandState
}): Promise<{ dataUrl: string; aspectRatio?: string; width: number; height: number }> {
  const state = normalizeImageExpand(input.state)
  const img = await loadImage(input.sourceDataUrl)
  const sourceAspect = img.naturalWidth / Math.max(1, img.naturalHeight)
  const contentAspect = contentAspectFromExpand(state, sourceAspect)
  const targetAspect =
    expandAspectRatioValue(state.aspectId, contentAspect) ?? contentAspect
  const { width, height } = expandCanvasPixelSize(targetAspect, state.resolution)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('EXPAND_CANVAS_UNAVAILABLE')
  ctx.clearRect(0, 0, width, height)

  // 内容区按扩展边距排布；若目标比例与内容不一致，居中 letterbox
  const totalW = 1 + state.expandLeft + state.expandRight
  const totalH = 1 + state.expandTop + state.expandBottom
  let contentW = width
  let contentH = height
  let contentX = 0
  let contentY = 0
  const canvasAr = width / Math.max(1, height)
  if (Math.abs(canvasAr - contentAspect) > 0.001) {
    if (canvasAr > contentAspect) {
      contentH = height
      contentW = Math.round(height * contentAspect)
      contentX = Math.round((width - contentW) / 2)
    } else {
      contentW = width
      contentH = Math.round(width / contentAspect)
      contentY = Math.round((height - contentH) / 2)
    }
  }

  const cellW = contentW / totalW
  const cellH = contentH / totalH
  const dx = Math.round(contentX + state.expandLeft * cellW)
  const dy = Math.round(contentY + state.expandTop * cellH)
  const dw = Math.max(1, Math.round(cellW))
  const dh = Math.max(1, Math.round(cellH))
  ctx.drawImage(img, dx, dy, dw, dh)

  const dataUrl = canvas.toDataURL('image/png')
  const aspectRatio =
    state.aspectId === 'original' ? undefined : state.aspectId
  return { dataUrl, aspectRatio, width, height }
}
