import { describe, expect, it } from 'vitest'
import {
  computeStage2dAttachmentTransforms,
  computeStage2dRigTransforms,
  createStage2dJoint,
  normalizeStage2dRig,
  type Stage2dRig
} from '../src/shared/gameAssets'

/** 根(0,0) → chest 上 100 → armL 右 50 的三关节绑定姿势 */
function makeRig(overrides?: Partial<Stage2dRig>): Stage2dRig {
  return normalizeStage2dRig({
    root: { x: 0, y: 0 },
    joints: [
      { id: 'hip', name: '髋', parentId: null, x: 0, y: 0, rotation: 0 },
      { id: 'chest', name: '胸', parentId: 'hip', x: 0, y: -100, rotation: 0 },
      { id: 'armL', name: '左臂', parentId: 'chest', x: 50, y: 0, rotation: 0 }
    ],
    attachments: [
      { layerId: 'leg', jointId: 'chest', offsetX: 10, offsetY: 0, rotation: 0 }
    ],
    ...overrides
  })
}

describe('normalizeStage2dRig：骨骼装配归一化', () => {
  it('缺省字段补 id/name，坐标与角度夹取、角度收敛到 (-180,180]', () => {
    const rig = normalizeStage2dRig({
      joints: [
        { parentId: 'nope', x: Number.NaN, y: 999999 },
        { id: 'b', rotation: 540 }
      ]
    })
    expect(rig.joints[0]!.id).toBe('joint-0')
    expect(rig.joints[0]!.name).toBe('Joint 1')
    expect(rig.joints[0]!.x).toBe(0)
    expect(rig.joints[0]!.y).toBe(8192)
    // 父关节不存在 → 断链挂 root
    expect(rig.joints[0]!.parentId).toBeNull()
    // 540° → 180°
    expect(rig.joints[1]!.rotation).toBe(180)
  })

  it('父链成环时断链（FK 不死循环）', () => {
    const rig = normalizeStage2dRig({
      joints: [
        { id: 'a', parentId: 'c' },
        { id: 'b', parentId: 'a' },
        { id: 'c', parentId: 'b' }
      ]
    })
    expect(rig.joints.some((joint) => joint.parentId === null)).toBe(true)
    const transforms = computeStage2dRigTransforms(rig)
    expect(transforms).toHaveLength(3)
    for (const item of transforms) {
      expect(Number.isFinite(item.x)).toBe(true)
      expect(Number.isFinite(item.y)).toBe(true)
    }
  })

  it('挂点要求 layerId 与 jointId 同时有效，否则剔除', () => {
    const rig = normalizeStage2dRig({
      joints: [{ id: 'hip' }],
      attachments: [
        { layerId: 'head', jointId: 'hip' },
        { layerId: '', jointId: 'hip' },
        { layerId: 'ghost', jointId: 'missing' }
      ]
    })
    expect(rig.attachments).toHaveLength(1)
    expect(rig.attachments[0]!.layerId).toBe('head')
  })
})

describe('computeStage2dRigTransforms：平面正向运动学', () => {
  it('绑定姿势：自根向下累加局部偏移', () => {
    const transforms = computeStage2dRigTransforms(makeRig())
    const map = new Map(transforms.map((item) => [item.jointId, item]))
    expect(map.get('hip')).toMatchObject({ x: 0, y: 0, rotation: 0 })
    expect(map.get('chest')).toMatchObject({ x: 0, y: -100, rotation: 0 })
    expect(map.get('armL')).toMatchObject({ x: 50, y: -100, rotation: 0 })
  })

  it('父关节旋转带动子关节（顺时针为正）', () => {
    const transforms = computeStage2dRigTransforms(makeRig(), { chest: 90 })
    const map = new Map(transforms.map((item) => [item.jointId, item]))
    expect(map.get('chest')!.rotation).toBe(90)
    // 子关节局部偏移 (50,0) 随父旋转 90° → (0,50)
    expect(map.get('armL')!.x).toBeCloseTo(0, 5)
    expect(map.get('armL')!.y).toBeCloseTo(-50, 5)
    expect(map.get('armL')!.rotation).toBe(90)
  })

  it('pose 只覆盖旋转，不改写绑定值（可回到绑定姿势）', () => {
    const rig = makeRig()
    computeStage2dRigTransforms(rig, { chest: 90, armL: -30 })
    expect(rig.joints.find((joint) => joint.id === 'chest')!.rotation).toBe(0)
    expect(rig.joints.find((joint) => joint.id === 'armL')!.rotation).toBe(0)
    const back = computeStage2dRigTransforms(rig)
    expect(back.find((item) => item.jointId === 'armL')).toMatchObject({ x: 50, y: -100 })
  })

  it('root 平移整体生效（根关节跟随 rig.root）', () => {
    const rig = makeRig({ root: { x: 120, y: 240 } })
    const transforms = computeStage2dRigTransforms(rig)
    expect(transforms[0]).toMatchObject({ x: 120, y: 240 })
    expect(transforms[2]).toMatchObject({ x: 170, y: 140 })
  })
})

describe('computeStage2dAttachmentTransforms：部件挂点', () => {
  it('挂点随关节世界变换（偏移跟着旋转）', () => {
    const [bound] = computeStage2dAttachmentTransforms(makeRig())
    expect(bound).toMatchObject({ layerId: 'leg', x: 10, y: -100, rotation: 0 })

    const [posed] = computeStage2dAttachmentTransforms(makeRig(), { chest: 90 })
    expect(posed!.x).toBeCloseTo(0, 5)
    expect(posed!.y).toBeCloseTo(-90, 5)
    expect(posed!.rotation).toBe(90)
  })

  it('部件自身旋转叠加在关节旋转之上', () => {
    const rig = makeRig({
      attachments: [{ layerId: 'leg', jointId: 'chest', offsetX: 0, offsetY: 0, rotation: 30 }]
    })
    const [posed] = computeStage2dAttachmentTransforms(rig, { chest: 90 })
    expect(posed!.rotation).toBe(120)
  })
})

describe('createStage2dJoint', () => {
  it('补齐 name / 空 parentId，角度与坐标归一化', () => {
    const joint = createStage2dJoint({ id: 'hand', x: 12.4, y: -3, rotation: -450 })
    expect(joint).toMatchObject({ id: 'hand', name: 'hand', parentId: null })
    expect(joint.x).toBe(12.4)
    expect(joint.rotation).toBe(-90)
  })
})
