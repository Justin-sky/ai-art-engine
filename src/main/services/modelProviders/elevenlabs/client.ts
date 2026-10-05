import { ElevenLabsClient, ElevenLabsError } from '@elevenlabs/elevenlabs-js'
import type { FetchFunction } from '@elevenlabs/elevenlabs-js/core'
import type { ModelProviderInstance } from '@shared/modelProvider'
import { ELEVENLABS_DEFAULT_BASE_URL } from '@shared/modelProvider'
import { LONG_GENERATE_TIMEOUT_MS } from '../http'

/**
 * ElevenLabs 官方 SDK 客户端（`@elevenlabs/elevenlabs-js`）。
 *
 * 为什么用 SDK 而不是手写 axios：它是官方生成器产物，路径 / 请求体字段名 / 查询参数
 * 都由规范同步生成，不必再手工核对（手写那版就漏过 duration 0.5–30、
 * prompt_influence 0–1、model_id 单值 enum 三个约束）。SDK 同样支持自定义 baseUrl
 * 与 xi-api-key，所以自建代理场景不受影响。
 *
 * **`maxRetries: 0` 是关键**：SDK 默认重试 2 次，而这里调用的全是**按次计费**的
 * 生成接口（TTS / 对话 / 音乐 / 音效）。一次超时后自动重试 = 重复扣费，
 * 所以两端都显式关掉（客户端默认 + 每次请求）。
 */
export function trimElevenBaseUrl(url: string): string {
  return (url || ELEVENLABS_DEFAULT_BASE_URL).replace(/\/+$/, '')
}

/** 每次请求都带上：关掉重试，避免生成接口被重复调用 */
export const ELEVEN_NO_RETRY = { maxRetries: 0 } as const

/**
 * 建 SDK 客户端。
 *
 * @param fetcher 仅测试注入用（换成一个记录器就能断言真实线格式）；
 *                生产环境不传，SDK 自己挑原生 fetch。
 */
export function createElevenClient(
  provider: ModelProviderInstance,
  timeoutMs = LONG_GENERATE_TIMEOUT_MS,
  fetcher?: FetchFunction
): ElevenLabsClient {
  return new ElevenLabsClient({
    apiKey: provider.apiKey.trim() || undefined,
    baseUrl: trimElevenBaseUrl(provider.baseUrl || ELEVENLABS_DEFAULT_BASE_URL),
    timeoutInSeconds: Math.round(timeoutMs / 1000),
    maxRetries: 0,
    ...(fetcher ? { fetcher } : {})
  })
}

/**
 * 把 SDK 的流式响应收成一个 Buffer。
 *
 * SDK 里所有返回音频的方法都是 `ReadableStream<Uint8Array>`，
 * 我们统一落盘成文件，所以这里一次收完（音频都不大，不必流式落盘）。
 */
export async function collectElevenAudio(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value?.length) chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
}

/**
 * 从 SDK 错误里取上游原文。
 *
 * SDK 会把错误体解析好放在 `ElevenLabsError.body`（就是 `{ detail: {...} }` 那个信封），
 * 所以这里比手写那版简单得多 —— 不必再猜 ArrayBuffer / 字符串 / 数组。
 * 取不到时退回 `message`，最后退回 statusCode，保证消息永不悬空。
 */
export function readElevenErrorDetail(err: unknown): string {
  if (err instanceof ElevenLabsError) {
    const body = err.body as unknown
    if (typeof body === 'string' && body.trim()) return body.trim()
    if (body && typeof body === 'object') {
      const detail = (body as { detail?: unknown }).detail
      if (typeof detail === 'string' && detail.trim()) return detail.trim()
      if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
        const message = (detail as { message?: unknown }).message
        if (typeof message === 'string' && message.trim()) return message.trim()
      }
      if (Array.isArray(detail)) {
        const parts = detail
          .map((item) => {
            if (typeof item === 'string') return item.trim()
            if (item && typeof item === 'object') {
              const row = item as { msg?: unknown; message?: unknown }
              const text = row.msg ?? row.message
              return typeof text === 'string' ? text.trim() : ''
            }
            return ''
          })
          .filter(Boolean)
        if (parts.length) return parts.join('; ')
      }
      const message = (body as { message?: unknown }).message
      if (typeof message === 'string' && message.trim()) return message.trim()
    }
    const own = err.message?.trim()
    if (own) return own
    if (err.statusCode != null) return `upstream returned HTTP ${err.statusCode}`
    return 'ElevenLabs request failed'
  }
  return err instanceof Error ? err.message : String(err)
}
