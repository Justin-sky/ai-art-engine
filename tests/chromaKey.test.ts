import { describe, expect, it } from 'vitest'
import { applyChromaKey } from '../src/shared/graph'

function rgbaPixels(hexPixels: number[]): Uint8ClampedArray {
  const arr = new Uint8ClampedArray(hexPixels.length * 4)
  hexPixels.forEach((hex, i) => {
    arr[i * 4] = (hex >> 16) & 0xff
    arr[i * 4 + 1] = (hex >> 8) & 0xff
    arr[i * 4 + 2] = hex & 0xff
    arr[i * 4 + 3] = 255
  })
  return arr
}

function alphaOf(arr: Uint8ClampedArray): number[] {
  const out: number[] = []
  for (let i = 3; i < arr.length; i += 4) out.push(arr[i]!)
  return out
}

describe('chromaKey black (黑底去背)', () => {
  it('turns near-black pixels fully transparent', () => {
    const pixels = rgbaPixels([0x000000, 0x080808, 0x101010])
    const arr = applyChromaKey(pixels, 'black', { threshold: 60, feather: 0 })
    expect(alphaOf(arr)).toEqual([0, 0, 0])
  })

  it('keeps bright effect pixels opaque', () => {
    const pixels = rgbaPixels([0xffffff, 0xffaa00, 0x00ffcc, 0xff3300])
    const arr = applyChromaKey(pixels, 'black', { threshold: 60, feather: 0 })
    expect(alphaOf(arr)).toEqual([255, 255, 255, 255])
  })

  it('uses channel max so pure red/green are not mistaken for background', () => {
    const pixels = rgbaPixels([0xff0000, 0x00ff00])
    const arr = applyChromaKey(pixels, 'black', { threshold: 60, feather: 0 })
    expect(alphaOf(arr)).toEqual([255, 255])
  })

  it('applies soft feather band on dim edges', () => {
    const pixels = rgbaPixels([0x000000, 0x404040, 0x808080])
    const arr = applyChromaKey(pixels, 'black', { threshold: 60, feather: 80 })
    const alphas = alphaOf(arr)
    expect(alphas[0]).toBe(0)
    // 0x40(64) 落在 60~140 渐变带 → 部分保留（非 0 非 255）
    expect(alphas[1]).toBeGreaterThan(0)
    expect(alphas[1]).toBeLessThan(255)
    // 0x80(128) 仍在带内但保留更多
    expect(alphas[2]).toBeGreaterThan(alphas[1]!)
  })
})

describe('chromaKey white (白底去背)', () => {
  it('turns near-white pixels transparent, keeps dark pixels', () => {
    const pixels = rgbaPixels([0xffffff, 0xf5f5f5, 0x000000, 0x222222])
    const arr = applyChromaKey(pixels, 'white', { threshold: 40, feather: 0 })
    expect(alphaOf(arr)).toEqual([0, 0, 255, 255])
  })
})
