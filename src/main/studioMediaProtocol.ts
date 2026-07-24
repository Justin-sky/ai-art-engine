import { createReadStream, existsSync, statSync } from 'fs'
import { extname } from 'path'
import { Readable } from 'stream'

/** Chromium 媒体元素依赖正确 MIME；file:// 经 net.fetch 时常为 octet-stream，导致 mp3 等无法播放。 */
function mimeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.ogg':
      return 'audio/ogg'
    case '.m4a':
    case '.aac':
      return 'audio/mp4'
    case '.mp4':
      return 'video/mp4'
    case '.mov':
      return 'video/quicktime'
    case '.webm':
      return 'video/webm'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.bmp':
      return 'image/bmp'
    case '.glb':
      return 'model/gltf-binary'
    case '.gltf':
      return 'model/gltf+json'
    case '.fbx':
      return 'application/octet-stream'
    case '.txt':
      return 'text/plain; charset=utf-8'
    case '.md':
    case '.markdown':
      return 'text/markdown; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

function nodeStreamToWeb(stream: ReturnType<typeof createReadStream>): ReadableStream {
  return Readable.toWeb(stream) as unknown as ReadableStream
}

/** 为 studio-media:// 提供本地文件，带 Content-Type 与 Range（音视频预览必需）。 */
export function handleStudioMediaRequest(request: Request): Response {
  try {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.searchParams.get('path') ?? '')
    if (!filePath || !existsSync(filePath)) {
      return new Response('Not Found', { status: 404 })
    }

    const { size } = statSync(filePath)
    const mime = mimeForPath(filePath)
    const rangeHeader = request.headers.get('Range')

    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
      if (match) {
        const start = match[1] ? Number(match[1]) : 0
        const end = match[2] ? Number(match[2]) : size - 1
        if (
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          start >= 0 &&
          start < size &&
          start <= end
        ) {
          const safeEnd = Math.min(end, size - 1)
          const chunkSize = safeEnd - start + 1
          const stream = createReadStream(filePath, { start, end: safeEnd })
          return new Response(nodeStreamToWeb(stream), {
            status: 206,
            headers: {
              'Content-Type': mime,
              'Content-Length': String(chunkSize),
              'Content-Range': `bytes ${start}-${safeEnd}/${size}`,
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'no-cache'
            }
          })
        }
      }
    }

    const stream = createReadStream(filePath)
    return new Response(nodeStreamToWeb(stream), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      }
    })
  } catch (error) {
    console.error('[studio-media]', error)
    return new Response('Bad Request', { status: 400 })
  }
}
