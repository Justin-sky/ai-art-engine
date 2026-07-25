import { createHash, randomUUID } from 'crypto'
import { basename, extname, join } from 'path'
import { existsSync, readFileSync, statSync } from 'fs'
import { TosClient } from '@volcengine/tos-sdk'
import OSS from 'ali-oss'
import COS from 'cos-nodejs-sdk-v5'
import {
  getObjectStorageBucket,
  pickActiveObjectStorage,
  type AliyunOssParams,
  type ObjectStorageProviderInstance,
  type TencentCosParams,
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

/* ---------- Volcengine TOS ---------- */

function createTosClient(tos: VolcengineTosParams): TosClient {
  return new TosClient({
    accessKeyId: tos.accessKeyId.trim(),
    accessKeySecret: tos.accessKeySecret.trim(),
    region: tos.region.trim(),
    endpoint: tos.endpoint.trim().replace(/\/$/, '')
  })
}

function resolveTosPublicUrl(
  client: TosClient,
  tos: VolcengineTosParams,
  objectKey: string
): string {
  const custom = tos.publicBaseUrl?.trim().replace(/\/$/, '')
  if (custom) return `${custom}/${objectKey}`

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

async function uploadFileViaTos(
  provider: ObjectStorageProviderInstance,
  absPath: string,
  objectKey: string
): Promise<string> {
  const client = createTosClient(provider.tos)
  await client.putObjectFromFile({
    bucket: provider.tos.bucket.trim(),
    key: objectKey,
    filePath: absPath
  })
  return resolveTosPublicUrl(client, provider.tos, objectKey)
}

async function uploadBufferViaTos(
  provider: ObjectStorageProviderInstance,
  buffer: Buffer,
  objectKey: string
): Promise<string> {
  const client = createTosClient(provider.tos)
  await client.putObject({
    bucket: provider.tos.bucket.trim(),
    key: objectKey,
    body: buffer
  })
  return resolveTosPublicUrl(client, provider.tos, objectKey)
}

async function deleteViaTos(
  provider: ObjectStorageProviderInstance,
  bucket: string,
  key: string
): Promise<void> {
  const client = createTosClient(provider.tos)
  await client.deleteObject({ bucket, key })
}

/* ---------- Aliyun OSS ---------- */

function createOssClient(oss: AliyunOssParams): OSS {
  const region = oss.region.trim()
  const endpoint = oss.endpoint.trim().replace(/\/$/, '')
  return new OSS({
    accessKeyId: oss.accessKeyId.trim(),
    accessKeySecret: oss.accessKeySecret.trim(),
    bucket: oss.bucket.trim(),
    region: region.startsWith('oss-') ? region : `oss-${region}`,
    endpoint: endpoint || undefined,
    secure: true,
    timeout: 120_000
  })
}

function resolveOssPublicUrl(client: OSS, oss: AliyunOssParams, objectKey: string): string {
  const custom = oss.publicBaseUrl?.trim().replace(/\/$/, '')
  if (custom) return `${custom}/${objectKey}`
  try {
    const signed = client.signatureUrl(objectKey, { expires: 60 * 60 * 24 })
    if (typeof signed === 'string' && signed.trim()) return signed.trim()
  } catch {
    // fall through
  }
  const endpointHost = (oss.endpoint || `https://${oss.region}.aliyuncs.com`)
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '')
  return `https://${oss.bucket.trim()}.${endpointHost}/${objectKey}`
}

async function uploadFileViaOss(
  provider: ObjectStorageProviderInstance,
  absPath: string,
  objectKey: string
): Promise<string> {
  const client = createOssClient(provider.oss)
  await client.put(objectKey, absPath)
  return resolveOssPublicUrl(client, provider.oss, objectKey)
}

async function uploadBufferViaOss(
  provider: ObjectStorageProviderInstance,
  buffer: Buffer,
  objectKey: string
): Promise<string> {
  const client = createOssClient(provider.oss)
  await client.put(objectKey, buffer)
  return resolveOssPublicUrl(client, provider.oss, objectKey)
}

async function deleteViaOss(
  provider: ObjectStorageProviderInstance,
  _bucket: string,
  key: string
): Promise<void> {
  const client = createOssClient(provider.oss)
  await client.delete(key)
}

/* ---------- Tencent COS ---------- */

function createCosClient(cos: TencentCosParams): COS {
  return new COS({
    SecretId: cos.secretId.trim(),
    SecretKey: cos.secretKey.trim()
  })
}

function cosPutObject(
  client: COS,
  params: {
    Bucket: string
    Region: string
    Key: string
    Body: Buffer
    ContentLength?: number
  }
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    client.putObject(params as Parameters<COS['putObject']>[0], (err, data) => {
      if (err) reject(err)
      else resolve(data)
    })
  })
}

function cosDeleteObject(
  client: COS,
  params: { Bucket: string; Region: string; Key: string }
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    client.deleteObject(params, (err, data) => {
      if (err) reject(err)
      else resolve(data)
    })
  })
}

