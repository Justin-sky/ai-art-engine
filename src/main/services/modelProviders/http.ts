import axios, { type AxiosInstance } from 'axios'
import type { ModelProviderInstance } from '@shared/openrouter'
import { OPENROUTER_DEFAULT_BASE_URL } from '@shared/openrouter'

export function trimBaseUrl(url: string): string {
  return (url || OPENROUTER_DEFAULT_BASE_URL).replace(/\/$/, '')
}

export function authHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim()
  if (!key) {
    throw new Error('API Key 为空，请在设置中填写模型提供商的 API Key')
  }
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/Justin-sky/ai-art-engine',
    'X-Title': 'AIArtEngine',
    'X-OpenRouter-Title': 'AIArtEngine'
  }
}

/** 文本 / 图片生成等长耗时请求统一超时（30 分钟） */
export const LONG_GENERATE_TIMEOUT_MS = 1_800_000

export function createProviderHttpClient(
  provider: ModelProviderInstance,
  timeoutMs = 120_000
): AxiosInstance {
  return axios.create({
    baseURL: trimBaseUrl(provider.baseUrl),
    timeout: timeoutMs,
    headers: authHeaders(provider.apiKey)
  })
}

/** OpenRouter 对无效 Key 也会返回 "Missing Authentication header"，翻译成可操作提示 */
export function formatAuthError(message: string, provider: ModelProviderInstance): string {
  const lower = message.toLowerCase()
  const looksLikeMissingAuth =
    lower.includes('missing authentication') ||
    lower.includes('no cookie auth') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key') ||
    lower.includes('user not found')
  if (!looksLikeMissingAuth) return message

  const isOpenRouterHost = /openrouter\.ai/i.test(provider.baseUrl || '')
  const key = provider.apiKey.trim()
  if (isOpenRouterHost && key && !key.startsWith('sk-or-')) {
    return `${message}（当前 Key 不像 OpenRouter 密钥：请到 openrouter.ai/keys 复制以 sk-or-v1- 开头的密钥，并确认已保存设置）`
  }
  return `${message}（请检查设置中的 API Key 是否正确、已保存，且提供商 Base URL 匹配）`
}

export function isAuthFailure(status: number | undefined, message: string): boolean {
  if (status === 401 || status === 403) return true
  const lower = message.toLowerCase()
  return (
    lower.includes('unauthorized') ||
    lower.includes('invalid api key') ||
    lower.includes('missing authentication') ||
    lower.includes('no cookie auth') ||
    lower.includes('user not found') ||
    lower.includes('authentication required')
  )
}

export async function readHttpError(err: unknown): Promise<string> {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: { message?: string } | string; message?: string }
      | undefined
    if (typeof data?.error === 'string') return data.error
    if (data?.error && typeof data.error === 'object' && data.error.message) return data.error.message
    if (data?.message) return data.message
    return err.message
  }
  return err instanceof Error ? err.message : String(err)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
