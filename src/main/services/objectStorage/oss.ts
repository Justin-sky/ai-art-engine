import OSS from 'ali-oss'
import type { AliyunOssParams } from '@shared/objectStorage'
import type { ObjectStorageAdapter } from './types'

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

export const ossAdapter: ObjectStorageAdapter = {
  kind: 'aliyun-oss',

  async uploadFile(provider, absPath, objectKey) {
    const client = createOssClient(provider.oss)
    await client.put(objectKey, absPath)
    return resolveOssPublicUrl(client, provider.oss, objectKey)
  },

  async uploadBuffer(provider, buffer, objectKey) {
    const client = createOssClient(provider.oss)
    await client.put(objectKey, buffer)
    return resolveOssPublicUrl(client, provider.oss, objectKey)
  },

  async deleteObject(provider, _bucket, key) {
    const client = createOssClient(provider.oss)
    await client.delete(key)
  }
}
