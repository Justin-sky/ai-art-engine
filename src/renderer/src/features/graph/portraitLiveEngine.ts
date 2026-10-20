import { defErrSimple, fail } from '@shared/errors/appError'
import {
  applyOpticalLensLabRgba,
  applyPortraitLivePixelPipeline,
  auditGoldenComposition,
  buildCameraExifProfileMetadata,
  composeIdPhotoPrintSheetRgba,
  computeWatermarkPsnrDb,
  embedCameraMetadataInPngBytes,
  embedInvisiblePixelWatermarkRgba,
  estimatePseudoDepthMap,
  extractImageStyleDna,
  hasPortraitLiveAdjustments,
  normalizePortraitRetouch,
  portraitExportMimeType,
  purifyAiArtifactsAndInjectSensorGrainRgba,
  renderEyeTrackingHeatmapRgba,
  renderIdPhotoSingleRgba,
  renderLightingVariantGridRgba,
  renderParallaxFrameRgba,
  renderPortraitVariantGridRgba,
  serializeCubeLutToText,
  synthesizeCubeLutFromStyleDna,
  type CameraProfilePresetId,
  type GoldenCompositionAuditReport,
  type ImageStyleDnaReport,
  type OpticalLensPresetId,
  type ParallaxMotionPresetId,
  type PixelWatermarkPayload,
  type PortraitCubeLut,
  type PortraitExportFormat,
  type PortraitLiveInput,
  type PortraitRetouchState
} from '@shared/graph'
import { extractPortraitPersonMaskAlpha } from './model/portraitCapabilities'

const LIVE_PREVIEW_MAX_EDGE = 960
const LIVE_EXPORT_MAX_EDGE = 2048

function canvasToPortraitDataUrl(
  canvas: HTMLCanvasElement,
  format?: PortraitExportFormat | string | null
): string {
  const mime = portraitExportMimeType(format)
  return mime === 'image/png' ? canvas.toDataURL(mime) : canvas.toDataURL(mime, 0.92)
}

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
  const exportFormat = options?.highRes ? input.state?.exportFormat : 'png'
  const needsFormatConvert =
    Boolean(options?.highRes) &&
    Boolean(exportFormat && exportFormat !== 'png') &&
    !trimmed.startsWith(`data:${portraitExportMimeType(exportFormat)}`)
  if (!hasPortraitLiveAdjustments(input) && !needsFormatConvert) {
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
    dataUrl: canvasToPortraitDataUrl(canvas, exportFormat),
    width,
    height,
    appliedSteps,
    hasAdjustments: appliedSteps.length > 0
  }
}

/**
 * Renders a millimeter-exact local ID photo (or 8-up print sheet when `idPhotoSheet` is true)
 * directly on the client canvas with 0-Token cost.
 */
export async function renderPortraitIdPhotoLocal(
  sourceUrl: string,
  input: PortraitLiveInput
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const trimmed = sourceUrl.trim()
  if (!trimmed) return null
  const state = normalizePortraitRetouch(input.state)
  if (state.idPhotoSpecId === 'none') return null
  const { width, height, pixels } = await getSourceRaster(trimmed, LIVE_EXPORT_MAX_EDGE)
  const personMaskAlpha = await extractPortraitPersonMaskAlpha(trimmed, width, height)
  const single = renderIdPhotoSingleRgba(pixels, width, height, input, {
    dpi: state.exportDpi || 300,
    replaceBackdrop: true,
    personMaskAlpha
  })
  if (!single) return null

  const finalBuf = state.idPhotoSheet
    ? composeIdPhotoPrintSheetRgba(single.pixels, single.width, single.height)
    : single

  const canvas = document.createElement('canvas')
  canvas.width = finalBuf.width
  canvas.height = finalBuf.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const outData = new ImageData(
    new Uint8ClampedArray(finalBuf.pixels),
    finalBuf.width,
    finalBuf.height
  )
  ctx.putImageData(outData, 0, 0)
  return {
    dataUrl: canvasToPortraitDataUrl(canvas, state.exportFormat),
    width: finalBuf.width,
    height: finalBuf.height
  }
}

