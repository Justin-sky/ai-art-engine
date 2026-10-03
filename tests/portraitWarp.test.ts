import { describe, expect, it } from 'vitest'
import {
  buildWarpMesh,
  isWarpMeshIdentity,
  liquifyControlsFromStrokes,
  sampleWarpMesh,
  warpImage,
  warpPoints,
  type WarpControl
} from '../src/shared/media/portrait/warp'
import { createRng, type RgbaImage } from '../src/shared/media/portrait/kernels'

/**
 * 网格变形（src/shared/media/portrait/warp.ts）。
 *
 * 液化/五官/身形全靠它，所以锁三件事：
 * 1. 无控制点 = 恒等（绝不能悄悄重采样一遍把图糊掉）；
 * 2. 位移方向与语义一致（推、膨胀、收缩）；
 * 3. 关键点用同一网格移动（否则后续蒙版与脸对不上，这是最容易出的错位 bug）。
 */

function noiseImage(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  const rng = createRng(3)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rng() * 255
    data[i + 1] = rng() * 255
    data[i + 2] = rng() * 255
    data[i + 3] = 255
  }
  return { data, width, height }
}

describe('portrait warp', () => {
  it('无控制点时网格恒等，且不重采样', () => {
    const mesh = buildWarpMesh([], 8, 8, 1)
    expect(isWarpMeshIdentity(mesh)).toBe(true)
    const image = noiseImage(24, 24)
    const out = warpImage(image, mesh)
    expect(Array.from(out.data)).toEqual(Array.from(image.data))
  })

  it('单点推拉在控制点处给出预期位移', () => {
    const control: WarpControl = { x: 0.5, y: 0.5, dx: 0.08, dy: -0.04, radius: 0.4 }
    const mesh = buildWarpMesh([control], 3, 3, 1)
    // 3×3 网格的 (1,1) 节点正好落在 (0.5,0.5)
    const [dx, dy] = sampleWarpMesh(mesh, 0.5, 0.5)
    expect(dx).toBeCloseTo(0.08, 5)
    expect(dy).toBeCloseTo(-0.04, 5)
    // 半径之外不受影响
    const [farX, farY] = sampleWarpMesh(mesh, 1, 1)
    expect(Math.abs(farX)).toBeLessThan(0.01)
    expect(Math.abs(farY)).toBeLessThan(0.01)
  })

  it('径向控制点：膨胀向外、收缩向内', () => {
    const bloat = buildWarpMesh(
      [{ x: 0.5, y: 0.5, dx: 0, dy: 0, radius: 0.6, radial: 0.05 }],
      5,
      5,
      1
    )
    const [bx] = sampleWarpMesh(bloat, 0.75, 0.5)
    expect(bx).toBeGreaterThan(0)
    const pinch = buildWarpMesh(
      [{ x: 0.5, y: 0.5, dx: 0, dy: 0, radius: 0.6, radial: -0.05 }],
      5,
      5,
      1
    )
    const [px] = sampleWarpMesh(pinch, 0.75, 0.5)
    expect(px).toBeLessThan(0)
  })

  it('多控制点重叠时做加权归一，不叠加爆炸', () => {
    const controls: WarpControl[] = [
      { x: 0.5, y: 0.5, dx: 0.1, dy: 0, radius: 0.5 },
      { x: 0.5, y: 0.5, dx: 0.1, dy: 0, radius: 0.5 }
    ]
    const mesh = buildWarpMesh(controls, 3, 3, 1)
    const [dx] = sampleWarpMesh(mesh, 0.5, 0.5)
    expect(dx).toBeLessThanOrEqual(0.1 + 1e-6)
    expect(dx).toBeGreaterThan(0.05)
  })

  it('warpImage 真的改变画面，warpPoints 用同一网格', () => {
    const image = noiseImage(32, 32)
    // 3×3 网格的节点正好落在 (0.5,0.5)，位移可精确断言
    const mesh = buildWarpMesh([{ x: 0.5, y: 0.5, dx: 0.12, dy: 0, radius: 0.5 }], 3, 3, 1)
    const warped = warpImage(image, mesh)
    expect(Array.from(warped.data)).not.toEqual(Array.from(image.data))
    const [moved] = warpPoints([[0.5, 0.5]], mesh)
    expect(moved[0]).toBeCloseTo(0.62, 4)
    expect(moved[1]).toBeCloseTo(0.5, 4)
  })

  it('液化笔画 → 控制点：推拉带位移、膨胀收缩带径向、还原被跳过', () => {
    const push = liquifyControlsFromStrokes([
      {
        mode: 'push',
        size: 0.2,
        strength: 50,
        points: [{ x: 0.5, y: 0.5, dx: 0.1, dy: 0 }]
      }
    ])
    expect(push).toHaveLength(1)
    expect(push[0].dx).toBeCloseTo(0.05, 6)
    expect(push[0].radius).toBeCloseTo(0.1, 6)

    const bloat = liquifyControlsFromStrokes([
      { mode: 'bloat', size: 0.2, strength: 100, points: [{ x: 0.5, y: 0.5 }] }
    ])
    expect(bloat[0].radial).toBeGreaterThan(0)

    const pinch = liquifyControlsFromStrokes([
      { mode: 'pinch', size: 0.2, strength: 100, points: [{ x: 0.5, y: 0.5 }] }
    ])
    expect(pinch[0].radial).toBeLessThan(0)

    const restore = liquifyControlsFromStrokes([
      { mode: 'restore', size: 0.2, strength: 100, points: [{ x: 0.5, y: 0.5 }] }
    ])
    expect(restore).toHaveLength(0)

    // push 但没有位移（只是点了一下）→ 不产生控制点
    expect(
      liquifyControlsFromStrokes([
        { mode: 'push', size: 0.2, strength: 100, points: [{ x: 0.5, y: 0.5 }] }
      ])
    ).toHaveLength(0)
  })
})
