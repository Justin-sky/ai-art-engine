import axios, { type AxiosInstance } from 'axios'
import type { ModelProviderInstance } from '@shared/modelProvider'
import { OPENROUTER_DEFAULT_BASE_URL } from '@shared/modelProvider'
import { resolveAppErrorLocale } from '@shared/errors/appError'

export function trimBaseUrl(url: string): string {
  return (url || OPENROUTER_DEFAULT_BASE_URL).replace(/\/$/, '')
}

export function authHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/Justin-sky/ai-art-engine',
    'X-Title': 'AIArtEngine',
    'X-OpenRouter-Title': 'AIArtEngine'
  }
  // 本地 OpenAI 兼容服务（vLLM / Ollama / LM Studio）无需 API Key
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

/** 文本 / 图片生成等长耗时请求统一超时（120 分钟） */
export const LONG_GENERATE_TIMEOUT_MS = 7_200_000

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

  const isEn = resolveAppErrorLocale() === 'en-US'
  const isOpenRouterHost = /openrouter\.ai/i.test(provider.baseUrl || '')
  const key = provider.apiKey.trim()
  if (isOpenRouterHost && key && !key.startsWith('sk-or-')) {
    return isEn
      ? `${message} (This key does not look like an OpenRouter key: copy one starting with sk-or-v1- from openrouter.ai/keys and make sure settings are saved)`
      : `${message}（当前 Key 不像 OpenRouter 密钥：请到 openrouter.ai/keys 复制以 sk-or-v1- 开头的密钥，并确认已保存设置）`
  }
  return isEn
    ? `${message} (Check that the API Key in settings is correct and saved, and the provider Base URL matches)`
    : `${message}（请检查设置中的 API Key 是否正确、已保存，且提供商 Base URL 匹配）`
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
      { error?: { message?: string } | string; message?: string } | undefined
    if (typeof data?.error === 'string') return data.error
    if (data?.error && typeof data.error === 'object' && data.error.message)
      return data.error.message
    if (data?.message) return data.message
    // 网络层错（DNS / TCP / TLS 握手前 socket 被断 / 超时）：err.response 缺失，
    // 只能靠 err.message + err.code + err.cause 给出可定位的诊断串。
    return annotateAxiosNetworkError(err)
  }
  return err instanceof Error ? err.message : String(err)
}

/**
 * 把 axios 网络错的关键诊断信息拼成单行：
 *   `code=<err.code> | <err.message> | cause.code=<cause.code> | cause=<cause.message>`
 * - `err.code`：Node/undici 给的稳定标签（`ECONNRESET` / `ENOTFOUND` / `EAI_AGAIN` / `UND_ERR_SOCKET` / `ERR_TLS_HANDSHAKE` / `ETIMEDOUT`...），便于用户一眼看出是防火墙断握手、DNS 失败还是连接被拒。
 * - `err.cause`：undici 在 TLS 握手前断开时常挂在 cause 上（与顶层 message 重复时不重复打印）。
 * - `err.message`：原生的可读描述，保留便于沟通。
 *
 * 对有 response 的"上游业务错"路径不生效——那条路径上游通常自带 message，不带冗余诊断反而更干净。
 */
export function annotateAxiosNetworkError(err: import('axios').AxiosError): string {
  const parts: string[] = []
  if (err.code) parts.push(`code=${err.code}`)
  if (err.message) parts.push(err.message)
  const cause = err.cause as { code?: string; message?: string } | undefined
  if (cause) {
    if (cause.code && cause.code !== err.code) parts.push(`cause.code=${cause.code}`)
    if (cause.message && cause.message !== err.message) parts.push(`cause=${cause.message}`)
  }
  return parts.filter(Boolean).join(' | ')
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
