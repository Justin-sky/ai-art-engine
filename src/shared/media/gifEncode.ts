/**
 * GIF89a 编码器（纯 TS、零依赖）。
 *
 * 只实现导出动图所需的最小子集：全局调色板 + 单个透明索引 + 逐帧 LZW；
 * 不做交错、局部调色板、帧间差分。
 *
 * 自研而非引依赖的取舍：与主进程 jpeg-js / pngjs 的既有选择一致——不为一次导出
 * 新增运行时依赖，也让编码逻辑可被单测直接往返验证（见 tests/gifEncode.test.ts）。
 *
 * 调色板索引约定：需要透明度时索引 0 固定留给透明色，不透明色从索引 1 起；
 * 不需要透明度时索引 0 就是第一个正常颜色。调用方按 quantizeGifFrames 的返回值填即可。
 */

export type GifRgb = readonly [number, number, number]

export interface GifFrame {
  /** 长度必须等于 width*height，值为调色板索引 */
  indices: Uint8Array
  /** 该帧延迟（1/100 秒）；省略时用 EncodeGifInput.delayCs */
  delayCs?: number
  /** 该帧是否声明透明（默认跟随 transparentIndex 是否提供） */
  transparent?: boolean
}

export interface EncodeGifInput {
  width: number
  height: number
  /** 全局调色板，长度 1..256 */
  palette: readonly GifRgb[]
  frames: readonly GifFrame[]
  /** 默认帧延迟（1/100 秒），默认 10 */
  delayCs?: number
  /** 循环次数：0 = 无限循环（默认 0） */
  loopCount?: number
  /** 透明色索引；不传表示整图无透明 */
  transparentIndex?: number
}

/** GIF LZW 字典上限：最大可分配码值 4095 */
const MAX_CODE = 4096

/** 逐字节增长的目标缓冲；避免用 number[] 承载数十万字节的压缩流 */
class ByteSink {
  private buf = new Uint8Array(4096)
  private len = 0

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return
    let next = this.buf.length * 2
    while (next < this.len + extra) next *= 2
    const grown = new Uint8Array(next)
    grown.set(this.buf.subarray(0, this.len))
    this.buf = grown
  }

  byte(value: number): void {
    this.ensure(1)
    this.buf[this.len] = value & 0xff
    this.len += 1
  }

  bytes(values: Uint8Array): void {
    this.ensure(values.length)
    this.buf.set(values, this.len)
    this.len += values.length
  }

  ascii(text: string): void {
    this.ensure(text.length)
    for (let i = 0; i < text.length; i += 1) this.buf[this.len + i] = text.charCodeAt(i) & 0xff
    this.len += text.length
  }

  /** GIF 多用小端 16 位 */
  u16le(value: number): void {
    this.byte(value & 0xff)
    this.byte((value >> 8) & 0xff)
  }

  take(): Uint8Array {
    return this.buf.slice(0, this.len)
  }
}

/** LSB-first 位写入器（GIF 的码流按低位在前打包） */
class BitWriter {
  private out = new ByteSink()
  private acc = 0
  private bits = 0

  write(code: number, size: number): void {
    let value = code
    let remaining = size
    while (remaining > 0) {
      const take = Math.min(8 - this.bits, remaining)
      this.acc |= (value & ((1 << take) - 1)) << this.bits
      this.bits += take
      remaining -= take
      value >>>= take
      if (this.bits === 8) {
        this.out.byte(this.acc)
        this.acc = 0
        this.bits = 0
      }
    }
  }

  finish(): Uint8Array {
    if (this.bits > 0) {
      this.out.byte(this.acc)
      this.acc = 0
      this.bits = 0
    }
    return this.out.take()
  }
}

/**
 * LZW 压缩单帧索引流。
 *
 * 码长增长规则必须与解码器严格同步：编码侧「分配新码后若 nextCode > 2^codeSize 则加宽」，
 * 等价于解码侧常见的「压入新条目后 nextCode >= 2^codeSize 则加宽」（解码字典在读取时滞后一条）。
 */
