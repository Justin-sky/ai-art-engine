/**
 * 证件照规格与**纯几何输出**（裁切 + 5 寸拼版）。
 *
 * 口径参考国内证件照通行做法：
 * - 头部（颅顶 → 下巴）占画面高度约 2/3，颅顶距上边约 8%；
 * - 底色白 #ffffff / 蓝 #438edb / 红 #d9001b；
 * - 拼版默认 5 寸相纸（89×127mm），张间留 2mm 便于裁切。
 *
 * 本文件**不参与修图**：脸部美容、换底色全部交给图片模型（见 `portraitRetouch.ts`
 * 合成提示词、`execute/portrait.ts` 调 `ctx.generateImage`）。模型返回一张构图正确、
 * 底色正确的图之后，这里只负责两件模型做不可靠的事：
 * 1. 按规格精确裁到 25×35mm@300dpi 这类**确定的像素尺寸**；
 * 2. 把单张铺成 5 寸相纸拼版（行列算得出来，模型算不准像素对齐）。
 */

import type { PortraitFaceAnalysis } from './portraitFace'
import { PORTRAIT_LANDMARK_COUNT } from './portraitFace'

export type PortraitIdPhotoSpecId =
  | 'none'
  | 'oneInch'
  | 'smallOneInch'
  | 'largeOneInch'
  | 'twoInch'
  | 'smallTwoInch'
  | 'passport'
  | 'visa'
  | 'driverLicense'
  | 'socialSecurity'
  | 'custom'

export interface IdPhotoSpec {
  id: PortraitIdPhotoSpecId
  /** i18n key suffix under graph.portrait.options.* */
  labelKey: string
  widthMm: number
  heightMm: number
  /** 头部高度占画面高度的比例 */
  headRatio: number
  /** 颅顶距上边的比例 */
  topMargin: number
}

export const ID_PHOTO_SPECS: readonly IdPhotoSpec[] = [
  {
    id: 'oneInch',
    labelKey: 'oneInch',
    widthMm: 25,
    heightMm: 35,
    headRatio: 0.66,
    topMargin: 0.08
  },
  {
    id: 'smallOneInch',
    labelKey: 'smallOneInch',
    widthMm: 22,
    heightMm: 32,
    headRatio: 0.66,
    topMargin: 0.08
  },
  {
    id: 'largeOneInch',
    labelKey: 'largeOneInch',
    widthMm: 33,
    heightMm: 48,
    headRatio: 0.64,
    topMargin: 0.08
  },
  {
    id: 'twoInch',
    labelKey: 'twoInch',
    widthMm: 35,
    heightMm: 49,
    headRatio: 0.62,
    topMargin: 0.08
  },
  {
    id: 'smallTwoInch',
    labelKey: 'smallTwoInch',
    widthMm: 35,
    heightMm: 45,
    headRatio: 0.64,
    topMargin: 0.08
  },
  {
    id: 'passport',
    labelKey: 'passport',
    widthMm: 33,
    heightMm: 48,
    headRatio: 0.64,
    topMargin: 0.09
  },
  { id: 'visa', labelKey: 'visa', widthMm: 35, heightMm: 45, headRatio: 0.68, topMargin: 0.1 },
  {
    id: 'driverLicense',
    labelKey: 'driverLicense',
    widthMm: 22,
    heightMm: 32,
    headRatio: 0.66,
    topMargin: 0.08
  },
  {
    id: 'socialSecurity',
    labelKey: 'socialSecurity',
    widthMm: 26,
    heightMm: 32,
    headRatio: 0.66,
    topMargin: 0.08
  },
  { id: 'custom', labelKey: 'custom', widthMm: 25, heightMm: 35, headRatio: 0.66, topMargin: 0.08 }
] as const

/** 常用相纸（mm） */
export const ID_PHOTO_PAPERS = {
  fiveInch: { id: 'fiveInch', widthMm: 89, heightMm: 127, gapMm: 2 },
  sixInch: { id: 'sixInch', widthMm: 102, heightMm: 152, gapMm: 2 },
  a4: { id: 'a4', widthMm: 210, heightMm: 297, gapMm: 3 }
} as const

export type IdPhotoPaperId = keyof typeof ID_PHOTO_PAPERS

