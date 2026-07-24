import axios from 'axios'

export type ResolvedMediaBytes = {
  buf: Buffer
  mime: string
}

function mimeFromContentType(header: string | undefined, fallback: string): string {
  const raw = (header || '').split(';')[0]?.trim().toLowerCase()
  return raw || fallback
}

function extHintMime(url: string): string {
  const path = url.split('?')[0]?.toLowerCase() ?? ''
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.gif')) return 'image/gif'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.mp4')) return 'video/mp4'
  if (path.endsWith('.webm')) return 'video/webm'
  if (path.endsWith('.mp3')) return 'audio/mpeg'
  if (path.endsWith('.wav')) return 'audio/wav'
  return 'application/octet-stream'
}

/** 解析 data URL，或在主进程下载 http(s)（避免渲染进程 CORS） */
export async function resolveMediaBytesFromUrl(rawInput: string): Promise<ResolvedMediaBytes> {
  const raw = rawInput.trim()
  if (!raw) throw new Error('空的媒体 URL')

  const dataMatch = /^data:([^;,]+)?(;base64)?,([\s\S]+)$/i.exec(raw)
  if (dataMatch) {
    const mime = (dataMatch[1] || 'application/octet-stream').toLowerCase()
    const isBase64 = !!dataMatch[2]
    const payload = dataMatch[3] || ''
    return {
      mime,
      buf: Buffer.from(payload, isBase64 ? 'base64' : 'utf8')
    }
  }

  if (!/^https?:\/\//i.test(raw)) {
    throw new Error('无效的媒体 URL（需要 data: 或 http(s)）')
  }

  try {
    const response = await axios.get<ArrayBuffer>(raw, {
      responseType: 'arraybuffer',
      timeout: 120_000,
      maxContentLength: 80 * 1024 * 1024,
      maxBodyLength: 80 * 1024 * 1024
    })
    const mime = mimeFromContentType(
      typeof response.headers['content-type'] === 'string'
        ? response.headers['content-type']
        : undefined,
      extHintMime(raw)
    )
    return { buf: Buffer.from(response.data), mime }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`下载媒体失败: ${detail}`)
  }
}
