import { describe, expect, it } from 'vitest'
import {
  ID_PHOTO_BG_COLORS,
  ID_PHOTO_PAPERS,
  ID_PHOTO_SPECS,
  computeIdPhotoCrop,
  computeIdPhotoSheet,
  idPhotoBackgroundColors,
  idPhotoPixelSize,
  idPhotoSpecById
} from '../src/shared/graph/idPhoto'
import {
  canonicalFaceTemplate,
  portraitFaceMetrics,
  type PortraitFaceAnalysis
} from '../src/shared/graph/portraitFace'

/**
 * 证件照规格与拼版（src/shared/graph/idPhoto.ts）。
 *
 * 证件照是「差 1mm 就交不了差」的功能，所以规格表的自洽性、裁切后的头身比、
 * 拼版张数都要锁死；这些数值不能靠肉眼在界面上试。
 */

function analysisAt(scale = 1): PortraitFaceAnalysis {
  // 把模板脸放到 1000×1500 画布中央：脸宽约 0.6 * 1000 * scale
  const landmarks = canonicalFaceTemplate().map(
    ([x, y]) => [0.5 + (x - 0.5) * scale, 0.35 + (y - 0.35) * scale] as [number, number]
  )
  return {
    schema: 'canonical68',
    landmarks,
    box: { x: 0.2, y: 0.2, w: 0.6, h: 0.5 },
    score: 0.99,
    modelId: 'test'
  }
}

describe('idPhoto 规格表', () => {
  it('规格自洽：id 唯一、尺寸为正、头身比与上边距在合理区间', () => {
    expect(ID_PHOTO_SPECS.length).toBeGreaterThanOrEqual(8)
    expect(new Set(ID_PHOTO_SPECS.map((s) => s.id)).size).toBe(ID_PHOTO_SPECS.length)
    for (const spec of ID_PHOTO_SPECS) {
      expect(spec.labelKey.length).toBeGreaterThan(0)
      expect(spec.widthMm).toBeGreaterThan(10)
      expect(spec.widthMm).toBeLessThan(200)
      expect(spec.heightMm).toBeGreaterThan(spec.widthMm)
      expect(spec.headRatio).toBeGreaterThan(0.5)
      expect(spec.headRatio).toBeLessThan(0.8)
      expect(spec.topMargin).toBeGreaterThan(0)
      expect(spec.topMargin).toBeLessThan(0.2)
    }
  })

  it('none / 未知 id 都返回 null（调用方据此跳过裁切）', () => {
    expect(idPhotoSpecById('none')).toBeNull()
    expect(idPhotoSpecById('')).toBeNull()
    expect(idPhotoSpecById('nope')).toBeNull()
    expect(idPhotoSpecById('oneInch')?.widthMm).toBe(25)
  })

  it('像素尺寸按 DPI 换算（一寸 @300dpi = 295×413）', () => {
    const spec = idPhotoSpecById('oneInch')!
    expect(idPhotoPixelSize(spec, 300)).toEqual({ width: 295, height: 413 })
    const big = idPhotoPixelSize(spec, 600)
    expect(big.width).toBe(591)
    expect(big.height).toBe(827)
    // DPI 下限保护
    expect(idPhotoPixelSize(spec, 1).width).toBeGreaterThan(0)
  })

  it('底色：白/蓝/红是纯色，渐变是两种颜色', () => {
    expect(idPhotoBackgroundColors('white')).toEqual({ from: '#ffffff', to: '#ffffff' })
    expect(ID_PHOTO_BG_COLORS.blue).toBe('#438edb')
    expect(ID_PHOTO_BG_COLORS.red).toBe('#d9001b')
    const gradient = idPhotoBackgroundColors('gradient')
    expect(gradient.from).not.toBe(gradient.to)
  })
})

describe('idPhoto 裁切', () => {
  it('裁切保持规格长宽比', () => {
    const spec = idPhotoSpecById('twoInch')!
    const crop = computeIdPhotoCrop({
      analysis: analysisAt(1),
      spec,
      imageWidth: 1000,
      imageHeight: 1500
    })
    expect(crop.width / crop.height).toBeCloseTo(spec.widthMm / spec.heightMm, 3)
  })

  it('头部高度占裁切高度的比例接近规格要求', () => {
    const spec = idPhotoSpecById('oneInch')!
    const analysis = analysisAt(1)
    const crop = computeIdPhotoCrop({
      analysis,
      spec,
      imageWidth: 1000,
      imageHeight: 1500
    })
    const m = portraitFaceMetrics(analysis.landmarks)
    const chinY = m.chin[1] * 1500
    const foreheadY = m.forehead[1] * 1500
    const headH = chinY - (foreheadY - (chinY - foreheadY) * 0.55)
    const ratio = headH / crop.height
    expect(ratio).toBeGreaterThan(spec.headRatio - 0.06)
    expect(ratio).toBeLessThan(spec.headRatio + 0.06)
  })

  it('裁切框被钳制在图像内（脸贴边也不越界）', () => {
    const spec = idPhotoSpecById('oneInch')!
    const edge: PortraitFaceAnalysis = {
      ...analysisAt(2),
      landmarks: canonicalFaceTemplate().map(
        ([x, y]) => [0.02 + x * 0.9, 0.02 + y * 0.9] as [number, number]
      )
    }
    const crop = computeIdPhotoCrop({ analysis: edge, spec, imageWidth: 400, imageHeight: 400 })
    expect(crop.x).toBeGreaterThanOrEqual(0)
    expect(crop.y).toBeGreaterThanOrEqual(0)
    expect(crop.x + crop.width).toBeLessThanOrEqual(400.001)
    expect(crop.y + crop.height).toBeLessThanOrEqual(400.001)
  })
})

describe('idPhoto 拼版', () => {
  it('5 寸相纸拼一寸照为 3×3（共 9 张）', () => {
    const spec = idPhotoSpecById('oneInch')!
    const sheet = computeIdPhotoSheet({ spec, dpi: 300, paper: 'fiveInch' })
    expect(sheet.cols).toBe(3)
    expect(sheet.rows).toBe(3)
    expect(sheet.count).toBe(9)
    expect(sheet.cellWidth).toBe(295)
    expect(sheet.cellHeight).toBe(413)
    expect(sheet.width).toBe(Math.round((ID_PHOTO_PAPERS.fiveInch.widthMm / 25.4) * 300))
    expect(sheet.height).toBe(Math.round((ID_PHOTO_PAPERS.fiveInch.heightMm / 25.4) * 300))
  })

  it('二寸照在 5 寸纸上拼 2×2，A4 张数更多', () => {
    const spec = idPhotoSpecById('twoInch')!
    const five = computeIdPhotoSheet({ spec, dpi: 300, paper: 'fiveInch' })
    expect(five.count).toBe(five.cols * five.rows)
    const a4 = computeIdPhotoSheet({ spec, dpi: 300, paper: 'a4' })
    expect(a4.count).toBeGreaterThan(five.count)
  })

  it('超大单张也不会算出 0 行 0 列', () => {
    const spec = idPhotoSpecById('largeOneInch')!
    const sheet = computeIdPhotoSheet({ spec, dpi: 600, paper: 'fiveInch' })
    expect(sheet.cols).toBeGreaterThanOrEqual(1)
    expect(sheet.rows).toBeGreaterThanOrEqual(1)
  })
})
