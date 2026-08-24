import {
  isLikelyEquirectangularSize,
  type BlockoutLayoutMode
} from './aiSceneBlockout'

const VIEW_SIZE = 512
const VIEW_FOV_DEG = 90
const CENTER_LEFT_RIGHT_AZIMUTH = [0, -90, 90] as const

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1
}

function sampleBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  u: number,
  v: number
): [number, number, number, number] {
  const x = wrap01(u) * (width - 1)
  const y = Math.min(height - 1, Math.max(0, v * (height - 1)))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const idx = (ix: number, iy: number) => (iy * width + ix) * 4
  const mix = (a: number, b: number, t: number) => a + (b - a) * t
  const i00 = idx(x0, y0)
  const i10 = idx(x1, y0)
  const i01 = idx(x0, y1)
  const i11 = idx(x1, y1)
  const out: [number, number, number, number] = [0, 0, 0, 255]
  for (let c = 0; c < 4; c += 1) {
    out[c] = mix(mix(data[i00 + c]!, data[i10 + c]!, tx), mix(data[i01 + c]!, data[i11 + c]!, tx), ty)
  }
  return out
}

/** 从等距柱状全景生成中/左/右 90° 透视切片（方位 0 / -90 / +90）。 */
export function renderEquirectPerspectiveViews(
  source: ImageData,
  outSize = VIEW_SIZE,
  fovDeg = VIEW_FOV_DEG
): ImageData[] {
  const tan = Math.tan(((fovDeg / 2) * Math.PI) / 180)
  const aspect = 1
  return CENTER_LEFT_RIGHT_AZIMUTH.map((centerAzimuth) => {
    const out = new ImageData(outSize, outSize)
    for (let py = 0; py < outSize; py += 1) {
      for (let px = 0; px < outSize; px += 1) {
        const ndcX = ((px + 0.5) / outSize) * 2 - 1
        const ndcY = 1 - ((py + 0.5) / outSize) * 2
        const x = ndcX * tan * aspect
        const y = ndcY * tan
        const z = -1
        const len = Math.hypot(x, y, z) || 1
        const dx = x / len
        const dy = y / len
        const dz = z / len
        const elev = (Math.asin(Math.min(1, Math.max(-1, dy))) * 180) / Math.PI
        const azOff = (Math.atan2(dx, -dz) * 180) / Math.PI
        const u = 0.5 + (centerAzimuth + azOff) / 360
        const v = 0.5 - elev / 180
        const [r, g, b, a] = sampleBilinear(source.data, source.width, source.height, u, v)
        const o = (py * outSize + px) * 4
        out.data[o] = r
        out.data[o + 1] = g
        out.data[o + 2] = b
        out.data[o + 3] = a
      }
    }
    return out
  })
}

function imageDataToPngDataUrl(image: ImageData): string {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

async function loadImageData(src: string): Promise<ImageData | null> {
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  try {
    await img.decode()
  } catch {
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

export async function detectBlockoutLayoutMode(dataUrl: string): Promise<BlockoutLayoutMode> {
  if (!dataUrl.trim() || typeof document === 'undefined') return 'perspective'
  const source = await loadImageData(dataUrl)
  if (!source) return 'perspective'
  return isLikelyEquirectangularSize(source.width, source.height) ? 'panorama' : 'perspective'
}

/**
 * 360 模式且只有一张 2:1 全景时，展开成中/左/右透视切图。
 * 透视模式或已有多张参考图时原样返回。
 */
export async function prepareBlockoutReferenceImages(
  images: string[],
  mode: BlockoutLayoutMode
): Promise<{
  images: string[]
  unwrapped: boolean
  detectedMode: BlockoutLayoutMode
}> {
  const list = images.map((url) => url.trim()).filter(Boolean).slice(0, 3)
  if (!list.length || typeof document === 'undefined') {
    return { images: list, unwrapped: false, detectedMode: mode }
  }
  const first = await loadImageData(list[0]!)
  const detectedMode: BlockoutLayoutMode =
    first && isLikelyEquirectangularSize(first.width, first.height) ? 'panorama' : 'perspective'
  if (mode !== 'panorama' || list.length !== 1 || !first) {
    return { images: list, unwrapped: false, detectedMode }
  }
  if (!isLikelyEquirectangularSize(first.width, first.height)) {
    return { images: list, unwrapped: false, detectedMode }
  }
  const views = renderEquirectPerspectiveViews(first)
  const urls = views.map((view) => imageDataToPngDataUrl(view)).filter(Boolean)
  if (urls.length !== 3) return { images: list, unwrapped: false, detectedMode }
  return { images: urls, unwrapped: true, detectedMode }
}
