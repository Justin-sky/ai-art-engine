import axios, { type AxiosInstance } from 'axios'
import { COMFYUI_DEFAULT_BASE_URL, type ModelProviderInstance } from '@shared/modelProvider'
import { LONG_GENERATE_TIMEOUT_MS, readHttpError, trimBaseUrl } from '../http'

export function comfyUiBaseUrl(provider: ModelProviderInstance): string {
  return trimBaseUrl(provider.baseUrl || COMFYUI_DEFAULT_BASE_URL)
}

export function createComfyUiHttpClient(
  provider: ModelProviderInstance,
  timeoutMs = 60_000,
  baseURL = comfyUiBaseUrl(provider)
): AxiosInstance {
  const key = provider.apiKey.trim()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (key) {
    headers.Authorization = `Bearer ${key}`
    headers['X-API-Key'] = key
  }
  return axios.create({
    baseURL,
    timeout: timeoutMs,
    headers
  })
}

export function createComfyUiLongClient(provider: ModelProviderInstance): AxiosInstance {
  return createComfyUiHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
}

export function createComfyUiFormClient(
  provider: ModelProviderInstance,
  baseURL = comfyUiBaseUrl(provider)
): AxiosInstance {
  const key = provider.apiKey.trim()
  const headers: Record<string, string> = {}
  if (key) {
    headers.Authorization = `Bearer ${key}`
    headers['X-API-Key'] = key
  }
  return axios.create({
    baseURL,
    timeout: LONG_GENERATE_TIMEOUT_MS,
    headers
  })
}

/**
 * userdata / 画布 workflow 在 ComfyUI 本体，不在 comfy-api-proxy。
 * 填了「本体地址」就只连这一处，不再回落 8188。
 * 未填时：Base URL 若是默认代理 8189，才再试同机 8188。
 */
export function comfyUiUserdataOrigins(provider: ModelProviderInstance): string[] {
  const primary = comfyUiBaseUrl(provider)
  const native =
    typeof provider.nativeBaseUrl === 'string' ? trimBaseUrl(provider.nativeBaseUrl) : ''
  if (native) return [native]
  const out: string[] = [primary]
  try {
    const url = new URL(primary)
    if (url.port === '8189') {
      url.port = '8188'
      const guessed = trimBaseUrl(url.toString())
      if (!out.includes(guessed)) out.push(guessed)
    }
  } catch {
    /* ignore */
  }
  return out
}

export async function readComfyUiError(err: unknown): Promise<string> {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: { code?: string; message?: string } | string; message?: string }
      | undefined
    if (data?.error && typeof data.error === 'object') {
      const code = data.error.code ? `[${data.error.code}] ` : ''
      if (data.error.message) return `${code}${data.error.message}`
    }
    if (typeof data?.error === 'string') return data.error
    if (data?.message) return data.message
  }
  return readHttpError(err)
}
