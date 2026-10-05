import axios, { type AxiosInstance } from 'axios'
import type { ModelProviderInstance } from '@shared/modelProvider'
import { ELEVENLABS_DEFAULT_BASE_URL } from '@shared/modelProvider'

/**
 * ElevenLabs HTTP 客户端。
 *
 * 鉴权是 `xi-api-key` 请求头（非 Bearer），与共享 authHeaders 方案不同，故单独建客户端。
 * 事实来源：官方 openapi.json 里 `xi-api-key` 是 header 参数。
 */
export function createElevenLabsHttpClient(
  provider: ModelProviderInstance,
  timeoutMs = 120_000
): AxiosInstance {
  const key = provider.apiKey.trim()
  return axios.create({
    baseURL: trimElevenBaseUrl(provider.baseUrl || ELEVENLABS_DEFAULT_BASE_URL),
    timeout: timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'xi-api-key': key } : {})
    }
  })
}

export function trimElevenBaseUrl(url: string): string {
  return (url || ELEVENLABS_DEFAULT_BASE_URL).replace(/\/+$/, '')
}
