import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMAGE_TRANSFORM,
  IMAGE_TRANSFORM_LIMITS,
  describeImageTransform,
  imageTransformToNodePatch,
  isIdentityImageTransform,
  normalizeImageTransform,
  planImageTransform,
  readImageTransformFromNode
} from '../src/shared/graph'

/**
 * 图片变换的契约与几何（`src/shared/graph/imageTransform.ts`）。
 *
 * 这个文件锁的是「画布尺寸规则」与「归一化兜底」——它们是编辑器预览与执行器落笔的**唯一**
 * 依据（两边共用 `planImageTransform`），一旦某条规则被改坏，表现是「预览和出图不一样」
 * 或「旋转 90° 之后被裁掉一半」这类只能靠肉眼发现的问题。
 */
describe('imageTransform 归一化', () => {
  it('默认值：不缩放、不旋转、不镜像、不位移、跟随原图、透明填充', () => {
    expect(normalizeImageTransform()).toEqual(DEFAULT_IMAGE_TRANSFORM)
    expect(isIdentityImageTransform(normalizeImageTransform())).toBe(true)
  })

  it('数值夹回合法区间（脏数据 / 面板输入 / 导入预设都走这里）', () => {
    const s = normalizeImageTransform({
      scale: 99,
      rotate: 720,
      offsetX: -5,
      offsetY: 5
    })
    expect(s.scale).toBe(IMAGE_TRANSFORM_LIMITS.scaleMax)
    expect(s.rotate).toBe(IMAGE_TRANSFORM_LIMITS.rotateLimit)
    expect(s.offsetX).toBe(-IMAGE_TRANSFORM_LIMITS.offsetLimit)
    expect(s.offsetY).toBe(IMAGE_TRANSFORM_LIMITS.offsetLimit)

    const low = normalizeImageTransform({ scale: -3, rotate: NaN })
    expect(low.scale).toBe(IMAGE_TRANSFORM_LIMITS.scaleMin)
    expect(low.rotate).toBe(0)
  })

  it('未知画幅 / 尺寸 / 填充回落默认', () => {
    const s = normalizeImageTransform({
      aspectId: '5:7' as never,
      sizeId: '8K' as never,
      fill: 'rainbow' as never
    })
    expect(s.aspectId).toBe('original')
    expect(s.sizeId).toBe('original')
    expect(s.fill).toBe('transparent')
  })

  it('只要动了画幅 / 尺寸就不算「什么都没做」', () => {
    expect(isIdentityImageTransform(normalizeImageTransform({ aspectId: '1:1' }))).toBe(false)
    expect(isIdentityImageTransform(normalizeImageTransform({ sizeId: '2K' }))).toBe(false)
    expect(isIdentityImageTransform(normalizeImageTransform({ flipV: true }))).toBe(false)
  })

  it('从节点参数读取：缺字段走默认，部分字段与默认合并', () => {
    expect(readImageTransformFromNode(undefined)).toEqual(DEFAULT_IMAGE_TRANSFORM)
    expect(readImageTransformFromNode({})).toEqual(DEFAULT_IMAGE_TRANSFORM)
    expect(readImageTransformFromNode({ imageTransform: { rotate: 90 } })).toMatchObject({
      rotate: 90,
      scale: 1,
      aspectId: 'original'
    })
    expect(readImageTransformFromNode({ imageTransform: { rotate: 1e9 } }).rotate).toBe(
      IMAGE_TRANSFORM_LIMITS.rotateLimit
    )
  })

  it('编辑器补丁与读取同口径（写入前也会夹回）', () => {
    const patch = imageTransformToNodePatch(normalizeImageTransform({ scale: 3, aspectId: '16:9' }))
    expect(patch.imageTransform.scale).toBe(3)
    expect(patch.imageTransform.aspectId).toBe('16:9')
    expect(readImageTransformFromNode(patch)).toEqual(patch.imageTransform)
  })
})

