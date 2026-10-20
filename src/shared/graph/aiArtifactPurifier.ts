/**
 * AI 频谱伪影净化与「真机相机 EXIF 元数据」注入器
 * （AI-Artifact Purifier & Camera EXIF/PNG Metadata Injector）
 *
 * 1. 滤除大模型生图常见的 2×2 / 4×4 微棋盘格高频伪影与塑料水彩涂抹感，同时保护真实结构边缘
 * 2. 注入符合全画幅拜耳 CMOS 物理信噪比规律的泊松-高斯光学底噪（消除「AI 一眼假」）
 * 3. 在导出 PNG 中注入哈苏 / 索尼 / 徕卡 / 阿莱等真机相机与镜头拍摄元数据（无缝归档至 Lightroom / Capture One）
 */

export type CameraProfilePresetId =
  'hasselblad-x2d' | 'sony-a7rv-gm' | 'leica-m11-noctilux' | 'arri-alexa35'

export interface CameraExifMetadata {
  presetId: CameraProfilePresetId
  make: string
  model: string
  lensModel: string
  focalLengthMm: number
  fNumber: number
  iso: number
  exposureTime: string
  colorSpace: 'Display P3' | 'Adobe RGB (1998)' | 'sRGB IEC61966-2.1' | 'ARRI Wide Gamut 4'
  software: string
  capturedAtIso: string
}

export const CAMERA_PROFILE_PRESETS: Readonly<
  Record<CameraProfilePresetId, Omit<CameraExifMetadata, 'capturedAtIso'>>
