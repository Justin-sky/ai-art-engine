import { readFileSync } from 'fs'
import COS from 'cos-nodejs-sdk-v5'
import type { TencentCosParams } from '@shared/objectStorage'
import type { ObjectStorageAdapter } from './types'

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

function resolveCosPublicUrl(client: COS, cos: TencentCosParams, objectKey: string): string {
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

export const cosAdapter: ObjectStorageAdapter = {
  kind: 'tencent-cos',

  async uploadFile(provider, absPath, objectKey) {
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
  },

  async uploadBuffer(provider, buffer, objectKey) {
    const client = createCosClient(provider.cos)
    await cosPutObject(client, {
      Bucket: provider.cos.bucket.trim(),
      Region: provider.cos.region.trim(),
      Key: objectKey,
      Body: buffer,
      ContentLength: buffer.byteLength
    })
    return resolveCosPublicUrl(client, provider.cos, objectKey)
  },

  async deleteObject(provider, bucket, key) {
    const client = createCosClient(provider.cos)
    await cosDeleteObject(client, {
      Bucket: bucket || provider.cos.bucket.trim(),
      Region: provider.cos.region.trim(),
      Key: key
    })
  }
}
