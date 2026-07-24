import { describe, expect, it } from 'vitest'
import { shouldApplyShotSplitImport } from '../src/renderer/src/features/script/applyShotSplitOnOpen'

describe('shouldApplyShotSplitImport', () => {
  it('skips when the same split fingerprint was already applied', () => {
    expect(
      shouldApplyShotSplitImport({
        fingerprint: 'fp-a',
        lastApplied: 'fp-a',
        contentUnchanged: false
      })
    ).toBe('skip')
  })

  it('marks only when content already matches shots', () => {
    expect(
      shouldApplyShotSplitImport({
        fingerprint: 'fp-b',
        lastApplied: null,
        contentUnchanged: true
      })
    ).toBe('mark-only')
  })

  it('applies when split fingerprint changed', () => {
    expect(
      shouldApplyShotSplitImport({
        fingerprint: 'fp-new',
        lastApplied: 'fp-old',
        contentUnchanged: false
      })
    ).toBe('apply')
  })

  it('applies on first execute even if shots already exist', () => {
    expect(
      shouldApplyShotSplitImport({
        fingerprint: 'fp-d',
        lastApplied: null,
        contentUnchanged: false
      })
    ).toBe('apply')
  })
})
