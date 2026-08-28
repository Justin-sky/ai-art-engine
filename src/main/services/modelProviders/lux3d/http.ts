import axios, { type AxiosInstance } from 'axios'
import type { ModelProviderInstance } from '@shared/modelProvider'
import { LUX3D_DEFAULT_BASE_URL } from '@shared/modelProvider'
import { LONG_GENERATE_TIMEOUT_MS, readHttpError, trimBaseUrl } from '../http'

/**
 * AHOLO 网关标准响应信封：成功时 c === '0'、m 为空字符串，业务数据在 d。
 */
export type Lux3dEnvelope<T = unknown> = {
  /** 失败信息；成功时为 null */
  f?: unknown
  /** 状态码；成功时为 "0" */
  c?: string | null
  /** 提示信息；成功时为空字符串 "" */
  m?: string | null
  /** 业务数据 */
  d?: T | null
}

/**
 * Lux3D HTTP 客户端。
 * AHOLO 网关鉴权为裸 Key（`Authorization: <apiKey>`，无 Bearer 前缀），
 * 与共享 authHeaders 的 Bearer 方案不同，故单独建客户端。
 */
export function createLux3dHttpClient(
  provider: ModelProviderInstance,
  timeoutMs = 120_000
): AxiosInstance {
  const key = provider.apiKey.trim()
  return axios.create({
    baseURL: trimBaseUrl(provider.baseUrl || LUX3D_DEFAULT_BASE_URL),
    timeout: timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: key } : {})
    }
  })
}

export function createLux3dLongClient(provider: ModelProviderInstance): AxiosInstance {
  return createLux3dHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
}

/** cn 区域路径前缀 /lux3d/v1；com（全球）区域为 /global/lux3d/v1 */
export function lux3dPathPrefix(provider: ModelProviderInstance): string {
  return /aholo3d\.com/i.test(provider.baseUrl || '') ? '/global/lux3d/v1' : '/lux3d/v1'
}

/** 提取错误详情：网关错误体优先取信封 m（如 "参数错误"），否则回退通用解析 */
export async function readLux3dHttpError(err: unknown): Promise<string> {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as Lux3dEnvelope | undefined
    const message = typeof data?.m === 'string' ? data.m.trim() : ''
    if (message) return message
  }
  return readHttpError(err)
}
