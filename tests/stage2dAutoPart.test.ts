import { describe, expect, it } from 'vitest'
import {
  partitionStage2dAutoPart,
  extractAlphaPlane,
  type Stage2dAutoPartSlot
} from '../src/shared/gameAssets'

function filledAlpha(width: number, height: number, rects: Array<[number, number, number, number]>): Uint8Array {
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
      { id: 'armL', name: '左臂', jointId: 'shoulderL', polyline: [{ x: 10, y: 15 }, { x: 10, y: 29 }] },
      { id: 'armR', name: '右臂', jointId: 'shoulderR', polyline: [{ x: 30, y: 15 }, { x: 30, y: 29 }] }
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
        { id: 'torso', name: '躯干', jointId: 'pelvis', polyline: [{ x: 6, y: 6 }, { x: 6, y: 10 }] }
      ]
    })
    expect(r.pieces.length).toBe(1)
    expect(r.pieces[0]!.crop).toEqual({ x: 6, y: 6, width: 1, height: 1 })
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
