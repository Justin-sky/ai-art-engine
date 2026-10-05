import axios, { type AxiosInstance } from 'axios'
import type { ModelProviderInstance } from '@shared/modelProvider'
import { WORLDLABS_DEFAULT_BASE_URL } from '@shared/modelProvider'
import { readHttpError } from '../http'

/**
 * World Labs Marble HTTP 客户端。
 * 鉴权为自定义头 `WLT-Api-Key`（非 Bearer），与共享 authHeaders 方案不同，故单独建客户端。
 */
export function createWorldlabsHttpClient(
  provider: ModelProviderInstance,
  timeoutMs = 120_000
): AxiosInstance {
  const key = provider.apiKey.trim()
  return axios.create({
    baseURL: trimWorldlabsBaseUrl(provider.baseUrl || WORLDLABS_DEFAULT_BASE_URL),
    timeout: timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'WLT-Api-Key': key } : {})
    }
  })
}

export function trimWorldlabsBaseUrl(url: string): string {
  return (url || WORLDLABS_DEFAULT_BASE_URL).replace(/\/+$/, '')
}

/**
 * 提取错误详情。World Labs 的错误体有三种形态：
 *   - `{ detail: "..." }`（400 / 402 等业务错误，最常见）
 *   - `{ detail: [{ loc, msg, type }] }`（422 校验错误，逐字段）
 *   - `{ error: { message } }` / `{ message }`
 * 另外响应常带 `request_id`（World Labs 支持排查用），有就一并附上——用户报障时这串是关键线索。
 */
export async function readWorldlabsHttpError(err: unknown): Promise<string> {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | {
          error?: { message?: string } | string
          message?: string
          detail?: string | Array<{ loc?: unknown[]; msg?: string }>
          request_id?: string
        }
      | undefined
    const parts: string[] = []
    if (typeof data?.error === 'string' && data.error.trim()) parts.push(data.error.trim())
    else if (data?.error && typeof data.error === 'object' && data.error.message) {
      parts.push(String(data.error.message))
    }
    if (typeof data?.detail === 'string' && data.detail.trim()) {
      parts.push(data.detail.trim())
    } else if (Array.isArray(data?.detail)) {
      const fields = data.detail
        .map((item) => {
          const path = (item?.loc ?? []).filter((seg) => seg !== 'body').join('.')
          const msg = item?.msg?.trim() ?? ''
          if (!msg) return ''
          return path ? `${path}: ${msg}` : msg
        })
        .filter(Boolean)
      if (fields.length) parts.push(fields.join('; '))
    }
    if (!parts.length && typeof data?.message === 'string' && data.message.trim()) {
      parts.push(data.message.trim())
    }
    const requestId =
      (typeof data?.request_id === 'string' ? data.request_id.trim() : '') ||
      String(err.response?.headers?.['x-request-id'] ?? '').trim()
    if (requestId) parts.push(`request_id=${requestId}`)
    if (parts.length) return parts.join(' · ')
  }
  return readHttpError(err)
}
