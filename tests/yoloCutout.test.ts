import { describe, expect, it } from 'vitest'
import {
  applyAlphaToRgba,
  applyCutoutBrushStrokes,
  buildCutoutAlpha,
  buildSalientSubjectMask,
  defringeRgba,
  featherAlpha,
  letterboxGeometryFor,
  punchInteriorBackgroundHoles,
  refineCutoutAlphaGuided,
  resolveCutoutRegion,
  stampCutoutBrushSegment
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

describe('refineCutoutAlphaGuided', () => {
  it('snaps a shifted coarse mask edge onto the true RGB object boundary', () => {
    const w = 24
    const h = 24
    const rgba = new Uint8ClampedArray(w * h * 4)
    const coarseAlpha = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x
        // 真实图像边界在 x = 12（左半深红前景，右半纯白背景）
        const isFg = x < 12
        rgba[idx * 4] = isFg ? 30 : 250
        rgba[idx * 4 + 1] = isFg ? 40 : 250
        rgba[idx * 4 + 2] = isFg ? 50 : 250
        rgba[idx * 4 + 3] = 255
        // 粗掩码在 x ∈ [10, 14] 模糊过渡（把 x=12,13 的背景也误包进来）
        if (x < 10) coarseAlpha[idx] = 1
        else if (x < 15) coarseAlpha[idx] = 1 - (x - 9) / 6
        else coarseAlpha[idx] = 0
      }
    }
    const refined = refineCutoutAlphaGuided(rgba, coarseAlpha, w, h, {
      radius: 3,
      colorMattingStrength: 0.7
    })
    // 真实前景 x=10,11 被拉升接近 1，而真实背景 x=12,13 被显著压低
    expect(refined[12 * w + 10]!).toBeGreaterThan(coarseAlpha[12 * w + 10]!)
    expect(refined[12 * w + 12]!).toBeLessThan(coarseAlpha[12 * w + 12]!)
    expect(refined[12 * w + 2]!).toBe(1)
    expect(refined[12 * w + 22]!).toBe(0)
  })

  it('separates iso-luminant chromatic edges (same grayscale brightness, different RGB color) via 3x3 RGB covariance', () => {
    const w = 24
    const h = 24
    const rgba = new Uint8ClampedArray(w * h * 4)
    const coarseAlpha = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x
        // 左半红 (200, 30, 30) 与右半绿 (30, 120, 30) 灰度亮度近乎相等 (~80)，单通道灰度滤波无法区分
        const isFg = x < 12
        rgba[idx * 4] = isFg ? 200 : 30
        rgba[idx * 4 + 1] = isFg ? 30 : 120
        rgba[idx * 4 + 2] = 30
        rgba[idx * 4 + 3] = 255
        if (x < 10) coarseAlpha[idx] = 1
        else if (x < 15) coarseAlpha[idx] = 1 - (x - 9) / 6
        else coarseAlpha[idx] = 0
      }
    }
    const refined = refineCutoutAlphaGuided(rgba, coarseAlpha, w, h, {
      radius: 3,
      colorMattingStrength: 0.65
    })
    expect(refined[12 * w + 11]!).toBeGreaterThan(0.85)
    expect(refined[12 * w + 12]!).toBeLessThan(0.15)
  })

  it('peels trapped bright background between fine dark hair strands in a 3-color hairline window', () => {
    const w = 32
    const h = 32
    const rgba = new Uint8ClampedArray(w * h * 4)
    const coarseAlpha = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x
        // y < 8: 外部纯白背景 (alpha=0)
        // 8 <= y < 18: 稀疏深色发丝 (x % 3 !== 2 为深色发丝 [32,28,26]，x % 3 === 2 为夹在发丝间的白底 [242,238,238])，
        //              粗掩码把整个发丝包络区 (8..18) 都给了 0.92 的高 alpha
        // y >= 18: 内部暖色额头皮肤 [222, 180, 162] (alpha=1)
        if (y < 8) {
          rgba[idx * 4] = 242
          rgba[idx * 4 + 1] = 238
          rgba[idx * 4 + 2] = 238
          rgba[idx * 4 + 3] = 255
          coarseAlpha[idx] = 0
        } else if (y < 18) {
          const isHairStrand = x % 3 !== 2
          rgba[idx * 4] = isHairStrand ? 32 : 242
          rgba[idx * 4 + 1] = isHairStrand ? 28 : 238
          rgba[idx * 4 + 2] = isHairStrand ? 26 : 238
          rgba[idx * 4 + 3] = 255
          coarseAlpha[idx] = 0.92
        } else {
          rgba[idx * 4] = 222
          rgba[idx * 4 + 1] = 180
          rgba[idx * 4 + 2] = 162
          rgba[idx * 4 + 3] = 255
          coarseAlpha[idx] = 1
        }
      }
    }
    const refined = refineCutoutAlphaGuided(rgba, coarseAlpha, w, h, {
      radius: 4,
      colorMattingStrength: 0.4
    })
    // 发丝本体 (y=12, x=12) 保持高不透明度
    expect(refined[12 * w + 12]!).toBeGreaterThan(0.8)
    // 夹在发丝之间的白底间隙 (y=12, x=14) 被显著剥离透明
    expect(refined[12 * w + 14]!).toBeLessThan(0.2)
  })

  it('preserves opaque white hair inside a dark outline on a white background without resurrecting an exterior white halo', () => {
    const w = 28
    const h = 20
    const rgba = new Uint8ClampedArray(w * h * 4)
    const alpha = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x
        // x < 10: 外部纯白背景 (252,252,255), alpha = 0
        // x = 10..11: 2px 二次元深色线稿描边 (48,45,55), alpha = 1
        // x >= 12: 角色内部银白头发 (245,246,252), alpha = 1
        if (x < 10) {
          rgba[idx * 4] = 252
          rgba[idx * 4 + 1] = 252
          rgba[idx * 4 + 2] = 255
          rgba[idx * 4 + 3] = 255
          alpha[idx] = 0
        } else if (x <= 11) {
          rgba[idx * 4] = 48
          rgba[idx * 4 + 1] = 45
          rgba[idx * 4 + 2] = 55
          rgba[idx * 4 + 3] = 255
          alpha[idx] = 1
        } else {
          rgba[idx * 4] = 245
          rgba[idx * 4 + 1] = 246
          rgba[idx * 4 + 2] = 252
          rgba[idx * 4 + 3] = 255
          alpha[idx] = 1
        }
      }
    }
    const refined = refineCutoutAlphaGuided(rgba, alpha, w, h, {
      radius: 4,
      colorMattingStrength: 0.5
    })
    // 描边外侧 1~3px 的纯白背景像素 (x=7,8,9) 绝不被引导滤波反向拉升成半透明白雾光晕
    expect(refined[10 * w + 7]).toBe(0)
    expect(refined[10 * w + 8]).toBe(0)
    expect(refined[10 * w + 9]).toBe(0)
    // 描边内侧的银白头发 (x=12,13,15) 绝不被跨过深色描边压低成半透明
    expect(refined[10 * w + 12]).toBe(1)
    expect(refined[10 * w + 13]).toBe(1)
    expect(refined[10 * w + 15]).toBe(1)
  })
})

