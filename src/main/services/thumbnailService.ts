import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import { nativeImage, type NativeImage } from 'electron'
import {
  THUMB_MAX_EDGE,
  isRealThumbnailPath,
  thumbRelativePathFor
} from '@shared/media/thumbnailPath'
import { isImageFilePath, isVideoFilePath } from '@shared/import'
import { fail, defErrSimple } from '@shared/errors/appError'
import { MAIN_ERRORS } from '../errors/messages'
import { removeIfExists } from '../persistence/binaryStore'

// ── 缩略图个性错误 ──
const E_THUMB_EMPTY_PATH = defErrSimple(
  'thumbnail.emptyPath',
  '空路径',
  'Path is empty'
)
const E_THUMB_SOURCE_MISSING = defErrSimple(
  'thumbnail.sourceImageMissing',
  '原图不存在',
  'Source image not found'
)
const E_THUMB_DECODE_FAILED = defErrSimple(
  'thumbnail.decodeFailed',
  '无法解码图片',
  'Failed to decode image'
)
const E_THUMB_VIDEO_FRAME_FAILED = defErrSimple(
  'thumbnail.videoFrameExtractFailed',
  '无法提取视频首帧',
  'Failed to extract video first frame'
)

function assertInside(root: string, abs: string): string {
  const resolvedRoot = resolve(root) + sep
  const resolvedTarget = resolve(abs)
  if (!resolvedTarget.startsWith(resolvedRoot) && resolvedTarget !== resolve(root)) {
    throw fail(MAIN_ERRORS.pathOutsideProject)
  }
  return resolvedTarget
}

function isUsable(image: NativeImage): boolean {
  if (image.isEmpty()) return false
  const { width, height } = image.getSize()
  return width > 0 && height > 0
}

function isThumbnailableMediaPath(filePath: string): boolean {
  return isImageFilePath(filePath) || isVideoFilePath(filePath)
}

/** createFromPath 对部分 JPG/路径会失败；优先 buffer，再回退 path */
function loadNativeImageSync(sourceAbs: string): NativeImage | null {
  if (isVideoFilePath(sourceAbs)) return null
  try {
    const buf = readFileSync(sourceAbs)
    const fromBuf = nativeImage.createFromBuffer(buf)
    if (isUsable(fromBuf)) return fromBuf
  } catch {
    /* try path */
  }

  try {
    const fromPath = nativeImage.createFromPath(sourceAbs)
    if (isUsable(fromPath)) return fromPath
  } catch {
    /* empty */
  }
  return null
}

async function createSystemThumbnail(sourceAbs: string): Promise<NativeImage | null> {
  // Windows/macOS 系统缩略图：图片变体 + 视频首帧/海报
  const createThumb = (
    nativeImage as typeof nativeImage & {
      createThumbnailFromPath?: (
        path: string,
        size: { width: number; height: number }
      ) => Promise<NativeImage>
    }
  ).createThumbnailFromPath

  if (typeof createThumb !== 'function') return null
  try {
    const thumb = await createThumb(sourceAbs, {
      width: THUMB_MAX_EDGE,
      height: THUMB_MAX_EDGE
    })
    if (isUsable(thumb)) return thumb
  } catch {
    /* unsupported format */
  }
  return null
}

async function loadNativeImageAsync(sourceAbs: string): Promise<NativeImage | null> {
  if (isVideoFilePath(sourceAbs)) {
    return createSystemThumbnail(sourceAbs)
  }
  const sync = loadNativeImageSync(sourceAbs)
  if (sync) return sync
  return createSystemThumbnail(sourceAbs)
}

function writeResizedPng(image: NativeImage, thumbAbs: string): void {
  const { width, height } = image.getSize()
  const maxEdge = Math.max(width, height)
  const resized =
    maxEdge > THUMB_MAX_EDGE
      ? image.resize({
          width: Math.max(1, Math.round((width * THUMB_MAX_EDGE) / maxEdge)),
          height: Math.max(1, Math.round((height * THUMB_MAX_EDGE) / maxEdge)),
          quality: 'better'
        })
      : image

  mkdirSync(dirname(thumbAbs), { recursive: true })
  writeFileSync(thumbAbs, resized.toPNG())
}

function existingThumbRel(
  sourceAbs: string,
  sourceRel: string,
  thumbAbs: string,
  thumbRel: string
): string | null {
  try {
    if (!existsSync(thumbAbs)) return null
    const srcStat = statSync(sourceAbs)
    const thumbStat = statSync(thumbAbs)
    if (thumbStat.mtimeMs >= srcStat.mtimeMs && thumbStat.size > 0) {
      return thumbRel
    }
  } catch {
    /* regenerate */
  }
  void sourceRel
  return null
}

/** 仅探测已有缩略图，不解码、不生成；供预览 IPC 快速返回 */
export function peekExistingImageThumbnail(
  root: string,
  sourceRelativePath: string
): string | null {
  const sourceRel = sourceRelativePath.replace(/\\/g, '/').trim()
  if (!sourceRel) return null
  try {
    const sourceAbs = assertInside(root, join(root, sourceRel))
    if (!existsSync(sourceAbs) || !isThumbnailableMediaPath(sourceAbs)) return null
    const thumbRel = thumbRelativePathFor(sourceRel)
    const thumbAbs = assertInside(root, join(root, thumbRel))
    return existingThumbRel(sourceAbs, sourceRel, thumbAbs, thumbRel)
  } catch {
    return null
  }
}

