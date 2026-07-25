import axios, { type AxiosInstance } from 'axios'
import type { ModelProviderInstance } from '@shared/openrouter'
import { MINIMAX_DEFAULT_BASE_URL } from '@shared/openrouter'
import { trimBaseUrl } from '../http'

export type MiniMaxBaseResp = {
  status_code?: number
  status_msg?: string
}

export function assertMiniMaxCredentials(provider: ModelProviderInstance): void {
  if (!provider.apiKey.trim()) {
    throw new Error('请先填写 API Key')
  }
}

export function createMiniMaxHttpClient(
  provider: ModelProviderInstance,
  timeoutMs = 120_000
): AxiosInstance {
  assertMiniMaxCredentials(provider)
  const baseURL = trimBaseUrl(provider.baseUrl || MINIMAX_DEFAULT_BASE_URL)
  return axios.create({
    baseURL,
    timeout: timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey.trim()}`
    }
  })
}

export function formatMiniMaxError(message: string): string {
  return `${message}（请检查 API Key 与 Base URL 是否正确）`
}

export async function readMiniMaxHttpError(err: unknown): Promise<string> {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { base_resp?: MiniMaxBaseResp; message?: string; error?: { message?: string } }
      | undefined
    const base = data?.base_resp
    if (base && typeof base.status_code === 'number' && base.status_code !== 0) {
      return base.status_msg || `MiniMax 错误 code=${base.status_code}`
    }
    if (data?.message) return data.message
    if (data?.error?.message) return data.error.message
    return err.message
  }
  return err instanceof Error ? err.message : String(err)
}

/** base_resp.status_code !== 0 时抛错 */
export function assertMiniMaxBaseResp(base: MiniMaxBaseResp | undefined, action: string): void {
  if (!base) return
  if (typeof base.status_code === 'number' && base.status_code !== 0) {
    throw new Error(
      formatMiniMaxError(`${action}失败：${base.status_msg || `code=${base.status_code}`}`)
    )
  }
}
