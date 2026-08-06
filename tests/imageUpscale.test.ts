import { describe, expect, it } from 'vitest'
import {
  buildUpscalePrompt,
  normalizeImageUpscale,
  resolveUpscaleInstruction,
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

  it('prefers explicit instruction over generated prompt', () => {
    expect(
      resolveUpscaleInstruction('请放大到 4K', normalizeImageUpscale({ scale: 2 }), 'zh-CN')
    ).toBe('请放大到 4K')
  })

  it('falls back to generated prompt when instruction is empty', () => {
    const state = normalizeImageUpscale({ scale: 4 })
    const prompt = resolveUpscaleInstruction('', state)
    expect(prompt).toContain('4x')
    expect(prompt).toBe(buildUpscalePrompt(state))
  })
})
