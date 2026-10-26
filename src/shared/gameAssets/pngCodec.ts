import type { ProceduralLevelMapResult } from './proceduralLevelMap'

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  const MOD = 65521
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]!) % MOD
    b = (b + a) % MOD
  }
  return ((b << 16) | a) >>> 0
}

function writeUint32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff
  buf[offset + 1] = (value >>> 16) & 0xff
  buf[offset + 2] = (value >>> 8) & 0xff
  buf[offset + 3] = value & 0xff
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length)
  writeUint32BE(chunk, 0, data.length)
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i) & 0xff
  }
  chunk.set(data, 8)
  const crc = crc32(chunk.subarray(4, 8 + data.length))
  writeUint32BE(chunk, 8 + data.length, crc)
  return chunk
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  }
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

/**
 * 纯算法零依赖 RGBA → 标准 PNG DataURL 编码器（支持 Node 与浏览器双端）。
 * 使用 zlib store blocks 封装原始扫描线，无需第三方 native 依赖即可产出合法 PNG。
 */
export function encodeRgbaToPngDataUrl(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): string {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const rowBytes = w * 4 + 1
  const rawScanlines = new Uint8Array(rowBytes * h)

  for (let y = 0; y < h; y++) {
    const rowStart = y * rowBytes
    rawScanlines[rowStart] = 0 // Filter type 0 (None)
    const srcStart = y * w * 4
    for (let i = 0; i < w * 4; i++) {
      rawScanlines[rowStart + 1 + i] = rgba[srcStart + i] ?? 0
    }
  }

  // Zlib stream with uncompressed deflate blocks (max 65535 bytes per block)
  const maxBlock = 65535
  const numBlocks = Math.max(1, Math.ceil(rawScanlines.length / maxBlock))
  const zlibData = new Uint8Array(2 + rawScanlines.length + numBlocks * 5 + 4)
  zlibData[0] = 0x78 // CMF
  zlibData[1] = 0x01 // FLG (no compression, valid check bits)

  let inOffset = 0
  let outOffset = 2
  for (let b = 0; b < numBlocks; b++) {
    const isLast = b === numBlocks - 1
    const blockLen = Math.min(maxBlock, rawScanlines.length - inOffset)
    zlibData[outOffset++] = isLast ? 0x01 : 0x00
    zlibData[outOffset++] = blockLen & 0xff
    zlibData[outOffset++] = (blockLen >>> 8) & 0xff
    const nlen = ~blockLen & 0xffff
    zlibData[outOffset++] = nlen & 0xff
    zlibData[outOffset++] = (nlen >>> 8) & 0xff
    zlibData.set(rawScanlines.subarray(inOffset, inOffset + blockLen), outOffset)
    outOffset += blockLen
    inOffset += blockLen
  }

  writeUint32BE(zlibData, outOffset, adler32(rawScanlines))
  outOffset += 4

  const ihdr = new Uint8Array(13)
  writeUint32BE(ihdr, 0, w)
  writeUint32BE(ihdr, 4, h)
  ihdr[8] = 8 // bit depth 8
  ihdr[9] = 6 // color type 6 (RGBA)
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdrChunk = makePngChunk('IHDR', ihdr)
  const idatChunk = makePngChunk('IDAT', zlibData.subarray(0, outOffset))
  const iendChunk = makePngChunk('IEND', new Uint8Array(0))

  const png = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  )
  let pos = 0
  png.set(signature, pos)
  pos += signature.length
  png.set(ihdrChunk, pos)
  pos += ihdrChunk.length
  png.set(idatChunk, pos)
  pos += idatChunk.length
  png.set(iendChunk, pos)

  return `data:image/png;base64,${bytesToBase64(png)}`
}

export type PbrMaterialPreset =
  'stone_dungeon' | 'brushed_metal' | 'wet_mud' | 'stylized_wood' | 'gold_ornament'

/**
 * 生成一张程序化材质贴图（支持 5 类典型游戏材质预设：地牢石砖、拉丝金属装甲、潮湿泥沼、风格化木板、流光金框）。
 */
