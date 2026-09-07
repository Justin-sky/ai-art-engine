import { describe, expect, it } from 'vitest'
import {
  computeSpriteAlignPlan,
  DEFAULT_SPRITE_ALIGN,
  estimateContentTranslation,
  estimateFrameTranslations,
  extractAlphaBounds,
  normalizeSpriteAlignOptions,
  type PixelImage,
  type SpriteAlignOptions
} from '../src/shared/gameAssets'

/** 确定性空间散列：内容区域每像素颜色随绝对坐标变化，保证平移代价只在完全对齐时为零 */
function hashColor(x: number, y: number): number {
  return 20 + (((x * 73856093) ^ (y * 19349663)) % 216)
}

/** 造一张透明底 + 若干实心方块区域的画布（方块填充 hashColor(x,y)） */
function makeFrame(
  width: number,
  height: number,
  rects: Array<[number, number, number, number]>,
  solid?: boolean
): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (const [x, y, w, h] of rects) {
    for (let yy = y; yy < Math.min(height, y + h); yy++) {
      for (let xx = x; xx < Math.min(width, x + w); xx++) {
        const i = (yy * width + xx) * 4
        const v = solid ? 200 : hashColor(xx, yy)
        data[i] = v
        data[i + 1] = solid ? 100 : v >> 1
        data[i + 2] = solid ? 50 : (v >> 2) + 30
        data[i + 3] = 255
      }
    }
  }
  return { width, height, data }
}

/** 把整幅图内容平移 (dx, dy)（正 = 右 / 下），尺寸不变，越界丢弃 */
function shiftPixelImage(src: PixelImage, dx: number, dy: number): PixelImage {
  const { width, height, data } = src
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const ny = y - dy
    if (ny < 0 || ny >= height) continue
    for (let x = 0; x < width; x++) {
      const nx = x - dx
      if (nx < 0 || nx >= width) continue
      const si = (y * width + x) * 4
      const di = (ny * width + nx) * 4
      out[di] = data[si]
      out[di + 1] = data[si + 1]
      out[di + 2] = data[si + 2]
      out[di + 3] = data[si + 3]
    }
  }
  return { width, height, data: out }
}

describe('extractAlphaBounds：透明主体外接框', () => {
  it('全透明返回 null', () => {
    const f = makeFrame(10, 10, [])
    expect(extractAlphaBounds(f.data, f.width, f.height)).toBeNull()
  })

  it('框住非透明像素的最小矩形', () => {
    const f = makeFrame(24, 20, [[7, 5, 10, 8]])
    const b = extractAlphaBounds(f.data, f.width, f.height)!
    expect(b).toEqual({ x: 7, y: 5, width: 10, height: 8 })
  })

  it('alphaMin 过滤低透明孤立点，不让外接框外扩', () => {
    const f = makeFrame(24, 20, [[7, 5, 10, 8]])
    const data = new Uint8ClampedArray(f.data)
    // 在远离主体的坐标放一个低 alpha 孤立点
    const low = (20 * 24 + 22) * 4
    data[low] = 255
    data[low + 1] = 255
    data[low + 2] = 255
    data[low + 3] = 4
    const b = extractAlphaBounds(data, 24, 20, { alphaMin: 8 })
    expect(b).toEqual({ x: 7, y: 5, width: 10, height: 8 })
  })
})

describe('normalizeSpriteAlignOptions', () => {
  it('空输入落到默认值', () => {
    expect(normalizeSpriteAlignOptions(null)).toEqual(DEFAULT_SPRITE_ALIGN)
    expect(normalizeSpriteAlignOptions(undefined)).toEqual(DEFAULT_SPRITE_ALIGN)
  })
  it('越界值夹取 / 非法值回落', () => {
    const o = normalizeSpriteAlignOptions({
      canvasWidth: 1,
      canvasHeight: 99999,
      anchor: 'nonsense' as never,
      contentHeightRatio: 2,
      groundRatio: 3
    } as Partial<SpriteAlignOptions>)
    expect(o.canvasWidth).toBe(16)
    expect(o.canvasHeight).toBe(8192)
    expect(o.anchor).toBe('ground')
    expect(o.contentHeightRatio).toBe(1)
    expect(o.groundRatio).toBe(0.5)
  })
})

