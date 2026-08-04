import { describe, expect, it } from 'vitest'
import {
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
})
