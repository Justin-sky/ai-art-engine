import { createHash, randomUUID } from 'crypto'
import { basename, extname, join } from 'path'
import { existsSync, statSync } from 'fs'
import { TosClient } from '@volcengine/tos-sdk'
import {
  pickActiveObjectStorage,
  type ObjectStorageProviderInstance,
  type VolcengineTosParams
} from '@shared/objectStorage'
import { settingsService } from './settingsService'
import { projectService } from './projectService'

export interface TosUploadLogEntry {
  level: 'info' | 'warn' | 'error'
  message: string
  ts: number
}

export interface TosUploadResult {
  objectKey: string
  url: string
  bytes: number
  bucket: string
  providerId: string
  providerLabel: string
  sourceLabel: string
  logs: TosUploadLogEntry[]
}

export type TosUploadLogFn = (entry: TosUploadLogEntry) => void

function pushLog(
  logs: TosUploadLogEntry[],
  onLog: TosUploadLogFn | undefined,
  level: TosUploadLogEntry['level'],
  message: string
): void {
  const entry: TosUploadLogEntry = { level, message, ts: Date.now() }
  logs.push(entry)
  onLog?.(entry)
  const line = `[TOS] ${message}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

function createTosClient(tos: VolcengineTosParams): TosClient {
  return new TosClient({
    accessKeyId: tos.accessKeyId.trim(),
    accessKeySecret: tos.accessKeySecret.trim(),
    region: tos.region.trim(),
    endpoint: tos.endpoint.trim().replace(/\/$/, '')
  })
}

function buildObjectKey(sourceLabel: string, ext: string): string {
  const day = new Date().toISOString().slice(0, 10)
  const safeExt = ext.replace(/^\./, '').toLowerCase() || 'bin'
  const hash = createHash('sha1').update(`${sourceLabel}:${Date.now()}:${randomUUID()}`).digest('hex').slice(0, 12)
  return `aiartengine/video-refs/${day}/${hash}.${safeExt}`
}

function resolvePublicUrl(
  client: TosClient,
  tos: VolcengineTosParams,
  objectKey: string
): string {
  const custom = tos.publicBaseUrl?.trim().replace(/\/$/, '')
  if (custom) return `${custom}/${objectKey}`

  // 预签名 GET，便于私有桶被视频生成服务拉取
  const signed = client.getPreSignedUrl({
    bucket: tos.bucket.trim(),
    key: objectKey,
    method: 'GET',
    expires: 60 * 60 * 24
  })
  if (typeof signed === 'string' && signed.trim()) return signed.trim()

  const endpointHost = tos.endpoint
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '')
  return `https://${tos.bucket.trim()}.${endpointHost}/${objectKey}`
}

function bufferFromDataUrl(dataUrl: string): { buffer: Buffer; ext: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl)
  if (!match) throw new Error('无效的 data URL')
  const mime = (match[1] || 'application/octet-stream').toLowerCase()
  const payload = match[3] || ''
  const buffer = match[2] ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload))
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
              : 'bin'
  return { buffer, ext }
}

function requireActiveProvider(): ObjectStorageProviderInstance {
  const provider = pickActiveObjectStorage(settingsService.get().objectStorage)
  if (!provider) {
    throw new Error(
      '未配置可用的对象存储（火山引擎 TOS）。请在设置 → 对象存储中填写 AccessKey、Region、Endpoint 与 Bucket'
    )
  }
  return provider
}

/**
 * 上传本地文件到 TOS，返回可供视频生成引用的 http(s) URL。
 */
