import { createHash, randomUUID } from 'crypto'
import { basename, extname, join } from 'path'
import { existsSync, statSync } from 'fs'
import {
  getObjectStorageBucket,
  pickActiveObjectStorage,
  type ObjectStorageProviderInstance
} from '@shared/objectStorage'
import { getObjectStorageAdapter } from '../runtime'
import { settingsService } from './settingsService'
import { projectService } from './projectService'

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
  return `aiartengine/video-refs/${day}/${hash}.${safeExt}`
}

function bufferFromDataUrl(dataUrl: string): { buffer: Buffer; ext: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl)
  if (!match) throw new Error('无效的 data URL')
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
    throw new Error(
      '未配置可用的对象存储。请在设置 → 对象存储中添加火山引擎 TOS / 阿里云 OSS / 腾讯云 COS，并填写密钥与桶信息'
    )
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

/**
 * 上传本地文件到当前启用的对象存储，返回可供视频生成引用的 http(s) URL。
 */
export async function uploadLocalFile(
  absPath: string,
  options?: { sourceLabel?: string; onLog?: ObjectStorageLogFn }
): Promise<ObjectStorageUploadResult> {
  const logs: ObjectStorageLogEntry[] = []
  const onLog = options?.onLog
  if (!existsSync(absPath)) throw new Error(`待上传文件不存在: ${absPath}`)

  const provider = requireActiveProvider()
  const bucket = getObjectStorageBucket(provider)
  const sourceLabel = options?.sourceLabel?.trim() || basename(absPath)
  const bytes = statSync(absPath).size
  const objectKey = buildObjectKey(sourceLabel, extname(absPath))

  pushLog(
    logs,
    onLog,
    'info',
    `开始上传参考视频到 ${provider.label}：${sourceLabel} → ${bucket}/${objectKey}（${formatBytes(bytes)}）`
  )

  const started = Date.now()
  const url = await adapterOf(provider).uploadFile(provider, absPath, objectKey)
  pushLog(
    logs,
    onLog,
    'info',
    `上传完成（${Date.now() - started}ms）：${url.slice(0, 120)}${url.length > 120 ? '…' : ''}`
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
  if (!trimmed) throw new Error('空的媒体路径')

  if (/^https?:\/\//i.test(trimmed)) {
    options?.onLog?.({
      level: 'info',
      message: `参考视频已是远程 URL，跳过上传：${trimmed.slice(0, 120)}`,
      ts: Date.now()
    })
    return { url: trimmed }
  }

  if (trimmed.startsWith('data:')) {
    const logs: ObjectStorageLogEntry[] = []
    const provider = requireActiveProvider()
    const { buffer, ext } = bufferFromDataUrl(trimmed)
    const sourceLabel = options?.sourceLabel?.trim() || 'data-url'
    const objectKey = buildObjectKey(sourceLabel, ext)
    const bucket = getObjectStorageBucket(provider)
    pushLog(
      logs,
      options?.onLog,
      'info',
      `开始上传 data URL 参考视频到 ${provider.label}：${sourceLabel} → ${bucket}/${objectKey}（${formatBytes(buffer.byteLength)}）`
    )
    const started = Date.now()
    const url = await adapterOf(provider).uploadBuffer(provider, buffer, objectKey)
    pushLog(
      logs,
      options?.onLog,
      'info',
      `上传完成（${Date.now() - started}ms）：${url.slice(0, 120)}${url.length > 120 ? '…' : ''}`
    )
    return {
      url,
      uploaded: {
        objectKey,
        url,
        bytes: buffer.byteLength,
        bucket,
        providerId: provider.id,
        providerLabel: provider.label,
        sourceLabel,
        logs
      }
    }
  }

  const root = options?.projectRoot ?? (projectService.isOpen() ? projectService.getRoot() : '')
  const abs =
    root && !trimmed.match(/^[A-Za-z]:[\\/]/) && !trimmed.startsWith('/')
      ? join(root, trimmed)
      : trimmed
  const uploaded = await uploadLocalFile(abs, {
    sourceLabel: options?.sourceLabel ?? basename(abs),
    onLog: options?.onLog
  })
  return { url: uploaded.url, uploaded }
}

/** 工程相对路径 → 对象存储公网/预签名 URL（供参考视频） */
export async function uploadProjectMedia(
  relativePath: string,
  options?: { onLog?: ObjectStorageLogFn }
): Promise<ObjectStorageUploadResult> {
  if (!projectService.isOpen()) throw new Error('未打开工程')
  const root = projectService.getRoot()
  const abs = join(root, relativePath.replace(/\\/g, '/'))
  return uploadLocalFile(abs, {
    sourceLabel: relativePath.replace(/\\/g, '/'),
    onLog: options?.onLog
  })
}

/**
 * 生成结束后清理临时参考视频对象。
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
      `跳过删除临时参考视频：${err instanceof Error ? err.message : String(err)}`
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
      pushLog(
        logs,
        options?.onLog,
        'info',
        `已删除临时参考视频：${item.sourceLabel || key}（${bucket}/${key}）`
      )
    } catch (err) {
      pushLog(
        logs,
        options?.onLog,
        'warn',
        `删除临时参考视频失败：${bucket}/${key} — ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  return logs
}

