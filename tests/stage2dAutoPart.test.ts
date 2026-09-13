import { describe, expect, it } from 'vitest'
import {
  assignStage2dAutoPartRegion,
  eraseStage2dAutoPartSlot,
  partitionStage2dAutoPart,
  recomputeStage2dAutoPieces,
  extractAlphaPlane,
  type Stage2dAutoPartSlot
} from '../src/shared/gameAssets'

function filledAlpha(
  width: number,
  height: number,
  rects: Array<[number, number, number, number]>
): Uint8Array {
  const alpha = new Uint8Array(width * height)
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        alpha[y * width + x] = 255
      }
    }
  }
  return alpha
}

describe('partitionStage2dAutoPart：最近骨段像素归属切分', () => {
  it('空内容 / 无槽位 → 空结果', () => {
    const r0 = partitionStage2dAutoPart({
      width: 16,
      height: 16,
      alpha: new Uint8Array(256),
      slots: []
    })
    expect(r0.pieces).toEqual([])
    const r1 = partitionStage2dAutoPart({
      width: 16,
      height: 16,
      alpha: filledAlpha(16, 16, [[2, 2, 10, 10]]),
      slots: []
    })
    expect(r1.pieces).toEqual([])
    expect([...r1.assignment]).toEqual(new Array(256).fill(-1))
  })

  it('整幅内容归给唯一骨段槽，裁剪框 = 全部不透明像素外接框', () => {
    const alpha = filledAlpha(40, 40, [[10, 5, 30, 35]])
    const r = partitionStage2dAutoPart({
      width: 40,
      height: 40,
      alpha,
      slots: [
        {
          id: 'torso',
          name: '躯干',
          jointId: 'pelvis',
          polyline: [
            { x: 20, y: 20 },
            { x: 20, y: 10 }
          ]
        }
      ]
    })
    expect(r.pieces.length).toBe(1)
    expect(r.pieces[0]!.crop).toEqual({ x: 10, y: 5, width: 20, height: 30 })
    expect(r.pieces[0]!.pixelCount).toBe(20 * 30)
    expect(r.pieces[0]!.jointId).toBe('pelvis')
  })

  it('左右两块分属两条骨段，边界像素按最近段归属', () => {
    const width = 40
    const height = 30
    const alpha = filledAlpha(width, height, [
      [0, 0, 20, 30],
      [21, 0, 40, 30]
    ])
    const slots: Stage2dAutoPartSlot[] = [
      {
        id: 'armL',
        name: '左臂',
        jointId: 'shoulderL',
        polyline: [
          { x: 10, y: 15 },
          { x: 10, y: 29 }
        ]
      },
      {
        id: 'armR',
        name: '右臂',
        jointId: 'shoulderR',
        polyline: [
          { x: 30, y: 15 },
          { x: 30, y: 29 }
        ]
      }
    ]
    const r = partitionStage2dAutoPart({ width, height, alpha, slots })
    expect(r.pieces.length).toBe(2)
    // 第 0 列像素离左骨段最近 → 归左臂
    expect(r.pieces[0]!.id).toBe('armL')
    // 左块前 10 列全部是 armL
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < 10; x += 1) {
        expect(r.assignment[y * width + x]).toBe(0)
      }
    }
    // 右块倒数 10 列全部是 armR
    for (let y = 0; y < height; y += 1) {
      for (let x = 30; x < 40; x += 1) {
        expect(r.assignment[y * width + x]).toBe(1)
      }
    }
    // 裁框与像素数量自洽
    const total = r.pieces.reduce((sum, piece) => sum + piece.pixelCount, 0)
    expect(total).toBe(20 * 30 + 19 * 30)
  })

  it('枢轴 = 挂点关节（polyline 首点）位置并夹取回裁剪框', () => {
    const alpha = filledAlpha(50, 50, [[20, 0, 30, 30]])
    const r = partitionStage2dAutoPart({
      width: 50,
      height: 50,
      alpha,
      slots: [
        {
          id: 'head',
          name: '头',
          jointId: 'neck',
          polyline: [
            { x: 25, y: 30 },
            { x: 25, y: 15 }
          ]
        }
      ]
    })
    expect(r.pieces.length).toBe(1)
    expect(r.pieces[0]!.crop).toEqual({ x: 20, y: 0, width: 10, height: 30 })
    // neck 在内容 (25,30)，像素格下界 29.5：夹回裁剪框内最大行中心
    expect(r.pieces[0]!.pivot).toEqual({ x: 25, y: 29.5 })
  })

  it('alpha 阈值以下不算内容（稀疏抗锯齿残留丢弃）', () => {
    const width = 20
    const height = 20
    const alpha = new Uint8Array(width * height)
    alpha[5 * width + 5] = 3 // 低于阈值
    alpha[6 * width + 6] = 255
    const r = partitionStage2dAutoPart({
      width,
      height,
      alpha,
      alphaMin: 8,
      slots: [
        {
          id: 'torso',
          name: '躯干',
          jointId: 'pelvis',
          polyline: [
            { x: 6, y: 6 },
            { x: 6, y: 10 }
          ]
        }
      ]
    })
    expect(r.pieces.length).toBe(1)
    expect(r.pieces[0]!.crop).toEqual({ x: 6, y: 6, width: 1, height: 1 })
  })
})

