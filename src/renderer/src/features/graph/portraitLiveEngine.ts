import { defErrSimple, fail } from '@shared/errors/appError'
import {
  applyPortraitLivePixelPipeline,
  hasPortraitLiveAdjustments,
  type PortraitLiveInput
} from '@shared/graph'

const LIVE_PREVIEW_MAX_EDGE = 960
const LIVE_EXPORT_MAX_EDGE = 2048

const ERR_LIVE_PREVIEW_LOAD = defErrSimple(
  'graph.portrait.livePreviewLoadFailed',
  '实时预览底图加载失败',
  'Failed to load base image for live preview'
)

interface CachedSourceRaster {
  key: string
  width: number
  height: number
  pixels: Uint8ClampedArray
}

let cachedRaster: CachedSourceRaster | null = null

function loadSourceImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(fail(ERR_LIVE_PREVIEW_LOAD))
    img.src = src
  })
}

async function getSourceRaster(
  sourceUrl: string,
  maxEdge: number
): Promise<{ width: number; height: number; pixels: Uint8ClampedArray }> {
  const key = `${sourceUrl}::${maxEdge}`
  if (cachedRaster && cachedRaster.key === key) {
    return {
      width: cachedRaster.width,
      height: cachedRaster.height,
      pixels: cachedRaster.pixels
    }
  }
  const img = await loadSourceImage(sourceUrl)
  const rawW = Math.max(1, img.naturalWidth || img.width || 1)
  const rawH = Math.max(1, img.naturalHeight || img.height || 1)
  const scale = Math.min(1, maxEdge / Math.max(rawW, rawH))
  const width = Math.max(1, Math.round(rawW * scale))
  const height = Math.max(1, Math.round(rawH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw fail(ERR_LIVE_PREVIEW_LOAD)
  ctx.drawImage(img, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)
  cachedRaster = {
    key,
    width,
    height,
    pixels: new Uint8ClampedArray(imageData.data)
  }
  return {
    width,
    height,
    pixels: cachedRaster.pixels
  }
}

export interface PortraitLiveRenderResult {
  dataUrl: string
  width: number
  height: number
  appliedSteps: string[]
  hasAdjustments: boolean
}

/**
 * Renders the deterministic local computational photography pipeline
 * (landmark MLS liquify + frequency separation skin retouch + eyes/teeth polish + 3D LUT + texture).
 */
export async function renderPortraitLiveRetouch(
  sourceUrl: string,
  input: PortraitLiveInput,
  options?: { highRes?: boolean }
): Promise<PortraitLiveRenderResult | null> {
  const trimmed = sourceUrl.trim()
  if (!trimmed) return null
  if (!hasPortraitLiveAdjustments(input)) {
    return {
      dataUrl: trimmed,
      width: 0,
      height: 0,
      appliedSteps: [],
      hasAdjustments: false
    }
  }
  const maxEdge = options?.highRes ? LIVE_EXPORT_MAX_EDGE : LIVE_PREVIEW_MAX_EDGE
  const { width, height, pixels } = await getSourceRaster(trimmed, maxEdge)
  const { pixels: outPixels, appliedSteps } = applyPortraitLivePixelPipeline(
    pixels,
    width,
    height,
    input
  )

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const outData = new ImageData(new Uint8ClampedArray(outPixels), width, height)
  ctx.putImageData(outData, 0, 0)
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
    appliedSteps,
    hasAdjustments: appliedSteps.length > 0
  }
}