> = {
  'hasselblad-x2d': {
    presetId: 'hasselblad-x2d',
    make: 'Hasselblad',
    model: 'X2D 100C',
    lensModel: 'XCD 2,5/90V',
    focalLengthMm: 90,
    fNumber: 2.5,
    iso: 64,
    exposureTime: '1/250',
    colorSpace: 'Display P3',
    software: 'Phocus 3.8 / AI Art Engine Studio'
  },
  'sony-a7rv-gm': {
    presetId: 'sony-a7rv-gm',
    make: 'SONY',
    model: 'ILCE-7RM5',
    lensModel: 'FE 85mm F1.4 GM II',
    focalLengthMm: 85,
    fNumber: 1.4,
    iso: 100,
    exposureTime: '1/500',
    colorSpace: 'Adobe RGB (1998)',
    software: 'Capture One 16 Pro / AI Art Engine Studio'
  },
  'leica-m11-noctilux': {
    presetId: 'leica-m11-noctilux',
    make: 'Leica Camera AG',
    model: 'LEICA M11',
    lensModel: 'Noctilux-M 1:0.95/50 ASPH.',
    focalLengthMm: 50,
    fNumber: 0.95,
    iso: 64,
    exposureTime: '1/1000',
    colorSpace: 'sRGB IEC61966-2.1',
    software: 'Leica Firmware 2.1 / AI Art Engine Studio'
  },
  'arri-alexa35': {
    presetId: 'arri-alexa35',
    make: 'ARRI',
    model: 'ALEXA 35',
    lensModel: 'ARRI Master Anamorphic 50mm T1.9',
    focalLengthMm: 50,
    fNumber: 1.9,
    iso: 800,
    exposureTime: '1/48',
    colorSpace: 'ARRI Wide Gamut 4',
    software: 'DaVinci Resolve Studio / AI Art Engine Studio'
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * 确定性伪随机数发生器（xorshift32），保证相同 seed 下传感器光学微粒完全可复现
 */
function nextRng01(state: { s: number }): number {
  let x = state.s | 0
  if (x === 0) x = 0x6d2b79f5
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  state.s = x
  return ((x >>> 0) % 100000) / 100000
}

/**
 * 滤除 AI 生图高频棋盘格伪影（Micro-Checkerboard De-Ringing）并注入真实全画幅 CMOS 泊松-高斯光学微粒
 */
export function purifyAiArtifactsAndInjectSensorGrainRgba(
  sourcePixels: Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    /** 高频微棋盘格伪影抑制强度 0..1，默认 0.65 */
    decheckerStrength?: number
    /** 拜耳传感器物理微颗粒注入强度 0..1，默认 0.28 */
    sensorNoiseStrength?: number
    /** 随机种子，默认 20261020 */
    seed?: number
  }
): {
  pixels: Uint8ClampedArray
  /** 被抑制的高频棋盘振荡能量比（0..100） */
  artifactReductionScore: number
} {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const dechecker = clamp01(options?.decheckerStrength ?? 0.65)
  const noiseStrength = clamp01(options?.sensorNoiseStrength ?? 0.28)
  const rng = { s: (options?.seed ?? 20261020) | 0 }

  const out = new Uint8ClampedArray(sourcePixels.length)
  let suppressedOscillationSum = 0
  let pixelCount = 0

  for (let y = 0; y < h; y++) {
    const yUp = Math.max(0, y - 1)
    const yDown = Math.min(h - 1, y + 1)
    for (let x = 0; x < w; x++) {
      const xLeft = Math.max(0, x - 1)
      const xRight = Math.min(w - 1, x + 1)
      const idx = (y * w + x) * 4

      const pUp = (yUp * w + x) * 4
      const pDown = (yDown * w + x) * 4
      const pLeft = (y * w + xLeft) * 4
      const pRight = (y * w + xRight) * 4

      // 产生 1 个近似高斯分布的传感器散粒噪声样本（Box-Muller 简化均值法）
      const n1 = nextRng01(rng) + nextRng01(rng) + nextRng01(rng) - 1.5
      const nChroma = (nextRng01(rng) - 0.5) * 0.35

      for (let c = 0; c < 3; c++) {
        const center = sourcePixels[idx + c] ?? 0
        const up = sourcePixels[pUp + c] ?? center
        const down = sourcePixels[pDown + c] ?? center
        const left = sourcePixels[pLeft + c] ?? center
        const right = sourcePixels[pRight + c] ?? center

        const crossAvg = (up + down + left + right) * 0.25
        const diff = center - crossAvg
        // 判断是否为单像素孤立高频棋盘尖峰（四邻域同向偏离中心但彼此接近）
        const neighborSpread = Math.max(Math.abs(up - down), Math.abs(left - right))
        const isCheckerboardSpike = Math.abs(diff) > neighborSpread * 0.65 && Math.abs(diff) < 28

        let filtered = center
        if (dechecker > 0.01 && isCheckerboardSpike) {
          const damp = dechecker * 0.75
          filtered = center - diff * damp
          suppressedOscillationSum += Math.abs(diff * damp)
        }

        // 注入符合 CMOS 泊松散粒噪声（Shot Noise 随信号平方根增长，在中暗部最明显）的物理颗粒
        if (noiseStrength > 0.005) {
          const normSignal = filtered / 255
          const shotSigma = Math.sqrt(Math.max(0.04, normSignal * (1 - normSignal * 0.45)))
          const grainDelta =
            (n1 + (c === 1 ? 0 : c === 0 ? nChroma : -nChroma)) * shotSigma * noiseStrength * 14.5
          filtered += grainDelta
        }

        out[idx + c] = Math.round(clamp(filtered, 0, 255))
      }

      out[idx + 3] = sourcePixels[idx + 3] ?? 255
      pixelCount++
    }
  }

  const avgSuppressed = pixelCount > 0 ? suppressedOscillationSum / (pixelCount * 3) : 0
  const artifactReductionScore = Math.round(clamp(avgSuppressed * 18, 0, 100))

  return {
    pixels: out,
    artifactReductionScore
  }
}

/**
 * 构建标准专业相机拍摄元数据对象
 */
export function buildCameraExifProfileMetadata(
  presetId: CameraProfilePresetId = 'hasselblad-x2d',
  customOverrides?: Partial<CameraExifMetadata>
): CameraExifMetadata {
  const base = CAMERA_PROFILE_PRESETS[presetId] ?? CAMERA_PROFILE_PRESETS['hasselblad-x2d']
  return {
    ...base,
    capturedAtIso: customOverrides?.capturedAtIso ?? new Date().toISOString(),
    ...customOverrides
  }
}

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const CAMERA_TEXT_KEYWORD = 'aiae:camera'

function crc32Bytes(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
  }
  return (c ^ 0xffffffff) >>> 0
}

function writeU32BE(target: Uint8Array, offset: number, val: number): void {
  target[offset] = (val >>> 24) & 0xff
  target[offset + 1] = (val >>> 16) & 0xff
  target[offset + 2] = (val >>> 8) & 0xff
  target[offset + 3] = val & 0xff
}

