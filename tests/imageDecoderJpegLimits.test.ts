import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * JPEG 解码上限的契约（src/main/yolo/imageDecoder.ts）。
 *
 * 背景：jpeg-js 默认把单次解码的内存上限设成 512MB（官方理由是「避免不可信内容
 * 意外 OOM」），而它按「每分量块表 256B + 分量行缓冲 + 输出 RGBA」累计记账，
 * 实测约 21 字节/像素 —— 24MP ≈ 480MB、48MP ≈ 550MB、101.8MP ≈ 2135MB。于是普通
 * 40MP 相机原图就会触顶，抛 `maxMemoryUsageInMB limit exceeded by at least NMB`，
 * 让本地视觉打标整条链路失败（写进 asset.visionTags.status = 'skipped'，
 * 素材卡上表现为「打标失败」，且重试也不变）。
 *
 * 这里断言三件事：
 * 1. 放宽后的选项确实被传给了 jpeg-js，而不是只写在常量里；
 * 2. 两个上限仍然配对：内存上限 ≥ 最坏记账 × 分辨率上限，否则放宽内存也白搭；
 * 3. 分辨率上限仍然有限 —— 解压炸弹的兜底不能跟着一起松掉。
 */

const { decodeSpy } = vi.hoisted(() => ({ decodeSpy: vi.fn() }))

vi.mock('jpeg-js', () => ({ decode: decodeSpy }))

import {
  decodeImage,
  JPEG_DECODE_OPTIONS,
  JPEG_MAX_MEMORY_MB,
  JPEG_MAX_RESOLUTION_MP,
  JPEG_WORST_CASE_BYTES_PER_PIXEL
} from '../src/main/yolo/imageDecoder'

/** JPEG 魔数（FF D8 FF）够走到解码分支，解码本身被 mock 掉 */
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

let dir = ''
let jpegPath = ''

beforeEach(() => {
  decodeSpy.mockReset()
  dir = mkdtempSync(join(tmpdir(), 'image-decoder-'))
  jpegPath = join(dir, 'shot.JPG')
  writeFileSync(jpegPath, JPEG_MAGIC)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('JPEG 解码上限', () => {
  it('走 file 输入时把放宽后的上限传给 jpeg-js', async () => {
    decodeSpy.mockReturnValue({ width: 2, height: 1, data: new Uint8Array(8) })

    const decoded = await decodeImage({ kind: 'file', path: jpegPath })

    expect(decodeSpy).toHaveBeenCalledTimes(1)
    const [bytes, options] = decodeSpy.mock.calls[0] as [Buffer, Record<string, unknown>]
    expect(Buffer.isBuffer(bytes)).toBe(true)
    expect(options).toEqual(JPEG_DECODE_OPTIONS)
    // 高于 jpeg-js 的 512MB 默认值（这是本次修复的实质）
    expect(options.maxMemoryUsageInMB).toBeGreaterThan(512)
    expect(options.useTArray).toBe(true)
    expect(decoded).toEqual({ width: 2, height: 1, rgba: new Uint8Array(8) })
  })

  it('内存上限配得上分辨率上限（否则相机原图仍会被内存上限误伤）', () => {
    const allowedBytes = JPEG_MAX_MEMORY_MB * 1024 * 1024
    const worstCaseBytes = JPEG_WORST_CASE_BYTES_PER_PIXEL * JPEG_MAX_RESOLUTION_MP * 1_000_000
    expect(allowedBytes).toBeGreaterThanOrEqual(worstCaseBytes)
    // 覆盖现有最大画幅相机（GFX100 102MP / Phase One 150MP）
    expect(JPEG_MAX_RESOLUTION_MP).toBeGreaterThanOrEqual(150)
  })

  it('分辨率上限仍然有限且不夸张（解压炸弹的兜底不能一起松掉）', () => {
    expect(Number.isFinite(JPEG_MAX_RESOLUTION_MP)).toBe(true)
    expect(JPEG_MAX_RESOLUTION_MP).toBeLessThanOrEqual(500)
  })

  it('真实 jpeg-js 接受这组选项：真编一张 JPEG 再用同一组选项解回来', async () => {
    const actual = await vi.importActual<typeof import('jpeg-js')>('jpeg-js')
    const width = 8
    const height = 8
    const rgba = Buffer.alloc(width * height * 4)
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 200
      rgba[i + 1] = 30
      rgba[i + 2] = 30
      rgba[i + 3] = 255
    }

    const encoded = actual.encode({ data: rgba, width, height }, 90)
    const decoded = actual.decode(Buffer.from(encoded.data), JPEG_DECODE_OPTIONS)

    expect(decoded.width).toBe(width)
    expect(decoded.height).toBe(height)
    expect(decoded.data.length).toBe(width * height * 4)
  })
})
