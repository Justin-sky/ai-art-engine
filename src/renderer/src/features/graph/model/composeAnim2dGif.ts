/**
 * 2D 帧动画 → GIF：把切好的逐帧 PNG（可能已键控透明）合成动图 dataUrl。
 *
 * 帧过大时统一等比缩放到不超过 TARGET_FRAME_MAX，控制体积与编码耗时；
 * 透明背景原样保留（GIF 只支持二值透明，alpha 阈值见 quantizeGifFrames）。
 */
import { encodeGif, gifDelayCsFromFps, quantizeGifFrames } from '@shared/media/gifEncode'

const TARGET_FRAME_MAX = 512

function loadFrame(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`load gif frame failed: ${src.slice(0, 64)}`))
    img.src = src
  })
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x2000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export interface Anim2dGifResult {
  /** data:image/gif;base64,…（可直接交给 saveGraphRunMedia） */
  dataUrl: string
  width: number
  height: number
  frameCount: number
  byteLength: number
}

export async function composeAnim2dGif(input: {
  frameUrls: string[]
  fps: number
  loop?: boolean
}): Promise<Anim2dGifResult | null> {
  const urls = (input.frameUrls ?? [])
    .map((url) => url?.trim())
    .filter((url): url is string => !!url)
  if (!urls.length) return null

  const images = await Promise.all(urls.map(loadFrame))
  const sourceWidth = images[0].naturalWidth || 1
  const sourceHeight = images[0].naturalHeight || 1
  const scale = Math.min(1, TARGET_FRAME_MAX / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  const pixels: Uint8ClampedArray[] = []
  for (const image of images) {
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(
      image,
      0,
      0,
      image.naturalWidth,
      image.naturalHeight,
      0,
      0,
      width,
      height
    )
    pixels.push(ctx.getImageData(0, 0, width, height).data)
  }

  const quantized = quantizeGifFrames(pixels)
  const frameTransparent = quantized.transparentIndex !== null
  const bytes = encodeGif({
    width,
    height,
    palette: quantized.palette,
    frames: quantized.frames.map((indices) => ({ indices, transparent: frameTransparent })),
    delayCs: gifDelayCsFromFps(input.fps),
    loopCount: input.loop === false ? 1 : 0,
    ...(frameTransparent ? { transparentIndex: quantized.transparentIndex as number } : {})
  })

  return {
    dataUrl: `data:image/gif;base64,${bytesToBase64(bytes)}`,
    width,
    height,
    frameCount: quantized.frames.length,
    byteLength: bytes.length
  }
}
