import { describe, expect, it } from 'vitest'
import {
  buildStage2dSpineAtlasText,
  buildStage2dSpineData,
  normalizeStage2dRig,
  stage2dSpineSafeName,
  type Stage2dRig
} from '../src/shared/gameAssets'

/** 根(0,0) → chest 上 100 → armL 右 50 的三关节绑定姿势 */
function makeRig(overrides?: Partial<Stage2dRig>): Stage2dRig {
  return normalizeStage2dRig({
    root: { x: 0, y: 0 },
    joints: [
      { id: 'hip', name: 'hip', parentId: null, x: 0, y: 0, rotation: 0 },
      { id: 'chest', name: 'chest', parentId: 'hip', x: 0, y: -100, rotation: 0 },
      { id: 'armL', name: 'armL', parentId: 'chest', x: 50, y: 0, rotation: 0 }
    ],
    attachments: [{ layerId: 'leg', jointId: 'chest', offsetX: 10, offsetY: 0, rotation: 0 }],
    ...overrides
  })
}

const boneByName = (skeleton: Record<string, unknown>, name: string): Record<string, unknown> => {
  const bones = skeleton.bones as Array<Record<string, unknown>>
  const found = bones.find((b) => b.name === name)
  expect(found, `bone ${name} should exist`).toBeTruthy()
  return found as Record<string, unknown>
}

describe('stage2dSpineSafeName：spine 标识符安全化', () => {
  it('保留 ASCII 字母数字与下划线，替换其余字符', () => {
    expect(stage2dSpineSafeName('head-01')).toBe('head-01')
    expect(stage2dSpineSafeName('Head Part_2')).toBe('Head_Part_2')
    expect(stage2dSpineSafeName('腿部')).toBe('p')
    expect(stage2dSpineSafeName('', 'fallback')).toBe('fallback')
    expect(stage2dSpineSafeName(undefined)).toBe('part')
  })
})

describe('buildStage2dSpineData：关节与坐标翻转换算', () => {
  it('bones：root 承载根锚点、关节挂 root / 父关节、y 取反', () => {
    const rig = makeRig({ root: { x: 40, y: 80 } })
    const { skeleton } = buildStage2dSpineData({ rig, parts: [] })
    const bones = skeleton.bones as Array<Record<string, unknown>>
    // root + 3 关节；无部件 → 无 attach 骨
    expect(bones).toHaveLength(4)
    expect(boneByName(skeleton, 'root').y).toBe(-80)
    const hip = boneByName(skeleton, 'hip')
    expect(hip.parent).toBe('root')
    const chest = boneByName(skeleton, 'chest')
    expect(chest.parent).toBe('hip')
    // y-down 上 100 → spine y-up 上 100（取反后为 +100）
    expect(chest.x).toBe(0)
    expect(chest.y).toBe(100)
  })

  it('pose 并入 setup：spine 关节旋转为 bind+pose 的相反数', () => {
    const rig = makeRig({
      joints: [
        { id: 'chest', name: 'chest', parentId: null, x: 0, y: 0, rotation: 90 },
        { id: 'elbow', name: 'elbow', parentId: 'chest', x: 0, y: -50, rotation: -20 }
      ]
    })
    const { skeleton } = buildStage2dSpineData({
      rig,
      pose: { chest: 30, elbow: -10 },
      parts: []
    })
    expect(boneByName(skeleton, 'chest').rotation as number).toBe(-120)
    expect(boneByName(skeleton, 'elbow').rotation as number).toBe(30)
  })

  it('绑定姿势为 0 时省略 rotation 字段', () => {
    const { skeleton } = buildStage2dSpineData({ rig: makeRig(), parts: [] })
    expect(boneByName(skeleton, 'hip').rotation).toBeUndefined()
  })

  it('顶层结构：skeleton/bones/slots/skins/animations 齐备', () => {
    const { skeleton } = buildStage2dSpineData({ rig: makeRig(), parts: [] })
    expect((skeleton.skeleton as Record<string, unknown>).spine).toBe('3.8.99')
    expect(Array.isArray(skeleton.slots)).toBe(true)
    expect(Array.isArray(skeleton.skins)).toBe(true)
    expect(Array.isArray(skeleton.animations)).toBe(false)
    expect(skeleton.animations).toEqual({})
  })

  it('确定性：同一入参两次产出相同 hash', () => {
    const a = buildStage2dSpineData({ rig: makeRig(), parts: [], meta: { name: 'hero' } })
    const b = buildStage2dSpineData({ rig: makeRig(), parts: [], meta: { name: 'hero' } })
    expect(a.skeleton.hash).toBe(b.skeleton.hash)
  })
})

