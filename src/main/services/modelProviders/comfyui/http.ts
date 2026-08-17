import axios, { type AxiosInstance } from 'axios'
import { COMFYUI_DEFAULT_BASE_URL, type ModelProviderInstance } from '@shared/modelProvider'
import { LONG_GENERATE_TIMEOUT_MS, readHttpError, trimBaseUrl } from '../http'

export function comfyUiBaseUrl(provider: ModelProviderInstance): string {
  return trimBaseUrl(provider.baseUrl || COMFYUI_DEFAULT_BASE_URL)
}

export function createComfyUiHttpClient(
  provider: ModelProviderInstance,
  timeoutMs = 60_000
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
    baseURL: comfyUiBaseUrl(provider),
    timeout: timeoutMs,
    headers
  })
}

export function createComfyUiLongClient(provider: ModelProviderInstance): AxiosInstance {
  return createComfyUiHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
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
