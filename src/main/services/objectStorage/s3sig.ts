import { createHash, createHmac } from 'crypto'

/** SHA-256 of an empty body. DELETE 与预签名 GET 都用它。 */
export const S3_EMPTY_PAYLOAD_HASH =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/** 预签名 GET 的 payload 标记。不把对象内容放进签名。 */
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'

export function sha256Hex(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex')
}

/** SigV4 URI 编码：除未保留字符外全部百分号编码，空格是 %20。 */
export function awsUriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

export function encodeS3Key(objectKey: string): string {
  return objectKey
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => awsUriEncode(part))
    .join('/')
}

export interface S3ObjectTarget {
  url: string
  host: string
  canonicalUri: string
}

/**
 * 拼出 PUT / GET / DELETE 的目标。
 * path-style：`https://endpoint/bucket/key`（MinIO、部分网关必须）。
 * virtual-hosted：`https://bucket.endpoint/key`（Amazon S3、Cloudflare R2 常用）。
 */
export function resolveS3ObjectTarget(input: {
  endpoint: string
  bucket: string
  objectKey: string
  pathStyle: boolean
}): S3ObjectTarget {
  let endpoint = input.endpoint.trim().replace(/\/$/, '')
  if (!/^https?:\/\//i.test(endpoint)) endpoint = `https://${endpoint}`
  const base = new URL(endpoint)
  const bucket = input.bucket.trim()
  const encodedKey = encodeS3Key(input.objectKey)
  const prefix = base.pathname.replace(/\/$/, '')
  const canonicalUri = input.pathStyle
    ? `${prefix}/${awsUriEncode(bucket)}/${encodedKey}`
    : `${prefix}/${encodedKey}`
  if (input.pathStyle) {
    return { url: `${base.origin}${canonicalUri}`, host: base.host, canonicalUri }
  }
  const host = `${bucket}.${base.host}`
  return { url: `${base.protocol}//${host}${canonicalUri}`, host, canonicalUri }
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

export function s3SigningKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, 's3')
  return hmacSha256(kService, 'aws4_request')
}

function canonicalHeaderBlock(headers: Record<string, string>): {
  block: string
  signedHeaders: string
} {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value.trim().replace(/\s+/g, ' ')
  }
  const names = Object.keys(normalized).sort()
  const lines = names.map((name) => `${name}:${normalized[name]}`)
  return { block: `${lines.join('\n')}\n`, signedHeaders: names.join(';') }
}

export interface S3SignedRequest {
  authorization: string
  signature: string
  signedHeaders: string
  /** 发给 HTTP 客户端的头。不含 host：客户端会按 URL 自己填，签进去的值必须和它一致。 */
  headers: Record<string, string>
}

export function signS3Authorization(input: {
  method: string
  canonicalUri: string
  canonicalQuery?: string
  host: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  payloadHash: string
  amzDate: string
  extraHeaders?: Record<string, string>
  /**
   * 预签名 URL：日期和凭证在 query 里，签名头只留 host。
   * 模型稍后用浏览器 / HTTP 客户端拉这条链接时不会带 x-amz-* 请求头。
   */
  queryAuth?: boolean
}): S3SignedRequest {
  const headers: Record<string, string> = input.queryAuth
    ? { host: input.host }
    : {
        host: input.host,
        'x-amz-date': input.amzDate,
        'x-amz-content-sha256': input.payloadHash,
        ...(input.extraHeaders ?? {})
      }
  const { block, signedHeaders } = canonicalHeaderBlock(headers)
  const canonicalRequest = [
    input.method.toUpperCase(),
    input.canonicalUri,
    input.canonicalQuery ?? '',
    block,
    signedHeaders,
    input.payloadHash
  ].join('\n')
  const dateStamp = input.amzDate.slice(0, 8)
  const scope = `${dateStamp}/${input.region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', input.amzDate, scope, sha256Hex(canonicalRequest)].join(
    '\n'
  )
  const signature = hmacSha256(
    s3SigningKey(input.secretAccessKey, dateStamp, input.region),
    stringToSign
  ).toString('hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`
  const outbound: Record<string, string> = input.queryAuth
    ? {}
    : {
        'x-amz-date': input.amzDate,
        'x-amz-content-sha256': input.payloadHash,
        Authorization: authorization
      }
  for (const [key, value] of Object.entries(input.extraHeaders ?? {})) {
    outbound[key] = value
  }
  return { authorization, signature, signedHeaders, headers: outbound }
}

function canonicalQuery(pairs: Array<[string, string]>): string {
  return pairs
    .map(([key, value]) => [awsUriEncode(key), awsUriEncode(value)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

/** 私有桶没有自定义域名时，给模型一条 24 小时内可拉取的 GET 链接。 */
export function presignS3GetUrl(input: {
  target: S3ObjectTarget
  region: string
  accessKeyId: string
  secretAccessKey: string
  amzDate: string
  expiresSec: number
}): string {
  const dateStamp = input.amzDate.slice(0, 8)
  const scope = `${dateStamp}/${input.region}/s3/aws4_request`
  const pairs: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${input.accessKeyId}/${scope}`],
    ['X-Amz-Date', input.amzDate],
    ['X-Amz-Expires', String(input.expiresSec)],
    ['X-Amz-SignedHeaders', 'host']
  ]
  const query = canonicalQuery(pairs)
  const signed = signS3Authorization({
    method: 'GET',
    canonicalUri: input.target.canonicalUri,
    canonicalQuery: query,
    host: input.target.host,
    region: input.region,
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    payloadHash: UNSIGNED_PAYLOAD,
    amzDate: input.amzDate,
    queryAuth: true
  })
  return `${input.target.url}?${query}&X-Amz-Signature=${signed.signature}`
}

export function formatAmzDate(date = new Date()): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

export { UNSIGNED_PAYLOAD }
