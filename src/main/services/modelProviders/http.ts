import axios, { type AxiosInstance } from 'axios'
import type { ModelProviderInstance } from '@shared/modelProvider'
import { OPENROUTER_DEFAULT_BASE_URL } from '@shared/modelProvider'
import { resolveAppErrorLocale } from '@shared/errors/appError'
import { withGenericUpstreamFailureHint } from '@shared/modelProviders/providerFailureDiagnostics'

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
    // 网络层错（DNS / TCP / TLS 握手前 socket 被断 / 超时）：err.response 缺失，
    // 只能靠 err.message + err.code + err.cause 给出可定位的诊断串。
    if (!err.response) return annotateAxiosNetworkError(err)
    // 上游业务错：归一化出原因，统一在出口补一次可操作提示
    return withGenericUpstreamFailureHint(
      normalizeUpstreamErrorBody(err.response.data, err.response.status)
    )
  }
  return withGenericUpstreamFailureHint(err instanceof Error ? err.message : String(err))
}

/**
 * 从上游错误体里取最可操作的原文。
 *
 * 兼容三种形状：已解析对象、JSON 文本、纯文本（网关直出）。
 * `responseType: 'arraybuffer'` 的请求（语音合成、音频 / 图片下载）拿到的是二进制体，
 * 经 decodeErrorPayload 解回来 —— 否则上游原因会被整段丢掉。
 */
function normalizeUpstreamErrorBody(raw: unknown, status?: number): string {
  const data = decodeErrorPayload(raw)
  if (typeof data?.error === 'string') return data.error
  if (data?.error && typeof data.error === 'object' && data.error.message) {
    return data.error.message
  }
  if (data?.message) return data.message
  // 部分网关把原因放在 detail / msg 上
  if (typeof data?.detail === 'string' && data.detail.trim()) return data.detail
  if (data?.msg) return data.msg
  // 体里确实没有原因：至少把状态码留下。不要把 axios 的
  // `code=ERR_BAD_REQUEST | Request failed with status code 400` 原样带出：
  // 那串既没信息量，又会被 isAuthFailure 之类的关键字判断误伤。
  return status
    ? `upstream returned HTTP ${status} without an error message`
    : 'upstream returned an error without a message'
}

/**
 * 归一化上游错误体。
 *
 * 关键场景：请求带 `responseType: 'arraybuffer'` 时（语音合成、音频/图片下载），
 * axios 把**错误响应体也**按二进制交付，于是 `err.response.data` 是 ArrayBuffer，
 * 原来按对象读 `.error.message` 直接落空 —— 上游明明回了具体原因
 * （「voice 不支持 / model 不存在 / 参数非法」），用户却只看到
 * `Request failed with status code 400`，完全没法定位。
 * 这里把二进制体按 UTF-8 解回文本再试一次 JSON。
 */
function decodeErrorPayload(raw: unknown): ErrorPayload | null {
  if (!raw) return null
  if (typeof raw === 'string') return parseErrorText(raw)
  if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
    const view =
      raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
    return parseErrorText(new TextDecoder('utf-8', { fatal: false }).decode(view))
  }
  if (typeof raw === 'object') return raw as ErrorPayload
  return null
}

/** 文本错误体：可能是 JSON（多数聚合器），也可能是纯文本（nginx/网关） */
function parseErrorText(text: string): ErrorPayload | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed && typeof parsed === 'object') return parsed as ErrorPayload
    } catch {
      /* 不是合法 JSON：退回纯文本 */
    }
  }
  return { message: trimmed }
}

interface ErrorPayload {
  error?: { message?: string } | string
  message?: string
  /** 部分网关用 detail / msg 承载原因 */
  detail?: string
  msg?: string
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
