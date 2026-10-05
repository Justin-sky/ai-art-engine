import axios from 'axios'
import { readHttpError } from '../http'

/**
 * 提取 ElevenLabs 的错误详情。
 *
 * 上游错误体的实际形状（比通用 readHttpError 能处理的更嵌套）：
 *   - `{ detail: { message: "...", status: "..." } }`（最典型：鉴权失败 / 参数非法）
 *   - `{ detail: [{ msg, type, loc }] }`（字段级校验错误，FastAPI 风格）
 *   - `{ detail: "..." }` / `{ message }` / `{ error: { message } }`
 * 通用实现只认**字符串** detail，嵌套对象会被丢掉、退化成
 * `upstream returned HTTP 401 without an error message` —— 用户看不到真正原因。
 */
export async function readElevenLabsHttpError(err: unknown): Promise<string> {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | {
          detail?: string | { message?: unknown; status?: unknown } | Array<unknown>
          message?: unknown
          error?: { message?: unknown } | string
        }
      | undefined
    const detail = data?.detail
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
    if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim()
    if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim()
    if (data?.error && typeof data.error === 'object') {
      const message = (data.error as { message?: unknown }).message
      if (typeof message === 'string' && message.trim()) return message.trim()
    }
  }
  return readHttpError(err)
}
