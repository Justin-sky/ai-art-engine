import { describe, expect, it } from 'vitest'
import {
  buildPortraitQualityPrompt,
  DEFAULT_PORTRAIT_QUALITY,
  normalizePortraitQuality,
  portraitQualityToNodePatch,
  readPortraitQualityFromNode
} from '../src/shared/graph'

describe('portraitQuality', () => {
  it('clamps out-of-range values', () => {
    const state = normalizePortraitQuality({ skinSmoothing: 999, colorTemp: -999 })
    expect(state.skinSmoothing).toBe(100)
    expect(state.colorTemp).toBe(-100)
  })

  it('builds a non-empty structured prompt for defaults', () => {
    const prompt = buildPortraitQualityPrompt(DEFAULT_PORTRAIT_QUALITY)
    expect(prompt.main.length).toBeGreaterThan(0)
    expect(prompt.main).toContain('人景自然融合')
  })

  it('migrates legacy portraitTexture into continuous params', () => {
    const state = readPortraitQualityFromNode({
      portraitTexture: {
        personScene: 'deep',
        skin: 'clear',
        sharpness: 'hd'
      }
    })
    expect(state.personSceneBlend).toBe(75)
    expect(state.skinSmoothing).toBe(55)
    expect(state.sharpness).toBe(80)
  })

  it('persists quality params and prompt', () => {
    const patch = portraitQualityToNodePatch({ ...DEFAULT_PORTRAIT_QUALITY, skinSmoothing: 80 })
    expect(patch.portraitQuality.skinSmoothing).toBe(80)
    expect(patch.portraitQualityPrompt.length).toBeGreaterThan(0)
  })
})
