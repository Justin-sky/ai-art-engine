import { describe, expect, it } from 'vitest'
import {
  anim2dCellKeys,
  moveAnimCellOrder,
  normalizeAnimCellEdits,
  normalizeAnimCellOrder,
  readAnimCellEditsFromNode,
  readAnimCellOrderFromNode
} from '../src/shared/graph'
import { encodeGif, quantizeGifFrames } from '../src/shared/media/gifEncode'
import { isAnimatedImageMediaUrl } from '../src/shared/import'
import {
  tryUnpackSourceGif,
  unpackGifToFrames
} from '../src/renderer/src/features/graph/model/unpackAnim2dGif'

describe('anim2d frame ordering & edits', () => {
  it('normalizes cell edits and filters invalid entries', () => {
    const edits = normalizeAnimCellEdits({
      '1-1':
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      '1-2': 'invalid-url',
      '': 'data:image/png;base64,123'
    })
    expect(Object.keys(edits)).toEqual(['1-1'])
    expect(edits['1-1']).toContain('data:image/png')
  })

  it('normalizes and reorders cell order', () => {
    const defaultKeys = ['1-1', '1-2', '1-3', '1-4']
    const custom = ['1-3', '1-1']
    const normalized = normalizeAnimCellOrder(custom, defaultKeys)
    // Custom keys first, followed by any unmentioned keys
    expect(normalized).toEqual(['1-3', '1-1', '1-2', '1-4'])

    // Move 1-1 earlier (left) -> swap with 1-3
    const movedLeft = moveAnimCellOrder(normalized, '1-1', -1)
    expect(movedLeft).toEqual(['1-1', '1-3', '1-2', '1-4'])

    // Move at boundary -> unchanged
    const boundary = moveAnimCellOrder(movedLeft, '1-1', -1)
    expect(boundary).toEqual(movedLeft)

    // Move 1-1 later (right) -> swap with 1-3
    const movedRight = moveAnimCellOrder(movedLeft, '1-1', 1)
    expect(movedRight).toEqual(['1-3', '1-1', '1-2', '1-4'])
  })

  it('reads cell order and edits from node params', () => {
    const params = {
      animRows: 1,
      animCols: 3,
      animCellOrder: ['1-3', '1-2', '1-1'],
      animCellEdits: {
        '1-2': 'data:image/png;base64,abc12345678901234567890'
      }
    }
    const order = readAnimCellOrderFromNode(params)
    expect(order).toEqual(['1-3', '1-2', '1-1'])

    const edits = readAnimCellEditsFromNode(params)
    expect(edits['1-2']).toBe('data:image/png;base64,abc12345678901234567890')
  })
})

describe('unpackGifToFrames', () => {
  it('unpacks animated GIF into frames with delay and fps metadata', () => {
    const width = 8
    const height = 8
    const f1 = new Uint8ClampedArray(width * height * 4).fill(255)
    const f2 = new Uint8ClampedArray(width * height * 4).fill(128)
    const f3 = new Uint8ClampedArray(width * height * 4).fill(64)

    const quantized = quantizeGifFrames([f1, f2, f3])
    const bytes = encodeGif({
      width,
      height,
      palette: quantized.palette,
      frames: quantized.frames.map((indices) => ({
        indices,
        delayCs: 10
      })),
      delayCs: 10,
      loopCount: 0
    })

    const unpacked = unpackGifToFrames(bytes)
    expect(unpacked).not.toBeNull()
    if (!unpacked) return

    expect(unpacked.width).toBe(width)
    expect(unpacked.height).toBe(height)
    expect(unpacked.frames).toHaveLength(3)
    expect(unpacked.frames[0].key).toBe('f1')
    expect(unpacked.frames[1].key).toBe('f2')
    expect(unpacked.frames[2].key).toBe('f3')
    expect(unpacked.frames[0].delayCs).toBe(10)
    expect(unpacked.averageFps).toBe(10)
  })

  it('isAnimatedImageMediaUrl identifies various GIF URLs correctly', () => {
    expect(
      isAnimatedImageMediaUrl('studio-media://local/?path=F%3A%5Cproject%5CCache%5Cgen.gif&t=123')
    ).toBe(true)
    expect(
      isAnimatedImageMediaUrl('studio-media://local/?path=F%3A%2Fproject%2FCache%2Fcat.GIF&t=456')
    ).toBe(true)
    expect(
      isAnimatedImageMediaUrl(
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      )
    ).toBe(true)
    expect(isAnimatedImageMediaUrl('Cache/generated-123.gif')).toBe(true)
    expect(isAnimatedImageMediaUrl('https://example.com/dance.gif?foo=bar#hash')).toBe(true)
    expect(isAnimatedImageMediaUrl('studio-media://local/?path=thumb.png&t=123')).toBe(false)
    expect(isAnimatedImageMediaUrl('Cache/sheet.png')).toBe(false)
    expect(isAnimatedImageMediaUrl('')).toBe(false)
  })

  it('tryUnpackSourceGif decodes bytes and data URLs', async () => {
    const width = 4
    const height = 4
    const f1 = new Uint8ClampedArray(width * height * 4).fill(200)
    const f2 = new Uint8ClampedArray(width * height * 4).fill(100)
    const quantized = quantizeGifFrames([f1, f2])
    const bytes = encodeGif({
      width,
      height,
      palette: quantized.palette,
      frames: quantized.frames.map((indices) => ({ indices, delayCs: 12 })),
      delayCs: 12,
      loopCount: 0
    })

    const fromBytes = await tryUnpackSourceGif(bytes)
    expect(fromBytes).not.toBeNull()
    expect(fromBytes?.frames).toHaveLength(2)

    const base64 = Buffer.from(bytes).toString('base64')
    const dataUrl = `data:image/gif;base64,${base64}`
    const fromDataUrl = await tryUnpackSourceGif(dataUrl)
    expect(fromDataUrl).not.toBeNull()
    expect(fromDataUrl?.frames).toHaveLength(2)
  })
})
