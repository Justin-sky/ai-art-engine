import { describe, expect, it } from 'vitest'
import {
  buildMatteUserPrompt,
  hasMatteMask,
  normalizeImageMatte
} from '../src/shared/graph'

describe('imageMatte', () => {
  it('normalizes defaults', () => {
    expect(normalizeImageMatte()).toMatchObject({
      maskDataUrl: '',
      prompt: '',
      brushSize: 28,
      aspectId: 'original',
      resolution: '2K',
      count: 1
    })
  })

  it('builds auto cutout prompt without mask', () => {
    const p = buildMatteUserPrompt(normalizeImageMatte({ prompt: 'keep the woman' }))
    expect(hasMatteMask(normalizeImageMatte())).toBe(false)
    expect(p).toContain('Remove the background')
    expect(p).toContain('keep the woman')
    expect(p).toContain('transparent')
  })

  it('builds keep-mask prompt when mask present', () => {
    const state = normalizeImageMatte({
      maskDataUrl: 'data:image/png;base64,aaa',
      prompt: 'hair detail'
    })
    expect(hasMatteMask(state)).toBe(true)
    const p = buildMatteUserPrompt(state)
    expect(p).toContain('masked (white)')
    expect(p).toContain('hair detail')
    expect(p).not.toContain('Remove the background and cut out the main subject automatically')
  })
})
