/**
 * 人像处理：渲染层烘焙实现（节点执行器 `bakePortraitRetouch` 钩子的落地）。
 *
 * 为什么像素活必须留在渲染层：
 * - 应用里所有本地像素合成（crop / iconPack / layerSplit / comicPage）都在渲染层，
 *   这里有 canvas 可以做解码与编码，而且不上主进程的事件循环；
 * - 纯内核在 `@shared/media/portrait/*`，与 node 环境单测共用同一份实现，
 *   不存在「预览一套、导出另一套」的漂移。
 *
 * 性能口径：阶段之间用 `setTimeout(0)` 让出事件循环，长烘焙期间界面不冻死；
 * 逐阶段进度经 `onStage` 回到节点运行日志。
 */

import { renderPortrait, type PortraitRenderInput } from '@shared/media/portrait/pipeline'
import type { RgbaImage } from '@shared/media/portrait/kernels'
import { buildCutoutAlpha } from '@shared/yoloCutout'
import type {
  IdPhotoPaperId,
  PortraitBrushStroke,
  PortraitFaceAnalysis,
  PortraitPoseKeypoint,
  PortraitRetouchState
} from '@shared/graph'
import { dataUrlToRawInput, yoloPose, yoloSegment } from '../../yolo/api'

export interface PortraitBakeResult {
  dataUrl: string
  sheetDataUrl: string | null
  width: number
  height: number
  landmarks: Array<[number, number]> | null
}

export interface PortraitBakeInput {
  sourceDataUrl: string
  state: PortraitRetouchState
  strokes?: PortraitBrushStroke[]
  face?: PortraitFaceAnalysis | null
  pose?: Array<[number, number, number?]> | null
  subjectMask?: Uint8ClampedArray | null
  seed?: number
  idPhoto?: { dpi?: number; paper?: IdPhotoPaperId; sheet?: boolean } | null
  signal?: AbortSignal | null
  onStage?: (info: { stage: string; index: number; total: number }) => void
  /** 预览模式：先把源图缩到该最长边再跑流水线（编辑器实时预览用），0 = 原始分辨率 */
  maxEdge?: number
}

/** 源图上限：超过该像素数时烘焙日志会提醒（内存与耗时都要有预期） */
export const PORTRAIT_LARGE_IMAGE_PIXELS = 32_000_000

async function loadImageElement(src: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('portrait: failed to decode source image'))
    el.src = src
  })
}

/** dataUrl → RGBA（可选缩放；`maxEdge=0` 表示原始分辨率） */
export async function dataUrlToRgba(src: string, maxEdge = 0): Promise<RgbaImage> {
  const img = await loadImageElement(src)
  const naturalMax = Math.max(img.naturalWidth, img.naturalHeight)
  const scale = maxEdge > 0 && naturalMax > maxEdge ? maxEdge / naturalMax : 1
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('portrait: canvas 2d context unavailable')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, width, height)
  const { data } = ctx.getImageData(0, 0, width, height)
  return { data, width, height }
}

/** RGBA → dataUrl（按导出格式与质量编码） */
export function rgbaToDataUrl(
  image: RgbaImage,
  format: 'png' | 'jpeg' = 'png',
  quality = 92
): string {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('portrait: canvas 2d context unavailable')
  const imageData = ctx.createImageData(image.width, image.height)
  imageData.data.set(image.data)
  ctx.putImageData(imageData, 0, 0)
  return format === 'jpeg'
    ? canvas.toDataURL('image/jpeg', Math.min(1, Math.max(0.5, quality / 100)))
    : canvas.toDataURL('image/png')
}

