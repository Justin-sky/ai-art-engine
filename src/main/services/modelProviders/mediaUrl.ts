import { readFileSync } from 'fs'
import { join } from 'path'

function toDataUrlFromFile(absPath: string): string {
  const buf = readFileSync(absPath)
  const ext = absPath.toLowerCase().split('.').pop() ?? ''
  const mime =
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
  return `data:${mime};base64,${buf.toString('base64')}`
}

/** 将本地路径转为 data URL；已是 http(s)/data 则原样返回 */
export function toMediaUrl(pathOrUrl: string, projectRoot?: string): string {
  if (
    pathOrUrl.startsWith('data:') ||
    pathOrUrl.startsWith('http://') ||
    pathOrUrl.startsWith('https://')
  ) {
    return pathOrUrl
  }
  const abs =
    projectRoot && !pathOrUrl.match(/^[A-Za-z]:\\|^\//)
      ? join(projectRoot, pathOrUrl)
      : pathOrUrl
  return toDataUrlFromFile(abs)
}

export const toImageUrl = toMediaUrl
export const toVideoUrl = toMediaUrl
export const toAudioUrl = toMediaUrl
