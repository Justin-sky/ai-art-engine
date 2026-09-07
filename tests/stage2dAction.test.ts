import { describe, expect, it } from 'vitest'
import {
  STAGE2D_ACTION_PRESETS,
  computeStage2dRigTransforms,
  createHumanoidStage2dRig,
  interpolateStage2dPose,
  normalizeStage2dAction,
  sampleStage2dAction,
  stage2dActionDuration,
  stage2dActionPresetById
} from '../src/shared/gameAssets'

describe('normalizeStage2dAction', () => {
  it('按 time 升序重排关键帧', () => {
    const action = normalizeStage2dAction({
      keyframes: [
        { time: 2, pose: { a: 90 } },
        { time: 0, pose: { b: -10 } },
        { time: 1, pose: { a: 0, b: 10 } }
      ]
    })
    expect(action.keyframes.map((k) => k.time)).toEqual([0, 1, 2])
    expect(action.keyframes[1].pose).toEqual({ a: 0, b: 10 })
  })

  it('剔除非法角度 / 非法时刻，保留空 pose 帧并收敛角度', () => {
    const action = normalizeStage2dAction({
      keyframes: [
        { time: 1, pose: {} },
        { time: -5, pose: { a: 190, b: Infinity, c: -540 } },
        { time: 2, pose: { a: -20 } }
      ] as never
    })
    expect(action.keyframes).toHaveLength(3)
    expect(action.keyframes.map((k) => k.time)).toEqual([0, 1, 2])
    expect(action.keyframes[0].pose).toEqual({ a: -170, c: 180 })
    expect(action.keyframes[1].pose).toEqual({})
    expect(action.keyframes[2].pose).toEqual({ a: -20 })
  })

  it('空 pose 帧是有效关键帧：在插值序列里回到绑定姿势', () => {
    const action = normalizeStage2dAction({
      keyframes: [
        { time: 0, pose: { arm: 90 } },
        { time: 1, pose: {} },
        { time: 2, pose: { arm: -90 } }
      ]
    })
    expect(action.keyframes).toHaveLength(3)
    const mid = sampleStage2dAction(action, 0.5)
    expect(mid.arm).toBe(45)
    const atBound = sampleStage2dAction(action, 1)
    expect(atBound).toEqual({})
  })

  it('duration 缺省取最后一帧时刻；显式提供则不小于最后一帧', () => {
    const a = normalizeStage2dAction({
      keyframes: [
        { time: 0, pose: { x: 10 } },
        { time: 3, pose: {} }
      ]
    })
    expect(a.duration).toBe(3)
    const b = normalizeStage2dAction({
      duration: 5,
      keyframes: [
        { time: 0, pose: { x: 10 } },
        { time: 3, pose: {} }
      ]
    })
    expect(b.duration).toBe(5)
  })

  it('loop 默认开启，空动作时长为 0', () => {
    expect(normalizeStage2dAction(undefined).loop).toBe(true)
    expect(normalizeStage2dAction(null).duration).toBe(0)
    expect(normalizeStage2dAction(null).keyframes).toEqual([])
  })
})

describe('interpolateStage2dPose', () => {
  it('逐关节线性插值', () => {
    const out = interpolateStage2dPose({ a: 0, b: 20 }, { a: 40, b: 0 }, 0.5)
    expect(out.a).toBe(20)
    expect(out.b).toBe(10)
  })

  it('跨 ±180 走最短路径（-170 → 170 中点落 180）', () => {
    const out = interpolateStage2dPose({ a: -170 }, { a: 170 }, 0.5)
    expect(out.a).toBe(180)
  })

  it('单侧缺失按绑定 0 参与', () => {
    const out = interpolateStage2dPose({ a: 90 }, {}, 0.5)
    expect(out.a).toBe(45)
    expect(out.b).toBeUndefined()
  })

  it('t<=0 / t>=1 分别返回首尾帧拷贝，且回绕后仍收敛', () => {
    expect(interpolateStage2dPose({ a: 10 }, { a: -10 }, 0)).toEqual({ a: 10 })
    expect(interpolateStage2dPose({ a: 10 }, { a: -10 }, 1)).toEqual({ a: -10 })
    // 10 → 190(= -170) 差 180：中点落在 100（unwrap 到 +180 一侧）
    expect(interpolateStage2dPose({ a: 10 }, { a: 190 }, 0.5).a).toBe(100)
  })

  it('结果与绑定几乎重合（|v|<1e-6）时省略关节', () => {
    expect(interpolateStage2dPose({ a: 10 }, { a: -10 }, 0.5)).toEqual({})
  })
})

