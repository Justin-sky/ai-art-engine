/**
 * GIF87a / GIF89a 解码器（纯 TS、零依赖）。
 *
 * 配合 gifEncode.ts 使用，支持将任意标准 GIF 二进制流或 dataUrl 拆解为逐帧 RGBA 像素数据：
 * - 支持全局调色板 (GCT) 与局部调色板 (LCT)
 * - 支持图形控制扩展（GCE）：透明色索引、单帧延时 (delayCs)、帧处置方式 (Disposal Method 0..3)
 * - 支持 4 遍交错 (Interlaced) 渲染
 * - 支持累积画布复合（Disposal 还原与透明叠加，确保拆出的每一帧都是完整的独立视图）
 */

export interface DecodedGifFrame {
  /** 完整画布尺寸的 RGBA 像素数据（长度 = canvasWidth * canvasHeight * 4） */
  rgba: Uint8ClampedArray
  /** 该帧在原动画中的延时（1/100 秒，如 10 = 100ms 即 10fps） */
  delayCs: number
  /** 该帧的局部偏移与画幅尺寸（用于高级精灵裁剪） */
  dims: { left: number; top: number; width: number; height: number }
  /** 帧处置方式：0 未指定, 1 保留, 2 还原为背景/透明, 3 还原为上一帧 */
  disposalMethod: number
  /** 是否含有透明像素 */
  transparent: boolean
}

export interface DecodedGif {
  width: number
  height: number
  loopCount: number | null
  frames: DecodedGifFrame[]
}

/** LZW 解压算法 */
function decompressLzw(subBlocks: Uint8Array, minCodeSize: number, pixelCount: number): Uint8Array {
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  let codeSize = minCodeSize + 1
  let dict: number[][] = []

  const resetDict = (): void => {
    dict = []
    for (let i = 0; i < clearCode; i++) dict.push([i])
    dict.push([]) // clearCode 占位
    dict.push([]) // endCode 占位
  }
  resetDict()

  const out = new Uint8Array(pixelCount)
  let outPos = 0
  let bitPos = 0
  const totalBits = subBlocks.length * 8

  const readCode = (): number => {
    if (bitPos + codeSize > totalBits) return endCode
    let code = 0
    for (let i = 0; i < codeSize; i++) {
      const bit = (subBlocks[(bitPos + i) >> 3] >> ((bitPos + i) & 7)) & 1
      code |= bit << i
    }
    bitPos += codeSize
    return code
  }

  let prev: number[] | null = null

  while (outPos < pixelCount && bitPos + codeSize <= totalBits) {
    const code = readCode()
    if (code === clearCode) {
      resetDict()
      codeSize = minCodeSize + 1
      prev = null
      continue
    }
    if (code === endCode) break

    let entry: number[]
    if (code < dict.length && dict[code].length) {
      entry = dict[code]
    } else if (prev && code === dict.length) {
      entry = [...prev, prev[0]]
    } else {
      break
    }

    for (let i = 0; i < entry.length && outPos < pixelCount; i++) {
      out[outPos++] = entry[i]
    }

    if (prev && dict.length < 4096) {
      dict.push([...prev, entry[0]])
      if (dict.length >= 1 << codeSize && codeSize < 12) {
        codeSize++
      }
    }
    prev = entry
  }

  return out
}

/** 4-Pass 交错行号映射表 */
function buildInterlaceRowMap(height: number): number[] {
  const rows = new Array<number>(height)
  let idx = 0
  // Pass 1: 行 0, 步长 8
  for (let r = 0; r < height; r += 8) rows[idx++] = r
  // Pass 2: 行 4, 步长 8
  for (let r = 4; r < height; r += 8) rows[idx++] = r
  // Pass 3: 行 2, 步长 4
  for (let r = 2; r < height; r += 4) rows[idx++] = r
  // Pass 4: 行 1, 步长 2
  for (let r = 1; r < height; r += 2) rows[idx++] = r
  return rows
}