export const ID_PHOTO_BG_COLORS: Readonly<Record<'white' | 'blue' | 'red', string>> = {
  white: '#ffffff',
  blue: '#438edb',
  red: '#d9001b'
}

/** 证件照底色（含渐变）→ 起止色 */
export function idPhotoBackgroundColors(bg: 'white' | 'blue' | 'red' | 'gradient'): {
  from: string
  to: string
} {
  if (bg === 'gradient') return { from: '#5b9bd5', to: '#dbeafe' }
  return { from: ID_PHOTO_BG_COLORS[bg], to: ID_PHOTO_BG_COLORS[bg] }
}

/** 底色 → 交给模型的自然语言描述（提示词里说「白色」比说 `#ffffff` 更稳） */
export function idPhotoBackgroundLabel(bg: 'white' | 'blue' | 'red' | 'gradient'): string {
  switch (bg) {
    case 'blue':
      return '标准证件照蓝色'
    case 'red':
      return '标准证件照红色'
    case 'gradient':
      return '浅蓝到白的柔和渐变'
    default:
      return '纯白色'
  }
}

export function idPhotoSpecById(id: string): IdPhotoSpec | null {
  if (!id || id === 'none') return null
  return ID_PHOTO_SPECS.find((spec) => spec.id === id) ?? null
}

const MM_PER_INCH = 25.4

/** 规格 + DPI → 输出像素尺寸（至少 1px） */
export function idPhotoPixelSize(spec: IdPhotoSpec, dpi = 300): { width: number; height: number } {
  const d = Math.max(72, dpi)
  return {
    width: Math.max(1, Math.round((spec.widthMm / MM_PER_INCH) * d)),
    height: Math.max(1, Math.round((spec.heightMm / MM_PER_INCH) * d))
  }
}

export interface IdPhotoCrop {
  /** 源图像素坐标（可能略超出边界，由调用方钳制后按比例缩放） */
  x: number
  y: number
  width: number
  height: number
}

