import { describe, expect, it } from 'vitest'
import {
  composeSafeRect,
  composeSubjectCrop,
  COMPOSE_HEADROOM_FRACTION,
  DEFAULT_COMPOSE_FRAME,
  type ComposeSubjectBox,
  type ComposeTargetFrame
} from '../src/shared/graph/composition'

const VERT: ComposeTargetFrame = { id: '9:16', width: 1080, height: 1920, safeAreaRatio: 0.1 }
const SQUARE: ComposeTargetFrame = { id: '1:1', width: 1024, height: 1024, safeAreaRatio: 0.08 }
const HORIZ: ComposeTargetFrame = { id: '16:9', width: 1920, height: 1080, safeAreaRatio: 0.05 }

const PORTRAIT_IMG = { imageWidth: 1080, imageHeight: 1920 }
const LANDSCAPE_IMG = { imageWidth: 1920, imageHeight: 1080 }

/** 中等分辨率竖屏全身人（原图像素） */
const PERSON_VERT: ComposeSubjectBox = { x: 400, y: 250, width: 280, height: 900 }
/** 横图里的竖长人 */
const PERSON_LAND: ComposeSubjectBox = { x: 820, y: 120, width: 220, height: 860 }
/** 大头贴（主体小） */
const PERSON_TIGHT: ComposeSubjectBox = { x: 400, y: 300, width: 240, height: 320 }

function close(actual: number, expected: number, eps = 1e-6): boolean {
  return Math.abs(actual - expected) < eps
}

describe('composeSubjectCrop', () => {
  it('9:16 源图裁 1:1 · center：以主体为中心，框不越界且主体完整', () => {
    const r = composeSubjectCrop({
      ...PORTRAIT_IMG,
      subject: PERSON_VERT,
      target: SQUARE,
      strategy: 'center'
    })
    expect(r.targetAspect).toBe(1)
    // 源更窄(0.5625<1) → 宽铺满、高收窄：bh = sa/ta
    expect(close(r.crop.cropX, 0)).toBe(true)
    expect(close(r.crop.cropW, 1)).toBe(true)
    expect(close(r.crop.cropH, 0.5625)).toBe(true)
    // 主体中心落在框中心
    const subCy = (PERSON_VERT.y + PERSON_VERT.height / 2) / PORTRAIT_IMG.imageHeight
    expect(close(r.crop.cropY + r.crop.cropH / 2, subCy)).toBe(true)
    expect(r.subjectFullyVisible).toBe(true)
  })

  it('9:16 源图裁 1:1 · headroom：头顶留白≈0.22 框高，脚部可能被裁', () => {
    const r = composeSubjectCrop({
      ...PORTRAIT_IMG,
      subject: PERSON_VERT,
      target: SQUARE,
      strategy: 'headroom'
    })
    const headTopNorm = 250 / 1920
    // 头顶落在 距框顶 ≈ COMPOSE_HEADROOM_FRACTION*框高 的位置
    const expectedGap = r.crop.cropH * COMPOSE_HEADROOM_FRACTION
    expect(close(r.crop.cropY, headTopNorm - expectedGap)).toBe(true)
    expect(r.crop.cropY).toBeGreaterThanOrEqual(0)
    expect(r.crop.cropY + r.crop.cropH).toBeLessThanOrEqual(1)
  })

  it('headroom 垂直放置：主体顶部上方留白比例正确', () => {
    const r = composeSubjectCrop({
      ...PORTRAIT_IMG,
      subject: PERSON_TIGHT, // 贴中上部大头贴
      target: SQUARE,
      strategy: 'headroom'
    })
    const headNorm = 300 / 1920
    const gapFrac = (headNorm - r.crop.cropY) / r.crop.cropH
    expect(close(gapFrac, COMPOSE_HEADROOM_FRACTION)).toBe(true)
    expect(r.subjectFullyVisible).toBe(true)
  })

  it('横源(16:9) 裁竖幅(9:16) · center：全高竖条，横向以主体居中', () => {
    const r = composeSubjectCrop({
      ...LANDSCAPE_IMG,
      subject: PERSON_LAND,
      target: VERT,
      strategy: 'center'
    })
    // sa=16/9 ≈ 1.7778 >= ta=0.5625 → 高铺满，宽按比例
    expect(close(r.crop.cropH, 1)).toBe(true)
    const bw = (1080 * (1080 / 1920)) / 1920 // 0.31640625
    expect(close(r.crop.cropW, bw)).toBe(true)
    const subCx = (820 + 220 / 2) / 1920
    expect(close(r.crop.cropX + r.crop.cropW / 2, subCx)).toBe(true)
    expect(r.subjectFullyVisible).toBe(true)
  })

  it('主体贴左边界：框钳制到 x=0 且主体仍在框内', () => {
    const r = composeSubjectCrop({
      ...LANDSCAPE_IMG,
      subject: { x: 10, y: 120, width: 220, height: 860 },
      target: VERT,
      strategy: 'center'
    })
    expect(close(r.crop.cropX, 0)).toBe(true)
    // 主体中心 cx = (10+110)/1920 ≈ 0.0625，框宽0.316 → 主体在框内
    expect(r.crop.cropX + r.crop.cropW).toBeGreaterThanOrEqual((10 + 220) / 1920)
  })

  it('主体贴底 + headroom：头部不被挤出框，脚允许超出', () => {
    const r = composeSubjectCrop({
      ...PORTRAIT_IMG,
      subject: { x: 400, y: 1500, width: 280, height: 400 },
      target: VERT, // 同比例 → 全图框，任何放置都完整
      strategy: 'headroom'
    })
    expect(r.subjectFullyVisible).toBe(true)
    // 主体顶部仍在框内
    expect(r.crop.cropY).toBeLessThanOrEqual(1500 / 1920)
  })

  it('极端细高的主体裁方形 center：主体中心仍在框内', () => {
    const r = composeSubjectCrop({
      ...PORTRAIT_IMG,
      subject: { x: 440, y: 0, width: 200, height: 1920 }, // 贯穿全高
      target: SQUARE,
      strategy: 'center'
    })
    const cy = r.crop.cropY + r.crop.cropH / 2
    expect(close(cy, 0.5)).toBe(true)
  })
})

describe('默认值 / 安全区', () => {
  it('默认画幅为 9:16', () => {
    expect(DEFAULT_COMPOSE_FRAME).toBe('9:16')
  })

  it('composeSafeRect 返回框内统一 inset', () => {
    const r = composeSafeRect(0.1)
    expect(r).toEqual({ top: 0.1, bottom: 0.1, left: 0.1, right: 0.1 })
    expect(composeSafeRect(0.9)).toEqual({ top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 })
  })
})
