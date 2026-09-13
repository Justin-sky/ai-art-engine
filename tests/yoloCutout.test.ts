import { describe, expect, it } from 'vitest'
import {
  applyAlphaToRgba,
  buildCutoutAlpha,
  defringeRgba,
  featherAlpha,
  letterboxGeometryFor,
  resolveCutoutRegion
} from '../src/shared/yoloCutout'

const MASK_HW = 160

/** 构造 mask 网格：左半（网格 x < hw/2）为前景 */
function halfMask(hw = MASK_HW, soft = false): Uint8Array {
  const data = new Uint8Array(hw * hw)
  const fg = soft ? 255 : 1
  for (let y = 0; y < hw; y++) {
    for (let x = 0; x < hw; x++) {
      if (x < hw / 2) data[y * hw + x] = fg
    }
  }
  return data
}

function flatMask(value: number, hw = MASK_HW): Uint8Array {
  return new Uint8Array(hw * hw).fill(value)
}

describe('letterboxGeometryFor', () => {
  it('maps square image to the full canvas without padding', () => {
    const geo = letterboxGeometryFor(640, 640)
    expect(geo.scale).toBe(1)
    expect(geo.padX).toBe(0)
    expect(geo.padY).toBe(0)
  })

  it('pads the short side for a wide image', () => {
    const geo = letterboxGeometryFor(1280, 640)
    expect(geo.scale).toBe(0.5)
    expect(geo.padX).toBe(0)
    expect(geo.padY).toBe(160)
  })

  it('never exceeds the canvas for extreme aspect ratios', () => {
    const geo = letterboxGeometryFor(4000, 100)
    expect(geo.scale).toBeCloseTo(0.16, 5)
    expect(geo.padY).toBeGreaterThan(0)
    expect(geo.padX).toBeGreaterThanOrEqual(0)
  })
})

describe('buildCutoutAlpha', () => {
  it('keeps the foreground half opaque and the background half transparent', () => {
    // 64×64 源图：scale = 640/64 = 10，mask 网格 80 对应原图 x = 32
    const alpha = buildCutoutAlpha({
      masks: [halfMask()],
      maskHw: MASK_HW,
      srcWidth: 64,
      srcHeight: 64,
      threshold: 0.5,
      feather: 0
    })
    expect(alpha.length).toBe(64 * 64)
    // 索引 = y * 64 + x；mask 左半（网格 x < 80）对应原图 x < 32
    expect(alpha[0 * 64 + 0]).toBe(1)
    expect(alpha[0 * 64 + 31]).toBe(1)
    expect(alpha[0 * 64 + 63]).toBe(0)
    expect(alpha[0 * 64 + 32]).toBe(0)
  })

  it('returns an empty mask when no instance is selected', () => {
    const alpha = buildCutoutAlpha({
      masks: [],
      maskHw: MASK_HW,
      srcWidth: 32,
      srcHeight: 32
    })
    expect(alpha.length).toBe(32 * 32)
    expect(alpha.every((v) => v === 0)).toBe(true)
  })

  it('merges multiple instances by max probability', () => {
    const left = halfMask()
    const right = new Uint8Array(MASK_HW * MASK_HW)
    for (let y = 0; y < MASK_HW; y++) {
      for (let x = MASK_HW / 2; x < MASK_HW; x++) right[y * MASK_HW + x] = 1
    }
    const alpha = buildCutoutAlpha({
      masks: [left, right],
      maskHw: MASK_HW,
      srcWidth: 64,
      srcHeight: 64,
      feather: 0
    })
    expect(alpha.every((v) => v === 1)).toBe(true)
  })

  it('applies the confidence threshold on soft masks', () => {
    const low = flatMask(100) // ≈0.39
    expect(
      buildCutoutAlpha({
        masks: [low],
        maskHw: MASK_HW,
        soft: true,
        srcWidth: 16,
        srcHeight: 16,
        threshold: 0.5,
        feather: 0
      }).every((v) => v === 0)
    ).toBe(true)

    expect(
      buildCutoutAlpha({
        masks: [low],
        maskHw: MASK_HW,
        soft: true,
        srcWidth: 16,
        srcHeight: 16,
        threshold: 0.3,
        feather: 0
      }).every((v) => v === 1)
    ).toBe(true)
  })

  it('feathers hard edges into a soft band', () => {
    const alpha = buildCutoutAlpha({
      masks: [halfMask()],
      maskHw: MASK_HW,
      srcWidth: 64,
      srcHeight: 64,
      threshold: 0.5,
      feather: 3
    })
    // 远离边界仍是纯前景 / 纯背景
    expect(alpha[20 * 64 + 20]).toBeCloseTo(1, 3)
    expect(alpha[20 * 64 + 50]).toBeCloseTo(0, 3)
    // 边界（x≈32）出现过渡值
    const edge = alpha[20 * 64 + 32]!
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(1)
  })

  it('crops to the requested region in source coordinates', () => {
    const full = buildCutoutAlpha({
      masks: [halfMask()],
      maskHw: MASK_HW,
      srcWidth: 64,
      srcHeight: 64,
      feather: 0
    })
    const rightHalf = buildCutoutAlpha({
      masks: [halfMask()],
      maskHw: MASK_HW,
      srcWidth: 64,
      srcHeight: 64,
      region: { x: 32, y: 0, width: 32, height: 64 },
      feather: 0
    })
    expect(rightHalf.length).toBe(32 * 64)
    expect(rightHalf.every((v) => v === 0)).toBe(true)
    // 区域采样与原图对应像素一致
    expect(rightHalf[10 * 32 + 5]).toBe(full[10 * 64 + 37])
  })

  it('offsets by letterbox padding instead of reading the wrong grid row', () => {
    // 400×100 → scale 1.6 / padY 240，原图只占画布中间 160 行，对应网格 y ∈ [60, 100]
    const band = new Uint8Array(MASK_HW * MASK_HW)
    for (let y = 70; y < 80; y++) {
      for (let x = 0; x < MASK_HW; x++) band[y * MASK_HW + x] = 1
    }
    const alpha = buildCutoutAlpha({
      masks: [band],
      maskHw: MASK_HW,
      srcWidth: 400,
      srcHeight: 100,
      region: { x: 0, y: 0, width: 10, height: 40 },
      feather: 0
    })
    // 顶部落在 band 之上 → 背景；y=26 落进 band → 前景
    expect(alpha[0 * 10 + 0]).toBe(0)
    expect(alpha[26 * 10 + 0]).toBe(1)
  })
})

