import axios, { type AxiosInstance } from 'axios'
import type { ModelProviderInstance } from '@shared/modelProvider'
import { MINIMAX_DEFAULT_BASE_URL } from '@shared/modelProvider'
import { resolveAppErrorLocale, fail } from '@shared/errors/appError'
import { PROVIDER_ERRORS } from '../catalog'
import { trimBaseUrl } from '../http'

export type MiniMaxBaseResp = {
  status_code?: number
  status_msg?: string
}

/** 当前是否英文环境（上游文案检测保持原样，仅本地生成的句子分支双语言） */
function isEn(): boolean {
  return resolveAppErrorLocale() === 'en-US'
}

export function assertMiniMaxCredentials(provider: ModelProviderInstance): void {
  if (!provider.apiKey.trim()) {
    throw fail(PROVIDER_ERRORS.missingApiKey)
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

const MM_AUTH_HINT_ZH = '请检查 API Key 与 Base URL 是否正确'
const MM_AUTH_HINT_EN = 'Check the API Key and Base URL'

/** 按 MiniMax status_code / 文案给出可操作提示（避免余额不足时误导去改 Key） */
export function formatMiniMaxError(message: string, statusCode?: number): string {
  const text = message.trim()
  // 已带提示的文案原样放行（幂等保护；中英两套提示均识别）
  if (
    new RegExp(
      `账户余额不足，请前往 MiniMax|${MM_AUTH_HINT_ZH}|insufficient minimax balance|${MM_AUTH_HINT_EN}`,
      'i'
    ).test(text)
  ) {
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
    return isEn()
      ? `${withCode} (Insufficient MiniMax balance — top up in the MiniMax console before retrying)`
      : `${withCode}（账户余额不足，请前往 MiniMax 控制台充值后再试）`
  }
  if (
    code === 1004 ||
    /invalid\s*api\s*key|unauthorized|authentication|鉴权失败|密钥无效/i.test(lower)
  ) {
    return isEn() ? `${text} (${MM_AUTH_HINT_EN})` : `${text}（${MM_AUTH_HINT_ZH}）`
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
      const raw =
        base.status_msg ||
        (isEn() ? `MiniMax error code=${base.status_code}` : `MiniMax 错误 code=${base.status_code}`)
      return formatMiniMaxError(raw, base.status_code)
    }
    if (data?.message) return formatMiniMaxError(data.message)
    if (data?.error?.message) return formatMiniMaxError(data.error.message)
    return err.message
  }
  return err instanceof Error ? err.message : String(err)
}

/** assertMiniMaxBaseResp 动作标签：调用方沿用中文动作 key，英文经此映射 */
const MM_ACTION_LABELS: Record<string, string> = {
  连接测试: 'Connection test',
  拉取模型: 'Fetching models',
  图片生成: 'Image generation',
  提交视频生成: 'Submitting video generation',
  轮询视频任务: 'Polling video task',
  获取视频文件: 'Retrieving video file',
  音色设计: 'Voice design'
}

/** base_resp.status_code !== 0 时抛错（中文措辞保持与旧版逐字一致） */
export function assertMiniMaxBaseResp(base: MiniMaxBaseResp | undefined, action: string): void {
  if (!base) return
  if (typeof base.status_code === 'number' && base.status_code !== 0) {
    const detail = base.status_msg || `code=${base.status_code}`
    const composed = isEn()
      ? `${MM_ACTION_LABELS[action] ?? action} failed: ${detail}`
      : `${action}失败：${detail}`
    throw new Error(formatMiniMaxError(composed, base.status_code))
  }
}
