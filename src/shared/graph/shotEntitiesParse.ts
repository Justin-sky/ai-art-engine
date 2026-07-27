import type { GraphImageItem } from './execute/types'

/** 分镜图生成 → 分镜视频：实体表条目 */
export type ShotEntityResult = {
  id: string
  name: string
  imageUrls: string[]
}

export function imageUrlFromGraphImageItem(item: GraphImageItem): string {
  return item.relativePath?.trim() || item.dataUrl?.trim() || ''
}

export function stringifyShotEntities(entities: ShotEntityResult[]): string {
  return JSON.stringify(entities, null, 2)
}

export function parseShotEntities(raw: string | undefined | null): ShotEntityResult[] {
  if (!raw?.trim()) return []
  try {
    const trimmed = raw.trim()
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    const body = fenced?.[1]?.trim() || trimmed
    const parsed = JSON.parse(body) as unknown
    if (!Array.isArray(parsed)) return []
    const out: ShotEntityResult[] = []
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue
      const item = row as Record<string, unknown>
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      const urlsRaw = item.imageUrls ?? item.imageurls ?? item.images
      const imageUrls = Array.isArray(urlsRaw)
        ? urlsRaw.map((u) => (typeof u === 'string' ? u.trim() : '')).filter(Boolean)
        : []
      if (!id || !name || !imageUrls.length) continue
      out.push({ id, name, imageUrls })
    }
    return out
  } catch {
    return []
  }
}