function readU32BE(source: Uint8Array, offset: number): number {
  return (
    ((source[offset]! << 24) |
      (source[offset + 1]! << 16) |
      (source[offset + 2]! << 8) |
      source[offset + 3]!) >>>
    0
  )
}

function makePngTextChunk(keyword: string, textValue: string): Uint8Array {
  const keyBytes = new TextEncoder().encode(keyword)
  const valBytes = new TextEncoder().encode(textValue)
  const dataLen = keyBytes.length + 1 + valBytes.length
  const chunk = new Uint8Array(12 + dataLen)
  writeU32BE(chunk, 0, dataLen)
  chunk[4] = 0x74 // 't'
  chunk[5] = 0x45 // 'E'
  chunk[6] = 0x58 // 'X'
  chunk[7] = 0x74 // 't'
  chunk.set(keyBytes, 8)
  chunk[8 + keyBytes.length] = 0
  chunk.set(valBytes, 8 + keyBytes.length + 1)
  const crc = crc32Bytes(chunk.subarray(4, 8 + dataLen))
  writeU32BE(chunk, 8 + dataLen, crc)
  return chunk
}

/**
 * 将真机相机拍摄参数写入 PNG 文件字节流（含标准 `Make` / `Model` / `Software` 与结构化 `aiae:camera` 块）
 */
export function embedCameraMetadataInPngBytes(
  pngBytes: Uint8Array,
  metadata: CameraExifMetadata
): Uint8Array {
  if (pngBytes.length < 8) return pngBytes
  for (let i = 0; i < 8; i++) {
    if (pngBytes[i] !== PNG_SIG[i]) return pngBytes
  }

  const chunksToInsert = [
    makePngTextChunk('Make', metadata.make),
    makePngTextChunk('Model', metadata.model),
    makePngTextChunk('LensModel', metadata.lensModel),
    makePngTextChunk('Software', metadata.software),
    makePngTextChunk(CAMERA_TEXT_KEYWORD, JSON.stringify(metadata))
  ]

  const kept: Uint8Array[] = [pngBytes.subarray(0, 8)]
  let offset = 8
  let inserted = false

  while (offset + 8 <= pngBytes.length) {
    const len = readU32BE(pngBytes, offset)
    const end = offset + 12 + len
    if (end > pngBytes.length) break
    const type = String.fromCharCode(
      pngBytes[offset + 4]!,
      pngBytes[offset + 5]!,
      pngBytes[offset + 6]!,
      pngBytes[offset + 7]!
    )
    if (type === 'IEND' && !inserted) {
      kept.push(...chunksToInsert)
      inserted = true
    }
    kept.push(pngBytes.subarray(offset, end))
    offset = end
  }
  if (!inserted) {
    kept.push(...chunksToInsert)
  }

  const totalLen = kept.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(totalLen)
  let pos = 0
  for (const part of kept) {
    out.set(part, pos)
    pos += part.length
  }
  return out
}

/**
 * 从 PNG 字节流中读取已注入的真机相机拍摄元数据
 */
export function extractCameraMetadataFromPngBytes(pngBytes: Uint8Array): CameraExifMetadata | null {
  if (pngBytes.length < 8) return null
  for (let i = 0; i < 8; i++) {
    if (pngBytes[i] !== PNG_SIG[i]) return null
  }

  let offset = 8
  while (offset + 8 <= pngBytes.length) {
    const len = readU32BE(pngBytes, offset)
    const end = offset + 12 + len
    if (end > pngBytes.length) break
    const type = String.fromCharCode(
      pngBytes[offset + 4]!,
      pngBytes[offset + 5]!,
      pngBytes[offset + 6]!,
      pngBytes[offset + 7]!
    )
    if (type === 'tEXt') {
      const slice = pngBytes.subarray(offset + 8, offset + 8 + len)
      const nullIdx = slice.indexOf(0)
      if (nullIdx > 0) {
        const key = new TextDecoder().decode(slice.subarray(0, nullIdx))
        if (key === CAMERA_TEXT_KEYWORD) {
          try {
            const val = new TextDecoder().decode(slice.subarray(nullIdx + 1))
            return JSON.parse(val) as CameraExifMetadata
          } catch {
            return null
          }
        }
      }
    }
    if (type === 'IEND') break
    offset = end
  }
  return null
}