describe('punchInteriorBackgroundHoles', () => {
  it('punches out enclosed background-colored holes while keeping solid foreground', () => {
    const w = 32
    const h = 32
    const rgba = new Uint8ClampedArray(w * h * 4)
    const alpha = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x
        const inSubject = x >= 6 && x < 26 && y >= 6 && y < 26
        const inHole = x >= 12 && x < 20 && y >= 12 && y < 20 // 8×8 = 64px 封闭背景内洞
        const isBgColor = !inSubject || inHole
        rgba[idx * 4] = isBgColor ? 245 : 30
        rgba[idx * 4 + 1] = isBgColor ? 245 : 40
        rgba[idx * 4 + 2] = isBgColor ? 245 : 180
        rgba[idx * 4 + 3] = 255
        // 初始粗掩码把整个 6..26 矩形都当成前景（未穿透内洞）
        alpha[idx] = inSubject ? 1 : 0
      }
    }
    const punched = punchInteriorBackgroundHoles(rgba, alpha, w, h)
    // 内洞中心变为全透明
    expect(punched[16 * w + 16]).toBe(0)
    // 主体实心环仍然保持不透明
    expect(punched[8 * w + 8]).toBe(1)
  })
})

describe('applyCutoutBrushStrokes', () => {
  it('restores foreground with keep brush and erases background with erase brush', () => {
    const w = 40
    const h = 40
    const base = new Float32Array(w * h)
    // 左半初始为前景
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < 20; x++) base[y * w + x] = 1
    }
    const edited = applyCutoutBrushStrokes(
      base,
      [
        // 在右半 (0.75, 0.5) 涂一笔 keep
        { mode: 'keep', radius: 0.1, points: [{ x: 0.75, y: 0.5 }] },
        // 在左半 (0.25, 0.5) 涂一笔 erase
        { mode: 'erase', radius: 0.1, points: [{ x: 0.25, y: 0.5 }] }
      ],
      { srcWidth: w, srcHeight: h }
    )
    expect(edited[20 * w + 30]).toBe(1)
    expect(edited[20 * w + 10]).toBe(0)
  })

  it('expands resolveCutoutRegion to include keep brush strokes', () => {
    const region = resolveCutoutRegion({
      boxes: [{ label: 'person', confidence: 0.9, x: 10, y: 10, width: 20, height: 20 }],
      srcWidth: 100,
      srcHeight: 100,
      brushStrokes: [{ mode: 'keep', radius: 0.05, points: [{ x: 0.8, y: 0.8 }] }]
    })
    expect(region.x + region.width).toBeGreaterThanOrEqual(85)
    expect(region.y + region.height).toBeGreaterThanOrEqual(85)
  })

  it('incrementally stamps a brush segment and returns the minimal dirty rect', () => {
    const w = 64
    const h = 64
    const workingAlpha = new Float32Array(w * h).fill(1)
    const rawSourceRgba = new Uint8ClampedArray(w * h * 4).fill(200)
    const workingRgba = new Uint8ClampedArray(rawSourceRgba)
    const dirty = stampCutoutBrushSegment({
      workingAlpha,
      workingRgba,
      rawSourceRgba,
      mode: 'erase',
      radiusNorm: 0.08,
      p0: { x: 0.5, y: 0.5 },
      p1: { x: 0.55, y: 0.5 },
      srcWidth: w,
      srcHeight: h,
      region: { x: 0, y: 0, width: w, height: h },
      outScale: 1,
      outWidth: w,
      outHeight: h
    })
    expect(dirty).not.toBeNull()
    expect(dirty!.dirtyW).toBeLessThan(24)
    expect(dirty!.dirtyH).toBeLessThan(24)
    expect(workingAlpha[32 * w + 32]).toBe(0)
    expect(workingRgba[(32 * w + 32) * 4 + 3]).toBe(0)
    // 脏矩形外部像素完全不受影响
    expect(workingAlpha[2 * w + 2]).toBe(1)
  })
})

describe('buildSalientSubjectMask', () => {
  it('extracts a non-COCO subject from a uniform background', () => {
    const w = 48
    const h = 48
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4
        const isProp = x >= 14 && x < 34 && y >= 10 && y < 38
        rgba[idx] = isProp ? 220 : 20
        rgba[idx + 1] = isProp ? 60 : 22
        rgba[idx + 2] = isProp ? 40 : 25
        rgba[idx + 3] = 255
      }
    }
    const salient = buildSalientSubjectMask(rgba, w, h)
    expect(salient).not.toBeNull()
    expect(salient!.box.label).toBe('subject')
    expect(salient!.box.width).toBeGreaterThanOrEqual(18)
    expect(salient!.box.height).toBeGreaterThanOrEqual(24)
  })
})