/** 解析 GIF 二进制字节流 */
export function decodeGif(input: Uint8Array | ArrayBuffer): DecodedGif {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length < 14) {
    throw new Error('GIF_DECODE_INVALID_LENGTH')
  }

  let p = 0
  const u8 = (): number => bytes[p++]
  const u16 = (): number => {
    const val = bytes[p] | (bytes[p + 1] << 8)
    p += 2
    return val
  }
  const ascii = (n: number): string => {
    let s = ''
    for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[p + i])
    p += n
    return s
  }

  // 1. Header
  const sig = ascii(6)
  if (sig !== 'GIF89a' && sig !== 'GIF87a') {
    throw new Error(`GIF_DECODE_INVALID_SIGNATURE: ${sig}`)
  }

  // 2. Logical Screen Descriptor
  const canvasWidth = u16()
  const canvasHeight = u16()
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    throw new Error('GIF_DECODE_INVALID_DIMENSIONS')
  }

  const packed = u8()
  const hasGct = (packed & 0x80) !== 0
  const gctSize = hasGct ? 1 << ((packed & 0x07) + 1) : 0
  u8() // bgIndex
  u8() // pixelAspectRatio

  // 3. Global Color Table (RGB triplets)
  const globalPalette: number[][] = []
  if (hasGct) {
    for (let i = 0; i < gctSize; i++) {
      globalPalette.push([u8(), u8(), u8()])
    }
  }

  let loopCount: number | null = null
  const frames: DecodedGifFrame[] = []

  // 当前帧控制状态
  let currentDelayCs = 10
  let currentDisposal = 0
  let currentTransparentIndex: number | null = null

  // 累积画布缓冲区 (RGBA)
  let canvas = new Uint8ClampedArray(canvasWidth * canvasHeight * 4)
  let previousCanvas: Uint8ClampedArray | null = null

  // 4. 解析块 (Blocks)
  while (p < bytes.length) {
    const introducer = u8()
    if (introducer === 0x3b) {
      // 尾部 Trailer
      break
    }

    if (introducer === 0x21) {
      // Extension
      const label = u8()
      if (label === 0xf9) {
        // Graphic Control Extension
        const blockSize = u8()
        if (blockSize === 4) {
          const gcePacked = u8()
          currentDisposal = (gcePacked >> 2) & 7
          const hasTransparent = (gcePacked & 1) !== 0
          currentDelayCs = u16()
          const tIdx = u8()
          currentTransparentIndex = hasTransparent ? tIdx : null
        } else {
          p += blockSize
        }
        u8() // block terminator (0x00)
      } else if (label === 0xff) {
        // Application Extension
        const blockSize = u8()
        const appName = ascii(blockSize)
        // 收集子块
        while (p < bytes.length) {
          const subLen = u8()
          if (subLen === 0) break
          if (appName.startsWith('NETSCAPE2.0') && subLen >= 3 && bytes[p] === 1) {
            loopCount = bytes[p + 1] | (bytes[p + 2] << 8)
          }
          p += subLen
        }
      } else {
        // 其它扩展（注释/文本等），跳过子块
        while (p < bytes.length) {
          const subLen = u8()
          if (subLen === 0) break
          p += subLen
        }
      }
    } else if (introducer === 0x2c) {
      // Image Descriptor
      const left = u16()
      const top = u16()
      const width = u16()
      const height = u16()
      const imgPacked = u8()
      const hasLct = (imgPacked & 0x80) !== 0
      const isInterlaced = (imgPacked & 0x40) !== 0
      const lctSize = hasLct ? 1 << ((imgPacked & 0x07) + 1) : 0

      const localPalette: number[][] = []
      if (hasLct) {
        for (let i = 0; i < lctSize; i++) {
          localPalette.push([u8(), u8(), u8()])
        }
      }
      const palette = hasLct ? localPalette : globalPalette

      // 收集并解压图像子块数据
      const minCodeSize = u8()
      const chunks: Uint8Array[] = []
      let totalBytes = 0
      while (p < bytes.length) {
        const subLen = u8()
        if (subLen === 0) break
        chunks.push(bytes.subarray(p, p + subLen))
        totalBytes += subLen
        p += subLen
      }

      const compressed = new Uint8Array(totalBytes)
      let cPos = 0
      for (const ch of chunks) {
        compressed.set(ch, cPos)
        cPos += ch.length
      }

      const pixelCount = width * height
      const indices = decompressLzw(compressed, minCodeSize, pixelCount)

      // 保存处理前的快照（用于 disposal = 3）
      if (currentDisposal === 3) {
        previousCanvas = new Uint8ClampedArray(canvas)
      } else {
        previousCanvas = null
      }

      // 如果这是第一帧且没有内容，可用背景色初始化画布
      let frameHasTransparency = false
      const interlaceRows = isInterlaced ? buildInterlaceRowMap(height) : null

      // 将当前图片块渲染叠加到累积画布上
      for (let y = 0; y < height; y++) {
        const targetY = top + (interlaceRows ? interlaceRows[y] : y)
        if (targetY < 0 || targetY >= canvasHeight) continue

        for (let x = 0; x < width; x++) {
          const targetX = left + x
          if (targetX < 0 || targetX >= canvasWidth) continue

          const pixelIdx = y * width + x
          const colorIdx = indices[pixelIdx]

          if (currentTransparentIndex !== null && colorIdx === currentTransparentIndex) {
            frameHasTransparency = true
            // 透明像素不覆盖画布原有内容
            continue
          }

          const color = palette[colorIdx] ?? [0, 0, 0]
          const cOffset = (targetY * canvasWidth + targetX) * 4
          canvas[cOffset] = color[0]
          canvas[cOffset + 1] = color[1]
          canvas[cOffset + 2] = color[2]
          canvas[cOffset + 3] = 255
        }
      }

      // 存储本帧独立快照（供展示与编辑）
      const snapshot = new Uint8ClampedArray(canvas)
      frames.push({
        rgba: snapshot,
        delayCs: Math.max(1, currentDelayCs || 10),
        dims: { left, top, width, height },
        disposalMethod: currentDisposal,
        transparent: frameHasTransparency || currentTransparentIndex !== null
      })

      // 帧后处置 (Post-Frame Disposal)
      if (currentDisposal === 2) {
        // Restore to Background (在局部区域恢复透明或背景色)
        for (let y = 0; y < height; y++) {
          const targetY = top + y
          if (targetY < 0 || targetY >= canvasHeight) continue
          for (let x = 0; x < width; x++) {
            const targetX = left + x
            if (targetX < 0 || targetX >= canvasWidth) continue
            const cOffset = (targetY * canvasWidth + targetX) * 4
            canvas[cOffset] = 0
            canvas[cOffset + 1] = 0
            canvas[cOffset + 2] = 0
            canvas[cOffset + 3] = 0
          }
        }
      } else if (currentDisposal === 3 && previousCanvas) {
        // Restore to Previous (恢复上一帧状态)
        canvas.set(previousCanvas)
      }
      // disposal === 1 (Do Not Dispose) 则保留画布作为下一帧底图

      // 重置单帧控制参数到下一帧默认值
      currentDelayCs = 10
      currentDisposal = 0
      currentTransparentIndex = null
    }
  }

  return {
    width: canvasWidth,
    height: canvasHeight,
    loopCount,
    frames
  }
}

/** 嗅探是否为 GIF 二进制流（检查 'GIF87a' 或 'GIF89a' 魔数） */
export function isGifBuffer(bytes: Uint8Array): boolean {
  if (bytes.length < 6) return false
  const sig =
    String.fromCharCode(bytes[0], bytes[1], bytes[2]) +
    String.fromCharCode(bytes[3], bytes[4], bytes[5])
  return sig === 'GIF89a' || sig === 'GIF87a'
}

/** 从 Base64 Data URL 解析为 Uint8Array */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
