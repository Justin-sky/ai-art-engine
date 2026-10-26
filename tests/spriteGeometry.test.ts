import { describe, expect, it } from 'vitest'
import {
  applySpriteCellAutoKey,
  applySpriteGroundShadow,
  applySpriteLoopClosure,
  applySpriteMotionTrail,
  applySpriteOuterOutline,
  applySpritePaletteLock,
  applySpritePixelSnap,
  computeSpriteAlignPlan,
  computeStabilizedCellPlacement,
  DEFAULT_SPRITE_ALIGN,
  detectSpriteCombatBoxes,
  estimateContentTranslation,
  estimateFrameTranslations,
  extractAlphaBounds,
  extractSpriteCorePivotX,
  extractSpritePalette,
  generateSpriteNormalMap,
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
    const wide = {
      srcWidth: 1024,
      srcHeight: 256,
      bounds: { x: 0, y: 0, width: 1024, height: 256 }
    }
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
    expect(estimateContentTranslation(ref, makeFrame(64, 64, [[20, 20, 16, 16]]))).toEqual({
      dx: 0,
      dy: 0
    })
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
    expect(estimateContentTranslation(ref, makeFrame(32, 64, [[5, 5, 8, 8]]))).toEqual({
      dx: 0,
      dy: 0
    })
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

describe('extractSpriteCorePivotX & computeStabilizedCellPlacement：躯干主轴稳像与身高归一化', () => {
  it('挥剑横向外扩时，躯干主轴 X 仍锁定在身体立柱中心，不随外接框右移', () => {
    // 角色躯干位于 x=[24..36]（中心 30），高 40px；向右挥出一把细长剑 x=[36..58]，厚 3px
    const f = makeFrame(
      64,
      64,
      [
        [24, 14, 12, 40],
        [36, 28, 22, 3]
      ],
      true
    )
    const bounds = extractAlphaBounds(f.data, f.width, f.height)!
    // 外接框中心被长剑拉到了 24 + 34/2 = 41
    expect(bounds.x + bounds.width / 2).toBe(41)
    // 而躯干主轴 X 依然牢牢锁在 30 附近（误差 < 1px）
    const pivotX = extractSpriteCorePivotX(f.data, f.width, f.height, bounds)!
    expect(pivotX).toBeGreaterThan(29.5)
    expect(pivotX).toBeLessThan(31)

    const placement = computeStabilizedCellPlacement({
      cellWidth: 64,
      cellHeight: 64,
      bounds,
      pivotX,
      mode: 'ground',
      referenceHeightPx: 44
    })
    expect(placement.scale).toBeCloseTo(1.1, 2)
    expect(placement.dstH).toBe(44)
    expect(placement.dstY).toBe(Math.round(64 * 0.94) - 44)
  })

  it('applySpriteCellAutoKey 对已透明图直接跳过二次抠图，对实底图仅泛洪外部背景且绝不挖穿角色内部银白盔甲与高光', () => {
    const w = 32
    const h = 32
    // 1. 原生透明图（外部 alpha=0，内部有银白盔甲色块）：完全跳过抠图，内部银白盔甲 100% 保留
    const nativeRgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 8; y < 24; y++) {
      for (let x = 8; x < 24; x++) {
        const p = (y * w + x) * 4
        nativeRgba[p] = 240
        nativeRgba[p + 1] = 242
        nativeRgba[p + 2] = 245
        nativeRgba[p + 3] = 255
      }
    }
    const nativeRes = applySpriteCellAutoKey(nativeRgba, w, h, { distance: 42, feather: 30 })
    expect(nativeRes.nativeTransparent).toBe(true)
    expect(nativeRes.keyedPixels).toBe(0)
    expect(nativeRgba[(16 * w + 16) * 4 + 3]).toBe(255)

    // 2. 纯白实底图：泛洪外部背景，但角色轮廓内部的 4x4 银白胸甲 (16px) 与 2x2 眼神高光 (4px) 均被完整保护，绝不挖洞
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h * 4; i += 4) {
      rgba[i] = 255
      rgba[i + 1] = 255
      rgba[i + 2] = 255
      rgba[i + 3] = 255
    }
    for (let y = 6; y < 28; y++) {
      for (let x = 8; x < 24; x++) {
        const p = (y * w + x) * 4
        rgba[p] = 30
        rgba[p + 1] = 50
        rgba[p + 2] = 160
        rgba[p + 3] = 255
      }
    }
    // 角色胸口/腿部 4x4=16px 的白色盔甲色块 (x=[14..18), y=[20..24)) -> 不与四边连通，必须完整保留不透明
    for (let y = 20; y < 24; y++) {
      for (let x = 14; x < 18; x++) {
        const p = (y * w + x) * 4
        rgba[p] = 255
        rgba[p + 1] = 255
        rgba[p + 2] = 255
        rgba[p + 3] = 255
      }
    }
    // 角色头部 2x2=4px 的白色眼神高光 (x=[12..14), y=[10..12)) -> 同样完整保留不透明
    for (let y = 10; y < 12; y++) {
      for (let x = 12; x < 14; x++) {
        const p = (y * w + x) * 4
        rgba[p] = 255
        rgba[p + 1] = 255
        rgba[p + 2] = 255
        rgba[p + 3] = 255
      }
    }

    const res = applySpriteCellAutoKey(rgba, w, h, { distance: 42, feather: 30 })
    expect(res.keyedPixels).toBeGreaterThan(100)
    // 外部四角透明
    expect(rgba[3]).toBe(0)
    // 角色内部 4x4 白色盔甲与 2x2 眼神高光均被完好保留，绝不被误挖成透明孔洞
    expect(rgba[(21 * w + 15) * 4 + 3]).toBe(255)
    expect(rgba[(10 * w + 12) * 4 + 3]).toBe(255)
  })

  it('applySpritePixelSnap + applySpriteOuterOutline + applySpriteGroundShadow：PixelOver 级像素规整、外描边与脚底阴影', () => {
    const f = makeFrame(32, 32, [[10, 8, 12, 16]], true)
    // 在边缘加一个半透明假像素毛刺 (x=9, y=10, alpha=110)
    const fringeIdx = (10 * 32 + 9) * 4
    f.data[fringeIdx] = 180
    f.data[fringeIdx + 3] = 110

    applySpritePixelSnap(f.data, 32, 32, 2)
    // 2x2 块 (x=[8..10), y=[10..12)) 中仅 1 个像素有弱 alpha，少于 40%，被干净剔除为 0
    expect(f.data[fringeIdx + 3]).toBe(0)
    // 主体 2x2 块规整后保持 255 硬边缘
    expect(f.data[(10 * 32 + 10) * 4 + 3]).toBe(255)

    // 1px 外描边：主体紧邻外侧 (x=9, y=12) 原本透明，描边后变为不透明描边色
    const outlineIdx = (12 * 32 + 9) * 4
    expect(f.data[outlineIdx + 3]).toBe(0)
    applySpriteOuterOutline(f.data, 32, 32, { color: 'gold', thickness: 1 })
    expect(f.data[outlineIdx + 3]).toBe(255)
    expect(f.data[outlineIdx]).toBe(250)

    // 脚底接触椭圆阴影：在脚底下方产生半透明阴影像素，且不覆盖主体不透明像素
    applySpriteGroundShadow(f.data, 32, 32)
    expect(f.data[(30 * 32 + 16) * 4 + 3]).toBeGreaterThan(20)
    expect(f.data[(12 * 32 + 12) * 4 + 3]).toBe(255)
  })

  it('extractSpritePalette & applySpritePaletteLock：跨帧调色板锁定消除色彩闪烁', () => {
    const refFrame = makeFrame(32, 32, [[8, 8, 16, 16]], true)
    const palette = extractSpritePalette(refFrame.data, 32, 32, 16)
    expect(palette.length).toBeGreaterThan(0)
    expect(palette[0]).toEqual([200, 100, 50])

    // 造一帧颜色发生微漂移的帧 (212, 108, 58)
    const drifted = makeFrame(32, 32, [[8, 8, 16, 16]], true)
    const p = (12 * 32 + 12) * 4
    drifted.data[p] = 212
    drifted.data[p + 1] = 108
    drifted.data[p + 2] = 58
    applySpritePaletteLock(drifted.data, 32, 32, palette, 1)
    expect([drifted.data[p], drifted.data[p + 1], drifted.data[p + 2]]).toEqual([200, 100, 50])
  })

  it('applySpriteMotionTrail + applySpriteLoopClosure + generateSpriteNormalMap + detectSpriteCombatBoxes', () => {
    const prev = makeFrame(64, 64, [[24, 14, 12, 40]], true)
    // 当前帧：角色躯干在 x=[24..36]，向右挥出长剑 x=[36..58], y=[26..32]
    const cur = makeFrame(
      64,
      64,
      [
        [24, 14, 12, 40],
        [36, 26, 22, 6]
      ],
      true
    )

    // 1. 自动识别躯干 hurtbox 与挥剑延伸 hitbox
    const combat = detectSpriteCombatBoxes(cur.data, 64, 64)!
    expect(combat).not.toBeNull()
    expect(combat.hurtbox.width).toBeLessThan(26)
    expect(combat.hitbox).not.toBeNull()
    expect(combat.hitbox!.x).toBeGreaterThanOrEqual(34)
    expect(combat.hitbox!.width).toBeGreaterThanOrEqual(16)

    // 2. 动作残影拖尾（左移 6px 在 x=20 处产生青色半透明残影，且不污染 x=28 处的主体像素）
    applySpriteMotionTrail(cur.data, prev.data, 64, 64, { style: 'cyan', offsetX: -6 })
    expect(cur.data[(24 * 64 + 20) * 4 + 3]).toBeGreaterThan(40)
    expect(cur.data[(24 * 64 + 28) * 4]).toBe(200)

    // 3. 2D 切线空间法线贴图生成（主体区域 Z 分量 B > 128，透明区为 [128,128,255,0]）
    const normalRgba = generateSpriteNormalMap(cur.data, 64, 64)
    expect(normalRgba[3]).toBe(0)
    expect(normalRgba[2]).toBe(255)
    const bodyIdx = (24 * 64 + 30) * 4
    expect(normalRgba[bodyIdx + 3]).toBe(255)
    expect(normalRgba[bodyIdx + 2]).toBeGreaterThan(150)

    // 4. 首尾循环闭合补偿
    const first = makeFrame(64, 64, [[24, 14, 12, 40]], false)
    const last = shiftPixelImage(first, 4, 0)
    applySpriteLoopClosure(last.data, first.data, 64, 64, 0.5)
    const afterShift = estimateContentTranslation(first, last)
    expect(Math.abs(afterShift.dx)).toBeLessThan(4)
  })
})