describe('imageTransform 画布尺寸规则', () => {
  const base = normalizeImageTransform()

  it('规则 1：跟随原图 + 不旋转 = 原尺寸', () => {
    const plan = planImageTransform(4000, 3000, base)
    expect(plan.width).toBe(4000)
    expect(plan.height).toBe(3000)
    expect(plan.drawWidth).toBe(4000)
    expect(plan.drawHeight).toBe(3000)
  })

  it('规则 1：旋转 90° 后画布按外接框扩张（长宽互换，不裁内容）', () => {
    const plan = planImageTransform(4000, 3000, normalizeImageTransform({ rotate: 90 }))
    expect(plan.width).toBe(3000)
    expect(plan.height).toBe(4000)
  })

  it('规则 1：任意角度按外接框扩张', () => {
    const plan = planImageTransform(4000, 3000, normalizeImageTransform({ rotate: 45 }))
    // (4000+3000)*sin45 ≈ 4949.7 → 4950，两个方向同值
    expect(plan.width).toBe(4950)
    expect(plan.height).toBe(4950)
  })

  it('规则 2：跟随画幅但选了档位 = 源图比例 + 档位长边', () => {
    const plan = planImageTransform(4000, 3000, normalizeImageTransform({ sizeId: '2K' }))
    expect(plan.width).toBe(2048)
    expect(plan.height).toBe(1536)
    // 竖图长边落在高度上
    const tall = planImageTransform(3000, 4000, normalizeImageTransform({ sizeId: '1K' }))
    expect(tall.height).toBe(1024)
    expect(tall.width).toBe(768)
  })

  it('规则 3：指定画幅 = 该比例 + 长边（横竖各一例）', () => {
    const wide = planImageTransform(
      4000,
      3000,
      normalizeImageTransform({ aspectId: '16:9', sizeId: '1K' })
    )
    expect(wide.width).toBe(1024)
    expect(wide.height).toBe(576)

    const tall = planImageTransform(
      4000,
      3000,
      normalizeImageTransform({ aspectId: '9:16', sizeId: '1K' })
    )
    expect(tall.height).toBe(1024)
    expect(tall.width).toBe(576)

    // 未选档位时用源图长边（4000）套画幅
    const originalEdge = planImageTransform(
      4000,
      3000,
      normalizeImageTransform({ aspectId: '1:1' })
    )
    expect(originalEdge.width).toBe(4000)
    expect(originalEdge.height).toBe(4000)
  })

  it('缩放作用于源图绘制尺寸，不改变画布（画布由画幅 / 尺寸决定）', () => {
    const plan = planImageTransform(4000, 3000, normalizeImageTransform({ scale: 0.5 }))
    expect(plan.width).toBe(4000)
    expect(plan.drawWidth).toBe(2000)
    expect(plan.drawHeight).toBe(1500)
  })

  it('位移是画布比例 → 像素（预览与出图按同一比例换算）', () => {
    const plan = planImageTransform(
      1000,
      500,
      normalizeImageTransform({ offsetX: 0.5, offsetY: -0.2 })
    )
    expect(plan.offsetX).toBe(500)
    expect(plan.offsetY).toBe(-100)
  })

  it('退化输入不崩：0 / NaN 尺寸都按 1 处理', () => {
    const plan = planImageTransform(0, Number.NaN, base)
    expect(plan.width).toBeGreaterThanOrEqual(1)
    expect(plan.height).toBeGreaterThanOrEqual(1)
  })
})

describe('imageTransform 日志', () => {
  it('打出源 → 目标尺寸、缩放、角度、镜像、位移与填充（英文，与 shared 其他日志同口径）', () => {
    const plan = planImageTransform(
      4000,
      3000,
      normalizeImageTransform({
        scale: 0.5,
        rotate: 90,
        flipH: true,
        offsetX: 0.1,
        fill: 'white'
      })
    )
    const line = describeImageTransform(plan)
    expect(line.startsWith('transform: 4000x3000 -> 3000x4000')).toBe(true)
    expect(line).toContain('scale 0.50')
    expect(line).toContain('rotate 90deg')
    expect(line).toContain('flip H')
    expect(line).toContain('fill white')
    expect(line).toMatch(/offset \d+,-?\d+px/)
  })

  it('没做的项不出现（避免日志里一堆 0 噪声）', () => {
    const line = describeImageTransform(planImageTransform(800, 600, normalizeImageTransform()))
    expect(line).toBe('transform: 800x600 -> 800x600 · scale 1.00')
  })
})