function resolveCosPublicUrl(
  client: COS,
  cos: TencentCosParams,
  objectKey: string
): string {
  const custom = cos.publicBaseUrl?.trim().replace(/\/$/, '')
  if (custom) return `${custom}/${objectKey}`

  const url = client.getObjectUrl({
    Bucket: cos.bucket.trim(),
    Region: cos.region.trim(),
    Key: objectKey,
    Sign: true,
    Expires: 60 * 60 * 24
  })
  if (typeof url === 'string' && url.trim()) return url.trim()
  return `https://${cos.bucket.trim()}.cos.${cos.region.trim()}.myqcloud.com/${objectKey}`
}

async function uploadFileViaCos(
  provider: ObjectStorageProviderInstance,
  absPath: string,
  objectKey: string
): Promise<string> {
  const client = createCosClient(provider.cos)
  const body = readFileSync(absPath)
  await cosPutObject(client, {
    Bucket: provider.cos.bucket.trim(),
    Region: provider.cos.region.trim(),
    Key: objectKey,
    Body: body,
    ContentLength: body.byteLength
  })
  return resolveCosPublicUrl(client, provider.cos, objectKey)
}

async function uploadBufferViaCos(
  provider: ObjectStorageProviderInstance,
  buffer: Buffer,
  objectKey: string
): Promise<string> {
  const client = createCosClient(provider.cos)
  await cosPutObject(client, {
    Bucket: provider.cos.bucket.trim(),
    Region: provider.cos.region.trim(),
    Key: objectKey,
    Body: buffer,
    ContentLength: buffer.byteLength
  })
  return resolveCosPublicUrl(client, provider.cos, objectKey)
}

async function deleteViaCos(
  provider: ObjectStorageProviderInstance,
  bucket: string,
  key: string
): Promise<void> {
  const client = createCosClient(provider.cos)
  await cosDeleteObject(client, {
    Bucket: bucket || provider.cos.bucket.trim(),
    Region: provider.cos.region.trim(),
    Key: key
  })
}

/* ---------- Dispatch ---------- */

async function uploadFile(
  provider: ObjectStorageProviderInstance,
  absPath: string,
  objectKey: string
): Promise<string> {
  if (provider.providerKind === 'aliyun-oss') {
    return uploadFileViaOss(provider, absPath, objectKey)
  }
  if (provider.providerKind === 'tencent-cos') {
    return uploadFileViaCos(provider, absPath, objectKey)
  }
  return uploadFileViaTos(provider, absPath, objectKey)
}

async function uploadBuffer(
  provider: ObjectStorageProviderInstance,
  buffer: Buffer,
  objectKey: string
): Promise<string> {
  if (provider.providerKind === 'aliyun-oss') {
    return uploadBufferViaOss(provider, buffer, objectKey)
  }
  if (provider.providerKind === 'tencent-cos') {
    return uploadBufferViaCos(provider, buffer, objectKey)
  }
  return uploadBufferViaTos(provider, buffer, objectKey)
}

async function deleteObject(
  provider: ObjectStorageProviderInstance,
  bucket: string,
  key: string
): Promise<void> {
  if (provider.providerKind === 'aliyun-oss') {
    return deleteViaOss(provider, bucket, key)
  }
  if (provider.providerKind === 'tencent-cos') {
    return deleteViaCos(provider, bucket, key)
  }
  return deleteViaTos(provider, bucket, key)
}

/**
 * 上传本地文件到当前启用的对象存储，返回可供视频生成引用的 http(s) URL。
 */
export async function uploadLocalFileToTos(
  absPath: string,
  options?: { sourceLabel?: string; onLog?: TosUploadLogFn }
): Promise<TosUploadResult> {
  const logs: TosUploadLogEntry[] = []
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
  const url = await uploadFile(provider, absPath, objectKey)
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
    const bucket = getObjectStorageBucket(provider)
    pushLog(
      logs,
      options?.onLog,
      'info',
      `开始上传 data URL 参考视频到 ${provider.label}：${sourceLabel} → ${bucket}/${objectKey}（${formatBytes(buffer.byteLength)}）`
    )
    const started = Date.now()
    const url = await uploadBuffer(provider, buffer, objectKey)
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
  const uploaded = await uploadLocalFileToTos(abs, {
    sourceLabel: options?.sourceLabel ?? basename(abs),
    onLog: options?.onLog
  })
  return { url: uploaded.url, uploaded }
}

/** 工程相对路径 → 对象存储公网/预签名 URL（供参考视频） */
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

  const defaultBucket = getObjectStorageBucket(provider)
  for (const item of uploads) {
    const bucket = item.bucket.trim() || defaultBucket
    const key = item.objectKey.trim()
    if (!bucket || !key) continue
    try {
      await deleteObject(provider, bucket, key)
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