describe('computeSpriteAlignPlan：统一画布放置', () => {
  const subject = { srcWidth: 256, srcHeight: 512, bounds: { x: 0, y: 0, width: 256, height: 512 } }

  it('ground：主体等比放高到画布，底边压地面基线，锚点为脚底中点', () => {
    const plan = computeSpriteAlignPlan(subject, {
      canvasWidth: 1024,
      canvasHeight: 1024,
      anchor: 'ground',
      contentHeightRatio: 0.8,
      groundRatio: 0.06,
      fitWithinWidth: true
    })!
    expect(plan).not.toBeNull()
    expect(plan.scale).toBeCloseTo(1.6, 5)
    expect(plan.dstW).toBe(Math.round(256 * 1.6))
    expect(plan.dstH).toBe(Math.round(512 * 1.6))
    expect(plan.dstX).toBe(Math.round((1024 - plan.dstW) / 2))
    expect(plan.anchorX).toBe(512)
    expect(plan.groundY).toBe(1024 - Math.round(1024 * 0.06))
    expect(plan.anchorY).toBe(plan.groundY)
    expect(plan.dstY).toBe(plan.groundY - plan.dstH)
    expect(plan.anchor).toBe('ground')
  })

  it('center：主体中心对齐画布中心', () => {
    const plan = computeSpriteAlignPlan(subject, {
      canvasWidth: 1024,
      canvasHeight: 1024,
      anchor: 'center',
      contentHeightRatio: 0.8
    })!
    expect(plan.dstX).toBe(Math.round((1024 - plan.dstW) / 2))
    expect(plan.dstY).toBe(Math.round((1024 - plan.dstH) / 2))
    expect(plan.anchorX).toBe(512)
    expect(plan.anchorY).toBe(Math.round(plan.dstY + plan.dstH / 2))
    expect(plan.groundY).toBe(-1)
  })

  it('fitWithinWidth：宽幅素材放高会超宽时收缩到画布内', () => {
    const wide = { srcWidth: 1024, srcHeight: 256, bounds: { x: 0, y: 0, width: 1024, height: 256 } }
    const plan = computeSpriteAlignPlan(wide, {
      canvasWidth: 512,
      canvasHeight: 512,
      anchor: 'ground',
      contentHeightRatio: 1,
      groundRatio: 0.06
    })!
    // 1.0 放高 scale=2 → 宽 2048 超 512，改按宽收缩 scale=0.5
    expect(plan.scale).toBeCloseTo(0.5, 5)
    expect(plan.dstW).toBe(512)
    expect(plan.dstH).toBe(Math.round(256 * 0.5))
    expect(plan.dstX).toBe(0)
  })

  it('bounds 越界被收缩回源图内', () => {
    const plan = computeSpriteAlignPlan(
      {
        srcWidth: 100,
        srcHeight: 100,
        bounds: { x: 50, y: -20, width: 200, height: 200 }
      },
      { canvasWidth: 256, canvasHeight: 256 }
    )!
    expect(plan).not.toBeNull()
    expect(plan.bounds).toEqual({ x: 50, y: 0, width: 50, height: 100 })
  })

  it('空框 / 源尺寸非法返回 null', () => {
    expect(
      computeSpriteAlignPlan({
        srcWidth: 100,
        srcHeight: 100,
        bounds: { x: 0, y: 0, width: 0, height: 10 }
      })
    ).toBeNull()
    expect(
      computeSpriteAlignPlan({
        srcWidth: 100.5,
        srcHeight: 100,
        bounds: { x: 0, y: 0, width: 10, height: 10 }
      })
    ).toBeNull()
  })
})

describe('estimateContentTranslation：平移去抖估计', () => {
  const ref = makeFrame(64, 64, [[20, 20, 16, 16]])

  it('同内容零平移 → (0,0)', () => {
    expect(estimateContentTranslation(ref, makeFrame(64, 64, [[20, 20, 16, 16]]))).toEqual({ dx: 0, dy: 0 })
  })

  it('内容右移 +4 → 需左移 dx=-4 对齐', () => {
    // shiftPixelImage(-4, 0) = 内容右移 4px
    expect(estimateContentTranslation(ref, shiftPixelImage(ref, -4, 0))).toEqual({ dx: -4, dy: 0 })
  })

  it('内容下移 +5 → dy=-5', () => {
    const probe = shiftPixelImage(ref, 0, -5) // 内容下移 5px
    expect(estimateContentTranslation(ref, probe)).toEqual({ dx: 0, dy: -5 })
  })

  it('内容大幅偏移（超出搜索范围）不崩溃，回退 (0,0)', () => {
    const far = shiftPixelImage(ref, 45, 40)
    expect(estimateContentTranslation(ref, far)).toEqual({ dx: 0, dy: 0 })
  })

  it('尺寸不一致返回 (0,0)', () => {
    expect(
      estimateContentTranslation(ref, makeFrame(32, 64, [[5, 5, 8, 8]]))
    ).toEqual({ dx: 0, dy: 0 })
  })
})

describe('estimateFrameTranslations：批量去抖', () => {
  it('选内容面积最大的帧作参考，其余帧逐帧估平移', () => {
    const refBig = makeFrame(64, 64, [[16, 16, 32, 32]])
    const shifted = shiftPixelImage(refBig, -4, -2) // 内容右移 4 / 下移 2
    const small = makeFrame(64, 64, [[16, 16, 8, 8]])
    const result = estimateFrameTranslations([refBig, shifted, small])!
    expect(result.referenceIndex).toBe(0)
    expect(result.shifts[0]).toEqual({ index: 0, dx: 0, dy: 0 })
    // refBig 面积 1024 > small 面积 64，参考不被小帧顶掉
    expect(result.shifts[1]).toEqual({ index: 1, dx: -4, dy: -2 })
    // small 内容与 refBig 左上同图案同位置 → 零平移
    expect(result.shifts[2]).toEqual({ index: 2, dx: 0, dy: 0 })
  })

  it('可显式指定参考帧（含放大搜索范围）', () => {
    const a = makeFrame(64, 64, [[10, 10, 24, 24]])
    const b = shiftPixelImage(a, -20, 0) // a 整体右移 20px
    const result = estimateFrameTranslations([a, b], { referenceIndex: 0, maxShiftPx: 24 })!
    expect(result.referenceIndex).toBe(0)
    expect(result.shifts[1]).toEqual({ index: 1, dx: -20, dy: 0 })
  })

  it('空数组 / 单帧边界', () => {
    expect(estimateFrameTranslations([])).toBeNull()
    const one = estimateFrameTranslations([makeFrame(32, 32, [[4, 4, 8, 8]])])!
    expect(one.referenceIndex).toBe(0)
    expect(one.shifts).toEqual([{ index: 0, dx: 0, dy: 0 }])
  })
})
