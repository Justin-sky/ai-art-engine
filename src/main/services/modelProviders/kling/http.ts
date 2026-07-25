import axios, { type AxiosInstance } from 'axios'
import type { ModelProviderInstance } from '@shared/openrouter'
import { KLING_DEFAULT_BASE_URL } from '@shared/openrouter'
import { LONG_GENERATE_TIMEOUT_MS, trimBaseUrl } from '../http'

export type KlingApiEnvelope<T = unknown> = {
  code?: number
  message?: string
  request_id?: string
  data?: T
}

export function assertKlingCredentials(provider: ModelProviderInstance): void {
  if (!provider.apiKey.trim()) {
    throw new Error('请先填写 API Key')
  }
}

export function createKlingHttpClient(
  provider: ModelProviderInstance,
  timeoutMs = 120_000
): AxiosInstance {
  assertKlingCredentials(provider)
  const baseURL = trimBaseUrl(provider.baseUrl || KLING_DEFAULT_BASE_URL)
  return axios.create({
    baseURL,
    timeout: timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey.trim()}`
    }
  })
}

export function createKlingLongClient(provider: ModelProviderInstance): AxiosInstance {
  return createKlingHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
}

export function formatKlingError(message: string): string {
  return `${message}（请检查 API Key 与 Base URL 是否正确）`
}

export async function readKlingHttpError(err: unknown): Promise<string> {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as KlingApiEnvelope | undefined
    if (data?.message) return data.message
    if (typeof data?.code === 'number' && data.code !== 0) {
      return `可灵错误 code=${data.code}`
    }
    return err.message
  }
  return err instanceof Error ? err.message : String(err)
}

/** 解析可灵标准响应；code !== 0 抛错 */
export function unwrapKlingData<T>(envelope: KlingApiEnvelope<T> | undefined, action: string): T {
  if (!envelope) throw new Error(`${action}：空响应`)
  if (typeof envelope.code === 'number' && envelope.code !== 0) {
    throw new Error(
      formatKlingError(`${action}失败：${envelope.message || `code=${envelope.code}`}`)
    )
  }
  if (envelope.data === undefined || envelope.data === null) {
    throw new Error(`${action}：未返回 data`)
  }
  return envelope.data
}

export { LONG_GENERATE_TIMEOUT_MS }
