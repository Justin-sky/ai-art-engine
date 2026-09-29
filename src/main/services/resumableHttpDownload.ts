/**
 * HTTP(S) 断点续传下载：partial 落在 resumeDir，失败不清空，下次带 Range 接着写。
 * 供 electron-updater 的 httpExecutor.download 替换使用（其 pending 目录失败会被 emptyDir）。
 */
import { createHash } from 'crypto'
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync
} from 'fs'
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'http'
import { request as httpsRequest } from 'https'
import { dirname, join } from 'path'
import { URL } from 'url'
import type { DownloadOptions } from 'builder-util-runtime'

const MAX_REDIRECTS = 10

function digestEncoding(expected: string): 'hex' | 'base64' {
  return expected.length === 128 && !expected.includes('+') && !expected.includes('=')
    ? 'hex'
    : 'base64'
}

export async function hashFileDigest(
  filePath: string,
  algorithm: 'sha512' | 'sha256',
  encoding: 'hex' | 'base64'
): Promise<string> {
  const hash = createHash(algorithm)
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve())
  })
  return hash.digest(encoding)
}

/** 用 sha512（优先）或 URL 生成稳定 partial 文件名 */
export function resumePartialPath(resumeDir: string, url: string, sha512?: string | null): string {
  const key = createHash('sha256')
    .update(sha512?.trim() || url)
    .digest('hex')
    .slice(0, 40)
  return join(resumeDir, `${key}.partial`)
}

function existingSize(filePath: string): number {
  try {
    if (!existsSync(filePath)) return 0
    return statSync(filePath).size
  } catch {
    return 0
  }
}

function parseContentRangeTotal(header: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(header) ? header[0] : header
  if (!raw) return undefined
  const m = /\/(\d+)\s*$/.exec(raw)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function headerNumber(header: string | string[] | undefined): number {
  const raw = Array.isArray(header) ? header[0] : header
  if (raw == null) return NaN
  const n = Number(raw)
  return Number.isFinite(n) ? n : NaN
}

function stripSensitiveOnCrossOrigin(
  from: URL,
  to: URL,
  headers: Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> {
  if (from.host.toLowerCase() === to.host.toLowerCase()) return headers
  const next = { ...headers }
  for (const key of Object.keys(next)) {
    const lower = key.toLowerCase()
    if (
      lower === 'authorization' ||
      lower === 'cookie' ||
      lower === 'proxy-authorization' ||
      lower === 'x-api-key'
    ) {
      delete next[key]
    }
  }
  return next
}

function attachCancel(token: DownloadOptions['cancellationToken'], abort: () => void): () => void {
  const t = token as unknown as {
    cancelled: boolean
    onCancel?: (cb: () => void) => void
    once?: (event: string, cb: () => void) => void
  }
  if (t.cancelled) {
    abort()
    return () => undefined
  }
  if (typeof t.onCancel === 'function') {
    t.onCancel(abort)
    return () => undefined
  }
  if (typeof t.once === 'function') {
    t.once('cancel', abort)
    return () => t.once?.('cancel', () => undefined)
  }
  return () => undefined
}

function openRequest(
  url: URL,
  headers: Record<string, string | string[] | undefined>
): Promise<{ response: IncomingMessage; url: URL }> {
  const isHttps = url.protocol === 'https:'
  const reqFn = isHttps ? httpsRequest : httpRequest
  const reqOptions: RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method: 'GET',
    headers
  }
  return new Promise((resolve, reject) => {
    const req = reqFn(reqOptions, (response) => resolve({ response, url }))
    req.on('error', reject)
    req.setTimeout(120_000, () => {
      req.destroy(new Error('Download request timed out'))
    })
    req.end()
  })
}

async function deliverIfComplete(
  partialPath: string,
  destination: string,
  options: DownloadOptions
): Promise<string | null> {
  if (!existsSync(partialPath) || existingSize(partialPath) <= 0) return null
  if (options.sha512) {
    const actual = await hashFileDigest(partialPath, 'sha512', digestEncoding(options.sha512))
    if (actual !== options.sha512) return null
  } else if (options.sha2) {
    const actual = await hashFileDigest(partialPath, 'sha256', 'hex')
    if (actual !== options.sha2) return null
  } else {
    return null
  }
  mkdirSync(dirname(destination), { recursive: true })
  try {
    renameSync(partialPath, destination)
  } catch {
    copyFileSync(partialPath, destination)
    try {
      unlinkSync(partialPath)
    } catch {
      // ignore
    }
  }
  return destination
}

function finalizeToDestination(partialPath: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true })
  try {
    renameSync(partialPath, destination)
  } catch {
    copyFileSync(partialPath, destination)
    try {
      unlinkSync(partialPath)
    } catch {
      // ignore
    }
  }
}

/**
 * 下载到 destination；中断后 partial 保留在 resumeDir，下次 Range 续传。
 */