/** 若缩略图缺失或比原图旧，则生成；返回 thumb 相对路径（仅图片同步路径） */
export function ensureImageThumbnail(root: string, sourceRelativePath: string): string {
  const sourceRel = sourceRelativePath.replace(/\\/g, '/').trim()
  if (!sourceRel) throw fail(E_THUMB_EMPTY_PATH)

  const sourceAbs = assertInside(root, join(root, sourceRel))
  if (!existsSync(sourceAbs)) throw fail(E_THUMB_SOURCE_MISSING)
  if (!isImageFilePath(sourceAbs)) {
    return sourceRel
  }

  const thumbRel = thumbRelativePathFor(sourceRel)
  const thumbAbs = assertInside(root, join(root, thumbRel))
  const cached = existingThumbRel(sourceAbs, sourceRel, thumbAbs, thumbRel)
  if (cached) return cached

  const image = loadNativeImageSync(sourceAbs)
  if (!image) {
    throw fail(E_THUMB_DECODE_FAILED)
  }
  writeResizedPng(image, thumbAbs)
  return thumbRel
}

/** 异步版：图片同步失败或视频时用系统 createThumbnailFromPath（视频取首帧/海报） */
export async function ensureImageThumbnailAsync(
  root: string,
  sourceRelativePath: string
): Promise<string> {
  const sourceRel = sourceRelativePath.replace(/\\/g, '/').trim()
  if (!sourceRel) throw fail(E_THUMB_EMPTY_PATH)

  const sourceAbs = assertInside(root, join(root, sourceRel))
  if (!existsSync(sourceAbs)) throw fail(MAIN_ERRORS.fileNotFound)
  if (!isThumbnailableMediaPath(sourceAbs)) {
    return sourceRel
  }

  const thumbRel = thumbRelativePathFor(sourceRel)
  const thumbAbs = assertInside(root, join(root, thumbRel))
  const cached = existingThumbRel(sourceAbs, sourceRel, thumbAbs, thumbRel)
  if (cached) return cached

  const image = await loadNativeImageAsync(sourceAbs)
  if (!image) {
    throw fail(isVideoFilePath(sourceAbs) ? E_THUMB_VIDEO_FRAME_FAILED : E_THUMB_DECODE_FAILED)
  }
  writeResizedPng(image, thumbAbs)
  return thumbRel
}

/** 为资产写入预期 thumb 路径；磁盘生成可异步 */
export function plannedThumbnailPath(sourceRelativePath: string): string {
  return thumbRelativePathFor(sourceRelativePath)
}

export function thumbnailPathForAsset(input: {
  relativePath?: string
  thumbnailPath?: string
}): string | undefined {
  const rel = input.relativePath?.trim()
  if (!rel) return input.thumbnailPath
  if (isRealThumbnailPath(input.thumbnailPath, rel)) return input.thumbnailPath
  return plannedThumbnailPath(rel)
}

type ThumbJob = {
  root: string
  sourceRel: string
  resolve: (thumbRel: string) => void
  reject: (err: unknown) => void
}

const pending = new Map<string, Promise<string>>()
const queue: ThumbJob[] = []
let active = 0
const MAX_CONCURRENT = 2
const warnedDecode = new Set<string>()

function jobKey(root: string, sourceRel: string): string {
  return `${root}::${sourceRel.replace(/\\/g, '/')}`
}

function pumpQueue(): void {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()!
    active += 1
    void ensureImageThumbnailAsync(job.root, job.sourceRel)
      .then((thumbRel) => job.resolve(thumbRel))
      .catch((err) => job.reject(err))
      .finally(() => {
        active -= 1
        pending.delete(jobKey(job.root, job.sourceRel))
        pumpQueue()
      })
  }
}

/** 后台排队生成；同路径去重 */
export function scheduleEnsureThumbnail(root: string, sourceRelativePath: string): Promise<string> {
  const sourceRel = sourceRelativePath.replace(/\\/g, '/').trim()
  const key = jobKey(root, sourceRel)
  const existing = pending.get(key)
  if (existing) return existing

  const promise = new Promise<string>((resolve, reject) => {
    queue.push({ root, sourceRel, resolve, reject })
    queueMicrotask(pumpQueue)
  })
  pending.set(key, promise)
  return promise
}

export function warnThumbnailOnce(relativePath: string, err: unknown): void {
  const key = relativePath.replace(/\\/g, '/')
  if (warnedDecode.has(key)) return
  warnedDecode.add(key)
  console.warn('[thumbnail] preview fallback to full image', key, err)
}

/** 删除原图及其旁挂缩略图（路径必须在工程内） */
export function removeImageAndThumbnail(root: string, sourceRelativePath: string): void {
  const sourceRel = sourceRelativePath.replace(/\\/g, '/').trim()
  if (!sourceRel) return

  const sourceAbs = assertInside(root, join(root, sourceRel))
  removeIfExists(sourceAbs)

  const candidates = new Set<string>()
  candidates.add(thumbRelativePathFor(sourceRel))
  // 若调用方传入的已是 thumb 路径，也尝试删掉
  if (sourceRel.startsWith('.aiartengine/thumbs/')) {
    candidates.add(sourceRel)
  }
  for (const thumbRel of candidates) {
    try {
      removeIfExists(assertInside(root, join(root, thumbRel)))
    } catch {
      /* ignore */
    }
  }
}
