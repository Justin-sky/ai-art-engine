/**
 * 帧序列拼版：把若干帧 dataUrl（同尺寸，来自 composeStage2dCanvas 等）拼成一张
 * rows×columns 的水平 sheet PNG。帧过大时统一等比缩放到不超过 TARGET_FRAME_MAX，
 * 避免 sheet 尺寸超过 canvas 面积上限（单张 file 体积也可控）。
 */

const TARGET_FRAME_MAX = 512
const SHEET_COLUMNS = 8

function loadSheetFrame(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`load frame failed: ${src.slice(0, 64)}`))
    img.src = src
  })
}

export interface Stage2dFrameSheet {
  dataUrl: string
  /** 每格在 sheet 内的宽（px，已按 scale 缩放） */
  frameWidth: number
  /** 每格在 sheet 内的高（px） */
  frameHeight: number
  /** 帧统一缩放因子（原始帧→sheet 格） */
  scale: number
  rows: number
  columns: number
}

export async function composeStage2dFrameSheet(input: {
  frameUrls: string[]
}): Promise<Stage2dFrameSheet | null> {
  const urls = (input.frameUrls ?? []).map((url) => url?.trim()).filter((url): url is string => !!url)
  if (!urls.length) return null
  const images = await Promise.all(urls.map(loadSheetFrame))
  const sourceWidth = images[0].naturalWidth || 1
  const sourceHeight = images[0].naturalHeight || 1
  const scale = Math.min(1, TARGET_FRAME_MAX / sourceWidth)
  const frameWidth = Math.max(1, Math.round(sourceWidth * scale))
  const frameHeight = Math.max(1, Math.round(sourceHeight * scale))
  const columns = Math.min(SHEET_COLUMNS, images.length)
  const rows = Math.ceil(images.length / columns)
  const canvas = document.createElement('canvas')
  canvas.width = columns * frameWidth
  canvas.height = rows * frameHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  images.forEach((image, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    if (scale >= 1) {
      ctx.drawImage(image, col * frameWidth, row * frameHeight)
    } else {
      ctx.drawImage(
        image,
        0,
        0,
        image.naturalWidth,
        image.naturalHeight,
        col * frameWidth,
        row * frameHeight,
        frameWidth,
        frameHeight
      )
    }
  })
  return {
    dataUrl: canvas.toDataURL('image/png'),
    frameWidth,
    frameHeight,
    scale,
    rows,
    columns
  }
}
