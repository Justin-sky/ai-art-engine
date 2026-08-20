import axios, { type AxiosInstance } from 'axios'
import type { ModelProviderInstance } from '@shared/modelProvider'
import { MAGICROUTER_DEFAULT_BASE_URL } from '@shared/modelProvider'
import { trimBaseUrl } from '../http'

export function assertMagicRouterCredentials(provider: ModelProviderInstance): void {
  if (!provider.apiKey.trim()) {
    throw new Error('请先填写 MagicRouter API Key（mr- 开头）')
  }
}

export function createMagicRouterHttpClient(
  provider: ModelProviderInstance,
  timeoutMs = 120_000
): AxiosInstance {
  assertMagicRouterCredentials(provider)
  const baseURL = trimBaseUrl(provider.baseUrl || MAGICROUTER_DEFAULT_BASE_URL)
  return axios.create({
    baseURL,
    timeout: timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey.trim()}`
    }
  })
}

/** OpenAI 兼容错误：{ error: { message } } / { message } / 纯文本 */
export async function readMagicRouterHttpError(err: unknown): Promise<string> {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: { message?: string; code?: string } | string; message?: string; detail?: string }
      | undefined
    if (typeof data?.error === 'string') return data.error
    if (data?.error && typeof data.error === 'object') {
      const code = data.error.code ? `[${data.error.code}] ` : ''
      if (data.error.message) return `${code}${data.error.message}`
    }
    if (data?.message) return data.message
    if (data?.detail) return data.detail
    const status = err.response?.status
    if (status === 401 || status === 403) {
      return `${err.message}（请检查 MagicRouter API Key 是否正确、已保存）`
    }
    return err.message
  }
  return err instanceof Error ? err.message : String(err)
}
