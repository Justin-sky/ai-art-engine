/**
 * 可玩 HTML 沙盒协议：主窗口 CSP 禁止 inline script，srcdoc/blob 会继承该策略。
 * 通过独立 privileged scheme + 文档级 CSP，在 iframe 内允许内联脚本试玩。
 */
import { randomUUID } from 'crypto'

const docs = new Map<string, { html: string; createdAt: number }>()
const MAX_DOCS = 24
const MAX_HTML_BYTES = 8 * 1024 * 1024

/** 试玩文档 CSP：允许内联/模块脚本与 data/blob，禁止联网与跳出 */
const GAMEPLAY_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' data: blob:",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  'worker-src blob:',
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'"
].join('; ')

function evictOldestIfNeeded(): void {
  if (docs.size < MAX_DOCS) return
  let oldestId = ''
  let oldestAt = Number.POSITIVE_INFINITY
  for (const [id, entry] of docs) {
    if (entry.createdAt < oldestAt) {
      oldestAt = entry.createdAt
      oldestId = id
    }
  }
  if (oldestId) docs.delete(oldestId)
}

function extractDocId(urlOrId: string): string {
  const raw = urlOrId.trim()
  if (!raw) return ''
  if (!raw.includes('://')) return raw
  try {
    const url = new URL(raw)
    return (url.searchParams.get('id') ?? '').trim()
  } catch {
    return ''
  }
}

/** 登记 HTML，返回可供 iframe.src 使用的 studio-gameplay URL */
export function openGameplayDocument(html: string): string {
  const body = typeof html === 'string' ? html : ''
  if (!body.trim()) {
    throw new Error('gameplay html is empty')
  }
  if (Buffer.byteLength(body, 'utf8') > MAX_HTML_BYTES) {
    throw new Error('gameplay html exceeds size limit')
  }
  evictOldestIfNeeded()
  const id = randomUUID()
  docs.set(id, { html: body, createdAt: Date.now() })
  return `studio-gameplay://local/?id=${encodeURIComponent(id)}`
}

/** 释放已登记文档（关闭沙盒 / 重载前调用） */
export function releaseGameplayDocument(urlOrId: string): void {
  const id = extractDocId(urlOrId)
  if (id) docs.delete(id)
}

export function handleStudioGameplayRequest(request: Request): Response {
  try {
    const url = new URL(request.url)
    const id = (url.searchParams.get('id') ?? '').trim()
    const entry = id ? docs.get(id) : undefined
    if (!entry) {
      return new Response('Not Found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      })
    }
    return new Response(entry.html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': GAMEPLAY_CSP,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  } catch (error) {
    console.error('[studio-gameplay]', error)
    return new Response('Bad Request', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    })
  }
}