/**
 * 逆向分析任意参考图 URL / DataURL 的色彩与光影基因，并合成标准 `.cube` 3D LUT
 */
export async function extractReferenceStyleDnaFromUrl(
  imageUrl: string,
  title = 'Reference_Style_DNA'
): Promise<{
  dna: ImageStyleDnaReport
  cubeLut: PortraitCubeLut
  cubeText: string
} | null> {
  const trimmed = imageUrl.trim()
  if (!trimmed) return null
  const { width, height, pixels } = await getSourceRaster(trimmed, 512)
  const dna = extractImageStyleDna(pixels, width, height, title)
  const cubeLut = synthesizeCubeLutFromStyleDna(dna, 9)
  const cubeText = serializeCubeLutToText(cubeLut)
  return { dna, cubeLut, cubeText }
}

/**
 * 本地 0 Token 渲染人像「平行宇宙」2×2 商业风格比稿样张（Client Contact Sheet）
 */
export async function renderPortraitParallelContactSheetLocal(
  sourceUrl: string,
  options?: {
    baseState?: Partial<PortraitRetouchState>
    landmarks?: ReadonlyArray<readonly [number, number]> | null
  }
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const trimmed = sourceUrl.trim()
  if (!trimmed) return null
  const { width, height, pixels } = await getSourceRaster(trimmed, 960)
  const sheet = renderPortraitVariantGridRgba(pixels, width, height, {
    baseState: options?.baseState,
    landmarks: options?.landmarks,
    maxCellEdge: 480
  })
  const canvas = document.createElement('canvas')
  canvas.width = sheet.width
  canvas.height = sheet.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(sheet.pixels), sheet.width, sheet.height),
    0,
    0
  )
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: sheet.width,
    height: sheet.height
  }
}

/**
 * 本地 0 Token 渲染 2.5D 打光「平行宇宙」2×2 商业布光比稿样张（Client Contact Sheet）
 */
export async function renderLightingParallelContactSheetLocal(
  sourceUrl: string
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const trimmed = sourceUrl.trim()
  if (!trimmed) return null
  const { width, height, pixels } = await getSourceRaster(trimmed, 960)
  const sheet = renderLightingVariantGridRgba(pixels, width, height, { maxCellEdge: 480 })
  const canvas = document.createElement('canvas')
  canvas.width = sheet.width
  canvas.height = sheet.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(sheet.pixels), sheet.width, sheet.height),
    0,
    0
  )
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: sheet.width,
    height: sheet.height
  }
}

/**
 * 本地渲染 2.5D 视差微动运镜帧（希区柯克变焦 / 3D 环绕 / 呼吸悬浮 / 荷兰角推进）
 */
export async function renderParallaxMotionFrameLocal(
  sourceUrl: string,
  preset: ParallaxMotionPresetId = 'dolly-zoom',
  progress = 0.75,
  intensity = 1.0
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const trimmed = sourceUrl.trim()
  if (!trimmed) return null
  const { width, height, pixels } = await getSourceRaster(trimmed, 1280)
  const depthMap = estimatePseudoDepthMap(pixels, width, height)
  const framePixels = renderParallaxFrameRgba(pixels, width, height, depthMap, {
    preset,
    progress,
    intensity
  })
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.putImageData(new ImageData(new Uint8ClampedArray(framePixels), width, height), 0, 0)
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height
  }
}

/**
 * 为任意图像嵌入人眼不可见的像素级盲水印（PSNR > 50dB），用于版权溯源与配方基因锁
 */