describe('featherAlpha', () => {
  it('returns a copy when radius is zero', () => {
    const src = new Float32Array([0, 1, 1, 0])
    const out = featherAlpha(src, 2, 2, 0)
    expect(Array.from(out)).toEqual([0, 1, 1, 0])
    expect(out).not.toBe(src)
  })

  it('spreads values across neighbours', () => {
    // 5×5 中心一像素为前景：模糊后中心下降、邻域抬升，且中心仍最亮
    const src = new Float32Array(25)
    src[12] = 1
    const out = featherAlpha(src, 5, 5, 1)
    expect(out[12]!).toBeLessThan(1)
    expect(out[12]!).toBeGreaterThan(out[0]!)
    expect(out[0]!).toBeGreaterThan(0)
    // 边角比近邻弱：模糊是向外递减的
    expect(out[7]!).toBeGreaterThan(out[0]!)
  })
})

describe('resolveCutoutRegion', () => {
  it('unions selected boxes and stays inside the frame', () => {
    const region = resolveCutoutRegion({
      boxes: [
        { label: 'person', confidence: 0.9, x: 10, y: 20, width: 30, height: 40 },
        { label: 'dog', confidence: 0.8, x: 200, y: 100, width: 50, height: 60 }
      ],
      srcWidth: 300,
      srcHeight: 300,
      feather: 4,
      margin: 2
    })
    expect(region).toEqual({ x: 4, y: 14, width: 252, height: 152 })
  })

  it('falls back to the full frame without boxes', () => {
    expect(resolveCutoutRegion({ boxes: [], srcWidth: 64, srcHeight: 32 })).toEqual({
      x: 0,
      y: 0,
      width: 64,
      height: 32
    })
  })
})

describe('applyAlphaToRgba', () => {
  it('writes alpha into the fourth byte of each pixel', () => {
    const rgba = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255])
    applyAlphaToRgba(rgba, new Float32Array([0, 1]))
    expect(Array.from(rgba)).toEqual([1, 2, 3, 0, 4, 5, 6, 255])
  })
})

describe('defringeRgba', () => {
  it('recovers the foreground color from a background-mixed edge pixel', () => {
    // 一行三个像素：背景(alpha 0, 亮黄) / 过渡(alpha 0.5) / 前景(alpha 1, 深色)
    // 过渡像素的颜色是 0.5*前景 + 0.5*背景 → (145,130,65)
    const rgba = new Uint8ClampedArray([240, 200, 60, 0, 145, 130, 65, 255, 50, 60, 70, 255])
    const alpha = new Float32Array([0, 0.5, 1])
    defringeRgba(rgba, alpha, 3, 1, { strength: 1 })
    // 过渡像素被还原为前景色（误差 ±1），背景与前景本体不变
    expect(rgba[0]).toBe(240)
    expect(rgba[1]).toBe(200)
    expect(rgba[2]).toBe(60)
    expect(rgba[4]).toBeGreaterThanOrEqual(49)
    expect(rgba[4]).toBeLessThanOrEqual(51)
    expect(rgba[5]).toBeGreaterThanOrEqual(59)
    expect(rgba[5]).toBeLessThanOrEqual(61)
    expect(rgba[6]).toBeGreaterThanOrEqual(69)
    expect(rgba[6]).toBeLessThanOrEqual(71)
    expect(rgba[8]).toBe(50)
    expect(rgba[9]).toBe(60)
    expect(rgba[10]).toBe(70)
  })

  it('leaves opaque and transparent pixels untouched', () => {
    const rgba = new Uint8ClampedArray([200, 10, 20, 255, 1, 2, 3, 0])
    const alpha = new Float32Array([1, 0])
    defringeRgba(rgba, alpha, 2, 1)
    expect(Array.from(rgba)).toEqual([200, 10, 20, 255, 1, 2, 3, 0])
  })
})
