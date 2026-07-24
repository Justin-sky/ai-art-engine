import { describe, expect, it } from 'vitest'
import { compareProjectEntries, unityNaturalCompare } from '@shared/projectSort'

describe('unityNaturalCompare', () => {
  it('sorts numeric segments naturally like Unity NaturalCompare', () => {
    expect(unityNaturalCompare('shot2', 'shot10')).toBeLessThan(0)
    expect(unityNaturalCompare('file2', 'file10')).toBeLessThan(0)
    expect(unityNaturalCompare('第1集', '第2集')).toBeLessThan(0)
  })

  it('is case-insensitive', () => {
    expect(unityNaturalCompare('Folder', 'folder')).toBe(0)
  })

  it('orders Chinese episode names by character (Unity en collator)', () => {
    expect(unityNaturalCompare('第一集', '第二集')).toBeLessThan(0)
  })
})

describe('compareProjectEntries', () => {
  it('keeps folders before assets when names are equal ignoring case', () => {
    expect(
      compareProjectEntries(
        { kind: 'folder', name: 'Props' },
        { kind: 'asset', name: 'props' }
      )
    ).toBeLessThan(0)
  })

  it('sorts within the same kind by natural compare', () => {
    expect(
      compareProjectEntries(
        { kind: 'asset', name: 'shot10' },
        { kind: 'asset', name: 'shot2' }
      )
    ).toBeGreaterThan(0)
  })
})