export function createProceduralMaterialTileRgba(
  preset: PbrMaterialPreset = 'stone_dungeon',
  width = 64,
  height = 64
): { width: number; height: number; data: Uint8ClampedArray } {
  const w = Math.max(8, Math.floor(width))
  const h = Math.max(8, Math.floor(height))
  const data = new Uint8ClampedArray(w * h * 4)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4
      const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0
      const grain = (hash % 19) - 9

      if (preset === 'brushed_metal') {
        const streak = ((((y * 2654435761) ^ ((x >> 3) * 19349663)) >>> 0) % 24) - 12
        const rivetX = x % 32 === 4 || x % 32 === 27
        const rivetY = y % 32 === 4 || y % 32 === 27
        const isRivet = rivetX && rivetY
        const seam = x % 32 === 0 || y % 32 === 0
        const base = seam ? 52 : isRivet ? 195 : 138 + streak + (grain >> 1)
        data[idx] = Math.max(0, Math.min(255, base - 6))
        data[idx + 1] = Math.max(0, Math.min(255, base))
        data[idx + 2] = Math.max(0, Math.min(255, base + 14))
        data[idx + 3] = 255
      } else if (preset === 'wet_mud') {
        const wave = Math.sin((x / w) * Math.PI * 4) * Math.cos((y / h) * Math.PI * 4)
        const puddle = wave > 0.35
        const r = puddle ? 72 + (grain >> 1) : 64 + grain
        const g = puddle ? 62 + (grain >> 1) : 48 + grain
        const b = puddle ? 58 + (grain >> 1) : 36 + grain
        data[idx] = Math.max(0, Math.min(255, r))
        data[idx + 1] = Math.max(0, Math.min(255, g))
        data[idx + 2] = Math.max(0, Math.min(255, b))
        data[idx + 3] = 255
      } else if (preset === 'stylized_wood') {
        const plankRow = Math.floor(y / 16)
        const plankSeamY = y % 16 === 0
        const plankSeamX = (x + plankRow * 24) % 48 === 0
        const ring = Math.round(Math.sin(x * 0.25 + plankRow * 1.7 + Math.sin(y * 0.4) * 1.2) * 12)
        const r = plankSeamY || plankSeamX ? 46 : 136 + ring + (grain >> 1)
        const g = plankSeamY || plankSeamX ? 30 : 92 + ring + (grain >> 1)
        const b = plankSeamY || plankSeamX ? 20 : 54 + (ring >> 1)
        data[idx] = Math.max(0, Math.min(255, r))
        data[idx + 1] = Math.max(0, Math.min(255, g))
        data[idx + 2] = Math.max(0, Math.min(255, b))
        data[idx + 3] = 255
      } else if (preset === 'gold_ornament') {
        const bx = Math.min(x, w - 1 - x)
        const by = Math.min(y, h - 1 - y)
        const borderDist = Math.min(bx, by)
        const isFrame = borderDist >= 2 && borderDist <= 9
        const isOuterVoid = borderDist < 2
        if (isOuterVoid) {
          data[idx] = 0
          data[idx + 1] = 0
          data[idx + 2] = 0
          data[idx + 3] = 0
        } else if (isFrame) {
          const bevel = borderDist === 5 || borderDist === 6 ? 35 : -10
          data[idx] = Math.max(0, Math.min(255, 218 + bevel + (grain >> 1)))
          data[idx + 1] = Math.max(0, Math.min(255, 172 + bevel + (grain >> 1)))
          data[idx + 2] = Math.max(0, Math.min(255, 68 + (bevel >> 1)))
          data[idx + 3] = 255
        } else {
          data[idx] = Math.max(0, Math.min(255, 42 + (grain >> 2)))
          data[idx + 1] = Math.max(0, Math.min(255, 48 + (grain >> 2)))
          data[idx + 2] = Math.max(0, Math.min(255, 68 + (grain >> 2)))
          data[idx + 3] = 255
        }
      } else {
        const brickRow = Math.floor(y / 16)
        const offsetX = brickRow % 2 === 0 ? 0 : 16
        const isMortarY = y % 16 === 0 || y % 16 === 15
        const isMortarX = (x + offsetX) % 32 === 0 || (x + offsetX) % 32 === 31
        const isMortar = isMortarX || isMortarY
        const baseR = isMortar ? 32 : 86 + grain
        const baseG = isMortar ? 36 : 94 + grain
        const baseB = isMortar ? 48 : 114 + grain
        data[idx] = Math.max(0, Math.min(255, baseR))
        data[idx + 1] = Math.max(0, Math.min(255, baseG))
        data[idx + 2] = Math.max(0, Math.min(255, baseB))
        data[idx + 3] = 255
      }
    }
  }
  return { width: w, height: h, data }
}

/**
 * 生成一张程序化地牢石砖测试贴图（当节点未接入外部贴图或处于离线测试环境时兜底）。
 */
export function createProceduralStoneTileRgba(
  width = 64,
  height = 64
): { width: number; height: number; data: Uint8ClampedArray } {
  return createProceduralMaterialTileRgba('stone_dungeon', width, height)
}

