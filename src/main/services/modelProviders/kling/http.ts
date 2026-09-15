import axios, { type AxiosInstance } from 'axios'
import type { ModelProviderInstance } from '@shared/modelProvider'
import { KLING_DEFAULT_BASE_URL } from '@shared/modelProvider'
import { resolveAppErrorLocale, fail, defErr } from '@shared/errors/appError'
import { PROVIDER_ERRORS } from '../catalog'
import { LONG_GENERATE_TIMEOUT_MS, trimBaseUrl } from '../http'

export type KlingApiEnvelope<T = unknown> = {
  code?: number
  message?: string
  request_id?: string
  data?: T
}

export function assertKlingCredentials(provider: ModelProviderInstance): void {
  if (!provider.apiKey.trim()) {
    throw fail(PROVIDER_ERRORS.missingApiKey)
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

const KLING_HINT_ZH = '请检查 API Key 与 Base URL 是否正确'
const KLING_HINT_EN = 'Check the API Key and Base URL'

function isEn(): boolean {
  return resolveAppErrorLocale() === 'en-US'
}

export function formatKlingError(message: string): string {
  if (isEn()) return `${message} (${KLING_HINT_EN})`
  return `${message}（${KLING_HINT_ZH}）`
}

export async function readKlingHttpError(err: unknown): Promise<string> {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as KlingApiEnvelope | undefined
    if (data?.message) return data.message
    if (typeof data?.code === 'number' && data.code !== 0) {
      return isEn() ? `Kling error code=${data.code}` : `可灵错误 code=${data.code}`
    }
    // 网络层错（DNS / TCP / TLS 握手等）：err.response 缺失，只能靠 err.message + err.code 诊断
    return annotateNetworkError(err)
  }
  return err instanceof Error ? err.message : String(err)
}

/**
 * 给 axios 网络错补一个稳定诊断尾巴：code（如 `ECONNRESET` / `ENOTFOUND` / `UND_ERR_SOCKET`）
 * + cause 的 code/message（undici 在 TLS 握手前断开时常挂在 cause 上）。
 * 避免用户只看到一行"Client network socket disconnected..."无法定位是防火墙断握手、DNS 失败还是连接被拒。
 */
function annotateNetworkError(err: import('axios').AxiosError): string {
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

/** unwrapKlingData 的动作标签：中文文案保持与旧版逐字一致，另附英文映射 */
export type KlingActionLabel = { zh: string; en: string }

export const KLING_ACTIONS = {
  pollImage: { zh: '轮询图片任务', en: 'Polling image task' },
  submitImage: { zh: '提交图片生成', en: 'Submitting image generation' },
  submitVideo: { zh: '提交视频生成', en: 'Submitting video generation' },
  pollVideo: { zh: '轮询视频任务', en: 'Polling video task' }
} satisfies Record<string, KlingActionLabel>

/** 空响应：`轮询图片任务：空响应` */
const E_KLING_UNWRAP_EMPTY = defErr<{ label: KlingActionLabel }>(
  'provider.kling.emptyResponse',
  ({ label }) => `${label.zh}：空响应`,
  ({ label }) => `${label.en}: empty response`
)
/** 未返回 data：`提交视频生成：未返回 data` */
const E_KLING_UNWRAP_NO_DATA = defErr<{ label: KlingActionLabel }>(
  'provider.kling.noDataInResponse',
  ({ label }) => `${label.zh}：未返回 data`,
  ({ label }) => `${label.en}: response contained no data`
)
/** code!==0：`提交图片生成失败：<上游 message>（请检查 API Key 与 Base URL 是否正确）` */
const E_KLING_UNWRAP_FAILED = defErr<{ label: KlingActionLabel; detail: string }>(
  'provider.kling.actionFailed',
  ({ label, detail }) => `${label.zh}失败：${detail}（${KLING_HINT_ZH}）`,
  ({ label, detail }) => `${label.en} failed: ${detail} (${KLING_HINT_EN})`
)

/** 解析可灵标准响应；code !== 0 抛错 */
export function unwrapKlingData<T>(
  envelope: KlingApiEnvelope<T> | undefined,
  action: KlingActionLabel
): T {
  if (!envelope) throw fail(E_KLING_UNWRAP_EMPTY, { label: action })
  if (typeof envelope.code === 'number' && envelope.code !== 0) {
    throw fail(E_KLING_UNWRAP_FAILED, {
      label: action,
      detail: envelope.message || `code=${envelope.code}`
    })
  }
  if (envelope.data === undefined || envelope.data === null) {
    throw fail(E_KLING_UNWRAP_NO_DATA, { label: action })
  }
  return envelope.data
}

export { LONG_GENERATE_TIMEOUT_MS }
