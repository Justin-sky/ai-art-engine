import { describe, expect, it } from 'vitest'
import {
  encodeGif,
  gifDelayCsFromFps,
  quantizeGifFrames,
  type GifRgb
} from '../src/shared/media/gifEncode'

/**
 * 测试内置一个最小 GIF 解析器 + LZW 解码器：
 * 只做结构校验不足以证明码流正确，必须把索引流解回原值做往返比对。
 */
interface ParsedGifFrame {
  delayCs: number
  transparentIndex: number | null
  indices: number[]
}

interface ParsedGif {
  width: number
  height: number
  globalPalette: number[][]
  loopCount: number | null
  frames: ParsedGifFrame[]
}

function lzwDecode(data: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  let dict: number[][] = []
  const reset = (): void => {
    dict = []
    for (let i = 0; i < clearCode; i += 1) dict.push([i])
    dict.push([])
    dict.push([])
  }
  reset()
  let codeSize = minCodeSize + 1
  let bitPos = 0
  const out: number[] = []
  const readCode = (): number => {
    let code = 0
    for (let i = 0; i < codeSize; i += 1) {
      const bit = (data[(bitPos + i) >> 3] >> ((bitPos + i) & 7)) & 1
      code |= bit << i
    }
    bitPos += codeSize
    return code
  }
  let prev: number[] | null = null
  while (bitPos + codeSize <= data.length * 8) {
    const code = readCode()
    if (code === clearCode) {
      reset()
      codeSize = minCodeSize + 1
      prev = null
      continue
    }
    if (code === endCode) break
    let entry: number[]
    if (code < dict.length && dict[code].length) entry = dict[code]
    else if (prev && code === dict.length) entry = [...prev, prev[0]]
    else throw new Error(`unexpected LZW code ${code}`)
    for (const value of entry) out.push(value)
    if (prev && dict.length < 4096) {
      dict.push([...prev, entry[0]])
      if (dict.length >= 1 << codeSize && codeSize < 12) codeSize += 1
    }
    prev = entry
  }
  return out
}

function parseGif(bytes: Uint8Array): ParsedGif {
  let p = 0
  const u8 = (): number => bytes[p++]
  const u16 = (): number => {
    const value = bytes[p] | (bytes[p + 1] << 8)
    p += 2
    return value
  }
  const ascii = (n: number): string => {
    const text = String.fromCharCode(...bytes.subarray(p, p + n))
    p += n
    return text
  }

  expect(ascii(6)).toBe('GIF89a')
  const width = u16()
  const height = u16()
  const packed = u8()
  expect(packed & 0x80).toBe(0x80)
  const gctSize = 1 << ((packed & 0x07) + 1)
  u8()
  u8()
  const globalPalette: number[][] = []
  for (let i = 0; i < gctSize; i += 1) globalPalette.push([u8(), u8(), u8()])

  const frames: ParsedGifFrame[] = []
  let loopCount: number | null = null
  let pendingDelay = 0
  let pendingTransparent: number | null = null

  while (p < bytes.length) {
    const marker = u8()
    if (marker === 0x3b) break
    if (marker === 0x21) {
      const label = u8()
      if (label === 0xf9) {
        expect(u8()).toBe(4)
        const flags = u8()
        pendingDelay = u16()
        const transparentIndex = u8()
        pendingTransparent = flags & 0x01 ? transparentIndex : null
        expect(u8()).toBe(0)
        continue
      }
      let blockIndex = 0
      for (;;) {
        const size = u8()
        if (!size) break
        const block = bytes.subarray(p, p + size)
        if (label === 0xff && blockIndex === 0) expect(String.fromCharCode(...block)).toBe('NETSCAPE2.0')
        if (label === 0xff && blockIndex === 1 && block[0] === 1) {
          loopCount = block[1] | (block[2] << 8)
        }
        p += size
        blockIndex += 1
      }
      continue
    }
    expect(marker).toBe(0x2c)
    expect(u16()).toBe(0)
    expect(u16()).toBe(0)
    expect(u16()).toBe(width)
    expect(u16()).toBe(height)
    expect(u8() & 0x80).toBe(0)
    const minCodeSize = u8()
    const chunks: number[] = []
    for (;;) {
      const size = u8()
      if (!size) break
      for (let i = 0; i < size; i += 1) chunks.push(u8())
    }
    frames.push({
      delayCs: pendingDelay,
      transparentIndex: pendingTransparent,
      indices: lzwDecode(Uint8Array.from(chunks), minCodeSize)
    })
  }

  expect(p).toBe(bytes.length)
  return { width, height, globalPalette, loopCount, frames }
}

