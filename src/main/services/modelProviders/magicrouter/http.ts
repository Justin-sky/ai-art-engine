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

/** 从响应体抽取可读错误信息；对象/数组用 JSON 兜底，避免 [object Object] */
function magicRouterErrorMessage(data: unknown): string | null {
  if (data == null) return null
  if (typeof data === 'string') return data.trim() || null
  if (typeof data !== 'object') return String(data)

  const rec = data as Record<string, unknown>
  const error = rec.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>
    const code = e.code != null ? `[${String(e.code)}] ` : ''
    const message =
      typeof e.message === 'string' && e.message.trim() ? e.message : JSON.stringify(e)
    return `${code}${message}`
  }
  if (typeof rec.message === 'string' && rec.message.trim()) return rec.message
  // FastAPI 校验错误常用 detail: [{ msg, loc, ... }]
  if (rec.detail != null) return JSON.stringify(rec.detail)
  return JSON.stringify(rec)
}

/** OpenAI 兼容错误：{ error: { message } } / { message } / { detail } / 纯文本 */
export async function readMagicRouterHttpError(err: unknown): Promise<string> {
  if (axios.isAxiosError(err)) {
    const parsed = magicRouterErrorMessage(err.response?.data)
    if (parsed) return parsed
    const status = err.response?.status
    if (status === 401 || status === 403) {
      return `${err.message}（请检查 MagicRouter API Key 是否正确、已保存）`
    }
    return err.message
  }
  return err instanceof Error ? err.message : String(err)
}