function lzwBytes(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  const writer = new BitWriter()
  const dict = new Map<number, number>()
  let codeSize = minCodeSize + 1
  let nextCode = endCode + 1

  writer.write(clearCode, codeSize)
  if (indices.length > 0) {
    let prefix = indices[0]
    for (let i = 1; i < indices.length; i += 1) {
      const suffix = indices[i]
      const key = (prefix << 8) | suffix
      const existing = dict.get(key)
      if (existing !== undefined) {
        prefix = existing
        continue
      }
      writer.write(prefix, codeSize)
      if (nextCode < MAX_CODE) {
        dict.set(key, nextCode)
        nextCode += 1
        if (nextCode > 1 << codeSize && codeSize < 12) codeSize += 1
      } else {
        // 字典写满：发清除码重置，避免码长溢出
        writer.write(clearCode, codeSize)
        dict.clear()
        codeSize = minCodeSize + 1
        nextCode = endCode + 1
      }
      prefix = suffix
    }
    writer.write(prefix, codeSize)
  }
  writer.write(endCode, codeSize)
  return writer.finish()
}

/** LZW 码流 → GIF 数据子块（每块 ≤255 字节，以 0 结尾） */
function writeLzwData(sink: ByteSink, indices: Uint8Array, minCodeSize: number): void {
  const compressed = lzwBytes(indices, minCodeSize)
  sink.byte(minCodeSize)
  for (let offset = 0; offset < compressed.length; offset += 255) {
    const end = Math.min(offset + 255, compressed.length)
    sink.byte(end - offset)
    sink.bytes(compressed.subarray(offset, end))
  }
  sink.byte(0)
}

export function encodeGif(input: EncodeGifInput): Uint8Array {
  const width = Math.floor(input.width)
  const height = Math.floor(input.height)
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('GIF_BAD_SIZE')
  }
  const palette = input.palette ?? []
  if (!palette.length || palette.length > 256) throw new Error('GIF_BAD_PALETTE')
  if (!input.frames?.length) throw new Error('GIF_NO_FRAMES')

  // 颜色表位数：GCT 条目数必须是 2 的幂，且 LZW 最小码长至少 2
  const tableBits = Math.max(2, Math.ceil(Math.log2(palette.length)))
  const tableSize = 1 << tableBits
  const transparentIndex = input.transparentIndex
  const hasTransparent =
    typeof transparentIndex === 'number' && transparentIndex >= 0 && transparentIndex < tableSize
  const defaultDelay = Math.max(0, Math.round(input.delayCs ?? 10))
  const loopCount = Math.max(0, Math.min(65535, Math.round(input.loopCount ?? 0)))
  const pixelCount = width * height

  const sink = new ByteSink()
  sink.ascii('GIF89a')
  // 逻辑屏幕描述符：带全局颜色表、色深 8 位、颜色表位宽 tableBits
  sink.u16le(width)
  sink.u16le(height)
  sink.byte(0x80 | (0x07 << 4) | (tableBits - 1))
  sink.byte(hasTransparent ? transparentIndex : 0)
  sink.byte(0)
  for (let i = 0; i < tableSize; i += 1) {
    const color = palette[i] ?? [0, 0, 0]
    sink.byte(color[0])
    sink.byte(color[1])
    sink.byte(color[2])
  }

  // NETSCAPE2.0 循环扩展，必须位于首个图像块之前；loopCount 0 = 无限
  sink.byte(0x21)
  sink.byte(0xff)
  sink.byte(0x0b)
  sink.ascii('NETSCAPE2.0')
  sink.byte(0x03)
  sink.byte(0x01)
  sink.u16le(loopCount)
  sink.byte(0)

  for (const frame of input.frames) {
    if (frame.indices.length !== pixelCount) throw new Error('GIF_FRAME_SIZE_MISMATCH')
    for (let i = 0; i < frame.indices.length; i += 1) {
      if (frame.indices[i] >= tableSize) throw new Error('GIF_INDEX_OUT_OF_RANGE')
    }
    const frameTransparent = hasTransparent && frame.transparent !== false
    const delay = Math.max(0, Math.round(frame.delayCs ?? defaultDelay))
    // 图形控制扩展：处置方式 2（回填背景）配合透明，保证逐帧擦除而非叠加
    sink.byte(0x21)
    sink.byte(0xf9)
    sink.byte(0x04)
    sink.byte(((frameTransparent ? 2 : 1) << 2) | (frameTransparent ? 1 : 0))
    sink.u16le(delay)
    sink.byte(frameTransparent ? transparentIndex : 0)
    sink.byte(0)
    // 图像描述符：整屏、无局部颜色表、不交错
    sink.byte(0x2c)
    sink.u16le(0)
    sink.u16le(0)
    sink.u16le(width)
    sink.u16le(height)
    sink.byte(0)
    writeLzwData(sink, frame.indices, tableBits)
  }

  sink.byte(0x3b)
  return sink.take()
}

