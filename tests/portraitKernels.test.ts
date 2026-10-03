import { describe, expect, it } from 'vitest'
import {
  addGrain,
  applyColorAdjust,
  applyLut,
  applyRegionTint,
  applyVignette,
  blendWithMask,
  boxBlurRgba,
  createRng,
  frequencySeparationSkin,
  gaussianLikeBlur,
  guidedFilterFloat,
  healBlemishes,
  isSkinPixel,
  localContrast,
  removeShine,
  unsharpMask,
  type RgbaImage
} from '../src/shared/media/portrait/kernels'
import {
  backgroundMaskFromSubject,
  blurMask,
  buildSkinMask,
  dilateMask,
  erodeMask,
  intersectMask,
  openMask,
  polygonMask,
  rectMask,
  scaleMask,
  strokeBounds,
  strokeMask,
  subtractMask,
  unionMask
} from '../src/shared/media/portrait/mask'

/**
 * 像素内核与蒙版（src/shared/media/portrait/{kernels,mask}.ts）。
 *
 * 这些函数是人像精修的「物理层」，引擎里所有观感问题最终都落到这里。测试只锁
 * **方向性与不变量**（变亮/变暗、保边、蒙版内外、确定性），不锁具体像素值——
 * 具体数值会随算法微调变化，锁死只会让后续调参寸步难行。
 */

function solid(width: number, height: number, rgb: [number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0]
    data[i + 1] = rgb[1]
    data[i + 2] = rgb[2]
    data[i + 3] = 255
  }
  return { data, width, height }
}

function withSpot(
  width: number,
  height: number,
  base: [number, number, number],
  spot: [number, number, number],
  rect: { x: number; y: number; w: number; h: number }
): RgbaImage {
  const image = solid(width, height, base)
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * width + x) * 4
      image.data[i] = spot[0]
      image.data[i + 1] = spot[1]
      image.data[i + 2] = spot[2]
    }
  }
  return image
}

const lum = (image: RgbaImage, x: number, y: number): number => {
  const i = (y * image.width + x) * 4
  return 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2]
}

