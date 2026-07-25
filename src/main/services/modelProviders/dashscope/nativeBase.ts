import { DASHSCOPE_DEFAULT_BASE_URL } from '@shared/modelProvider'
import { trimBaseUrl } from '../http'

/**
 * 从 OpenAI 兼容 Base URL 推导 DashScope 原生 `/api/v1` 根。
 * 例：…/compatible-mode/v1 → …/api/v1
 */
export function dashscopeNativeApiBase(compatBaseUrl: string | undefined): string {
  const base = trimBaseUrl(compatBaseUrl || DASHSCOPE_DEFAULT_BASE_URL)
  if (/\/compatible-mode\/v\d+$/i.test(base)) {
    return base.replace(/\/compatible-mode\/v\d+$/i, '/api/v1')
  }
  if (/\/api\/v\d+$/i.test(base)) return base
  return `${base.replace(/\/$/, '')}/api/v1`
}
