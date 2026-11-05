import { describe, expect, it } from 'vitest'
import { encodeGif, quantizeGifFrames } from '../src/shared/media/gifEncode'
import { decodeGif, isGifBuffer, dataUrlToBytes } from '../src/shared/media/gifDecode'

describe('gifDecode', () => {
  it('detects GIF magic bytes correctly', () => {
    const validGif89a = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    const validGif87a = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
    const invalidPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])

    expect(isGifBuffer(validGif89a)).toBe(true)
    expect(isGifBuffer(validGif87a)).toBe(true)
    expect(isGifBuffer(invalidPng)).toBe(false)
  })

  it('decodes encoded GIF frames round-trip with full RGBA fidelity', () => {
    const width = 4
    const height = 4
    // Frame 1: 4x4 red square with transparent top-left pixel
    const f1 = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      if (i === 0) {
        // Transparent pixel
        f1[i * 4 + 3] = 0
      } else {
        f1[i * 4] = 255
        f1[i * 4 + 1] = 0
        f1[i * 4 + 2] = 0
        f1[i * 4 + 3] = 255
      }
    }

    // Frame 2: 4x4 blue square with transparent top-left pixel
    const f2 = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      if (i === 0) {
        f2[i * 4 + 3] = 0
      } else {
        f2[i * 4] = 0
        f2[i * 4 + 1] = 0
        f2[i * 4 + 2] = 255
        f2[i * 4 + 3] = 255
      }
    }

    const quantized = quantizeGifFrames([f1, f2])
    const bytes = encodeGif({
      width,
      height,
      palette: quantized.palette,
      frames: quantized.frames.map((indices) => ({
        indices,
        delayCs: 15,
        transparent: quantized.transparentIndex !== null
      })),
      delayCs: 15,
      loopCount: 0,
      transparentIndex: quantized.transparentIndex ?? undefined
    })

    expect(isGifBuffer(bytes)).toBe(true)

    // Decode the encoded bytes
    const decoded = decodeGif(bytes)
    expect(decoded.width).toBe(width)
    expect(decoded.height).toBe(height)
    expect(decoded.loopCount).toBe(0)
    expect(decoded.frames).toHaveLength(2)

    // Frame 1 check
    expect(decoded.frames[0].delayCs).toBe(15)
    expect(decoded.frames[0].transparent).toBe(true)
    // Top-left pixel should be transparent (alpha = 0)
    expect(decoded.frames[0].rgba[3]).toBe(0)
    // Other pixel should be Red
    expect(decoded.frames[0].rgba[4]).toBe(255)
    expect(decoded.frames[0].rgba[5]).toBe(0)
    expect(decoded.frames[0].rgba[6]).toBe(0)
    expect(decoded.frames[0].rgba[7]).toBe(255)

    // Frame 2 check
    expect(decoded.frames[1].delayCs).toBe(15)
    expect(decoded.frames[1].transparent).toBe(true)
    // Top-left pixel should be transparent (alpha = 0)
    expect(decoded.frames[1].rgba[3]).toBe(0)
    // Other pixel should be Blue
    expect(decoded.frames[1].rgba[4]).toBe(0)
    expect(decoded.frames[1].rgba[5]).toBe(0)
    expect(decoded.frames[1].rgba[6]).toBe(255)
    expect(decoded.frames[1].rgba[7]).toBe(255)
  })

  it('converts dataUrl to bytes accurately', () => {
    const dataUrl =
      'data:image/gif;base64,R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
    const bytes = dataUrlToBytes(dataUrl)
    expect(isGifBuffer(bytes)).toBe(true)
    const decoded = decodeGif(bytes)
    expect(decoded.width).toBe(1)
    expect(decoded.height).toBe(1)
    expect(decoded.frames).toHaveLength(1)
  })
})
