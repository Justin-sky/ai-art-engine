/**
 * Pure-TypeScript zero-dependency PKZIP (.zip) archive builder for Indie Game Engine Bundles.
 *
 * Supports packing UTF-8 text files (.tmj, .csv, .json, .fnt, .gd, .cs, .gdshader, .shader, .html)
 * as well as Base64 Data URLs (data:image/png;base64,..., data:audio/wav;base64,...) or raw Uint8Array
 * bytes into a single standards-compliant .zip binary archive ready for Unity, Godot 4, or Unreal 5.
 */

export interface ZipArchiveEntryInput {
  /** Relative path inside the .zip archive (forward slashes recommended, e.g. 'assets/sprites/hero.png') */
  path: string
  /** Raw bytes, UTF-8 text content, or a `data:...;base64,...` Data URL */
  data: Uint8Array | string
  /** Optional flag: when true and `data` is a `data:...;base64,...` string, decodes into binary bytes */
  decodeDataUrl?: boolean
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    const idx = (crc ^ bytes[i]!) & 0xff
    crc = (crc >>> 8) ^ CRC32_TABLE[idx]!
  }
  return (crc ^ 0xffffffff) >>> 0
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '')
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(clean, 'base64'))
  }
  const bin = atob(clean)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i)
  }
  return out
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let bin = ''
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!)
  }
  return btoa(bin)
}

export function resolveZipEntryBytes(entry: ZipArchiveEntryInput): Uint8Array {
  if (entry.data instanceof Uint8Array) {
    return entry.data
  }
  const str = String(entry.data ?? '')
  if (entry.decodeDataUrl !== false && /^data:[^;]+;base64,/i.test(str)) {
    const commaIdx = str.indexOf(',')
    if (commaIdx >= 0) {
      return decodeBase64ToBytes(str.slice(commaIdx + 1))
    }
  }
  return new TextEncoder().encode(str)
}

function writeUint16LE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = val & 0xff
  buf[offset + 1] = (val >>> 8) & 0xff
}

function writeUint32LE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = val & 0xff
  buf[offset + 1] = (val >>> 8) & 0xff
  buf[offset + 2] = (val >>> 16) & 0xff
  buf[offset + 3] = (val >>> 24) & 0xff
}

/**
 * Builds a standard PKZIP (Store / Method 0) archive as a `Uint8Array`.
 */
export function buildZipArchiveBytes(entries: ZipArchiveEntryInput[]): Uint8Array {
  const encoder = new TextEncoder()
  const prepared = entries
    .filter((e) => e.path && e.path.trim().length > 0)
    .map((e) => {
      const normalizedPath = e.path.trim().replace(/\\/g, '/').replace(/^\/+/, '')
      const nameBytes = encoder.encode(normalizedPath)
      const dataBytes = resolveZipEntryBytes(e)
      const crc32 = computeCrc32(dataBytes)
      return {
        nameBytes,
        dataBytes,
        crc32
      }
    })

  let localSize = 0
  let centralSize = 0
  for (const item of prepared) {
    localSize += 30 + item.nameBytes.length + item.dataBytes.length
    centralSize += 46 + item.nameBytes.length
  }

  const totalSize = localSize + centralSize + 22
  const out = new Uint8Array(totalSize)
  const localOffsets: number[] = []

  let cursor = 0
  for (const item of prepared) {
    localOffsets.push(cursor)
    // Local file header signature (0x04034b50)
    writeUint32LE(out, cursor, 0x04034b50)
    writeUint16LE(out, cursor + 4, 20) // version needed to extract (2.0)
    writeUint16LE(out, cursor + 6, 0x0800) // general purpose bit flag (UTF-8 filename)
    writeUint16LE(out, cursor + 8, 0) // compression method: 0 (Stored)
    writeUint16LE(out, cursor + 10, 0) // last mod file time
    writeUint16LE(out, cursor + 12, 0x5421) // last mod file date
    writeUint32LE(out, cursor + 14, item.crc32)
    writeUint32LE(out, cursor + 18, item.dataBytes.length)
    writeUint32LE(out, cursor + 22, item.dataBytes.length)
    writeUint16LE(out, cursor + 26, item.nameBytes.length)
    writeUint16LE(out, cursor + 28, 0) // extra field length
    out.set(item.nameBytes, cursor + 30)
    cursor += 30 + item.nameBytes.length
    out.set(item.dataBytes, cursor)
    cursor += item.dataBytes.length
  }

  const centralDirOffset = cursor
  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i]!
    const localOffset = localOffsets[i]!
    // Central directory file header signature (0x02014b50)
    writeUint32LE(out, cursor, 0x02014b50)
    writeUint16LE(out, cursor + 4, 20) // version made by
    writeUint16LE(out, cursor + 6, 20) // version needed to extract
    writeUint16LE(out, cursor + 8, 0x0800) // UTF-8 flag
    writeUint16LE(out, cursor + 10, 0) // method: 0 (Stored)
    writeUint16LE(out, cursor + 12, 0) // mod time
    writeUint16LE(out, cursor + 14, 0x5421) // mod date
    writeUint32LE(out, cursor + 16, item.crc32)
    writeUint32LE(out, cursor + 20, item.dataBytes.length)
    writeUint32LE(out, cursor + 24, item.dataBytes.length)
    writeUint16LE(out, cursor + 28, item.nameBytes.length)
    writeUint16LE(out, cursor + 30, 0) // extra length
    writeUint16LE(out, cursor + 32, 0) // comment length
    writeUint16LE(out, cursor + 34, 0) // disk number
    writeUint16LE(out, cursor + 36, 0) // internal attrs
    writeUint32LE(out, cursor + 38, 0) // external attrs
    writeUint32LE(out, cursor + 42, localOffset)
    out.set(item.nameBytes, cursor + 46)
    cursor += 46 + item.nameBytes.length
  }

  // End of Central Directory Record (0x06054b50)
  writeUint32LE(out, cursor, 0x06054b50)
  writeUint16LE(out, cursor + 4, 0) // disk number
  writeUint16LE(out, cursor + 6, 0) // central dir start disk
  writeUint16LE(out, cursor + 8, prepared.length)
  writeUint16LE(out, cursor + 10, prepared.length)
  writeUint32LE(out, cursor + 12, centralSize)
  writeUint32LE(out, cursor + 16, centralDirOffset)
  writeUint16LE(out, cursor + 20, 0) // comment length

  return out
}

/**
 * Encodes a ZIP archive directly into a downloadable `data:application/zip;base64,...` Data URL.
 */
export function buildZipArchiveDataUrl(entries: ZipArchiveEntryInput[]): string {
  const bytes = buildZipArchiveBytes(entries)
  return `data:application/zip;base64,${encodeBytesToBase64(bytes)}`
}