/** 阶段之间的让出点：不冻界面，也让运行日志能刷新 */
function yieldToHost(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 该参数下是否需要人像主体蒙版（背景虚化 / 换底 / 证件照换底都要） */
function needsSubjectMask(state: PortraitRetouchState): boolean {
  return state.bgBlur > 0 || state.bgMode !== 'keep' || state.idPhotoSpecId !== 'none'
}

/** 该参数下是否需要人体姿态（身形类工具全靠它） */
function needsPose(state: PortraitRetouchState): boolean {
  return (
    state.bodySlim > 0 ||
    state.waistSlim > 0 ||
    state.hipLift > 0 ||
    state.armSlim > 0 ||
    state.shoulderBeauty > 0 ||
    state.neckLengthen > 0 ||
    state.legLengthen > 0 ||
    state.headBodyRatio > 0
  )
}

/** 可选能力：模型缺失 / 推理失败一律退化为 null，不让整次烘焙挂掉 */
async function tryLoad<T>(load: () => Promise<T | null>): Promise<T | null> {
  try {
    return await load()
  } catch (err) {
    console.warn('[portrait] optional vision capability unavailable', err)
    return null
  }
}

/**
 * 主体（人）蒙版：用现有 YOLO 分割模型跑一次，按 letterbox 几何还原到工作分辨率。
 * 拿不到模型时返回 null —— 背景类工具据此跳过，而不是拿一张错蒙版乱修。
 */
async function loadSubjectMask(
  sourceDataUrl: string,
  width: number,
  height: number
): Promise<Uint8ClampedArray | null> {
  const raw = await dataUrlToRawInput(sourceDataUrl, 1280)
  const result = await yoloSegment({ image: raw, softMask: true })
  if (!result.masks.length) return null
  const maskHw = result.masks[0]!.width
  const alpha = buildCutoutAlpha({
    srcWidth: result.width,
    srcHeight: result.height,
    masks: result.masks.map((mask) => mask.data),
    maskHw,
    ...(result.letterbox ? { letterbox: result.letterbox } : {}),
    soft: true,
    threshold: 0.35,
    outScale: Math.max(0.01, width / Math.max(1, result.width)),
    feather: Math.max(1, Math.round(Math.min(width, height) * 0.004))
  })
  const outW = Math.max(
    1,
    Math.round(result.width * Math.max(0.01, width / Math.max(1, result.width)))
  )
  const mask = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(alpha.length / outW - 1, Math.round((y * outW) / Math.max(1, height)))
    for (let x = 0; x < width; x++) {
      const sx = Math.min(outW - 1, Math.round((x * outW) / Math.max(1, width)))
      const value = alpha[sy * outW + sx] ?? 0
      mask[y * width + x] = Math.round(Math.min(1, Math.max(0, value)) * 255)
    }
  }
  return mask
}

/** 人体姿态关键点（归一化）：身形类工具的控制点来源 */
async function loadPose(sourceDataUrl: string): Promise<PortraitPoseKeypoint[] | null> {
  const raw = await dataUrlToRawInput(sourceDataUrl, 1280)
  const result = await yoloPose({ image: raw })
  const skeleton = result.skeletons[0]
  if (!skeleton?.length) return null
  const width = Math.max(1, result.width)
  const height = Math.max(1, result.height)
  return skeleton.map(
    (point) => [point.x / width, point.y / height, point.confidence] as PortraitPoseKeypoint
  )
}

/** 烘焙（节点执行器的能力缝实现） */
export async function bakePortraitRetouch(input: PortraitBakeInput): Promise<PortraitBakeResult> {
  const maxEdge = input.maxEdge && input.maxEdge > 0 ? input.maxEdge : 0
  const source = await dataUrlToRgba(input.sourceDataUrl, maxEdge)
  // 姿态与主体蒙版都靠已有 YOLO 模型（pose / segment）：拿不到就跳过对应工具组，
  // 绝不用「估出来的蒙版」去改背景或身形 —— 那类错误用户很难发现。
  const [subjectMask, pose] = await Promise.all([
    input.subjectMask ??
      (needsSubjectMask(input.state)
        ? tryLoad(() => loadSubjectMask(input.sourceDataUrl, source.width, source.height))
        : Promise.resolve(null)),
    input.pose ??
      (needsPose(input.state)
        ? tryLoad(() => loadPose(input.sourceDataUrl))
        : Promise.resolve(null))
  ])
  const renderInput: PortraitRenderInput = {
    image: source,
    state: input.state,
    faces: input.face ?? null,
    pose: pose ?? null,
    subjectMask: subjectMask ?? null,
    strokes: input.strokes ?? [],
    seed: input.seed ?? 1,
    idPhoto: input.idPhoto ?? null
  }
  const result = await renderPortrait(renderInput, {
    onStage: input.onStage,
    yield: yieldToHost
  })
  const format = input.state.exportFormat === 'jpeg' ? 'jpeg' : 'png'
  const quality = input.state.exportQuality
  return {
    dataUrl: rgbaToDataUrl(result.image, format, quality),
    sheetDataUrl: result.sheet ? rgbaToDataUrl(result.sheet, format, quality) : null,
    width: result.image.width,
    height: result.image.height,
    landmarks: result.landmarks
  }
}

/**
 * 人脸关键点检测（执行器 `detectPortraitFaces` 钩子的落地）。
 *
 * 目前**未接入人脸模型**：返回空数组等于「没检出人脸」，五官 / 妆容 / 证件照类工具
 * 会被跳过，其余本地工具照常工作 —— 这是刻意选的降级方向（宁可少修，不可错修）。
 * 人脸关键点模型接入点见 `docs/ARCH_YOLO_LOCAL.md` 的 face 任务类型（B3 批次）。
 */
export async function detectPortraitFaces(_input: {
  sourceDataUrl: string
  signal?: AbortSignal | null
}): Promise<PortraitFaceAnalysis[]> {
  return []
}
