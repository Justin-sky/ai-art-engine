import { createHmac } from 'crypto'

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/**
 * 可灵开放平台 JWT（HS256）。
 * payload: iss=AccessKey, exp=now+ttl, nbf=now-skew
 */
export function signKlingJwt(
  accessKey: string,
  secretKey: string,
  options?: { ttlSec?: number; skewSec?: number; nowSec?: number }
): string {
  const ak = accessKey.trim()
  const sk = secretKey.trim()
  if (!ak) throw new Error('请先填写 Access Key')
  if (!sk) throw new Error('请先填写 Secret Key')

  const ttlSec = options?.ttlSec ?? 1800
  const skewSec = options?.skewSec ?? 5
  const now = options?.nowSec ?? Math.floor(Date.now() / 1000)

  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    iss: ak,
    exp: now + ttlSec,
    nbf: now - skewSec
  }

  const headerPart = base64UrlEncode(JSON.stringify(header))
  const payloadPart = base64UrlEncode(JSON.stringify(payload))
  const signingInput = `${headerPart}.${payloadPart}`
  const signature = createHmac('sha256', sk).update(signingInput).digest()
  return `${signingInput}.${base64UrlEncode(signature)}`
}

/** 解码 JWT payload（不校验签名；仅测试/调试用） */
export function decodeKlingJwtPayload(token: string): {
  iss?: string
  exp?: number
  nbf?: number
} {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT')
  const json = Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
    'utf8'
  )
  return JSON.parse(json) as { iss?: string; exp?: number; nbf?: number }
}