export async function embedPixelWatermarkInImageUrl(
  sourceUrl: string,
  payload: PixelWatermarkPayload
): Promise<{ dataUrl: string; psnrDb: number } | null> {
  const trimmed = sourceUrl.trim()
  if (!trimmed) return null
  const { width, height, pixels } = await getSourceRaster(trimmed, LIVE_EXPORT_MAX_EDGE)
  const watermarked = embedInvisiblePixelWatermarkRgba(pixels, payload)
  const psnrDb = computeWatermarkPsnrDb(pixels, watermarked)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.putImageData(new ImageData(new Uint8ClampedArray(watermarked), width, height), 0, 0)
  return {
    dataUrl: canvas.toDataURL('image/png'),
    psnrDb
  }
}

/**
 * 本地实时渲染物理光学镜头仿真（ARRI 变形宽银幕拉丝 / 柯达胶片红晕光 / 徕卡大光圈 / 大画幅移轴）
 */
export async function renderOpticalLensSimulationLocal(
  sourceUrl: string,
  preset: OpticalLensPresetId = 'arri-anamorphic'
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const trimmed = sourceUrl.trim()
  if (!trimmed) return null
  const { width, height, pixels } = await getSourceRaster(trimmed, 1280)
  const simulated = applyOpticalLensLabRgba(pixels, width, height, { preset })
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.putImageData(new ImageData(new Uint8ClampedArray(simulated), width, height), 0, 0)
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height
  }
}

/**
 * 本地计算「人眼 3 秒注视显著性热力图」与黄金构图美学诊断报告（含最佳排字留白安全区）
 */
export async function renderEyeTrackingSaliencyAuditLocal(sourceUrl: string): Promise<{
  heatmapDataUrl: string
  audit: GoldenCompositionAuditReport
} | null> {
  const trimmed = sourceUrl.trim()
  if (!trimmed) return null
  const { width, height, pixels } = await getSourceRaster(trimmed, 640)
  const heatmapRgba = renderEyeTrackingHeatmapRgba(pixels, width, height)
  const audit = auditGoldenComposition(pixels, width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.putImageData(new ImageData(new Uint8ClampedArray(heatmapRgba), width, height), 0, 0)
  return {
    heatmapDataUrl: canvas.toDataURL('image/png'),
    audit
  }
}

/**
 * 本地执行 AI 频谱微棋盘伪影净化 + 拜耳传感器物理颗粒注入 + 真机相机 EXIF 元数据嵌入
 */
export async function purifyAiArtifactsAndEmbedCameraExifLocal(
  sourceUrl: string,
  cameraPresetId: CameraProfilePresetId = 'hasselblad-x2d'
): Promise<{
  dataUrl: string
  artifactReductionScore: number
  cameraModelLabel: string
} | null> {
  const trimmed = sourceUrl.trim()
  if (!trimmed) return null
  const { width, height, pixels } = await getSourceRaster(trimmed, LIVE_EXPORT_MAX_EDGE)
  const purified = purifyAiArtifactsAndInjectSensorGrainRgba(pixels, width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.putImageData(new ImageData(new Uint8ClampedArray(purified.pixels), width, height), 0, 0)
  const rawPngDataUrl = canvas.toDataURL('image/png')
  const prefix = 'data:image/png;base64,'
  const exifMeta = buildCameraExifProfileMetadata(cameraPresetId)
  if (!rawPngDataUrl.startsWith(prefix)) {
    return {
      dataUrl: rawPngDataUrl,
      artifactReductionScore: purified.artifactReductionScore,
      cameraModelLabel: `${exifMeta.make} ${exifMeta.model}`
    }
  }
  const b64 = rawPngDataUrl.slice(prefix.length)
  const bin = atob(b64)
  const pngBytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) pngBytes[i] = bin.charCodeAt(i)
  const withExif = embedCameraMetadataInPngBytes(pngBytes, exifMeta)
  let outBin = ''
  const chunk = 0x8000
  for (let i = 0; i < withExif.length; i += chunk) {
    outBin += String.fromCharCode(...withExif.subarray(i, i + chunk))
  }
  return {
    dataUrl: `${prefix}${btoa(outBin)}`,
    artifactReductionScore: purified.artifactReductionScore,
    cameraModelLabel: `${exifMeta.make} ${exifMeta.model} (${exifMeta.lensModel})`
  }
}