describe('sampleStage2dAction', () => {
  const action = normalizeStage2dAction({
    duration: 2,
    keyframes: [
      { time: 0, pose: { arm: 0 } },
      { time: 1, pose: { arm: 90 } },
      { time: 2, pose: { arm: 0 } }
    ]
  })

  it('端点严格命中关键帧', () => {
    expect(sampleStage2dAction(action, 0)).toEqual({ arm: 0 })
    expect(sampleStage2dAction(action, 1)).toEqual({ arm: 90 })
    expect(sampleStage2dAction(action, 2)).toEqual({ arm: 0 })
  })

  it('区间线性插值', () => {
    expect(sampleStage2dAction(action, 0.5).arm).toBe(45)
    expect(sampleStage2dAction(action, 1.5).arm).toBe(45)
  })

  it('循环播放对时长取模', () => {
    expect(sampleStage2dAction(action, 3)).toEqual(sampleStage2dAction(action, 1))
    expect(sampleStage2dAction(action, 2.5).arm).toBe(45)
    expect(sampleStage2dAction(action, -0.5).arm).toBe(45)
  })

  it('非循环动作把时间夹在 [0, duration]', () => {
    const once = normalizeStage2dAction({ ...action, loop: false })
    expect(sampleStage2dAction(once, 99).arm).toBe(0)
    expect(sampleStage2dAction(once, -99).arm).toBe(0)
  })

  it('空动作 / 首帧前的时间返回空姿势或首帧', () => {
    expect(sampleStage2dAction(normalizeStage2dAction(null), 1)).toEqual({})
    // 末帧刻在时长之内（duration=3 > 末帧 2）：尾段保持末帧直到 wrap
    const lateStart = normalizeStage2dAction({
      duration: 3,
      keyframes: [
        { time: 1, pose: { arm: 10 } },
        { time: 2, pose: { arm: 20 } }
      ]
    })
    expect(sampleStage2dAction(lateStart, 0)).toEqual({ arm: 10 })
    expect(sampleStage2dAction(lateStart, 2)).toEqual({ arm: 20 })
    expect(sampleStage2dAction(lateStart, 2.7)).toEqual({ arm: 20 })
  })
})

describe('内置动作预设', () => {
  it('预设齐全且 id 唯一、可按键查', () => {
    expect(STAGE2D_ACTION_PRESETS.length).toBeGreaterThanOrEqual(4)
    const ids = new Set(STAGE2D_ACTION_PRESETS.map((p) => p.id))
    expect(ids.size).toBe(STAGE2D_ACTION_PRESETS.length)
    expect(stage2dActionPresetById('wave')?.id).toBe('wave')
    expect(stage2dActionPresetById('nope')).toBeNull()
    expect(stage2dActionPresetById(null)).toBeNull()
  })

  it('预设关键帧升序且首尾为空 pose（可平滑回绕）', () => {
    for (const p of STAGE2D_ACTION_PRESETS) {
      expect(p.duration).toBeGreaterThan(0)
      expect(p.keyframes.length).toBeGreaterThan(1)
      const times = p.keyframes.map((k) => k.time)
      expect([...times].sort((x, y) => x - y)).toEqual(times)
      expect(p.keyframes[0].pose).toEqual({})
      expect(p.keyframes[p.keyframes.length - 1].pose).toEqual({})
      expect(p.keyframes[p.keyframes.length - 1].time).toBe(p.duration)
    }
  })

  it('预设 pose 采样的关节存在于人形模板，采样结果可喂 FK', () => {
    const rig = createHumanoidStage2dRig({ x: 0, groundY: 0, height: 200 })
    const rigIds = new Set(rig.joints.map((j) => j.id))
    for (const p of STAGE2D_ACTION_PRESETS) {
      for (const kf of p.keyframes) {
        for (const jointId of Object.keys(kf.pose)) {
          expect(rigIds.has(jointId), `${p.id}:${jointId}`).toBe(true)
        }
      }
      // 在整段时长内采样喂 FK 都不抛且输出含命中的骨骼
      const step = p.duration / 8
      for (let t = 0; t <= p.duration + 1e-6; t += step) {
        const pose = sampleStage2dAction(p, t)
        expect(() => computeStage2dRigTransforms(rig, pose)).not.toThrow()
      }
    }
  })

  it('时长工具读取 duration', () => {
    const action = normalizeStage2dAction({
      keyframes: [
        { time: 0, pose: { a: 1 } },
        { time: 2.5, pose: {} }
      ]
    })
    expect(stage2dActionDuration(action)).toBe(2.5)
    expect(stage2dActionDuration(normalizeStage2dAction(null))).toBe(0)
  })
})