describe('assignStage2dAutoPartRegion：框选改投 / 抠除', () => {
  /** 手工造一张带左右两槽的 assignment（左带 slot0、右带 slot1、中缝 -1） */
  function manualBands(width: number, height: number): Int32Array {
    const a = new Int32Array(width * height).fill(-1)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < 6; x += 1) a[y * width + x] = 0
      for (let x = width - 6; x < width; x += 1) a[y * width + x] = 1
    }
    return a
  }

  it('区域内像素改投目标槽，返回新数组且不改输入', () => {
    const width = 24
    const height = 20
    const assignment = manualBands(width, height)
    expect(assignment[0 * width + 0]).toBe(0)
    // 把右带（slot1）的一块投给左带（slot0），框边缘跨缝也无妨
    const next = assignStage2dAutoPartRegion({
      assignment,
      width,
      region: { x: 16, y: 2, width: 8, height: 4 },
      to: 0
    })
    // 输入不被修改
    expect(assignment[2 * width + 18]).toBe(1)
    // 区域内右带像素 1 → 0
    expect(next[2 * width + 18]).toBe(0)
    expect(next[2 * width + 23]).toBe(0)
    // 中缝 -1 不复活，区域外不受影响
    expect(next[2 * width + 16]).toBe(-1)
    expect(next[2 * width + 0]).toBe(0)
    expect(next[10 * width + 23]).toBe(1)
  })

  it('to=-1 抠除：区域内归属像素置透明，已透明像素不复活', () => {
    const width = 24
    const height = 20
    const assignment = manualBands(width, height)
    const next = assignStage2dAutoPartRegion({
      assignment,
      width,
      region: { x: 0, y: 0, width: 6, height: 20 },
      to: -1
    })
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < 6; x += 1) expect(next[y * width + x]).toBe(-1)
    }
    // 把已抠除区域试图投给其它槽也不会复活（cur === -1 保持）
    const back = assignStage2dAutoPartRegion({
      assignment: next,
      width,
      region: { x: 0, y: 0, width: 6, height: 20 },
      to: 1
    })
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < 6; x += 1) expect(back[y * width + x]).toBe(-1)
    }
  })

  it('越界区域自动夹取回画布', () => {
    const width = 24
    const height = 20
    const assignment = manualBands(width, height)
    const next = assignStage2dAutoPartRegion({
      assignment,
      width,
      region: { x: -4, y: -4, width: 10, height: 30 },
      to: 1
    })
    expect(next.length).toBe(width * height)
    // x<6 的左带前几列被越界框覆盖 → 投给了右带 slot1
    expect(next[0 * width + 0]).toBe(1)
    // 无内容的中缝仍为 -1（不复活）
    expect(next[0 * width + 10]).toBe(-1)
  })
})