describe('portrait kernels', () => {
  it('盒式模糊 radius=0 原样返回，radius>0 抹平点状结构', () => {
    const image = withSpot(32, 32, [120, 120, 120], [255, 255, 255], { x: 15, y: 15, w: 2, h: 2 })
    const same = boxBlurRgba(image, 0)
    expect(Array.from(same.data)).toEqual(Array.from(image.data))
    const blurred = boxBlurRgba(image, 4)
    expect(lum(blurred, 15, 15)).toBeLessThan(lum(image, 15, 15))
    // 亮点附近的本底被抬起来（半径内扩散）
    expect(lum(blurred, 12, 12)).toBeGreaterThan(120)
  })

  it('引导滤波保边：阶跃两侧的取值仍贴近各自一侧', () => {
    const w = 32
    const h = 8
    const guide = new Float32Array(w * h)
    const src = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = x < w / 2 ? 20 : 220
        guide[y * w + x] = v
        src[y * w + x] = v
      }
    }
    const out = guidedFilterFloat(guide, src, w, h, 3, 4)
    expect(out[4 * w + 2]).toBeLessThan(70)
    expect(out[4 * w + (w - 3)]).toBeGreaterThan(180)
  })

  it('磨皮降方差但保留大致亮度；strength=0 时原样返回', () => {
    const noisy = solid(24, 24, [180, 150, 140])
    const rng = createRng(7)
    for (let i = 0; i < noisy.data.length; i += 4) {
      const n = (rng() - 0.5) * 60
      noisy.data[i] += n
      noisy.data[i + 1] += n
      noisy.data[i + 2] += n
    }
    const zero = frequencySeparationSkin(noisy, { radius: 3, strength: 0, poreRetain: 50 })
    expect(Array.from(zero.data)).toEqual(Array.from(noisy.data))
    const smoothed = frequencySeparationSkin(noisy, { radius: 3, strength: 0.9, poreRetain: 50 })
    const variance = (img: RgbaImage): number => {
      let sum = 0
      let sum2 = 0
      let n = 0
      for (let i = 0; i < img.data.length; i += 4) {
        const v = img.data[i]
        sum += v
        sum2 += v * v
        n++
      }
      return sum2 / n - (sum / n) ** 2
    }
    expect(variance(smoothed)).toBeLessThan(variance(noisy))
    expect(Math.abs(lum(smoothed, 12, 12) - lum(noisy, 12, 12))).toBeLessThan(40)
  })

  it('曝光/饱和度/色温方向正确', () => {
    const image = solid(8, 8, [128, 128, 128])
    const base = {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      colorTemp: 0,
      tint: 0,
      vibrance: 0,
      saturation: 0,
      hslHue: 0,
      hslSat: 0,
      hslLum: 0
    }
    const brighter = applyColorAdjust(image, { ...base, exposure: 50 })
    expect(brighter.data[0]).toBeGreaterThan(128)
    const darker = applyColorAdjust(image, { ...base, exposure: -50 })
    expect(darker.data[0]).toBeLessThan(128)
    const gray = applyColorAdjust(solid(4, 4, [200, 90, 60]), { ...base, saturation: -100 })
    expect(Math.abs(gray.data[0] - gray.data[1])).toBeLessThan(3)
    const warm = applyColorAdjust(image, { ...base, colorTemp: 80 })
    expect(warm.data[0]).toBeGreaterThan(warm.data[2])
  })

  it('内置 LUT 生效且 none 是空操作', () => {
    const image = solid(8, 8, [180, 140, 120])
    expect(Array.from(applyLut(image, 'none').data)).toEqual(Array.from(image.data))
    const bw = applyLut(image, 'bw')
    expect(Math.abs(bw.data[0] - bw.data[2])).toBeLessThan(6)
    expect(Array.from(applyLut(image, 'bogus').data)).toEqual(Array.from(image.data))
  })

  it('颗粒确定性：同种子逐像素一致，不同种子不同', () => {
    const image = solid(16, 16, [128, 128, 128])
    const a = addGrain(image, 0.8, 11)
    const b = addGrain(image, 0.8, 11)
    const c = addGrain(image, 0.8, 12)
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
    expect(Array.from(a.data)).not.toEqual(Array.from(c.data))
  })

  it('暗角压四角、留中心', () => {
    const image = solid(32, 32, [200, 200, 200])
    const out = applyVignette(image, 1)
    expect(lum(out, 16, 16)).toBeGreaterThan(lum(out, 0, 0))
  })

  it('区域合成：蒙版为 0 不动、为 255 全量、可指定不透明度', () => {
    const base = solid(4, 4, [100, 100, 100])
    const overlay = solid(4, 4, [200, 200, 200])
    const zero = new Uint8ClampedArray(16)
    expect(Array.from(blendWithMask(base, overlay, zero).data)).toEqual(Array.from(base.data))
    const full = new Uint8ClampedArray(16).fill(255)
    expect(blendWithMask(base, overlay, full).data[0]).toBe(200)
    const half = blendWithMask(base, overlay, full, 0.5)
    expect(half.data[0]).toBeGreaterThan(140)
    expect(half.data[0]).toBeLessThan(180)
    const tinted = applyRegionTint(base, full, { brighten: 40 })
    expect(tinted.data[0]).toBe(140)
  })

  it('皮肤判定认肤色、拒纯色', () => {
    expect(isSkinPixel(220, 180, 160)).toBe(true)
    expect(isSkinPixel(30, 60, 220)).toBe(false)
    expect(isSkinPixel(20, 20, 20)).toBe(false)
  })

  it('去瑕疵只压暗斑、不动正常区域', () => {
    const image = withSpot(32, 32, [210, 170, 150], [150, 110, 95], { x: 14, y: 14, w: 4, h: 4 })
    const mask = new Uint8ClampedArray(32 * 32).fill(255)
    const out = healBlemishes(image, mask, 1, 2)
    expect(lum(out, 15, 15)).toBeGreaterThan(lum(image, 15, 15))
    expect(Math.abs(lum(out, 2, 2) - lum(image, 2, 2))).toBeLessThan(2)
  })

  it('去油光只压高光；锐化提升边缘对比；清晰度不溢出', () => {
    const bright = withSpot(24, 24, [120, 120, 120], [250, 250, 250], { x: 10, y: 10, w: 4, h: 4 })
    const out = removeShine(bright, null, 1)
    expect(lum(out, 11, 11)).toBeLessThan(lum(bright, 11, 11))
    const edge = withSpot(24, 24, [80, 80, 80], [180, 180, 180], { x: 12, y: 0, w: 12, h: 24 })
    const sharp = unsharpMask(edge, 1.5, 1)
    expect(lum(sharp, 11, 12)).toBeLessThan(lum(edge, 11, 12))
    const clarity = localContrast(edge, 6, 1)
    expect(clarity.data[0]).toBeGreaterThanOrEqual(0)
    expect(clarity.data[0]).toBeLessThanOrEqual(255)
  })

  it('高斯近似模糊让硬边过渡', () => {
    const edge = withSpot(32, 8, [40, 40, 40], [220, 220, 220], { x: 16, y: 0, w: 16, h: 8 })
    const blurred = gaussianLikeBlur(edge, 6)
    expect(lum(blurred, 16, 4)).toBeLessThan(lum(edge, 16, 4))
    expect(lum(blurred, 15, 4)).toBeGreaterThan(lum(edge, 15, 4))
  })
})

