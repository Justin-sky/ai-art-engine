import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { readPsd, writePsdBuffer } from 'ag-psd'
import { PNG } from 'pngjs'
import {
  decodePsdComposite,
  encodeRgbaPng,
  readPsdCompositeFile
} from '../src/main/services/psdCompositeService'

/**
 * PSD 合成预览的契约：应用内不出画面的根因是「PSD 是未合成的图层文档」，
 * 所以这里用 ag-psd 现造一份 PSD 再解回来，锁住合成图确实被当成像素读出来了。
 */

/** PSD 头部固定长度 */
const HEADER_LENGTH = 26

/** 四象限异色的测试图：能同时校验行序、通道顺序与不要被灰度化 */
function sampleRgba(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const left = x < width / 2
      const top = y < height / 2
      data[i] = left ? 255 : 0
      data[i + 1] = top ? 255 : 0
      data[i + 2] = left === top ? 0 : 255
      data[i + 3] = 255
    }
  }
  return data
}

function toPsdBuffer(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  return Buffer.from(
    writePsdBuffer({
      width,
      height,
      imageData: { width, height, data: rgba }
    })
  )
}

/** 带一个图层的 PSD：图层记录正是畸形文件的出事点，没有图层就复现不出来 */
function toLayeredPsdBuffer(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  return Buffer.from(
    writePsdBuffer({
      width,
      height,
      imageData: { width, height, data: rgba },
      children: [
        {
          name: 'layer',
          top: 0,
          left: 0,
          bottom: height,
          right: width,
          imageData: { width, height, data: rgba }
        }
      ]
    })
  )
}

/** 段跳读：offset 处是四字节长度前缀，返回下一段起点 */
function nextSectionOf(buffer: Buffer, offset: number): number {
  return offset + 4 + buffer.readUInt32BE(offset)
}

/**
 * 把第一条图层记录的高度框改成 top > bottom。
 * 非 Photoshop 工具写出的 PSD 常有这类畸形记录，ag-psd 读到就抛 Invalid layer size，
 * 整份文件再也读不出画面——而它的合成图其实是完好的。
 */
function breakFirstLayerBox(psd: Buffer): Buffer {
  const broken = Buffer.from(psd)
  const layerMaskStart = nextSectionOf(broken, nextSectionOf(broken, HEADER_LENGTH))
  // Layer & Mask 段：4B 段长 + 4B Layer Info 段长 + 2B 图层数 + 图层记录
  const firstRecord = layerMaskStart + 4 + 4 + 2
  broken.writeInt32BE(100, firstRecord)
  broken.writeInt32BE(0, firstRecord + 8)
  return broken
}

describe('PSD 合成预览解码', () => {
  it('PSD 合成图解成同尺寸同像素的 RGBA', () => {
    const width = 8
    const height = 6
    const rgba = sampleRgba(width, height)

    const decoded = decodePsdComposite(toPsdBuffer(width, height, rgba))

    expect(decoded).not.toBeNull()
    expect(decoded!.width).toBe(width)
    expect(decoded!.height).toBe(height)
    expect(Array.from(decoded!.rgba)).toEqual(Array.from(rgba))
  })

  it('图层记录畸形的 PSD 仍能解出合成图（剥掉图层段后重读）', () => {
    const width = 8
    const height = 6
    const rgba = sampleRgba(width, height)
    const broken = breakFirstLayerBox(toLayeredPsdBuffer(width, height, rgba))

    // 先坐实这确实是 ag-psd 直读不了的畸形文件，否则本用例证明不了降级路径
    expect(() =>
      readPsd(broken, { skipLayerImageData: true, useImageData: true })
    ).toThrow()

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const decoded = decodePsdComposite(broken)

      expect(decoded).not.toBeNull()
      expect(decoded!.width).toBe(width)
      expect(decoded!.height).toBe(height)
      expect(Array.from(decoded!.rgba)).toEqual(Array.from(rgba))
    } finally {
      warn.mockRestore()
    }
  })

  it('非 PSD 数据解不出画面但不抛错（由调用方回落其它预览手段）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(decodePsdComposite(Buffer.from('not a psd at all'))).toBeNull()
      expect(decodePsdComposite(Buffer.alloc(0))).toBeNull()
    } finally {
      warn.mockRestore()
    }
  })

  it('RGBA 编码出的 PNG 可被原样解回（预览交给 nativeImage / <img> 的载体）', () => {
    const width = 4
    const height = 3
    const rgba = sampleRgba(width, height)

    const png = PNG.sync.read(encodeRgbaPng({ width, height, rgba: new Uint8Array(rgba) }))

    expect(png.width).toBe(width)
    expect(png.height).toBe(height)
    expect(Array.from(png.data)).toEqual(Array.from(rgba))
  })
})

describe('PSD 合成预览：读盘入口', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aae-psd-preview-'))

  function cleanUp(): void {
    rmSync(dir, { recursive: true, force: true })
  }

  afterAll(cleanUp)

  it('从磁盘读出合成图（缩略图链路实际走的入口）', () => {
    const width = 5
    const height = 4
    const rgba = sampleRgba(width, height)
    const abs = join(dir, 'cover.psd')
    writeFileSync(abs, toPsdBuffer(width, height, rgba))

    const image = readPsdCompositeFile(abs)

    expect(image?.width).toBe(width)
    expect(image?.height).toBe(height)
    expect(Array.from(image!.rgba)).toEqual(Array.from(rgba))
  })

  it('文件缺失或根本不是 PSD 时不抛错，返回 null 由上层降级', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(readPsdCompositeFile(join(dir, 'missing.psd'))).toBeNull()

      const junk = join(dir, 'junk.psd')
      writeFileSync(junk, 'definitely not a psd')
      expect(readPsdCompositeFile(junk)).toBeNull()
    } finally {
      warn.mockRestore()
    }
  })
})
