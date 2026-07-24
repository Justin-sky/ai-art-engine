import { describe, expect, it } from 'vitest'
import {
  buildRedrawUserPrompt,
  clampRedrawParamsToCapabilities,
  hasRedrawMask,
  normalizeImageRedraw
} from '../src/shared/graph'

describe('imageRedraw', () => {
  it('normalizes defaults', () => {
    expect(normalizeImageRedraw()).toMatchObject({
      maskDataUrl: '',
      prompt: '',
      brushSize: 28,
      aspectId: 'original',
      resolution: '2K',
      count: 1
    })
  })

  it('clamps brush size', () => {
    expect(normalizeImageRedraw({ brushSize: 1 }).brushSize).toBe(4)
    expect(normalizeImageRedraw({ brushSize: 999 }).brushSize).toBe(120)
  })

  it('detects mask presence', () => {
    expect(hasRedrawMask(normalizeImageRedraw())).toBe(false)
    expect(
      hasRedrawMask(normalizeImageRedraw({ maskDataUrl: 'data:image/png;base64,aaa' }))
    ).toBe(true)
  })

  it('clamps params to capabilities', () => {
    const clamped = clampRedrawParamsToCapabilities(
      normalizeImageRedraw({ aspectId: '21:9', resolution: '8K', count: 9 }),
      {
        aspectRatios: ['1:1', '16:9'],
        resolutions: ['1K', '2K'],
        counts: [1, 2]
      }
    )
    expect(clamped.aspectId).toBe('original')
    expect(clamped.resolution).toBe('2K')
    expect(clamped.count).toBe(1)
  })

  it('builds inpaint prompt with user text', () => {
    const p = buildRedrawUserPrompt(
      normalizeImageRedraw({ prompt: 'change scarf to red' })
    )
    expect(p).toContain('Inpaint')
    expect(p).toContain('change scarf to red')
  })
})
