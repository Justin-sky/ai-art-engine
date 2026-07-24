import { describe, expect, it } from 'vitest'
import {
  buildUpscalePrompt,
  normalizeImageUpscale,
  upscaleScaleToResolution
} from '../src/shared/graph'

describe('imageUpscale', () => {
  it('normalizes defaults and invalid values', () => {
    expect(normalizeImageUpscale()).toEqual({
      engineId: 'imageApi',
      variantId: 'general',
      scale: 2
    })
    expect(normalizeImageUpscale({ scale: 9 as never })).toEqual({
      engineId: 'imageApi',
      variantId: 'general',
      scale: 2
    })
    // 旧图若存过 topaz，归一化为图片模型
    expect(normalizeImageUpscale({ engineId: 'topaz' as never })).toEqual({
      engineId: 'imageApi',
      variantId: 'general',
      scale: 2
    })
  })

  it('maps scale to resolution tiers', () => {
    expect(upscaleScaleToResolution(2)).toBe('2K')
    expect(upscaleScaleToResolution(4)).toBe('4K')
    expect(upscaleScaleToResolution(6)).toBe('4K')
  })

  it('builds prompt with scale and variant', () => {
    const p = buildUpscalePrompt({
      variantId: 'portrait',
      scale: 4
    })
    expect(p).toContain('4x')
    expect(p).toContain('portrait')
    expect(p).toContain('AI image upscaling')
    expect(p).not.toContain('Topaz')
  })
})