export async function downloadFileResumable(input: {
  url: string | URL
  destination: string
  resumeDir: string
  options: DownloadOptions
}): Promise<string> {
  const { destination, resumeDir, options } = input
  mkdirSync(resumeDir, { recursive: true })
  mkdirSync(dirname(destination), { recursive: true })

  const startUrl = typeof input.url === 'string' ? new URL(input.url) : input.url
  const partialPath = resumePartialPath(resumeDir, startUrl.href, options.sha512)

  const already = await deliverIfComplete(partialPath, destination, options)
  if (already) return already

  let url = startUrl
  let headers: Record<string, string | string[] | undefined> = {
    ...(options.headers as Record<string, string | string[] | undefined> | null | undefined),
    'User-Agent': 'AIArtEngine-updater',
    'Cache-Control': 'no-cache'
  }

  let redirectCount = 0
  let attempt = 0

  while (attempt < 4) {
    attempt++
    if (options.cancellationToken.cancelled) throw new Error('cancelled')

    let existing = existingSize(partialPath)
    const reqHeaders = { ...headers }
    if (existing > 0) reqHeaders.Range = `bytes=${existing}-`
    else delete reqHeaders.Range

    const { response, url: current } = await openRequest(url, reqHeaders)
    const status = response.statusCode ?? 0
    const location = response.headers.location

    if (
      (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) &&
      location
    ) {
      response.resume()
      if (++redirectCount > MAX_REDIRECTS) throw new Error('Too many redirects')
      const next = new URL(location, current)
      headers = stripSensitiveOnCrossOrigin(current, next, headers)
      url = next
      attempt--
      continue
    }

    if (status === 416 && existing > 0) {
      response.resume()
      const done = await deliverIfComplete(partialPath, destination, options)
      if (done) return done
      try {
        unlinkSync(partialPath)
      } catch {
        // ignore
      }
      continue
    }

    // 服务端不支持续传：丢弃 partial，用本次 200 正文整包写入
    if (status === 200 && existing > 0) {
      try {
        unlinkSync(partialPath)
      } catch {
        // ignore
      }
      existing = 0
    }

    if (status !== 200 && status !== 206) {
      response.resume()
      throw new Error(`Download failed: HTTP ${status} for ${url.href}`)
    }

    const contentLength = headerNumber(response.headers['content-length'])
    const totalFromRange = parseContentRangeTotal(response.headers['content-range'])
    const total =
      totalFromRange ??
      (status === 206
        ? existing + (Number.isFinite(contentLength) ? contentLength : 0)
        : Number.isFinite(contentLength)
          ? contentLength
          : 0)

    const append = status === 206 && existing > 0
    const startedAt = Date.now()
    let sessionReceived = 0
    let lastEmit = 0

    const emitProgress = (force = false) => {
      if (!options.onProgress || total <= 0) return
      const now = Date.now()
      if (!force && now - lastEmit < 200) return
      lastEmit = now
      const transferred = Math.min(existing + sessionReceived, total)
      const elapsed = Math.max(0.001, (now - startedAt) / 1000)
      options.onProgress({
        total,
        delta: sessionReceived,
        transferred,
        percent: Math.min(100, (transferred / total) * 100),
        bytesPerSecond: Math.round(sessionReceived / elapsed)
      })
    }

    const fileOut = createWriteStream(partialPath, { flags: append ? 'a' : 'w' })
    let settled = false
    const abort = () => {
      if (settled) return
      response.destroy()
      try {
        fileOut.destroy()
      } catch {
        // ignore
      }
    }
    attachCancel(options.cancellationToken, abort)

    try {
      await new Promise<void>((resolve, reject) => {
        const fail = (err: Error) => {
          // 尽量把已写入磁盘的 partial 刷掉，供下次 Range 续传
          fileOut.end(() => reject(err))
        }
        response.on('data', (chunk: Buffer) => {
          if (options.cancellationToken.cancelled) {
            abort()
            fail(new Error('cancelled'))
            return
          }
          sessionReceived += chunk.length
          if (!fileOut.write(chunk)) {
            response.pause()
            fileOut.once('drain', () => response.resume())
          }
          emitProgress()
        })
        response.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))))
        response.on('aborted', () => fail(new Error('Download aborted')))
        response.on('end', () => {
          fileOut.end(() => resolve())
        })
        fileOut.on('error', (err) => reject(err))
      })
      settled = true
    } catch (err) {
      settled = true
      throw err
    }

    emitProgress(true)
    if (options.cancellationToken.cancelled) throw new Error('cancelled')

    const finalSize = existingSize(partialPath)
    if (total > 0 && finalSize < total) {
      // 未下完：保留 partial，下次 Range 续传（勿因 sha 不匹配删掉）
      throw new Error(`Download incomplete: ${finalSize}/${total} bytes`)
    }

    if (options.sha512) {
      const actual = await hashFileDigest(partialPath, 'sha512', digestEncoding(options.sha512))
      if (actual !== options.sha512) {
        try {
          unlinkSync(partialPath)
        } catch {
          // ignore
        }
        throw new Error(
          `sha512 checksum mismatch: expected ${options.sha512.slice(0, 12)}…, got ${actual.slice(0, 12)}…`
        )
      }
    } else if (options.sha2) {
      const actual = await hashFileDigest(partialPath, 'sha256', 'hex')
      if (actual !== options.sha2) {
        try {
          unlinkSync(partialPath)
        } catch {
          // ignore
        }
        throw new Error('sha256 checksum mismatch')
      }
    }

    finalizeToDestination(partialPath, destination)
    return destination
  }

  throw new Error('Download failed after retries')
}
