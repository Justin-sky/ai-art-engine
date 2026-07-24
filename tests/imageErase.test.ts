import { describe, expect, it } from 'vitest'
import { buildEraseUserPrompt, normalizeImageErase } from '../src/shared/graph'

describe('imageErase', () => {
  it('normalizes like redraw mask state', () => {
    expect(normalizeImageErase()).toMatchObject({
      maskDataUrl: '',
      prompt: '',
      brushSize: 28,
      aspectId: 'original',
      resolution: '2K',
      count: 1
    })
  })

  it('builds erase / object-removal prompt', () => {
    const p = buildEraseUserPrompt(
      normalizeImageErase({ prompt: 'remove the person' })
    )
    expect(p).toContain('Erase')
    expect(p).toContain('remove the person')
    expect(p).toContain('background')
  })
})
