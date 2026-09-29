import { createHash } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CancellationToken } from 'builder-util-runtime'
import {
  downloadFileResumable,
  hashFileDigest,
  resumePartialPath
} from '../src/main/services/resumableHttpDownload'

function sha512Base64(buf: Buffer): string {
  return createHash('sha512').update(buf).digest('base64')
}

describe('resumableHttpDownload', () => {
  let server: Server
  let baseUrl: string
  let payload: Buffer
  let digest: string
  /** 模拟中途断线：前 N 字节后 socket destroy */
  let breakAfter: number | null = null
  let rangeRequests = 0

  beforeAll(async () => {
    payload = Buffer.alloc(64 * 1024, 0xab)
    for (let i = 0; i < payload.length; i++) payload[i] = i % 251
    digest = sha512Base64(payload)

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url !== '/file.bin') {
        res.writeHead(404)
        res.end()
        return
      }
      const range = req.headers.range
      if (range) {
        rangeRequests++
        const m = /^bytes=(\d+)-$/.exec(range)
        if (!m) {
          res.writeHead(400)
          res.end()
          return
        }
        const start = Number(m[1])
        if (start >= payload.length) {
          res.writeHead(416, { 'Content-Range': `bytes */${payload.length}` })
          res.end()
          return
        }
        const chunk = payload.subarray(start)
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${payload.length - 1}/${payload.length}`,
          'Content-Length': String(chunk.length),
          'Accept-Ranges': 'bytes'
        })
        if (breakAfter != null && start < breakAfter) {
          // 续传过程中不再人为断开
          res.end(chunk)
          return
        }
        res.end(chunk)
        return
      }

      res.writeHead(200, {
        'Content-Length': String(payload.length),
        'Accept-Ranges': 'bytes'
      })
      if (breakAfter != null) {
        res.write(payload.subarray(0, breakAfter), () => {
          // 等首段刷出后再掐断，避免客户端连响应头都收不到
          res.destroy()
        })
        return
      }
      res.end(payload)
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('no port')
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
  })

  it('downloads fully and verifies sha512', async () => {
    breakAfter = null
    rangeRequests = 0
    const root = mkdtempSync(join(tmpdir(), 'aiae-resume-'))
    const dest = join(root, 'out.bin')
    const resumeDir = join(root, 'resume')
    await downloadFileResumable({
      url: `${baseUrl}/file.bin`,
      destination: dest,
      resumeDir,
      options: { cancellationToken: new CancellationToken(), sha512: digest }
    })
    expect(readFileSync(dest).equals(payload)).toBe(true)
    expect(rangeRequests).toBe(0)
  })

  it('resumes from partial after connection drop', async () => {
    breakAfter = 10_000
    rangeRequests = 0
    const root = mkdtempSync(join(tmpdir(), 'aiae-resume-'))
    const dest = join(root, 'out.bin')
    const resumeDir = join(root, 'resume')
    const url = `${baseUrl}/file.bin`

    await expect(
      downloadFileResumable({
        url,
        destination: dest,
        resumeDir,
        options: { cancellationToken: new CancellationToken(), sha512: digest }
      })
    ).rejects.toThrow()

    const partial = resumePartialPath(resumeDir, url, digest)
    expect(existsSync(partial), `partial missing under ${resumeDir}`).toBe(true)
    expect(readFileSync(partial).length).toBeGreaterThanOrEqual(breakAfter! - 1024)
    expect(readFileSync(partial).length).toBeLessThan(payload.length)

    breakAfter = null
    await downloadFileResumable({
      url,
      destination: dest,
      resumeDir,
      options: { cancellationToken: new CancellationToken(), sha512: digest }
    })

    expect(rangeRequests).toBeGreaterThanOrEqual(1)
    expect(readFileSync(dest).equals(payload)).toBe(true)
    expect(await hashFileDigest(dest, 'sha512', 'base64')).toBe(digest)
  })

  it('reuses complete partial without re-download', async () => {
    breakAfter = null
    rangeRequests = 0
    const root = mkdtempSync(join(tmpdir(), 'aiae-resume-'))
    const dest = join(root, 'out.bin')
    const resumeDir = join(root, 'resume')
    const url = `${baseUrl}/file.bin`
    const partial = resumePartialPath(resumeDir, url, digest)
    mkdirSync(resumeDir, { recursive: true })
    writeFileSync(partial, payload)

    await downloadFileResumable({
      url,
      destination: dest,
      resumeDir,
      options: { cancellationToken: new CancellationToken(), sha512: digest }
    })
    expect(readFileSync(dest).equals(payload)).toBe(true)
    expect(rangeRequests).toBe(0)
  })
})
