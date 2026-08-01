import { describe, expect, it } from 'vitest'
import {
  bezierPointAt,
  computeOrthogonalWorldPoints,
  computeTempEdgeScreen,
  hitTestEdges,
  nextGraphEdgePathStyle,
  parseGraphEdgePathStyle,
  type EdgeScreenGeometry
} from '../src/renderer/src/graph/edgeCanvas'

function makeEdge(
  id: string,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  pathStyle: 'curve' | 'orthogonal' = 'curve'
): EdgeScreenGeometry {
  const dx = Math.max(60, Math.abs(ex - sx) * 0.5)
  if (pathStyle === 'orthogonal') {
    const midX = (sx + ex) / 2
    const points =
      Math.abs(sy - ey) < 0.5
        ? [
            { x: sx, y: sy },
            { x: ex, y: ey }
          ]
        : [
            { x: sx, y: sy },
            { x: midX, y: sy },
            { x: midX, y: ey },
            { x: ex, y: ey }
          ]
    return {
      id,
      source: `${id}-src`,
      target: `${id}-dst`,
      pathStyle,
      points,
      sx,
      sy,
      c1x: points[1]?.x ?? sx,
      c1y: points[1]?.y ?? sy,
      c2x: points[points.length - 2]?.x ?? ex,
      c2y: points[points.length - 2]?.y ?? ey,
      ex,
      ey
    }
  }
  return {
    id,
    source: `${id}-src`,
    target: `${id}-dst`,
    pathStyle: 'curve',
    points: [
      { x: sx, y: sy },
      { x: ex, y: ey }
    ],
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

describe('parseGraphEdgePathStyle / nextGraphEdgePathStyle', () => {
  it('parses known styles and defaults to curve', () => {
    expect(parseGraphEdgePathStyle('orthogonal')).toBe('orthogonal')
    expect(parseGraphEdgePathStyle('hidden')).toBe('hidden')
    expect(parseGraphEdgePathStyle('straight')).toBe('orthogonal')
    expect(parseGraphEdgePathStyle('nope')).toBe('curve')
  })

  it('cycles curve → orthogonal → hidden → curve', () => {
    expect(nextGraphEdgePathStyle('curve')).toBe('orthogonal')
    expect(nextGraphEdgePathStyle('orthogonal')).toBe('hidden')
    expect(nextGraphEdgePathStyle('hidden')).toBe('curve')
  })
})

describe('computeOrthogonalWorldPoints', () => {
  it('uses a mid-X elbow when target is to the right', () => {
    const pts = computeOrthogonalWorldPoints({ x: 0, y: 0 }, { x: 200, y: 80 })
    expect(pts).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 200, y: 80 }
    ])
  })

  it('routes around when target is to the left', () => {
    const pts = computeOrthogonalWorldPoints({ x: 200, y: 0 }, { x: 0, y: 80 })
    expect(pts.length).toBeGreaterThanOrEqual(4)
    expect(pts[0]).toEqual({ x: 200, y: 0 })
    expect(pts[pts.length - 1]).toEqual({ x: 0, y: 80 })
    // 水平/垂直段
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1]!
      const b = pts[i]!
      expect(a.x === b.x || a.y === b.y).toBe(true)
    }
  })
})

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

  it('builds orthogonal screen polyline', () => {
    const temp = computeTempEdgeScreen(
      { x: 0, y: 0 },
      { x: 200, y: 80 },
      { x: 0, y: 0, zoom: 1 },
      'orthogonal'
    )
    expect(temp.pathStyle).toBe('orthogonal')
    expect(temp.points.length).toBe(4)
    expect(temp.points[0]).toEqual({ x: 0, y: 0 })
    expect(temp.points[3]).toEqual({ x: 200, y: 80 })
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

  it('hits orthogonal elbows on the vertical segment', () => {
    const ortho = makeEdge('o', 0, 0, 200, 80, 'orthogonal')
    // mid-X = 100，竖直段 x=100, y 0→80
    expect(hitTestEdges([ortho], 100, 40, 6)).toBe('o')
    expect(hitTestEdges([ortho], 140, 40, 6)).toBeNull()
  })
})
