/**
 * 证件照规格、裁切与拼版（纯计算，便于单测）。
 *
 * 口径参考国内证件照通行做法：
 * - 头部（颅顶 → 下巴）占画面高度约 2/3，颅顶距上边约 8%；
 * - 底色白 #ffffff / 蓝 #438edb / 红 #d9001b；
 * - 拼版默认 5 寸相纸（89×127mm），张间留 2mm 便于裁切。
 */

import type { PortraitFaceAnalysis } from '../graph/portraitFace'
import { portraitFaceMetrics } from '../graph/portraitFace'

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
  /** i18n key suffix under graph.portrait.idPhoto.specs.* */
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

/**
 * 由人脸关键点算证件照裁切框：
 * 颅顶取「发际线向上 0.55 倍脸高」的经验估计（关键点里没有颅顶），
 * 再按规格要求的头身比与上边距反推裁切框。
 */
export function computeIdPhotoCrop(input: {
  analysis: PortraitFaceAnalysis
  spec: IdPhotoSpec
  imageWidth: number
  imageHeight: number
}): IdPhotoCrop {
  const { analysis, spec, imageWidth, imageHeight } = input
  const m = portraitFaceMetrics(analysis.landmarks)
  // 关键点坐标是归一化的，先换算到像素
  const chinY = m.chin[1] * imageHeight
  const foreheadY = m.forehead[1] * imageHeight
  const faceH = Math.max(1, chinY - foreheadY)
  const crownY = foreheadY - faceH * 0.55
  const headH = Math.max(1, chinY - crownY)
  const centerX = m.center[0] * imageWidth

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
