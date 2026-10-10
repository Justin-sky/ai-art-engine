/**
 * 从 SAM 2.1 的 zip 里只解出 encoder / decoder 两个 ONNX。
 * 按中央目录定位后流式 inflate，避免把数百 MB 的压缩包整包读进内存。
 */
import { createReadStream, createWriteStream } from 'fs'
import { type FileHandle, open, stat, unlink } from 'fs/promises'
import { basename, join } from 'path'
import { pipeline } from 'stream/promises'
import { createInflateRaw } from 'zlib'
import { sam2OnnxFileNames } from '@shared/sam2Catalog'

const EOCD_SIG = 0x06054b50
const CFH_SIG = 0x02014b50
const LFH_SIG = 0x04034b50

interface ZipEntry {
  name: string
  method: number
  compSize: number
  uncompSize: number
  localOffset: number
}

export async function extractSam2OnnxPair(
  zipPath: string,
  destDir: string,
  modelId: string
): Promise<void> {
  const names = sam2OnnxFileNames(modelId)
  const written: string[] = []
  const fh = await open(zipPath, 'r')
  try {
    const entries = await readCentralDirectory(fh)
    for (const fileName of [names.encoder, names.decoder]) {
      const entry = entries.find((item) => zipBaseName(item.name) === fileName)
      if (!entry) {
        throw new Error(`压缩包内缺少 ${fileName}`) // cjk-ok
      }
      const outPath = join(destDir, fileName)
      await extractEntry(zipPath, entry, outPath)
      written.push(outPath)
    }
  } catch (err) {
    await Promise.all(written.map((path) => unlink(path).catch(() => undefined)))
    throw err
  } finally {
    await fh.close()
  }
}

function zipBaseName(name: string): string {
  return basename(name.replace(/\\/g, '/'))
}

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await fh.read(buf, offset, length - offset, position + offset)
    if (bytesRead === 0) throw new Error('压缩包被截断') // cjk-ok
    offset += bytesRead
  }
  return buf
}

async function readCentralDirectory(fh: FileHandle): Promise<ZipEntry[]> {
  const { size } = await fh.stat()
  const tailLen = Math.min(size, 22 + 65535)
  const tail = await readAt(fh, size - tailLen, tailLen)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('下载内容不是有效的 zip') // cjk-ok
  const entryCount = tail.readUInt16LE(eocd + 10)
  const cdSize = tail.readUInt32LE(eocd + 12)
  const cdOffset = tail.readUInt32LE(eocd + 16)
  if (entryCount === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new Error('不支持 Zip64 压缩包') // cjk-ok
  }
  const cd = await readAt(fh, cdOffset, cdSize)
  const entries: ZipEntry[] = []
  let cursor = 0
  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > cd.length || cd.readUInt32LE(cursor) !== CFH_SIG) {
      throw new Error('zip 中央目录损坏') // cjk-ok
    }
    const method = cd.readUInt16LE(cursor + 10)
    const compSize = cd.readUInt32LE(cursor + 20)
    const uncompSize = cd.readUInt32LE(cursor + 24)
    const nameLen = cd.readUInt16LE(cursor + 28)
    const extraLen = cd.readUInt16LE(cursor + 30)
    const commentLen = cd.readUInt16LE(cursor + 32)
    const localOffset = cd.readUInt32LE(cursor + 42)
    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('不支持 Zip64 压缩包') // cjk-ok
    }
    const name = cd.slice(cursor + 46, cursor + 46 + nameLen).toString('utf8')
    entries.push({ name, method, compSize, uncompSize, localOffset })
    cursor += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function extractEntry(zipPath: string, entry: ZipEntry, outPath: string): Promise<void> {
  const fh = await open(zipPath, 'r')
  let dataStart = 0
  try {
    const local = await readAt(fh, entry.localOffset, 30)
    if (local.readUInt32LE(0) !== LFH_SIG) throw new Error('zip 本地文件头损坏') // cjk-ok
    const nameLen = local.readUInt16LE(26)
    const extraLen = local.readUInt16LE(28)
    dataStart = entry.localOffset + 30 + nameLen + extraLen
  } finally {
    await fh.close()
  }
  if (entry.compSize <= 0) throw new Error(`压缩条目为空：${zipBaseName(entry.name)}`) // cjk-ok
  const input = createReadStream(zipPath, {
    start: dataStart,
    end: dataStart + entry.compSize - 1
  })
  const output = createWriteStream(outPath)
  try {
    if (entry.method === 0) {
      await pipeline(input, output)
    } else if (entry.method === 8) {
      await pipeline(input, createInflateRaw(), output)
    } else {
      throw new Error(`不支持的 zip 压缩方式 ${entry.method}`) // cjk-ok
    }
  } catch (err) {
    await unlink(outPath).catch(() => undefined)
    throw err
  }
  if (entry.uncompSize > 0) {
    const size = (await stat(outPath)).size
    if (size !== entry.uncompSize) {
      await unlink(outPath).catch(() => undefined)
      throw new Error('解压后体积与压缩包声明不一致') // cjk-ok
    }
  }
}
