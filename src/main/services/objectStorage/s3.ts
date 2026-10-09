import { readFile } from 'fs/promises'
import axios from 'axios'
import type { S3CompatibleParams } from '@shared/objectStorage'
import type { ObjectStorageAdapter } from './types'
import {
  S3_EMPTY_PAYLOAD_HASH,
  formatAmzDate,
  presignS3GetUrl,
  resolveS3ObjectTarget,
  sha256Hex,
  signS3Authorization
} from './s3sig'

const PUT_CONTENT_TYPE = 'application/octet-stream'
const PRESIGN_SECONDS = 60 * 60 * 24

function readS3Error(data: unknown, status: number): string {
  const text =
    typeof data === 'string'
      ? data
      : Buffer.isBuffer(data)
        ? data.toString('utf8')
        : data
          ? JSON.stringify(data)
          : ''
  const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1]
  const message = text.match(/<Message>([^<]+)<\/Message>/)?.[1]
  const detail = [code, message].filter(Boolean).join(': ')
  return detail
    ? `S3 request failed (${status}): ${detail}`
    : `S3 request failed (${status})${text ? `: ${text.slice(0, 300)}` : ''}`
}

function publicOrSignedUrl(s3: S3CompatibleParams, objectKey: string): string {
  const custom = s3.publicBaseUrl.trim().replace(/\/$/, '')
  if (custom) return `${custom}/${objectKey.replace(/^\/+/, '')}`
  const target = resolveS3ObjectTarget({
    endpoint: s3.endpoint,
    bucket: s3.bucket,
    objectKey,
    pathStyle: s3.pathStyle
  })
  return presignS3GetUrl({
    target,
    region: s3.region.trim(),
    accessKeyId: s3.accessKeyId.trim(),
    secretAccessKey: s3.secretAccessKey.trim(),
    amzDate: formatAmzDate(),
    expiresSec: PRESIGN_SECONDS
  })
}

async function s3Request(
  s3: S3CompatibleParams,
  method: 'PUT' | 'DELETE',
  objectKey: string,
  body?: Buffer
): Promise<void> {
  const target = resolveS3ObjectTarget({
    endpoint: s3.endpoint,
    bucket: s3.bucket,
    objectKey,
    pathStyle: s3.pathStyle
  })
  const payload = body ?? Buffer.alloc(0)
  const payloadHash = body ? sha256Hex(body) : S3_EMPTY_PAYLOAD_HASH
  const amzDate = formatAmzDate()
  const extraHeaders = method === 'PUT' ? { 'content-type': PUT_CONTENT_TYPE } : undefined
  const signed = signS3Authorization({
    method,
    canonicalUri: target.canonicalUri,
    host: target.host,
    region: s3.region.trim(),
    accessKeyId: s3.accessKeyId.trim(),
    secretAccessKey: s3.secretAccessKey.trim(),
    payloadHash,
    amzDate,
    extraHeaders
  })
  const response = await axios.request({
    method,
    url: target.url,
    data: method === 'PUT' ? payload : undefined,
    headers: signed.headers,
    responseType: 'text',
    timeout: 120_000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true
  })
  if (response.status >= 300) {
    throw new Error(readS3Error(response.data, response.status))
  }
}

export const s3Adapter: ObjectStorageAdapter = {
  kind: 's3',

  async uploadFile(provider, absPath, objectKey) {
    const body = await readFile(absPath)
    return this.uploadBuffer(provider, body, objectKey)
  },

  async uploadBuffer(provider, buffer, objectKey) {
    await s3Request(provider.s3, 'PUT', objectKey, buffer)
    return publicOrSignedUrl(provider.s3, objectKey)
  },

  async deleteObject(provider, _bucket, key) {
    await s3Request(provider.s3, 'DELETE', key)
  }
}
