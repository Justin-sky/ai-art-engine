import { describe, expect, it } from 'vitest'
import {
  cropTargetAspect,
  fitCropRectToAspect,
  normalizeImageCrop
} from '../src/shared/graph'

describe('imageCrop', () => {
  it('normalizes defaults', () => {
    expect(normalizeImageCrop()).toMatchObject({
      cropX: 0.1,
      cropY: 0.1,
      cropW: 0.8,
      cropH: 0.8,
      aspectId: 'original'
    })
  })

  it('clamps crop rect inside unit square', () => {
    const r = normalizeImageCrop({
      cropX: 0.9,
      cropY: 0.9,
      cropW: 0.5,
      cropH: 0.5
    })
    expect(r.cropX + r.cropW).toBeLessThanOrEqual(1.0001)
    expect(r.cropY + r.cropH).toBeLessThanOrEqual(1.0001)
  })

  it('fits rect to 16:9 on square source', () => {
    const fitted = fitCropRectToAspect(
      { cropX: 0.1, cropY: 0.1, cropW: 0.8, cropH: 0.8 },
      cropTargetAspect('16:9', 1)!,
      1
    )
    const pixelAspect = fitted.cropW / fitted.cropH
    expect(pixelAspect).toBeCloseTo(16 / 9, 2)
  })
})