/** 帧率 → GIF 帧延迟（1/100 秒）；下限 2，规避播放器把 0/1 当 10 处理 */
export function gifDelayCsFromFps(fps: number): number {
  const safe = Number.isFinite(fps) && fps > 0 ? fps : 10
  return Math.max(2, Math.round(100 / safe))
}

export interface GifQuantizeOptions {
  /** 不透明色数上限；默认按是否含透明取 255 / 256 */
  maxColors?: number
  /** alpha 低于该值按透明处理，默认 128；传 0 关闭透明 */
  alphaThreshold?: number
  /** 中位切分采样上限（跨帧合计），默认 20000 */
  sampleLimit?: number
}

export interface GifQuantizeResult {
  /** 索引 0 为透明占位（含透明时）；可直接交给 encodeGif */
  palette: Array<[number, number, number]>
  /** 每帧调色板索引，长度 = 像素数 */
  frames: Uint8Array[]
  /** 透明色索引；无透明时为 null */
  transparentIndex: number | null
}

interface QuantizeBox {
  items: number[]
  channel: 0 | 1 | 2
  maxRange: number
}

/**
 * 中位切分量化：跨帧统一选一份全局调色板，再把每个像素映射到最近色。
 * 全局调色板（而非逐帧局部表）是刻意的取舍——滑板序列本身同源，全局表体积更小、
 * 且省掉了逐帧颜色表带来的体积膨胀。
 */
