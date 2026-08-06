import { describe, expect, it } from 'vitest'
import {
  aspectRatioCropRect,
  parseAspectRatio
} from '../src/renderer/src/features/graph/model/normalizeImageAspectRatio'

describe('normalizeImageAspectRatio', () => {
  it('parses common aspect ratios', () => {
    expect(parseAspectRatio('16:9')).toBeCloseTo(16 / 9, 6)
    expect(parseAspectRatio('9:16')).toBeCloseTo(9 / 16, 6)
    expect(parseAspectRatio('1:1')).toBe(1)
    expect(parseAspectRatio('bad')).toBeNull()
  })

  it('keeps an already matching image unchanged', () => {
    expect(aspectRatioCropRect(1920, 1080, 16 / 9)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    })
  })

  it('center-crops a too-wide image to the target ratio', () => {
    expect(aspectRatioCropRect(1600, 900, 1)).toEqual({
      x: 350,
      y: 0,
      width: 900,
      height: 900
    })
  })

  it('center-crops a too-tall image to the target ratio', () => {
    expect(aspectRatioCropRect(900, 1600, 16 / 9)).toEqual({
      x: 0,
      y: 547,
      width: 900,
      height: 506
    })
  })
})
