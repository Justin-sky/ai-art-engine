import { describe, expect, it } from 'vitest'
import {
  PORTRAIT_LANDMARK_COUNT,
  defaultPortraitRetouch,
  normalizePortraitRetouch,
  portraitFaceBoxFromLandmarks,
  portraitFaceMaskShape,
  portraitScopePlan
} from '@shared/graph'

/**
 * 人像「局部生效」范围计划。
 *
 * 这里的判定决定了「模型重绘结果要不要按蒙版贴回原图」——
 * 判错的表现很隐蔽：要么局部效果又作用到全局（用户最初的问题），
 * 要么把调色 / 换背景这类全局效果裁掉一半（比原来更糟），所以逐条锁死。
 */

function stateWith(patch: Record<string, unknown>) {
  return normalizePortraitRetouch({ ...defaultPortraitRetouch(), ...patch })
}

describe('人像局部回贴范围计划', () => {
  it('只调皮肤 / 面部 → 罩脸', () => {
    const plan = portraitScopePlan(stateWith({ skinSmoothing: 'strong' }))
    expect(plan).toMatchObject({ face: true, person: false, disabled: false })
    expect(plan.regions).toEqual([])
  })

  it('调身形 → 罩人物（脸也一起罩）', () => {
    const plan = portraitScopePlan(stateWith({ waistSlim: 'strong' }))
    expect(plan).toMatchObject({ person: true, face: false, disabled: false })
  })

  it('皮肤 + 身形 → 两者都要', () => {
    const plan = portraitScopePlan(stateWith({ skinSmoothing: 'standard', shoulderNeck: 'light' }))
    expect(plan).toMatchObject({ face: true, person: true, disabled: false })
  })

  it('妆容 / 眼睛 / 影调 / 质感都属于面部范围', () => {
    // 枚举档位用合法值（非法值会被域校验挡掉，那样测的就不是范围判定了）
    for (const [key, value] of [
      ['makeupStyle', 'portrait'],
      ['eyeWhiten', 'strong'],
      ['fillLight', 'strong'],
      ['sharpness', 'strong']
    ] as const) {
      expect(portraitScopePlan(stateWith({ [key]: value })).face, key).toBe(true)
    }
  })

  it('调色 / 换背景 / 证件照是整图语义：整体放弃蒙版（否则全局效果会被裁掉）', () => {
    for (const [key, value] of [
      ['lutId', 'fuji'],
      ['bgMode', 'prompt'],
      ['bgBlur', 'strong'],
      ['colorTemp', 'warmStrong']
    ] as const) {
      const plan = portraitScopePlan(stateWith({ [key]: value }))
      expect(plan.disabled, key).toBe(true)
      expect(plan.reason, key).toBe('global')
    }
    const idPhoto = portraitScopePlan(stateWith({ idPhotoSpecId: 'oneInch' }))
    expect(idPhoto.disabled).toBe(true)
    expect(idPhoto.reason).toBe('idPhoto')
  })

  it('局部项与全局项同时存在时，也按整图（不能只回贴局部）', () => {
    const plan = portraitScopePlan(stateWith({ skinSmoothing: 'strong', lutId: 'fuji' }))
    expect(plan.disabled).toBe(true)
    expect(plan.reason).toBe('global')
  })

  it('只画了手动区域框 → 蒙版只由框组成（人像之外也能用）', () => {
    const plan = portraitScopePlan(
      stateWith({
        manualRegions: [
          { id: 'r1', kind: 'blemish', box: { x: 0.2, y: 0.3, w: 0.1, h: 0.1 }, note: '' }
        ]
      })
    )
    expect(plan.disabled).toBe(false)
    expect(plan.face).toBe(false)
    expect(plan.person).toBe(false)
    expect(plan.regions).toHaveLength(1)
  })

  it('导出设置不算「改哪里」，不改默认档位时整体放弃', () => {
    const plan = portraitScopePlan(stateWith({ outputSize: '4K', exportDpi: 600 }))
    expect(plan.disabled).toBe(true)
    expect(plan.reason).toBe('off')
  })
})

describe('人像脸部蒙版几何', () => {
  /** 造一张脸的 canonical-68：外接框 [0.3,0.2]–[0.7,0.6] */
  function faceLandmarks(scale = 1): Array<[number, number]> {
    const points: Array<[number, number]> = []
    for (let i = 0; i < PORTRAIT_LANDMARK_COUNT; i++) {
      const t = i / (PORTRAIT_LANDMARK_COUNT - 1)
      points.push([0.3 + t * 0.4 * scale, 0.2 + Math.sin(t * Math.PI) * 0.4 * scale])
    }
    return points
  }

  it('椭圆的纵向范围要盖住额头（高于关键点外接框上沿）', () => {
    const points = faceLandmarks()
    const box = portraitFaceBoxFromLandmarks(points)
    const shape = portraitFaceMaskShape(points)
    expect(shape, '关键点足够时应能造出形状').toBeTruthy()
    const top = shape!.ellipse.cy - shape!.ellipse.ry
    expect(top).toBeLessThan(box.y)
    // 下沿要包住下巴
    expect(shape!.ellipse.cy + shape!.ellipse.ry).toBeGreaterThan(box.y + box.h)
  })

  it('颈部梯形接在下巴下方、比脸窄起、向下张开', () => {
    const points = faceLandmarks()
    const box = portraitFaceBoxFromLandmarks(points)
    const shape = portraitFaceMaskShape(points)!
    const [topLeft, topRight, bottomRight, bottomLeft] = shape.neck
    // 起点在下巴附近，终点明显更低
    expect(topLeft![1]).toBeGreaterThanOrEqual(box.y + box.h * 0.8)
    expect(bottomLeft![1]).toBeGreaterThan(box.y + box.h * 1.4)
    // 上窄下宽（脖子到锁骨）
    expect(topRight![0] - topLeft![0]).toBeLessThan(bottomRight![0] - bottomLeft![0])
  })

  it('关键点不足 / 退化时返回 null（调用方据此退回整图并记日志）', () => {
    expect(portraitFaceMaskShape(null)).toBeNull()
    expect(portraitFaceMaskShape([[0.5, 0.5]])).toBeNull()
    expect(portraitFaceMaskShape(faceLandmarks(0))).toBeNull()
  })
})
