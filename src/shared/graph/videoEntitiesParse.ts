import type { GraphVideoItem } from './execute/types'

/** 分镜视频生成 → 分镜输出 / 成片时间线：视频实体表条目 */
export type VideoEntityResult = {
  id: string
  name: string
  videoUrls: string[]
}

export function videoUrlFromGraphVideoItem(item: GraphVideoItem): string {
  return item.relativePath?.trim() || item.dataUrl?.trim() || ''
}

export function stringifyVideoEntities(entities: VideoEntityResult[]): string {
  return JSON.stringify(entities, null, 2)
}

export function parseVideoEntities(raw: string | undefined | null): VideoEntityResult[] {
  if (!raw?.trim()) return []
  try {
    const trimmed = raw.trim()
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    const body = fenced?.[1]?.trim() || trimmed
    const parsed = JSON.parse(body) as unknown
    if (!Array.isArray(parsed)) return []
    const out: VideoEntityResult[] = []
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue
      const item = row as Record<string, unknown>
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const name =
        typeof item.name === 'string'
          ? item.name.trim()
          : typeof item.title === 'string'
            ? item.title.trim()
            : ''
      const urlsRaw = item.videoUrls ?? item.videourls ?? item.videos ?? item.urls
      const videoUrls = Array.isArray(urlsRaw)
        ? urlsRaw.map((u) => (typeof u === 'string' ? u.trim() : '')).filter(Boolean)
        : []
      if (!id || !name || !videoUrls.length) continue
      out.push({ id, name, videoUrls })
    }
    return out
  } catch {
    return []
  }
}