/** 确定性伪随机，避免用例不可复现 */
function makeRandom(count: number, seed = 12345): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state
  }
}

describe('gifDelayCsFromFps', () => {
  it('把帧率换算成 1/100 秒延迟并保留下限', () => {
    expect(gifDelayCsFromFps(8)).toBe(13)
    expect(gifDelayCsFromFps(24)).toBe(4)
    expect(gifDelayCsFromFps(10)).toBe(10)
    expect(gifDelayCsFromFps(60)).toBe(2)
    expect(gifDelayCsFromFps(0)).toBe(10)
    expect(gifDelayCsFromFps(Number.NaN)).toBe(10)
  })
})

describe('encodeGif 结构', () => {
  it('写入头、逻辑屏幕、整屏图像描述符与结束符', () => {
    const parsed = parseGif(
      encodeGif({
        width: 2,
        height: 1,
        palette: [
          [0, 0, 0],
          [255, 255, 255]
        ],
        frames: [
          { indices: Uint8Array.from([0, 1]), delayCs: 12 },
          { indices: Uint8Array.from([1, 0]), delayCs: 12 }
        ],
        loopCount: 0
      })
    )
    expect(parsed.width).toBe(2)
    expect(parsed.height).toBe(1)
    expect(parsed.loopCount).toBe(0)
    expect(parsed.globalPalette.length).toBe(4)
    expect(parsed.frames.length).toBe(2)
    expect(parsed.frames[0].delayCs).toBe(12)
    expect(parsed.frames[0].transparentIndex).toBeNull()
    expect(parsed.frames[0].indices).toEqual([0, 1])
    expect(parsed.frames[1].indices).toEqual([1, 0])
  })

  it('透明索引与单次播放写入图形控制扩展', () => {
    const parsed = parseGif(
      encodeGif({
        width: 3,
        height: 1,
        palette: [
          [0, 0, 0],
          [255, 0, 0],
          [0, 255, 0]
        ],
        frames: [{ indices: Uint8Array.from([0, 1, 2]), transparent: true }],
        delayCs: 4,
        loopCount: 1,
        transparentIndex: 0
      })
    )
    expect(parsed.loopCount).toBe(1)
    expect(parsed.frames[0].transparentIndex).toBe(0)
    expect(parsed.frames[0].delayCs).toBe(4)
    expect(parsed.frames[0].indices).toEqual([0, 1, 2])
  })

  it('单像素帧可编解码', () => {
    const parsed = parseGif(
      encodeGif({
        width: 1,
        height: 1,
        palette: [[9, 9, 9]],
        frames: [{ indices: Uint8Array.from([0]) }]
      })
    )
    expect(parsed.frames[0].indices).toEqual([0])
  })
})

describe('encodeGif LZW 往返', () => {
  it('256 色随机大图逐码一致（覆盖码长增长与字典重置）', () => {
    const width = 160
    const height = 160
    const random = makeRandom(width * height)
    const indices = new Uint8Array(width * height)
    for (let i = 0; i < indices.length; i += 1) indices[i] = random() % 256
    const palette: GifRgb[] = []
    for (let i = 0; i < 256; i += 1) palette.push([i, 255 - i, (i * 7) % 256])

    const parsed = parseGif(
      encodeGif({ width, height, palette, frames: [{ indices }], delayCs: 10 })
    )
    expect(parsed.frames[0].indices).toEqual(Array.from(indices))
  })

  it('高重复图案逐码一致（覆盖长字典链）', () => {
    const width = 200
    const height = 120
    const indices = new Uint8Array(width * height)
    for (let i = 0; i < indices.length; i += 1) indices[i] = (i % 17) * 3
    const palette: GifRgb[] = []
    for (let i = 0; i < 256; i += 1) palette.push([i, 128, 255 - i])

    const parsed = parseGif(
      encodeGif({ width, height, palette, frames: [{ indices }], delayCs: 10 })
    )
    expect(parsed.frames[0].indices).toEqual(Array.from(indices))
  })

  it('多帧共用全局调色板且互不串码', () => {
    const width = 8
    const height = 8
    const palette: GifRgb[] = [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
      [0, 255, 0]
    ]
    const frames = [0, 1, 2, 3].map((offset) => ({
      indices: Uint8Array.from({ length: width * height }, (_, i) => (i + offset) % 4)
    }))
    const parsed = parseGif(encodeGif({ width, height, palette, frames }))
    expect(parsed.frames.map((f) => f.indices)).toEqual(
      frames.map((f) => Array.from(f.indices))
    )
  })
})