/** 关键点 → 颅顶/下巴/中心（归一化 0..1）。不依赖本地精修内核，只做几何。 */
function faceAnchorsFromLandmarks(landmarks: ReadonlyArray<readonly [number, number]>): {
  chinY: number
  foreheadY: number
  centerX: number
} | null {
  if (landmarks.length < PORTRAIT_LANDMARK_COUNT) return null
  // canonical-68：17..26 = 眉毛，27..35 = 鼻梁，8 = 下巴，36..47 = 眼睛
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let sumX = 0
  let count = 0
  for (let i = 17; i <= 47; i++) {
    const point = landmarks[i]
    if (!point) continue
    const [, y] = point
    if (!Number.isFinite(y)) continue
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const chin = landmarks[8]
  if (chin && Number.isFinite(chin[1])) maxY = Math.max(maxY, chin[1])
  for (let i = 36; i <= 47; i++) {
    const point = landmarks[i]
    if (!point || !Number.isFinite(point[0])) continue
    sumX += point[0]
    count++
  }
  if (!count || !Number.isFinite(minY) || !Number.isFinite(maxY) || maxY <= minY) return null
  return { foreheadY: minY, chinY: maxY, centerX: sumX / count }
}

/**
 * 由人脸关键点算证件照裁切框：
 * 颅顶取「眉线向上 0.55 倍脸高」的经验估计（关键点里没有颅顶），
 * 再按规格要求的头身比与上边距反推裁切框。
 */
export function computeIdPhotoCrop(input: {
  analysis: PortraitFaceAnalysis
  spec: IdPhotoSpec
  imageWidth: number
  imageHeight: number
}): IdPhotoCrop {
  const { analysis, spec, imageWidth, imageHeight } = input
  const anchors = faceAnchorsFromLandmarks(analysis.landmarks)
  if (!anchors) {
    // 没有可用关键点时给画面居中框，绝不抛错：宁可裁得保守也别让整个节点失败
    const aspect = spec.widthMm / spec.heightMm
    const height = Math.min(imageHeight, imageWidth / aspect)
    const width = height * aspect
    return {
      x: Math.max(0, (imageWidth - width) / 2),
      y: Math.max(0, (imageHeight - height) / 2),
      width,
      height
    }
  }

  const chinY = anchors.chinY * imageHeight
  const foreheadY = anchors.foreheadY * imageHeight
  const faceH = Math.max(1, chinY - foreheadY)
  const crownY = foreheadY - faceH * 0.55
  const headH = Math.max(1, chinY - crownY)
  const centerX = anchors.centerX * imageWidth

  const aspect = spec.widthMm / spec.heightMm
  let height = headH / Math.max(0.2, Math.min(0.95, spec.headRatio))
  let width = height * aspect
  const maxScale = Math.min(imageWidth / width, imageHeight / height, 1)
  if (maxScale < 1) {
    width *= maxScale
    height *= maxScale
  }
  const topMarginPx = height * spec.topMargin
  let x = centerX - width / 2
  let y = crownY - topMarginPx
  x = Math.min(Math.max(0, x), Math.max(0, imageWidth - width))
  y = Math.min(Math.max(0, y), Math.max(0, imageHeight - height))
  return { x, y, width, height }
}

export interface IdPhotoSheet {
  cols: number
  rows: number
  /** 单张像素尺寸 */
  cellWidth: number
  cellHeight: number
  gapPx: number
  /** 相纸像素尺寸 */
  width: number
  height: number
  count: number
}

/** 拼版：单张尺寸 + 相纸 → 行列与画布尺寸（张间留 gap） */
export function computeIdPhotoSheet(input: {
  spec: IdPhotoSpec
  dpi?: number
  paper?: IdPhotoPaperId
}): IdPhotoSheet {
  const dpi = Math.max(72, input.dpi ?? 300)
  const paper = ID_PHOTO_PAPERS[input.paper ?? 'fiveInch']
  const cell = idPhotoPixelSize(input.spec, dpi)
  const paperW = Math.round((paper.widthMm / MM_PER_INCH) * dpi)
  const paperH = Math.round((paper.heightMm / MM_PER_INCH) * dpi)
  const gapPx = Math.round((paper.gapMm / MM_PER_INCH) * dpi)
  const cols = Math.max(1, Math.floor((paperW + gapPx) / (cell.width + gapPx)))
  const rows = Math.max(1, Math.floor((paperH + gapPx) / (cell.height + gapPx)))
  return {
    cols,
    rows,
    cellWidth: cell.width,
    cellHeight: cell.height,
    gapPx,
    width: paperW,
    height: paperH,
    count: cols * rows
  }
}

/**
 * 一次证件照输出所需的全部几何信息。
 *
 * 执行器把所有像素活交给模型后，只需要这一份「怎么裁、要不要拼版」的说明；
 * 渲染层按它合成即可（合成失败不影响主图落盘）。
 */
export interface IdPhotoPlan {
  spec: IdPhotoSpec
  dpi: number
  /** 目标单张像素尺寸 */
  outputWidth: number
  outputHeight: number
  /** 源图裁切框（归一化 0..1，便于跨分辨率复用） */
  crop: { x: number; y: number; w: number; h: number }
  /** 拼版信息（未开启为 null） */
  sheet: (IdPhotoSheet & { paper: IdPhotoPaperId }) | null
}

export function planIdPhoto(input: {
  analysis: PortraitFaceAnalysis | null
  spec: IdPhotoSpec
  imageWidth: number
  imageHeight: number
  dpi?: number
  sheet?: boolean
  paper?: IdPhotoPaperId
}): IdPhotoPlan {
  const dpi = Math.max(72, input.dpi ?? 300)
  const size = idPhotoPixelSize(input.spec, dpi)
  const width = Math.max(1, input.imageWidth)
  const height = Math.max(1, input.imageHeight)
  const crop = input.analysis
    ? computeIdPhotoCrop({
        analysis: input.analysis,
        spec: input.spec,
        imageWidth: width,
        imageHeight: height
      })
    : (() => {
        const aspect = input.spec.widthMm / input.spec.heightMm
        const h = Math.min(height, width / aspect)
        const w = h * aspect
        return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h }
      })()
  return {
    spec: input.spec,
    dpi,
    outputWidth: size.width,
    outputHeight: size.height,
    crop: {
      x: crop.x / width,
      y: crop.y / height,
      w: crop.width / width,
      h: crop.height / height
    },
    sheet: input.sheet
      ? {
          ...computeIdPhotoSheet({ spec: input.spec, dpi, paper: input.paper }),
          paper: input.paper ?? 'fiveInch'
        }
      : null
  }
}
