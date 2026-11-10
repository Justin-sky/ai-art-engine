import { readFileSync } from 'fs'
import { isAbsolute, join } from 'path'
import { fileURLToPath } from 'url'
import { sniffImageMimeFromBytes } from '@shared/media/imageMimeSniff'

function toDataUrlFromFile(absPath: string): string {
  const buf = readFileSync(absPath)
  const ext = absPath.toLowerCase().split('.').pop() ?? ''
  const fallbackMime =
    ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'webp'
        ? 'image/webp'
        : ext === 'gif'
          ? 'image/gif'
          : ext === 'png'
            ? 'image/png'
            : ext === 'mp4'
              ? 'video/mp4'
              : ext === 'mov'
                ? 'video/quicktime'
                : ext === 'webm'
                  ? 'video/webm'
                  : ext === 'mp3'
                    ? 'audio/mpeg'
                    : ext === 'wav'
                      ? 'audio/wav'
                      : ext === 'ogg'
                        ? 'audio/ogg'
                        : ext === 'm4a'
                          ? 'audio/mp4'
                          : 'application/octet-stream'
  const mime = sniffImageMimeFromBytes(buf) ?? fallbackMime
  return `data:${mime};base64,${buf.toString('base64')}`
}

/** 将本地路径转为 data URL；已是 http(s)/data 则原样返回 */
export function toMediaUrl(pathOrUrl: string, projectRoot?: string): string {
  const s = String(pathOrUrl ?? '').trim()
  if (s.startsWith('data:') || s.startsWith('http://') || s.startsWith('https://')) {
    return s
  }
  let targetPath = s
  if (s.startsWith('studio-media://')) {
    try {
      const parsed = new URL(s)
      const p = parsed.searchParams.get('path')?.trim()
      if (p) targetPath = p
    } catch {
      // keep original
    }
  } else if (s.startsWith('file://')) {
    try {
      targetPath = fileURLToPath(s)
    } catch {
      // keep original
    }
  }
  const isAbs = isAbsolute(targetPath) || /^[A-Za-z]:[\\/]/.test(targetPath)
  const abs = projectRoot && !isAbs ? join(projectRoot, targetPath) : targetPath
  return toDataUrlFromFile(abs)
}

export const toImageUrl = toMediaUrl
export const toVideoUrl = toMediaUrl
export const toAudioUrl = toMediaUrl
