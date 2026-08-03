import { describe, expect, it } from 'vitest'
import type { GraphNode } from '@shared/graph'
import {
  computeMinimapTransform,
  minimapToWorld,
  resolveMinimapWorldBounds,
  viewportWorldRect,
  worldToMinimap
} from '../src/renderer/src/graph/minimapGeometry'

function node(id: string, x: number, y: number, w = 200, h = 120): GraphNode {
  return {
    id,
    typeId: 'note.text',
    category: 'note',
    title: id,
    position: { x, y },
    size: { w, h },
    params: {}
  } as GraphNode
}

describe('resolveMinimapWorldBounds', () => {
  it('falls back when empty', () => {
    const b = resolveMinimapWorldBounds([])
    expect(b.w).toBeGreaterThan(0)
    expect(b.h).toBeGreaterThan(0)
  })

  it('covers nodes with padding and min size', () => {
    const b = resolveMinimapWorldBounds([node('a', 100, 200)], 0)
    expect(b.x).toBeLessThanOrEqual(100)
    expect(b.y).toBeLessThanOrEqual(200)
    expect(b.w).toBeGreaterThanOrEqual(400)
    expect(b.h).toBeGreaterThanOrEqual(300)
  })
})

describe('minimap transform mapping', () => {
  it('round-trips world ↔ minimap at center', () => {
    const world = { x: 0, y: 0, w: 1000, h: 800 }
    const t = computeMinimapTransform(world, 180, 120, 0)
    const mid = { x: 500, y: 400 }
    const map = worldToMinimap(mid.x, mid.y, t)
    const back = minimapToWorld(map.x, map.y, t)
    expect(back.x).toBeCloseTo(mid.x, 5)
    expect(back.y).toBeCloseTo(mid.y, 5)
  })

  it('aligns content to bottom-left (no left/bottom inset)', () => {
    const world = { x: 0, y: 0, w: 1000, h: 500 }
    const t = computeMinimapTransform(world, 200, 200, 0)
    const origin = worldToMinimap(0, 0, t)
    const far = worldToMinimap(1000, 500, t)
    expect(origin.x).toBeCloseTo(0, 5)
    expect(far.y).toBeCloseTo(200, 5)
    expect(origin.y).toBeLessThanOrEqual(far.y)
  })
})

describe('viewportWorldRect', () => {
  it('maps screen viewport into world space', () => {
    const rect = viewportWorldRect({ x: 100, y: 50, zoom: 2 }, 400, 300)
    expect(rect.left).toBeCloseTo((0 - 100) / 2)
    expect(rect.top).toBeCloseTo((0 - 50) / 2)
    expect(rect.right).toBeCloseTo((400 - 100) / 2)
    expect(rect.bottom).toBeCloseTo((300 - 50) / 2)
  })
})
