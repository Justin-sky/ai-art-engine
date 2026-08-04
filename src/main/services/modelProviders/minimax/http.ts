import axios, { type AxiosInstance } from 'axios'
import type { ModelProviderInstance } from '@shared/modelProvider'
import { MINIMAX_DEFAULT_BASE_URL } from '@shared/modelProvider'
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

/** 按 MiniMax status_code / 文案给出可操作提示（避免余额不足时误导去改 Key） */
export function formatMiniMaxError(message: string, statusCode?: number): string {
  const text = message.trim()
  if (/账户余额不足，请前往 MiniMax|请检查 API Key 与 Base URL 是否正确/.test(text)) {
    return text
  }
  const code =
    typeof statusCode === 'number' && Number.isFinite(statusCode)
      ? statusCode
      : (() => {
          const m = /\((\d{3,5})\)/.exec(text) || /\bcode[=:\s]*(\d{3,5})\b/i.exec(text)
          return m ? Number(m[1]) : undefined
        })()
  const lower = text.toLowerCase()
  if (
    code === 1008 ||
    /insufficient\s*balance|余额不足|账户余额|balance\s*not\s*enough/i.test(lower)
  ) {
    const withCode = /\(1008\)|\b1008\b/.test(text) ? text : `${text} (1008)`
    return `${withCode}（账户余额不足，请前往 MiniMax 控制台充值后再试）`
  }
  if (
    code === 1004 ||
    /invalid\s*api\s*key|unauthorized|authentication|鉴权失败|密钥无效/i.test(lower)
  ) {
    return `${text}（请检查 API Key 与 Base URL 是否正确）`
  }
  if (code != null && !/\(\d{3,5}\)/.test(text) && !/\bcode[=:\s]*\d{3,5}\b/i.test(text)) {
    return `${text} (${code})`
  }
  return text
}

export async function readMiniMaxHttpError(err: unknown): Promise<string> {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { base_resp?: MiniMaxBaseResp; message?: string; error?: { message?: string } }
      | undefined
    const base = data?.base_resp
    if (base && typeof base.status_code === 'number' && base.status_code !== 0) {
      const raw = base.status_msg || `MiniMax 错误 code=${base.status_code}`
      return formatMiniMaxError(raw, base.status_code)
    }
    if (data?.message) return formatMiniMaxError(data.message)
    if (data?.error?.message) return formatMiniMaxError(data.error.message)
    return err.message
  }
  return err instanceof Error ? err.message : String(err)
}

/** base_resp.status_code !== 0 时抛错 */
export function assertMiniMaxBaseResp(base: MiniMaxBaseResp | undefined, action: string): void {
  if (!base) return
  if (typeof base.status_code === 'number' && base.status_code !== 0) {
    throw new Error(
      formatMiniMaxError(
        `${action}失败：${base.status_msg || `code=${base.status_code}`}`,
        base.status_code
      )
    )
  }
}
