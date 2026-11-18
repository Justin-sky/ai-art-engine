import { describe, expect, it } from 'vitest'
import type { GraphNode } from '@shared/graph'
import {
  DEFAULT_MINIMAP_INSET,
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

  it('covers nodes with min size and keeps single-node center symmetric', () => {
    const b = resolveMinimapWorldBounds([node('a', 100, 200, 200, 120)], 0)
    expect(b.x).toBeLessThanOrEqual(100)
    expect(b.y).toBeLessThanOrEqual(200)
    expect(b.w).toBe(400)
    expect(b.h).toBe(300)
    expect(b.x + b.w / 2).toBeCloseTo(200, 5)
    expect(b.y + b.h / 2).toBeCloseTo(260, 5)
  })
})

describe('minimap transform mapping', () => {
  it('round-trips world ↔ minimap at center with default inset', () => {
    const world = { x: -200, y: -150, w: 1000, h: 800 }
    const t = computeMinimapTransform(world, 180, 120)
    const mid = { x: 300, y: 250 }
    const map = worldToMinimap(mid.x, mid.y, t)
    expect(map.x).toBeCloseTo(90, 5)
    expect(map.y).toBeCloseTo(60, 5)
    const back = minimapToWorld(map.x, map.y, t)
    expect(back.x).toBeCloseTo(mid.x, 5)
    expect(back.y).toBeCloseTo(mid.y, 5)
  })

  it('centers wide content vertically and respects inset', () => {
    const world = { x: 0, y: 0, w: 1000, h: 500 }
    const t = computeMinimapTransform(world, 200, 200, 10)
    const origin = worldToMinimap(0, 0, t)
    const far = worldToMinimap(1000, 500, t)
    expect(origin.x).toBeCloseTo(10, 5)
    expect(far.x).toBeCloseTo(190, 5)
    expect(origin.y).toBeCloseTo(55, 5)
    expect(far.y).toBeCloseTo(145, 5)
  })

  it('centers tall narrow column horizontally instead of sticking to left edge', () => {
    const tallNodes = Array.from({ length: 30 }, (_, i) => node(`sfx-${i}`, 100, i * 280, 260, 220))
    const world = resolveMinimapWorldBounds(tallNodes)
    const t = computeMinimapTransform(world, 180, 120)
    const topLeft = worldToMinimap(world.x, world.y, t)
    const bottomRight = worldToMinimap(world.x + world.w, world.y + world.h, t)
    expect(topLeft.y).toBeCloseTo(DEFAULT_MINIMAP_INSET, 5)
    expect(bottomRight.y).toBeCloseTo(120 - DEFAULT_MINIMAP_INSET, 5)
    // Horizontally centered around x = 90 rather than glued to x = 0
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(90, 5)
    expect(topLeft.x).toBeGreaterThan(60)
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