describe('encodeGif 入参校验', () => {
  it('帧长度不符 / 索引越界 / 空帧列表抛错', () => {
    const palette: GifRgb[] = [
      [0, 0, 0],
      [255, 255, 255]
    ]
    expect(() =>
      encodeGif({ width: 2, height: 1, palette, frames: [{ indices: Uint8Array.from([0]) }] })
    ).toThrowError('GIF_FRAME_SIZE_MISMATCH')
    expect(() =>
      encodeGif({ width: 1, height: 1, palette, frames: [{ indices: Uint8Array.from([9]) }] })
    ).toThrowError('GIF_INDEX_OUT_OF_RANGE')
    expect(() => encodeGif({ width: 1, height: 1, palette, frames: [] })).toThrowError(
      'GIF_NO_FRAMES'
    )
    expect(() =>
      encodeGif({ width: 0, height: 1, palette, frames: [{ indices: Uint8Array.from([0]) }] })
    ).toThrowError('GIF_BAD_SIZE')
  })
})

describe('quantizeGifFrames', () => {
  function rgba(pixels: number[][]): Uint8ClampedArray {
    return new Uint8ClampedArray(pixels.flat())
  }

  it('全透明帧落到透明索引且调色板仍有兜底色', () => {
    const result = quantizeGifFrames([rgba([[0, 0, 0, 0], [255, 255, 255, 0]])])
    expect(result.transparentIndex).toBe(0)
    expect(result.palette.length).toBeGreaterThanOrEqual(1)
    expect(Array.from(result.frames[0])).toEqual([0, 0])
  })

  it('不透明两色图无透明且两色都能取回', () => {
    const result = quantizeGifFrames([
      rgba([
        [255, 0, 0, 255],
        [0, 0, 255, 255],
        [255, 0, 0, 255],
        [0, 0, 255, 255]
      ])
    ])
    expect(result.transparentIndex).toBeNull()
    const decoded = Array.from(result.frames[0]).map((index) => result.palette[index])
    expect(decoded).toContainEqual([255, 0, 0])
    expect(decoded).toContainEqual([0, 0, 255])
  })

  it('键控透明帧：透明像素归 0，不透明像素归彩色区', () => {
    const result = quantizeGifFrames([
      rgba([
        [0, 0, 0, 0],
        [12, 200, 30, 255],
        [0, 0, 0, 0],
        [12, 200, 30, 255]
      ])
    ])
    expect(result.transparentIndex).toBe(0)
    expect(Array.from(result.frames[0])).toEqual([0, 1, 0, 1])
    expect(result.palette[1]).toEqual([12, 200, 30])
  })

  it('alphaThreshold 可关闭透明处理', () => {
    const result = quantizeGifFrames([rgba([[10, 20, 30, 0]])], { alphaThreshold: 0 })
    expect(result.transparentIndex).toBeNull()
    expect(Array.from(result.frames[0])).toEqual([0])
  })

  it('调色板色数受 maxColors 约束', () => {
    const random = makeRandom(600)
    const pixels: number[][] = []
    for (let i = 0; i < 600; i += 1) {
      pixels.push([random() % 256, random() % 256, random() % 256, 255])
    }
    const result = quantizeGifFrames([rgba(pixels)], { maxColors: 8 })
    expect(result.palette.length).toBeLessThanOrEqual(8)
    for (const index of result.frames[0]) expect(index).toBeLessThan(result.palette.length)
  })
})