export async function uploadLocalFileToTos(
  absPath: string,
  options?: { sourceLabel?: string; onLog?: TosUploadLogFn }
): Promise<TosUploadResult> {
  const logs: TosUploadLogEntry[] = []
  const onLog = options?.onLog
  if (!existsSync(absPath)) throw new Error(`待上传文件不存在: ${absPath}`)

  const provider = requireActiveProvider()
  const tos = provider.tos
  const sourceLabel = options?.sourceLabel?.trim() || basename(absPath)
  const bytes = statSync(absPath).size
  const objectKey = buildObjectKey(sourceLabel, extname(absPath))

  pushLog(
    logs,
    onLog,
    'info',
    `开始上传参考视频到 TOS：${sourceLabel} → ${tos.bucket}/${objectKey}（${formatBytes(bytes)}）`
  )

  const client = createTosClient(tos)
  const started = Date.now()
  await client.putObjectFromFile({
    bucket: tos.bucket.trim(),
    key: objectKey,
    filePath: absPath
  })
  const url = resolvePublicUrl(client, tos, objectKey)
  pushLog(
    logs,
    onLog,
    'info',
    `TOS 上传完成（${Date.now() - started}ms）：${url.slice(0, 120)}${url.length > 120 ? '…' : ''}`
  )

  return {
    objectKey,
    url,
    bytes,
    bucket: tos.bucket.trim(),
    providerId: provider.id,
    providerLabel: provider.label,
    sourceLabel,
    logs
  }
}

/**
 * 将 data URL / 本地路径 / 工程相对路径转为可引用的 TOS URL。
 * 已是 http(s) 则原样返回（不重复上传）。
 */
export async function ensureRemoteMediaUrl(
  pathOrUrl: string,
  options?: { sourceLabel?: string; onLog?: TosUploadLogFn; projectRoot?: string }
): Promise<{ url: string; uploaded?: TosUploadResult }> {
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
    const logs: TosUploadLogEntry[] = []
    const provider = requireActiveProvider()
    const { buffer, ext } = bufferFromDataUrl(trimmed)
    const sourceLabel = options?.sourceLabel?.trim() || 'data-url'
    const objectKey = buildObjectKey(sourceLabel, ext)
    pushLog(
      logs,
      options?.onLog,
      'info',
      `开始上传 data URL 参考视频到 TOS：${sourceLabel} → ${provider.tos.bucket}/${objectKey}（${formatBytes(buffer.byteLength)}）`
    )
    const client = createTosClient(provider.tos)
    const started = Date.now()
    await client.putObject({
      bucket: provider.tos.bucket.trim(),
      key: objectKey,
      body: buffer
    })
    const url = resolvePublicUrl(client, provider.tos, objectKey)
    pushLog(
      logs,
      options?.onLog,
      'info',
      `TOS 上传完成（${Date.now() - started}ms）：${url.slice(0, 120)}${url.length > 120 ? '…' : ''}`
    )
    return {
      url,
      uploaded: {
        objectKey,
        url,
        bytes: buffer.byteLength,
        bucket: provider.tos.bucket.trim(),
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
  const uploaded = await uploadLocalFileToTos(abs, {
    sourceLabel: options?.sourceLabel ?? basename(abs),
    onLog: options?.onLog
  })
  return { url: uploaded.url, uploaded }
}

/** 工程相对路径 → TOS 公网/预签名 URL（供参考视频） */
export async function uploadProjectMediaToTos(
  relativePath: string,
  options?: { onLog?: TosUploadLogFn }
): Promise<TosUploadResult> {
  if (!projectService.isOpen()) throw new Error('未打开工程')
  const root = projectService.getRoot()
  const abs = join(root, relativePath.replace(/\\/g, '/'))
  return uploadLocalFileToTos(abs, {
    sourceLabel: relativePath.replace(/\\/g, '/'),
    onLog: options?.onLog
  })
}

/**
 * 生成结束后清理临时参考视频对象。
 * 删除失败只记 warn，不抛错，避免掩盖生成结果。
 */
export async function deleteTosUploads(
  uploads: Array<Pick<TosUploadResult, 'bucket' | 'objectKey' | 'sourceLabel'>>,
  options?: { onLog?: TosUploadLogFn }
): Promise<TosUploadLogEntry[]> {
  const logs: TosUploadLogEntry[] = []
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

  const client = createTosClient(provider.tos)
  for (const item of uploads) {
    const bucket = item.bucket.trim() || provider.tos.bucket.trim()
    const key = item.objectKey.trim()
    if (!bucket || !key) continue
    try {
      await client.deleteObject({ bucket, key })
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}