/**
 * 将 `generateProceduralLevelMap` 产出的 2D 关卡矩阵渲染为高对比度像素预览图（RGBA + PNG DataURL）。
 * 墙体、地板、陷阱、平台、玩家出生点、Boss 房、宝箱、怪物刷新点与传送门均一目了然。
 */
export function renderProceduralLevelToPng(
  level: ProceduralLevelMapResult,
  cellPx = 12
): { width: number; height: number; data: Uint8ClampedArray; dataUrl: string } {
  const cell = Math.max(4, Math.min(24, Math.floor(cellPx)))
  const imgW = level.width * cell
  const imgH = level.height * cell
  const data = new Uint8ClampedArray(imgW * imgH * 4)

  const setPx = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || x >= imgW || y < 0 || y >= imgH) return
    const i = (y * imgW + x) * 4
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }

  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      const tile = level.grid[ty]?.[tx] ?? 'wall'
      const aboveTile = ty > 0 ? (level.grid[ty - 1]?.[tx] ?? 'wall') : 'wall'
      const x0 = tx * cell
      const y0 = ty * cell

      for (let py = 0; py < cell; py++) {
        for (let px = 0; px < cell; px++) {
          if (tile === 'wall' || tile === 'void') {
            const isBevelTop = aboveTile !== 'wall' && aboveTile !== 'void' && py < 2
            const isMortar = py === cell - 1 || (px + (ty % 2) * (cell >> 1)) % cell === 0
            const r = isBevelTop ? 74 : isMortar ? 24 : 42
            const g = isBevelTop ? 85 : isMortar ? 28 : 48
            const b = isBevelTop ? 118 : isMortar ? 42 : 70
            setPx(x0 + px, y0 + py, r, g, b)
          } else if (tile === 'hazard') {
            const wave = (px + py + tx * 3) % 6 < 3
            setPx(x0 + px, y0 + py, wave ? 235 : 185, wave ? 94 : 52, 48)
          } else if (tile === 'platform') {
            const isTop = py < 3
            setPx(x0 + px, y0 + py, isTop ? 224 : 148, isTop ? 175 : 104, isTop ? 104 : 52)
          } else {
            const checker = (tx + ty) % 2 === 0
            const isBorder = px === 0 || py === 0
            const base = checker ? 22 : 26
            const delta = isBorder ? -3 : 0
            setPx(x0 + px, y0 + py, base + delta, base + 3 + delta, base + 12 + delta)
          }
        }
      }
    }
  }

  // Draw room outlines lightly
  for (const room of level.rooms) {
    const rx0 = room.x * cell
    const ry0 = room.y * cell
    const rw = room.width * cell
    const rh = room.height * cell
    const [rr, rg, rb] =
      room.role === 'start'
        ? [42, 195, 222]
        : room.role === 'boss'
          ? [247, 118, 142]
          : room.role === 'treasure'
            ? [224, 175, 104]
            : [86, 95, 137]
    for (let x = rx0; x < rx0 + rw; x += 2) {
      setPx(x, ry0, rr, rg, rb)
      setPx(x, ry0 + rh - 1, rr, rg, rb)
    }
    for (let y = ry0; y < ry0 + rh; y += 2) {
      setPx(rx0, y, rr, rg, rb)
      setPx(rx0 + rw - 1, y, rr, rg, rb)
    }
  }

  // Draw entity markers
  for (const ent of level.entities) {
    const cx = Math.floor((ent.gridX + 0.5) * cell)
    const cy = Math.floor((ent.gridY + 0.5) * cell)
    const rad = Math.max(2, Math.floor(cell * 0.36))
    const [er, eg, eb] =
      ent.type === 'player_spawn'
        ? [42, 195, 222]
        : ent.type === 'boss_spawn'
          ? [247, 118, 142]
          : ent.type === 'treasure_chest' || ent.type === 'coin'
            ? [224, 175, 104]
            : ent.type === 'exit_portal'
              ? [115, 218, 202]
              : [187, 154, 247]

    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy <= rad * rad) {
          const isCore = Math.abs(dx) <= 1 && Math.abs(dy) <= 1
          setPx(cx + dx, cy + dy, isCore ? 255 : er, isCore ? 255 : eg, isCore ? 255 : eb)
        }
      }
    }
  }

  return {
    width: imgW,
    height: imgH,
    data,
    dataUrl: encodeRgbaToPngDataUrl(data, imgW, imgH)
  }
}
