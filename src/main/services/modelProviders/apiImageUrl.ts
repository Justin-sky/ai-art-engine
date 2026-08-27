import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import { toMediaUrl } from './mediaUrl'
import { projectService } from '../projectService'

// ── 本文件错误条目（catalog 未覆盖的个性文案）──
const E_IMAGE_FILE_NOT_FOUND = defErr<{ path: string }>(
  'provider.imageUrl.fileNotFound',
  ({ path }) => `图片文件不存在: ${path}`,
  ({ path }) => `Image file not found: ${path}`
)
const E_EMPTY_REFERENCE = defErrSimple(
  'provider.imageUrl.emptyReference',
  '空的图片引用',
  'Empty image reference'
)
const E_STUDIO_MEDIA_NO_PATH = defErrSimple(
  'provider.imageUrl.studioMediaNoPath',
  'studio-media URL 缺少 path',
  'studio-media URL is missing its path'
)
const E_STUDIO_MEDIA_UNPARSABLE = defErr<{ detail: string }>(
  'provider.imageUrl.studioMediaUnparsable',
  ({ detail }) => `无法解析 studio-media 图片：${detail}`,
  ({ detail }) => `Could not resolve studio-media image: ${detail}`
)

function mimeFromPath(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'bmp') return 'image/bmp'
  return 'image/png'
}

function dataUrlFromAbsPath(absPath: string): string {
  if (!existsSync(absPath)) throw fail(E_IMAGE_FILE_NOT_FOUND, { path: absPath })
  const buf = readFileSync(absPath)
  return `data:${mimeFromPath(absPath)};base64,${buf.toString('base64')}`
}

/**
 * 将本地预览协议（studio-media / file）转为远端 API 可接受的 data URL / http(s)。
 * OpenRouter / OpenAI 兼容接口不接受 studio-media:// 或裸本地路径。
 */
export function ensureApiImageUrl(pathOrUrl: string): string {
  const trimmed = pathOrUrl.trim()
  if (!trimmed) throw fail(E_EMPTY_REFERENCE)

  if (trimmed.startsWith('data:') || /^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  if (trimmed.startsWith('studio-media://')) {
    try {
      const u = new URL(trimmed)
      const abs = decodeURIComponent(u.searchParams.get('path') ?? '')
      if (!abs) throw fail(E_STUDIO_MEDIA_NO_PATH)
      return dataUrlFromAbsPath(abs)
    } catch (err) {
      throw fail(E_STUDIO_MEDIA_UNPARSABLE, {
        detail: err instanceof Error ? err.message : String(err)
      })
    }
  }

  if (trimmed.startsWith('file:')) {
    return dataUrlFromAbsPath(fileURLToPath(trimmed))
  }

  // 工程相对路径 / 绝对路径
  const root = projectService.isOpen() ? projectService.getRoot() : undefined
  return toMediaUrl(trimmed, root)
}

export function ensureApiImageUrls(urls: string[] | undefined): string[] | undefined {
  if (!urls?.length) return urls
  return urls.map((url) => ensureApiImageUrl(url))
}
