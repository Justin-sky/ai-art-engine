import { describe, expect, it } from 'vitest'
import {
  bezierPointAt,
  computeTempEdgeScreen,
  hitTestEdges,
  type EdgeScreenGeometry
} from '../src/renderer/src/graph/edgeCanvas'

function makeEdge(
  id: string,
  sx: number,
  sy: number,
  ex: number,
  ey: number
): EdgeScreenGeometry {
  const dx = Math.max(60, Math.abs(ex - sx) * 0.5)
  return {
    id,
    source: `${id}-src`,
    target: `${id}-dst`,
    sx,
    sy,
    c1x: sx + dx,
    c1y: sy,
    c2x: ex - dx,
    c2y: ey,
    ex,
    ey
  }
}

describe('computeTempEdgeScreen', () => {
  it('maps world coordinates to screen using viewport transform', () => {
    const temp = computeTempEdgeScreen(
      { x: 100, y: 50 },
      { x: 300, y: 250 },
      { x: 20, y: 10, zoom: 2 }
    )
    // screen = world * zoom + offset
    expect(temp.sx).toBe(100 * 2 + 20)
    expect(temp.sy).toBe(50 * 2 + 10)
    expect(temp.ex).toBe(300 * 2 + 20)
    expect(temp.ey).toBe(250 * 2 + 10)
    // 控制点水平外扩，纵向与端点保持一致
    expect(temp.c1y).toBe(temp.sy)
    expect(temp.c2y).toBe(temp.ey)
    expect(temp.c1x).toBeGreaterThan(temp.sx)
    expect(temp.c2x).toBeLessThan(temp.ex)
  })
})

describe('bezierPointAt', () => {
  it('returns endpoints at t=0 and t=1', () => {
    const g = makeEdge('e', 0, 0, 200, 100)
    const start = bezierPointAt(g, 0)
    const end = bezierPointAt(g, 1)
    expect(start).toEqual({ x: 0, y: 0 })
    expect(end).toEqual({ x: 200, y: 100 })
  })

  it('stays within the bounding box of the control polygon', () => {
    const g = makeEdge('e', 0, 0, 200, 100)
    for (let i = 0; i <= 10; i += 1) {
      const p = bezierPointAt(g, i / 10)
      expect(p.x).toBeGreaterThanOrEqual(-0.001)
      expect(p.x).toBeLessThanOrEqual(200.001)
      expect(p.y).toBeGreaterThanOrEqual(-0.001)
      expect(p.y).toBeLessThanOrEqual(100.001)
    }
  })
})

describe('hitTestEdges', () => {
  const horizontal = makeEdge('h', 0, 100, 400, 100)

  it('hits a point near the curve within tolerance', () => {
    // 曲线在中点附近 y≈100，取一点略微偏离
    expect(hitTestEdges([horizontal], 200, 103, 8)).toBe('h')
  })

  it('misses a point far from the curve', () => {
    expect(hitTestEdges([horizontal], 200, 140, 8)).toBeNull()
  })

  it('picks the nearest edge when several are candidates', () => {
    const near = makeEdge('near', 0, 100, 400, 100)
    const far = makeEdge('far', 0, 130, 400, 130)
    // 点更靠近 near
    expect(hitTestEdges([far, near], 200, 101, 20)).toBe('near')
  })

  it('respects a larger tolerance for zoomed-in curves', () => {
    expect(hitTestEdges([horizontal], 200, 110, 6)).toBeNull()
    expect(hitTestEdges([horizontal], 200, 110, 14)).toBe('h')
  })
})
