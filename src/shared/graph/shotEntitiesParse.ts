import type { GraphImageItem } from './execute/types'
import type { GraphDocument, GraphNode } from './types'

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

function shotEntitiesFromNode(node: GraphNode, doc?: GraphDocument): ShotEntityResult[] {
  const fromParams = Array.isArray(node.params?.shotEntities)
    ? parseShotEntities(JSON.stringify(node.params.shotEntities))
    : parseShotEntities(
        typeof node.params?.text === 'string' ? node.params.text : null
      )
  if (fromParams.length) return fromParams
  const live = doc?.runStates?.[node.id]?.outputs?.out
  if (!live || typeof live !== 'object' || !('kind' in live)) return []
  if (live.kind === 'shotEntities' && typeof live.text === 'string') {
    return parseShotEntities(live.text)
  }
  return []
}

/**
 * 从剧本图解析某镜的参考图 URL。
 * 优先 script.shotImageGen（上层分镜图输出），避免被 shotVideoGen 上旧缓存抢先。
 */
export function resolveShotEntityImageUrlsFromGraphs(
  docs: Array<GraphDocument | null | undefined>,
  shotId: string
): string[] {
  const id = shotId.trim()
  if (!id) return []
  const preferTypeIds = ['script.shotImageGen', 'script.shotVideoGen'] as const
  for (const typeId of preferTypeIds) {
    for (const doc of docs) {
      if (!doc?.nodes?.length) continue
      for (const node of doc.nodes) {
        if (node.typeId !== typeId) continue
        const match = shotEntitiesFromNode(node, doc).find((item) => item.id === id)
        if (match?.imageUrls.length) return match.imageUrls
      }
    }
  }
  return []
}

export function entityImageUrlsByShotId(
  entities: ShotEntityResult[] | undefined | null
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const item of entities ?? []) {
    const id = item.id?.trim()
    if (!id || !item.imageUrls?.length) continue
    out[id] = item.imageUrls.map((u) => u.trim().replace(/\\/g, '/')).filter(Boolean)
  }
  return out
}
