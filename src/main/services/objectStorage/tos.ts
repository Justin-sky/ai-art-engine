import { TosClient } from '@volcengine/tos-sdk'
import type { VolcengineTosParams } from '@shared/objectStorage'
import { defErrSimple, fail } from '@shared/errors/appError'
import type { ObjectStorageAdapter } from './types'

const E_TOS_INVALID_ENDPOINT = defErrSimple(
  'tos.invalidEndpoint',
  '对象存储 TOS endpoint 无效',
  'The Volcengine TOS endpoint is invalid'
)

/** TOS SDK 的 endpoint 必须是主机名；带 https:// 时预签名会变成 bucket.https://… */
function tosEndpointHost(endpoint: string): string {
  return endpoint.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

/** 识别因 endpoint 带协议而产生的非法主机名（如 aae-test.https） */
function isMalformedVirtualHostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return /\.https?$/i.test(host) || /https?:/i.test(host)
  } catch {
    return true
  }
}

function createTosClient(tos: VolcengineTosParams): TosClient {
  return new TosClient({
    accessKeyId: tos.accessKeyId.trim(),
    accessKeySecret: tos.accessKeySecret.trim(),
    region: tos.region.trim(),
    endpoint: tosEndpointHost(tos.endpoint)
  })
}

function resolveTosPublicUrl(
  client: TosClient,
  tos: VolcengineTosParams,
  objectKey: string
): string {
  const custom = tos.publicBaseUrl?.trim().replace(/\/$/, '')
  if (custom) {
    const base = /^https?:\/\//i.test(custom) ? custom : `https://${custom}`
    return `${base.replace(/\/$/, '')}/${objectKey}`
  }

  const signed = client.getPreSignedUrl({
    bucket: tos.bucket.trim(),
    key: objectKey,
    method: 'GET',
    expires: 60 * 60 * 24
  })
  if (typeof signed === 'string' && signed.trim() && !isMalformedVirtualHostUrl(signed)) {
    return signed.trim()
  }

  const endpointHost = tosEndpointHost(tos.endpoint)
  if (!endpointHost) throw fail(E_TOS_INVALID_ENDPOINT)
  return `https://${tos.bucket.trim()}.${endpointHost}/${objectKey}`
}

export const tosAdapter: ObjectStorageAdapter = {
  kind: 'volcengine-tos',

  async uploadFile(provider, absPath, objectKey) {
    const client = createTosClient(provider.tos)
    await client.putObjectFromFile({
      bucket: provider.tos.bucket.trim(),
      key: objectKey,
      filePath: absPath
    })
    return resolveTosPublicUrl(client, provider.tos, objectKey)
  },

  async uploadBuffer(provider, buffer, objectKey) {
    const client = createTosClient(provider.tos)
    await client.putObject({
      bucket: provider.tos.bucket.trim(),
      key: objectKey,
      body: buffer
    })
    return resolveTosPublicUrl(client, provider.tos, objectKey)
  },

  async deleteObject(provider, bucket, key) {
    const client = createTosClient(provider.tos)
    await client.deleteObject({ bucket, key })
  }
}
