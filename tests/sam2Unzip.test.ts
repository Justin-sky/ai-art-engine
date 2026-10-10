import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { extractSam2OnnxPair } from '../src/main/yolo/sam2Unzip'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sam2-unzip-'))
  dirs.push(dir)
  return dir
}

describe('SAM 2.1 ONNX 解压', () => {
  it('只写出 encoder 与 decoder', async () => {
    const dir = await tempDir()
    const zip = new JSZip()
    zip.file('config.yaml', 'x: 1\n')
    zip.file('nested/sam2.1_hiera_tiny.encoder.onnx', Buffer.from('encoder-bytes'))
    zip.file('sam2.1_hiera_tiny.decoder.onnx', Buffer.from('decoder-bytes'))
    const zipPath = join(dir, 'tiny.zip')
    await writeFile(
      zipPath,
      await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    )

    const out = join(dir, 'out')
    await mkdir(out)
    await extractSam2OnnxPair(zipPath, out, 'sam2.1_hiera_tiny')

    expect(await readFile(join(out, 'sam2.1_hiera_tiny.encoder.onnx'), 'utf8')).toBe(
      'encoder-bytes'
    )
    expect(await readFile(join(out, 'sam2.1_hiera_tiny.decoder.onnx'), 'utf8')).toBe(
      'decoder-bytes'
    )
    expect((await readdir(out)).sort()).toEqual([
      'sam2.1_hiera_tiny.decoder.onnx',
      'sam2.1_hiera_tiny.encoder.onnx'
    ])
  })

  it('缺少 decoder 时不留下 encoder', async () => {
    const dir = await tempDir()
    const zip = new JSZip()
    zip.file('sam2.1_hiera_tiny.encoder.onnx', Buffer.from('encoder-bytes'))
    const zipPath = join(dir, 'tiny.zip')
    await writeFile(
      zipPath,
      await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    )
    const out = join(dir, 'out')
    await mkdir(out)

    await expect(extractSam2OnnxPair(zipPath, out, 'sam2.1_hiera_tiny')).rejects.toThrow(/decoder/)
    expect(await readdir(out)).toEqual([])
  })
})
