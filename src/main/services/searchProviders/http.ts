/**
 * searchProviders 各 adapter 共用的 HTTP helper。
 *
 * 抽出来的动机：3 个真搜索 adapter（Tavily / Brave / SerpAPI）都要做同样的事：
 *   - 把 axios 错误统一成可嵌入 detail 的字符串（保留 HTTP status + body）
 *   - 把 baseUrl 末尾的 / 抹掉，避免拼出 //search
 * deepseekSearch 同样需要，迁过来一并共用。
 */
import axios from 'axios'

export async function readHttpError(err: unknown): Promise<string> {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status
    const data = err.response?.data
    let body = ''
    if (typeof data === 'string') {
      body = data
    } else if (data) {
      try {
        body = JSON.stringify(data)
      } catch {
        body = '[unstringifiable body]'
      }
    }
    const detail = body || err.message || '(empty body)'
    return status ? `HTTP ${status}: ${detail}` : detail
  }
  return err instanceof Error ? err.message : String(err)
}

/** 抹掉 baseUrl 末尾连续的 /；不动路径中的 /v1 */
export function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

/** HTTP status → 是否视为鉴权失败 */
export function isAuthStatus(status: number | undefined): boolean {
  return status === 401 || status === 403
}