describe('eraseStage2dAutoPartSlot：整槽擦除', () => {
  it('把某槽全部像素置 -1，其余槽保留', () => {
    const assignment = new Int32Array([0, 0, 1, 1, -1, 2])
    const next = eraseStage2dAutoPartSlot({ assignment, slot: 1 })
    expect([...next]).toEqual([0, 0, -1, -1, -1, 2])
    expect([...assignment]).toEqual([0, 0, 1, 1, -1, 2])
  })

  it('非法槽下标返回原值副本', () => {
    const assignment = new Int32Array([0, 1])
    expect([...eraseStage2dAutoPartSlot({ assignment, slot: -1 })]).toEqual([0, 1])
    expect([...eraseStage2dAutoPartSlot({ assignment, slot: Number.NaN })]).toEqual([0, 1])
  })
})

describe('recomputeStage2dAutoPieces：编辑后重算部件清单', () => {
  const slots: Stage2dAutoPartSlot[] = [
    {
      id: 'head',
      name: '头',
      jointId: 'neck',
      polyline: [
        { x: 10, y: 4 },
        { x: 10, y: 2 }
      ]
    },
    {
      id: 'torso',
      name: '躯干',
      jointId: 'pelvis',
      polyline: [
        { x: 10, y: 10 },
        { x: 10, y: 6 }
      ]
    }
  ]

  it('按最新 assignment 收敛裁剪框与像素数，并携带 slotIndex', () => {
    const width = 20
    const height = 20
    // 模拟编辑后的归属：头(head=0) y0..11、躯干(torso=1) y12..19，各 x8..11
    const edited = new Int32Array(width * height).fill(-1)
    for (let y = 0; y < 12; y += 1) {
      for (let x = 8; x < 12; x += 1) edited[y * width + x] = 0
    }
    for (let y = 12; y < 20; y += 1) {
      for (let x = 8; x < 12; x += 1) edited[y * width + x] = 1
    }
    const recomputed = recomputeStage2dAutoPieces({ width, height, assignment: edited, slots })
    expect(recomputed.pieces.length).toBe(2)
    expect(recomputed.pieces.find((p) => p.id === 'head')!.slotIndex).toBe(0)
    const head = recomputed.pieces.find((p) => p.id === 'head')
    expect(head).toBeDefined()
    expect(head!.crop).toEqual({ x: 8, y: 0, width: 4, height: 12 })
    expect(head!.pixelCount).toBe(4 * 12)
    // 枢轴 = head 挂点（neck，内容 {10,4}）夹回新裁剪框内
    expect(head!.pivot).toEqual({ x: 10, y: 4 })
  })

  it('整槽擦除后该槽从部件清单消失', () => {
    const width = 20
    const height = 20
    const alpha = filledAlpha(width, height, [
      [8, 0, 12, 8],
      [8, 8, 12, 20]
    ])
    const { assignment } = partitionStage2dAutoPart({ width, height, alpha, slots })
    const erased = eraseStage2dAutoPartSlot({ assignment, slot: 1 })
    const recomputed = recomputeStage2dAutoPieces({ width, height, assignment: erased, slots })
    expect(recomputed.pieces.length).toBe(1)
    expect(recomputed.pieces[0]!.id).toBe('head')
  })
})

describe('extractAlphaPlane：RGBA → alpha 单通道', () => {
  it('正常提取 a 通道', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 10, 0, 255, 0, 200])
    const plane = extractAlphaPlane(rgba, 2, 1)
    expect(plane).not.toBeNull()
    expect([...plane!]).toEqual([10, 200])
  })

  it('长度不足 / 非法尺寸返回 null', () => {
    expect(extractAlphaPlane(new Uint8Array(3), 2, 1)).toBeNull()
    expect(extractAlphaPlane(new Uint8Array(100), 0, 5)).toBeNull()
  })
})