describe('buildStage2dSpineData：部件挂点 → attach 骨 + 槽 + region', () => {
  const parts = [
    {
      layerId: 'leg',
      name: 'leg',
      jointId: 'chest',
      anchor: 'ground' as const,
      dstWidth: 60,
      dstHeight: 120,
      offsetX: 10,
      offsetY: -5,
      rotation: 0
    },
    {
      layerId: 'head',
      name: 'head',
      jointId: 'armL',
      anchor: 'center' as const,
      dstWidth: 40,
      dstHeight: 40,
      offsetX: 0,
      offsetY: 0,
      rotation: 25
    }
  ]

  it('每个部件生成 attach 子骨并挂到关节，y 翻转、旋转取反', () => {
    const { skeleton } = buildStage2dSpineData({ rig: makeRig(), parts })
    const leg = boneByName(skeleton, 'attach_leg')
    expect(leg.parent).toBe('chest')
    expect(leg.x).toBe(10)
    expect(leg.y).toBe(5) // -(-5)
    expect(leg.rotation).toBeUndefined()
    const head = boneByName(skeleton, 'attach_head')
    expect(head.parent).toBe('armL')
    expect(head.x).toBe(0)
    expect(head.y).toBe(0)
    expect(head.rotation).toBe(-25)
  })

  it('slots 挂在 attach 骨上，默认 attachment 指向同名 region', () => {
    const { skeleton } = buildStage2dSpineData({ rig: makeRig(), parts })
    const slots = skeleton.slots as Array<Record<string, unknown>>
    expect(slots).toHaveLength(2)
    const legSlot = slots.find((s) => s.name === 'leg')
    expect(legSlot?.bone).toBe('attach_leg')
  })

  it('region 几何：ground 中心上移半高、center 即原点；尺寸=部件页', () => {
    const { skeleton, pages } = buildStage2dSpineData({ rig: makeRig(), parts })
    const skins = skeleton.skins as Array<Record<string, unknown>>
    const attachments = (skins[0]?.attachments ?? {}) as Record<string, Record<string, unknown>>
    const legRegion = attachments.leg?.leg as Record<string, unknown>
    expect(legRegion.x).toBe(0)
    expect(legRegion.y).toBe(60) // 120 / 2
    expect(legRegion.width).toBe(60)
    expect(legRegion.height).toBe(120)
    const headRegion = attachments.head?.head as Record<string, unknown>
    expect(headRegion.y).toBe(0)
    // pages 元数据与 region 对应
    const legPage = pages.find((p) => p.slotName === 'leg')
    expect(legPage?.pageWidth).toBe(60)
    expect(legPage?.pageHeight).toBe(120)
    expect(legPage?.attachBone).toBe('attach_leg')
  })

  it('部件名冲突自动加后缀去重（槽名在 spine 内唯一）', () => {
    const dup = [
      { ...parts[0], layerId: 'leg', name: 'leg' },
      { ...parts[0], layerId: 'leg2', name: 'leg' }
    ]
    const { skeleton } = buildStage2dSpineData({ rig: makeRig(), parts: dup })
    const slots = skeleton.slots as Array<Record<string, unknown>>
    expect(slots.map((s) => s.name).sort()).toEqual(['leg', 'leg-2'])
  })

  it('过滤：关节不存在 / 尺寸非法 / 空部件不产出', () => {
    const bad = [
      { ...parts[0], jointId: 'ghost' },
      { ...parts[0], dstWidth: 0 },
      { ...parts[0], dstHeight: Number.NaN }
    ]
    const { skeleton, pages } = buildStage2dSpineData({ rig: makeRig(), parts: bad })
    expect(pages).toHaveLength(0)
    expect(skeleton.slots).toHaveLength(0)
    // root + 3 关节，无 attach 骨
    expect(skeleton.bones).toHaveLength(4)
  })
})

describe('buildStage2dSpineAtlasText：atlas 文本', () => {
  it('每部件一页，含文件名 / 尺寸 / region', () => {
    const text = buildStage2dSpineAtlasText({
      pages: [
        { fileName: 'hero-leg.png', slotName: 'leg', width: 60, height: 120 },
        { fileName: 'hero-head.png', slotName: 'head', width: 40, height: 40 }
      ]
    })
    expect(text).toContain('hero-leg.png')
    expect(text).toContain('size: 60, 120')
    expect(text).toContain('hero-head.png')
    expect(text).toMatch(/\nleg\n  rotate: false/)
  })
})
