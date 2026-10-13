/**
 * KodikRouter 相对 OpenAI 语音协议只多一条网关校验：
 * `POST /audio/speech` 缺 `body.voice` 会直接 400。
 *
 * 目录不要按它的 `api_surfaces` 另写一套。官方 OpenAI 的 `GET /models`
 * 也没有这个字段，语音目录在本应用里是手填模型 id（聚合器）或本地静态表（官方）。
 */

/** Base URL 是否指向 KodikRouter（含子域，如 api.kodikrouter.ru） */
export function isKodikRouterBaseUrl(baseUrl: string | undefined | null): boolean {
  const raw = (baseUrl ?? '').trim()
  if (!raw) return false
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const host = new URL(withScheme).hostname.toLowerCase()
    return host === 'kodikrouter.ru' || host.endsWith('.kodikrouter.ru')
  } catch {
    return false
  }
}
