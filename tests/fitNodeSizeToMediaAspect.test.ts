import { describe, expect, it } from 'vitest'
import {
  cardImageGridCols,
  cardImageGridMediaSize,
  createNodeFromType,
  fitNodeSizeToMediaAspect,
  getNodeDefaultSize
} from '../src/shared/graph'

describe('fitNodeSizeToMediaAspect', () => {
  it('makes landscape nodes wider than tall', () => {
    const node = createNodeFromType('asset.image', { x: 0, y: 0 })
    const size = fitNodeSizeToMediaAspect(node, 1920, 1080)
    expect(size.w).toBeGreaterThan(size.h)
    expect(size.w / size.h).toBeCloseTo(16 / 9, 1)
  })

  it('makes portrait nodes taller than wide', () => {
    const node = createNodeFromType('asset.video', { x: 0, y: 0 })
    const size = fitNodeSizeToMediaAspect(node, 1080, 1920)
    expect(size.h).toBeGreaterThan(size.w)
    expect(size.h / size.w).toBeCloseTo(16 / 9, 1)
  })

  it('stays within default size limits', () => {
    const node = createNodeFromType('asset.image', { x: 0, y: 0 })
    const size = fitNodeSizeToMediaAspect(node, 8000, 200)
    expect(size.w).toBeLessThanOrEqual(480)
    expect(size.h).toBeGreaterThanOrEqual(72)
  })

  it('falls back to current size when media dims invalid', () => {
    const node = createNodeFromType('asset.image', { x: 0, y: 0 })
    const def = getNodeDefaultSize('asset.image')
    expect(fitNodeSizeToMediaAspect(node, 0, 100)).toEqual(def)
  })

  it('fits 2-column card grid wider than a single landscape image', () => {
    const node = createNodeFromType('asset.image', { x: 0, y: 0 })
    const single = fitNodeSizeToMediaAspect(node, 1920, 1080)
    const gridMedia = cardImageGridMediaSize(2, 1920, 1080, 2)
    expect(gridMedia).toEqual({ w: 3840, h: 1080 })
    const grid = fitNodeSizeToMediaAspect(node, gridMedia.w, gridMedia.h)
    // 两张横图并排：节点应更扁（更宽或更矮），避免格子上下黑边
    expect(grid.w / grid.h).toBeGreaterThan(single.w / single.h)
  })
})

describe('cardImageGridCols', () => {
  it('uses square matrix side length', () => {
    expect(cardImageGridCols(2)).toBe(2)
    expect(cardImageGridCols(3)).toBe(2)
    expect(cardImageGridCols(4)).toBe(2)
    expect(cardImageGridCols(5)).toBe(3)
    expect(cardImageGridCols(9)).toBe(3)
    expect(cardImageGridCols(16)).toBe(4)
  })
})

describe('cardImageGridMediaSize', () => {
  it('defaults to square matrix columns', () => {
    expect(cardImageGridMediaSize(3, 100, 50)).toEqual({ w: 200, h: 100 })
    expect(cardImageGridMediaSize(4, 100, 50)).toEqual({ w: 200, h: 100 })
    expect(cardImageGridMediaSize(9, 100, 50)).toEqual({ w: 300, h: 150 })
  })

  it('honors explicit columns', () => {
    expect(cardImageGridMediaSize(3, 100, 50, 2)).toEqual({ w: 200, h: 100 })
  })
})
