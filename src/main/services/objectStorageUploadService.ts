import { createHash, randomUUID } from 'crypto'
import { basename, extname, join } from 'path'
import { existsSync, statSync } from 'fs'
import {
  getObjectStorageBucket,
  pickActiveObjectStorage,
  type ObjectStorageProviderInstance
} from '@shared/objectStorage'
import { getObjectStorageAdapter } from '../runtime'
import { fail, defErr, defErrSimple, formatBi } from '@shared/errors/appError'
import { MAIN_ERRORS } from '../errors/messages'
import { settingsService } from './settingsService'
import { projectService } from './projectService'

// ── 对象存储上传个性错误（SDK 原生报错一律作为 detail 透传）──
const E_STORAGE_INVALID_DATA_URL = defErrSimple(
  'storage.upload.invalidDataUrl',
  '无效的 data URL',
  'Invalid data URL'
)
const E_STORAGE_NO_ACTIVE_PROVIDER = defErrSimple(
  'storage.upload.noActiveProvider',
  '未配置可用的对象存储。请在设置 → 对象存储中添加火山引擎 TOS / 阿里云 OSS / 腾讯云 COS，并填写密钥与桶信息',
  'No object storage is configured. Add Volcengine TOS / Aliyun OSS / Tencent COS in Settings → Object Storage, then fill in the keys and bucket'
)
const E_STORAGE_UPLOAD_FILE_MISSING = defErr<{ path: string }>(
  'storage.upload.fileMissing',
  ({ path }) => `待上传文件不存在: ${path}`,
  ({ path }) => `File to upload does not exist: ${path}`
)
const E_STORAGE_EMPTY_MEDIA_PATH = defErrSimple(
  'storage.upload.emptyMediaPath',
  '空的媒体路径',
  'Media path is empty'
)

// ── 上传日志文案（非 throw 场景，用 formatBi 按当前语言取值）──
const L_STORAGE_REUSE_CACHED = defErr<{
  sourceLabel: string
  bucket: string
  objectKey: string
}>(
  'storage.log.reuseCached',
  ({ sourceLabel, bucket, objectKey }) =>
    `复用已上传的参考媒体：${sourceLabel} → ${bucket}/${objectKey}（缓存命中，不重复上传）`,
  ({ sourceLabel, bucket, objectKey }) =>
    `Reusing uploaded reference media: ${sourceLabel} → ${bucket}/${objectKey} (cache hit, no re-upload)`
)
const L_STORAGE_START_UPLOAD = defErr<{
  provider: string
  sourceLabel: string
  bucket: string
  objectKey: string
  size: string
}>(
  'storage.log.startUpload',
  ({ provider, sourceLabel, bucket, objectKey, size }) =>
    `开始上传参考媒体到 ${provider}：${sourceLabel} → ${bucket}/${objectKey}（${size}）`,
  ({ provider, sourceLabel, bucket, objectKey, size }) =>
    `Uploading reference media to ${provider}: ${sourceLabel} → ${bucket}/${objectKey} (${size})`
)
const L_STORAGE_START_DATA_UPLOAD = defErr<{
  provider: string
  sourceLabel: string
  bucket: string
  objectKey: string
  size: string
}>(
  'storage.log.startDataUrlUpload',
  ({ provider, sourceLabel, bucket, objectKey, size }) =>
    `开始上传 data URL 参考媒体到 ${provider}：${sourceLabel} → ${bucket}/${objectKey}（${size}）`,
  ({ provider, sourceLabel, bucket, objectKey, size }) =>
    `Uploading data URL reference media to ${provider}: ${sourceLabel} → ${bucket}/${objectKey} (${size})`
)
const L_STORAGE_ALREADY_REMOTE = defErr<{ url: string }>(
  'storage.log.alreadyRemote',
  ({ url }) => `参考媒体已是远程 URL，跳过上传：${url}`,
  ({ url }) => `Reference media is already a remote URL, skipping upload: ${url}`
)
const L_STORAGE_UPLOAD_DONE = defErr<{ ms: number; url: string }>(
  'storage.log.uploadDone',
  ({ ms, url }) => `上传完成（${ms}ms）：${url}`,
  ({ ms, url }) => `Upload finished (${ms}ms): ${url}`
)
const L_STORAGE_SKIP_DELETE = defErr<{ reason: string }>(
  'storage.log.skipDelete',
  ({ reason }) => `跳过删除临时参考媒体：${reason}`,
  ({ reason }) => `Skipped deleting temporary reference media: ${reason}`
)
const L_STORAGE_DELETED = defErr<{ label: string; bucket: string; key: string }>(
  'storage.log.deleted',
  ({ label, bucket, key }) => `已删除临时参考媒体：${label}（${bucket}/${key}）`,
  ({ label, bucket, key }) => `Deleted temporary reference media: ${label} (${bucket}/${key})`
)
const L_STORAGE_DELETE_FAILED = defErr<{ bucket: string; key: string; reason: string }>(
  'storage.log.deleteFailed',
  ({ bucket, key, reason }) => `删除临时参考媒体失败：${bucket}/${key} — ${reason}`,
  ({ bucket, key, reason }) => `Failed to delete temporary reference media: ${bucket}/${key} — ${reason}`
)