export function quantizeGifFrames(
  frames: readonly Uint8ClampedArray[],
  options: GifQuantizeOptions = {}
): GifQuantizeResult {
  const alphaThreshold = Math.max(0, Math.round(options.alphaThreshold ?? 128))
  const sampleLimit = Math.max(1, Math.round(options.sampleLimit ?? 20000))
  const usable = frames.filter((frame) => frame && frame.length >= 4)

  let hasTransparent = false
  let totalPixels = 0
  for (const frame of usable) {
    totalPixels += frame.length >> 2
    if (hasTransparent || alphaThreshold <= 0) continue
    for (let i = 3; i < frame.length; i += 4) {
      if (frame[i] < alphaThreshold) {
        hasTransparent = true
        break
      }
    }
  }

  const limit = Math.min(
    256,
    Math.max(1, Math.round(options.maxColors ?? (hasTransparent ? 255 : 256)))
  )
  const colorLimit = hasTransparent ? Math.min(limit, 255) : limit

  // 采样：按总量算步长，避免大图逐像素进中位切分
  const stride = Math.max(1, Math.ceil(totalPixels / sampleLimit))
  const samples: number[] = []
  let seen = 0
  for (const frame of usable) {
    for (let i = 0; i < frame.length; i += 4) {
      const alpha = frame[i + 3]
      const opaque = alphaThreshold <= 0 || alpha >= alphaThreshold
      if (opaque && seen % stride === 0) samples.push(frame[i], frame[i + 1], frame[i + 2])
      seen += 1
    }
  }

  const colorCount = Math.floor(samples.length / 3)
  const makeBox = (items: number[]): QuantizeBox => {
    let rMin = 255
    let rMax = 0
    let gMin = 255
    let gMax = 0
    let bMin = 255
    let bMax = 0
    for (const idx of items) {
      const base = idx * 3
      const r = samples[base]
      const g = samples[base + 1]
      const b = samples[base + 2]
      if (r < rMin) rMin = r
      if (r > rMax) rMax = r
      if (g < gMin) gMin = g
      if (g > gMax) gMax = g
      if (b < bMin) bMin = b
      if (b > bMax) bMax = b
    }
    const ranges: [number, number, number] = [rMax - rMin, gMax - gMin, bMax - bMin]
    let channel: 0 | 1 | 2 = 0
    if (ranges[1] > ranges[channel]) channel = 1
    if (ranges[2] > ranges[channel]) channel = 2
    return { items, channel, maxRange: Math.max(ranges[0], ranges[1], ranges[2]) }
  }

  const boxes: QuantizeBox[] = []
  const root: number[] = []
  for (let i = 0; i < colorCount; i += 1) root.push(i)
  boxes.push(makeBox(root))

  while (boxes.length < colorLimit) {
    let pick = -1
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i]
      if (box.items.length < 2 || box.maxRange <= 0) continue
      if (pick < 0 || box.maxRange > boxes[pick].maxRange) pick = i
    }
    if (pick < 0) break
    const box = boxes[pick]
    const channel = box.channel
    box.items.sort((a, b) => samples[a * 3 + channel] - samples[b * 3 + channel])
    const mid = box.items.length >> 1
    boxes.splice(pick, 1, makeBox(box.items.slice(0, mid)), makeBox(box.items.slice(mid)))
  }

  const colors: Array<[number, number, number]> = boxes.map((box) => {
    if (!box.items.length) return [0, 0, 0]
    let r = 0
    let g = 0
    let b = 0
    for (const idx of box.items) {
      const base = idx * 3
      r += samples[base]
      g += samples[base + 1]
      b += samples[base + 2]
    }
    const n = box.items.length
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
  })
  if (!colors.length) colors.push([0, 0, 0])

  const transparentIndex = hasTransparent ? 0 : null
  const offset = hasTransparent ? 1 : 0
  const palette: Array<[number, number, number]> = hasTransparent ? [[0, 0, 0], ...colors] : colors

  // 最近色查找带 5 位/通道的缓存表：量化后像素远少于 32768 种组合
  const cache = new Int16Array(32768).fill(-1)
  const nearest = (r: number, g: number, b: number): number => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const cached = cache[key]
    if (cached >= 0) return cached
    let best = 0
    let bestDist = Number.POSITIVE_INFINITY
    for (let i = 0; i < colors.length; i += 1) {
      const color = colors[i]
      const dr = r - color[0]
      const dg = g - color[1]
      const db = b - color[2]
      const dist = dr * dr + dg * dg + db * db
      if (dist < bestDist) {
        bestDist = dist
        best = i
        if (dist === 0) break
      }
    }
    cache[key] = best
    return best
  }

  const outFrames = usable.map((frame) => {
    const out = new Uint8Array(frame.length >> 2)
    for (let i = 0, p = 0; i < frame.length; i += 4, p += 1) {
      const alpha = frame[i + 3]
      if (hasTransparent && alpha < alphaThreshold) {
        out[p] = transparentIndex as number
        continue
      }
      out[p] = nearest(frame[i], frame[i + 1], frame[i + 2]) + offset
    }
    return out
  })

  return { palette, frames: outFrames, transparentIndex }
}