describe('portrait masks', () => {
  it('多边形蒙版内外分明，羽化软化边缘', () => {
    const mask = polygonMask(20, 20, [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.75, 0.75],
      [0.25, 0.75]
    ])
    const at = (x: number, y: number): number => mask[y * 20 + x]
    expect(at(10, 10)).toBe(255)
    expect(at(1, 1)).toBe(0)
    const soft = polygonMask(
      20,
      20,
      [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.75, 0.75],
        [0.25, 0.75]
      ],
      0.9
    )
    expect(soft[10 * 20 + 10]).toBeLessThan(255)
    // 退化输入不抛错
    expect(Array.from(polygonMask(8, 8, []).data ?? polygonMask(8, 8, [])).length).toBe(64)
  })

  it('矩形蒙版等价于同坐标多边形', () => {
    const rect = rectMask(16, 16, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
    expect(rect[8 * 16 + 8]).toBe(255)
    expect(rect[0]).toBe(0)
  })

  it('形态学与布尔运算按语义工作', () => {
    const base = polygonMask(24, 24, [
      [0.4, 0.4],
      [0.6, 0.4],
      [0.6, 0.6],
      [0.4, 0.6]
    ])
    const dilated = dilateMask(base, 24, 24, 2)
    const eroded = erodeMask(base, 24, 24, 2)
    let dilatedArea = 0
    let baseArea = 0
    let erodedArea = 0
    for (let i = 0; i < base.length; i++) {
      if (dilated[i] > 0) dilatedArea++
      if (base[i] > 0) baseArea++
      if (eroded[i] > 0) erodedArea++
    }
    expect(dilatedArea).toBeGreaterThan(baseArea)
    expect(erodedArea).toBeLessThan(baseArea)
    const opened = openMask(base, 24, 24, 1)
    expect(opened[12 * 24 + 12]).toBeGreaterThan(0)
    const other = polygonMask(24, 24, [
      [0.5, 0.5],
      [0.9, 0.5],
      [0.9, 0.9],
      [0.5, 0.9]
    ])
    const union = unionMask(base, other)
    const intersect = intersectMask(base, other)
    for (let i = 0; i < base.length; i++) {
      expect(union[i]).toBeGreaterThanOrEqual(Math.max(base[i], other[i]))
      expect(intersect[i]).toBeLessThanOrEqual(Math.min(base[i], other[i]))
    }
    expect(union[12 * 24 + 12]).toBeGreaterThan(0)
    const zeros = new Uint8ClampedArray(base.length)
    expect(Array.from(intersectMask(base, zeros))).toEqual(Array.from(zeros))
    expect(Array.from(subtractMask(base, base))).toEqual(Array.from(zeros))
    const scaled = scaleMask(base, 0.5)
    expect(Math.max(...Array.from(scaled))).toBeLessThanOrEqual(128)
    const blurred = blurMask(base, 24, 24, 3)
    expect(blurred[12 * 24 + 12]).toBeLessThan(255)
  })

  it('肤色蒙版：肤色区域命中，纯色背景不命中', () => {
    const image = withSpot(40, 40, [40, 60, 200], [215, 175, 155], { x: 10, y: 10, w: 20, h: 20 })
    const mask = buildSkinMask(image)
    expect(mask[20 * 40 + 20]).toBeGreaterThan(100)
    expect(mask[0]).toBeLessThan(50)
  })

  it('主体蒙版取反得到背景权重（中心 0、角落 255）', () => {
    const subject = polygonMask(40, 40, [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.75, 0.75],
      [0.25, 0.75]
    ])
    const bg = backgroundMaskFromSubject(subject, 40, 40, 0.01)
    expect(bg[20 * 40 + 20]).toBeLessThan(40)
    expect(bg[0]).toBeGreaterThan(200)
  })

  it('笔刷蒙版：圆内命中、圆外不命中，硬度影响边缘', () => {
    const soft = strokeMask(40, 40, [{ size: 0.4, hardness: 0, points: [{ x: 0.5, y: 0.5 }] }])
    const hard = strokeMask(40, 40, [{ size: 0.4, hardness: 100, points: [{ x: 0.5, y: 0.5 }] }])
    expect(hard[20 * 40 + 20]).toBeGreaterThan(200)
    expect(soft[20 * 40 + 20]).toBeGreaterThan(200)
    // 边缘处硬笔刷仍是实心、软笔刷已衰减
    expect(hard[20 * 40 + 27]).toBeGreaterThan(soft[20 * 40 + 27])
    expect(hard[0]).toBe(0)
  })

  it('笔画包围盒用于局部重算', () => {
    const bounds = strokeBounds([{ size: 0.2, points: [{ x: 0.5, y: 0.5 }] }])
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeCloseTo(0.4, 5)
    expect(bounds!.w).toBeCloseTo(0.2, 5)
    expect(strokeBounds([])).toBeNull()
  })
})
