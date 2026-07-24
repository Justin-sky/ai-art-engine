import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PORTRAIT_TEXTURE,
  buildPortraitTexturePrompt,
  normalizePortraitTexture,
  portraitTextureToNodePatch
} from '../src/shared/graph'

describe('portraitTexture', () => {
  it('defaults to middle options from screenshot', () => {
    expect(normalizePortraitTexture()).toEqual(DEFAULT_PORTRAIT_TEXTURE)
    expect(DEFAULT_PORTRAIT_TEXTURE).toMatchObject({
      personScene: 'natural',
      lightShadow: 'natural',
      skin: 'natural',
      texture: 'natural',
      sharpness: 'standard'
    })
  })

  it('builds prompt from selected options', () => {
    expect(buildPortraitTexturePrompt(DEFAULT_PORTRAIT_TEXTURE)).toBe(
      '人景自然融合，光影自然匹配，自然肤质，自然纹理，标准清晰'
    )
    expect(
      buildPortraitTexturePrompt({
        personScene: 'deep',
        lightShadow: 'atmosphere',
        skin: 'real',
        texture: 'grain',
        sharpness: 'hd'
      })
    ).toBe('人景深度融合，光影氛围强化，真实肌理肤质，颗粒质感纹理，高清锐化')
  })

  it('falls back invalid values to defaults', () => {
    const s = normalizePortraitTexture({
      personScene: 'nope' as never,
      sharpness: 'hd'
    })
    expect(s.personScene).toBe('natural')
    expect(s.sharpness).toBe('hd')
  })

  it('writes node patch', () => {
    const patch = portraitTextureToNodePatch(DEFAULT_PORTRAIT_TEXTURE)
    expect(patch.portraitTexturePrompt).toContain('自然肤质')
    expect(patch.portraitTexture.skin).toBe('natural')
  })
})
