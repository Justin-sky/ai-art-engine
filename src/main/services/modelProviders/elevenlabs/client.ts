import axios, { type AxiosInstance } from 'axios'
import type { ModelProviderInstance } from '@shared/modelProvider'
import { ELEVENLABS_DEFAULT_BASE_URL } from '@shared/modelProvider'
import { LONG_GENERATE_TIMEOUT_MS, readHttpError } from '../http'

/**
 * ElevenLabs 直连 HTTP 客户端（不用官方 SDK）。
 *
 * 鉴权头是 `xi-api-key`（不是 Bearer）。生成类接口按次计费，
 * axios 默认不重试，这里也不加任何重试中间件。
 */
export function trimElevenBaseUrl(url: string): string {
  return (url || ELEVENLABS_DEFAULT_BASE_URL).replace(/\/+$/, '')
}

export function createElevenHttp(
  provider: ModelProviderInstance,
  timeoutMs = LONG_GENERATE_TIMEOUT_MS
): AxiosInstance {
  const key = provider.apiKey.trim()
  return axios.create({
    baseURL: trimElevenBaseUrl(provider.baseUrl || ELEVENLABS_DEFAULT_BASE_URL),
    timeout: timeoutMs,
    headers: {
      ...(key ? { 'xi-api-key': key } : {}),
      Accept: 'application/json'
    },
    transitional: { clarifyTimeoutError: true }
  })
}

/**
 * 上游错误原文。
 *
 * ElevenLabs 常用 `{ detail: { message } }` / `{ detail: "..." }`；
 * 通用 HTTP 解码只认字符串 detail，这里先抽一层再回退。
 * 音频端点失败时 responseType=arraybuffer，错误体也是二进制 —— 先解回文本。
 */
export async function readElevenErrorDetail(err: unknown): Promise<string> {
  if (axios.isAxiosError(err) && err.response?.data != null) {
    const fromDetail = extractElevenDetail(err.response.data)
    if (fromDetail) return fromDetail
  }
  return readHttpError(err)
}

function extractElevenDetail(raw: unknown): string {
  let data: unknown = raw
  if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
    const view =
      raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
    const text = new TextDecoder('utf-8', { fatal: false }).decode(view).trim()
    if (!text) return ''
    try {
      data = JSON.parse(text)
    } catch {
      return text
    }
  }
  if (!data || typeof data !== 'object') return ''
  const detail = (data as { detail?: unknown }).detail
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  if (detail && typeof detail === 'object') {
    const message = (detail as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return ''
}

/** GET JSON（目录 / 音色 / 鉴权探测） */
export async function elevenGetJson<T>(
  provider: ModelProviderInstance,
  path: string,
  timeoutMs = 30_000
): Promise<T> {
  const http = createElevenHttp(provider, timeoutMs)
  const { data } = await http.get<T>(path)
  return data
}

/**
 * POST JSON，响应为音频字节（TTS / 对话 / 音乐 / 音效）。
 *
 * `output_format` 走 query（官方规范），body 只放业务字段。
 */
export async function elevenPostAudio(
  provider: ModelProviderInstance,
  path: string,
  body: Record<string, unknown>,
  query?: { output_format?: string }
): Promise<Buffer> {
  const http = createElevenHttp(provider, LONG_GENERATE_TIMEOUT_MS)
  const { data } = await http.post(path, body, {
    params: query?.output_format ? { output_format: query.output_format } : undefined,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg, application/octet-stream, */*'
    },
    responseType: 'arraybuffer'
  })
  return Buffer.from(data as ArrayBuffer)
}

/** POST multipart（语音转写），响应 JSON */
export async function elevenPostFormJson<T>(
  provider: ModelProviderInstance,
  path: string,
  form: FormData,
  timeoutMs = LONG_GENERATE_TIMEOUT_MS
): Promise<T> {
  const http = createElevenHttp(provider, timeoutMs)
  const { data } = await http.post<T>(path, form, {
    // 不手写 Content-Type：让运行时带 multipart boundary
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  })
  return data
}