export interface ObjectStorageLogEntry {
  level: 'info' | 'warn' | 'error'
  message: string
  ts: number
}

export interface ObjectStorageUploadResult {
  objectKey: string
  url: string
  bytes: number
  bucket: string
  providerId: string
  providerLabel: string
  sourceLabel: string
  logs: ObjectStorageLogEntry[]
}

export type ObjectStorageLogFn = (entry: ObjectStorageLogEntry) => void

function pushLog(
  logs: ObjectStorageLogEntry[],
  onLog: ObjectStorageLogFn | undefined,
  level: ObjectStorageLogEntry['level'],
  message: string
): void {
  const entry: ObjectStorageLogEntry = { level, message, ts: Date.now() }
  logs.push(entry)
  onLog?.(entry)
  const line = `[ObjectStorage] ${message}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

function buildObjectKey(sourceLabel: string, ext: string): string {
  const day = new Date().toISOString().slice(0, 10)
  const safeExt = ext.replace(/^\./, '').toLowerCase() || 'bin'
  const hash = createHash('sha1')
    .update(`${sourceLabel}:${Date.now()}:${randomUUID()}`)
    .digest('hex')
    .slice(0, 12)
  return `aiartengine/media-refs/${day}/${hash}.${safeExt}`
}

function bufferFromDataUrl(dataUrl: string): { buffer: Buffer; ext: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl)
  if (!match) throw fail(E_STORAGE_INVALID_DATA_URL)
  const mime = (match[1] || 'application/octet-stream').toLowerCase()
  const payload = match[3] || ''
  const buffer = match[2]
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload))
  const ext =
    mime.includes('mp4')
      ? 'mp4'
      : mime.includes('webm')
        ? 'webm'
        : mime.includes('quicktime') || mime.includes('mov')
          ? 'mov'
          : mime.includes('mpeg') || mime.includes('mp3')
            ? 'mp3'
            : mime.includes('wav')
              ? 'wav'
              : mime.includes('png')
                ? 'png'
                : mime.includes('jpeg') || mime.includes('jpg')
                  ? 'jpg'
                  : mime.includes('webp')
                    ? 'webp'
                    : mime.includes('gif')
                      ? 'gif'
                      : 'bin'
  return { buffer, ext }
}

function requireActiveProvider(): ObjectStorageProviderInstance {
  const provider = pickActiveObjectStorage(settingsService.get().objectStorage)
  if (!provider) {
    throw fail(E_STORAGE_NO_ACTIVE_PROVIDER)
  }
  return provider
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function adapterOf(provider: ObjectStorageProviderInstance) {
  return getObjectStorageAdapter(provider.providerKind)
}

// ── 会话级幂等上传缓存 ──────────────────────────────────────────
// 同一本地文件 / data URL 作为参考媒体（图/视频/3D 共用）时只上传一次：重试 /
// 多入口（图节点、AI 对话、Agent 重发）不再产生重复对象，URL 24h 预签名内直接复用。
interface UploadCacheEntry {
  result: ObjectStorageUploadResult
  createdAt: number
}

/** 缓存条数上限，超限时先懒清过期、再淘汰最旧一半 */
const UPLOAD_CACHE_MAX = 200
/** 预签名 URL 有效期 24h，缓存保守上限 12h；超时懒清理后重新上传 */
const UPLOAD_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const uploadCache = new Map<string, UploadCacheEntry>()

/** 本地文件 key：绝对路径 + size + mtime，文件未变即可复用 */
function fileUploadCacheKey(absPath: string, providerId: string, bucket: string): string | undefined {
  try {
    const st = statSync(absPath)
    return `file:${providerId}:${bucket}:${absPath}:${st.size}:${st.mtimeMs}`
  } catch {
    return undefined
  }
}

/** data URL key：内容 sha1（避免把超大 data URL 原样当 key） */
function dataUploadCacheKey(buffer: Buffer, providerId: string, bucket: string): string {
  const hash = createHash('sha1').update(buffer).digest('hex')
  return `data:${providerId}:${bucket}:${hash}`
}

function lookupUploadCache(key: string | undefined): ObjectStorageUploadResult | undefined {
  if (!key) return undefined
  const entry = uploadCache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.createdAt > UPLOAD_CACHE_TTL_MS) {
    uploadCache.delete(key)
    return undefined
  }
  return entry.result
}

function storeUploadCache(key: string | undefined, result: ObjectStorageUploadResult): void {
  if (!key) return
  if (uploadCache.size >= UPLOAD_CACHE_MAX) {
    const now = Date.now()
    for (const [k, v] of uploadCache) {
      if (now - v.createdAt > UPLOAD_CACHE_TTL_MS) uploadCache.delete(k)
    }
    if (uploadCache.size >= UPLOAD_CACHE_MAX) {
      const dropCount = Math.ceil(uploadCache.size / 2)
      let removed = 0
      for (const k of uploadCache.keys()) {
        if (removed++ >= dropCount) break
        uploadCache.delete(k)
      }
    }
  }
  uploadCache.set(key, { result, createdAt: Date.now() })
}

/** 对象删除成功后使缓存失效，确保后续重新上传获得新对象 */
function evictUploadCacheByObjectKey(objectKey: string): void {
  for (const [k, v] of uploadCache) {
    if (v.result.objectKey === objectKey) uploadCache.delete(k)
  }
}

/** 缓存命中：克隆结果并追加一条复用日志（logs 展示与 onLog 回调均可见） */
function cloneCachedUpload(
  result: ObjectStorageUploadResult,
  onLog: ObjectStorageLogFn | undefined
): ObjectStorageUploadResult {
  const cloned = { ...result, logs: [...result.logs] }
  pushLog(
    cloned.logs,
    onLog,
    'info',
    formatBi(L_STORAGE_REUSE_CACHED, {
      sourceLabel: result.sourceLabel,
      bucket: result.bucket,
      objectKey: result.objectKey
    })
  )
  return cloned
}

/**
 * 上传本地文件到当前启用的对象存储，返回可供媒体生成引用的 http(s) URL。
 */
export async function uploadLocalFile(
  absPath: string,
  options?: { sourceLabel?: string; onLog?: ObjectStorageLogFn }
): Promise<ObjectStorageUploadResult> {
  const logs: ObjectStorageLogEntry[] = []
  const onLog = options?.onLog
  if (!existsSync(absPath)) throw fail(E_STORAGE_UPLOAD_FILE_MISSING, { path: absPath })

  const provider = requireActiveProvider()
  const bucket = getObjectStorageBucket(provider)
  const sourceLabel = options?.sourceLabel?.trim() || basename(absPath)
  const bytes = statSync(absPath).size
  const objectKey = buildObjectKey(sourceLabel, extname(absPath))

  pushLog(
    logs,
    onLog,
    'info',
    formatBi(L_STORAGE_START_UPLOAD, {
      provider: provider.label,
      sourceLabel,
      bucket,
      objectKey,
      size: formatBytes(bytes)
    })
  )

  const started = Date.now()
  const url = await adapterOf(provider).uploadFile(provider, absPath, objectKey)
  pushLog(
    logs,
    onLog,
    'info',
    formatBi(L_STORAGE_UPLOAD_DONE, {
      ms: Date.now() - started,
      url: `${url.slice(0, 120)}${url.length > 120 ? '…' : ''}`
    })
  )

  return {
    objectKey,
    url,
    bytes,
    bucket,
    providerId: provider.id,
    providerLabel: provider.label,
    sourceLabel,
    logs
  }
}

/**
 * 将 data URL / 本地路径 / 工程相对路径转为可引用的远程 URL。
 * 已是 http(s) 则原样返回（不重复上传）。
 */
export async function ensureRemoteMediaUrl(
  pathOrUrl: string,
  options?: { sourceLabel?: string; onLog?: ObjectStorageLogFn; projectRoot?: string }
): Promise<{ url: string; uploaded?: ObjectStorageUploadResult }> {
  const trimmed = pathOrUrl.trim()
  if (!trimmed) throw fail(E_STORAGE_EMPTY_MEDIA_PATH)

  if (/^https?:\/\//i.test(trimmed)) {
    options?.onLog?.({
      level: 'info',
      message: formatBi(L_STORAGE_ALREADY_REMOTE, { url: trimmed.slice(0, 120) }),
      ts: Date.now()
    })
    return { url: trimmed }
  }

  if (trimmed.startsWith('data:')) {
    const provider = requireActiveProvider()
    const bucket = getObjectStorageBucket(provider)
    const { buffer, ext } = bufferFromDataUrl(trimmed)
    const sourceLabel = options?.sourceLabel?.trim() || 'data-url'
    const cacheKey = dataUploadCacheKey(buffer, provider.id, bucket)
    const cached = lookupUploadCache(cacheKey)
    if (cached) return { url: cached.url, uploaded: cloneCachedUpload(cached, options?.onLog) }

    const logs: ObjectStorageLogEntry[] = []
    const objectKey = buildObjectKey(sourceLabel, ext)
    pushLog(
      logs,
      options?.onLog,
      'info',
      formatBi(L_STORAGE_START_DATA_UPLOAD, {
        provider: provider.label,
        sourceLabel,
        bucket,
        objectKey,
        size: formatBytes(buffer.byteLength)
      })
    )
    const started = Date.now()
    const url = await adapterOf(provider).uploadBuffer(provider, buffer, objectKey)
    pushLog(
      logs,
      options?.onLog,
      'info',
      formatBi(L_STORAGE_UPLOAD_DONE, {
        ms: Date.now() - started,
        url: `${url.slice(0, 120)}${url.length > 120 ? '…' : ''}`
      })
    )
    const result: ObjectStorageUploadResult = {
      objectKey,
      url,
      bytes: buffer.byteLength,
      bucket,
      providerId: provider.id,
      providerLabel: provider.label,
      sourceLabel,
      logs
    }
    storeUploadCache(cacheKey, result)
    return { url, uploaded: result }
  }

  const root = options?.projectRoot ?? (projectService.isOpen() ? projectService.getRoot() : '')
  const abs =
    root && !trimmed.match(/^[A-Za-z]:[\\/]/) && !trimmed.startsWith('/')
      ? join(root, trimmed)
      : trimmed
  const provider = requireActiveProvider()
  const bucket = getObjectStorageBucket(provider)
  const cacheKey = fileUploadCacheKey(abs, provider.id, bucket)
  const cached = lookupUploadCache(cacheKey)
  if (cached) return { url: cached.url, uploaded: cloneCachedUpload(cached, options?.onLog) }

  const uploaded = await uploadLocalFile(abs, {
    sourceLabel: options?.sourceLabel ?? basename(abs),
    onLog: options?.onLog
  })
  storeUploadCache(cacheKey, uploaded)
  return { url: uploaded.url, uploaded }
}

/** 工程相对路径 → 对象存储公网/预签名 URL（供参考媒体） */
export async function uploadProjectMedia(
  relativePath: string,
  options?: { onLog?: ObjectStorageLogFn }
): Promise<ObjectStorageUploadResult> {
  if (!projectService.isOpen()) throw fail(MAIN_ERRORS.noProject)
  const root = projectService.getRoot()
  const abs = join(root, relativePath.replace(/\\/g, '/'))
  return uploadLocalFile(abs, {
    sourceLabel: relativePath.replace(/\\/g, '/'),
    onLog: options?.onLog
  })
}

/**
 * 生成结束后清理临时参考媒体对象。
 * 删除失败只记 warn，不抛错，避免掩盖生成结果。
 */
export async function deleteUploads(
  uploads: Array<Pick<ObjectStorageUploadResult, 'bucket' | 'objectKey' | 'sourceLabel'>>,
  options?: { onLog?: ObjectStorageLogFn }
): Promise<ObjectStorageLogEntry[]> {
  const logs: ObjectStorageLogEntry[] = []
  if (!uploads.length) return logs

  let provider: ObjectStorageProviderInstance
  try {
    provider = requireActiveProvider()
  } catch (err) {
    pushLog(
      logs,
      options?.onLog,
      'warn',
      formatBi(L_STORAGE_SKIP_DELETE, {
        reason: err instanceof Error ? err.message : String(err)
      })
    )
    return logs
  }

  const defaultBucket = getObjectStorageBucket(provider)
  const adapter = adapterOf(provider)
  for (const item of uploads) {
    const bucket = item.bucket.trim() || defaultBucket
    const key = item.objectKey.trim()
    if (!bucket || !key) continue
    try {
      await adapter.deleteObject(provider, bucket, key)
      evictUploadCacheByObjectKey(key)
      pushLog(
        logs,
        options?.onLog,
        'info',
        formatBi(L_STORAGE_DELETED, { label: item.sourceLabel || key, bucket, key })
      )
    } catch (err) {
      pushLog(
        logs,
        options?.onLog,
        'warn',
        formatBi(L_STORAGE_DELETE_FAILED, {
          bucket,
          key,
          reason: err instanceof Error ? err.message : String(err)
        })
      )
    }
  }
  return logs
}

