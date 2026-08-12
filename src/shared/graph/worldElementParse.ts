import {
  DEFAULT_REVIEW_STATUS,
  normalizeReviewStatus,
  type ReviewStatus
} from './reviewStatus'
import type { GraphDocument, GraphNodeParams } from './types'
import type { GraphImageItem, GraphValue } from './execute/types'

/** 世界元素四类 */
export type WorldElementKind = 'characters' | 'scenes' | 'props' | 'weapons'

export const WORLD_ELEMENT_KINDS: readonly WorldElementKind[] = [
  'characters',
  'scenes',
  'props',
  'weapons'
] as const

export interface WorldElementItem {
  /** 稳定 id（模型生成或本地 hash(name+kind)） */
  id: string
  name: string
  /** 用于图片生成的详细提示词 */
  prompt: string
  /** 审核状态：未审核 | 已审核 */
  status: ReviewStatus
}

export interface WorldElementCatalog {
  characters: WorldElementItem[]
  scenes: WorldElementItem[]
  props: WorldElementItem[]
  weapons: WorldElementItem[]
}

const KIND_ALIASES: Record<string, WorldElementKind> = {
  characters: 'characters',
  character: 'characters',
  角色: 'characters',
  人物: 'characters',
  scenes: 'scenes',
  scene: 'scenes',
  场景: 'scenes',
  props: 'props',
  prop: 'props',
  道具: 'props',
  weapons: 'weapons',
  weapon: 'weapons',
  武器: 'weapons'
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/** 去掉模型常见的 markdown 代码围栏 */
export function stripWorldJsonCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced?.[1]) return fenced[1].trim()
  return trimmed
}

/** 稳定 id：优先用模型给的 id，否则 hash(kind+name) */
export function stableWorldElementId(
  kind: WorldElementKind,
  name: string,
  rawId?: string
): string {
  const fromModel = rawId?.trim()
  if (fromModel) return fromModel
  const key = `${kind}:${name.trim().toLowerCase()}`
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `we-${kind}-${(hash >>> 0).toString(16)}`
}

function normalizeItem(
  kind: WorldElementKind,
  item: unknown,
  index: number
): WorldElementItem | null {
  if (!item || typeof item !== 'object') return null
  const row = item as Record<string, unknown>
  const name =
    asString(row.name).trim() ||
    asString(row.title).trim() ||
    asString(row['名称']).trim() ||
    `${kind}-${index + 1}`
  const prompt =
    asString(row.prompt).trim() ||
    asString(row.description).trim() ||
    asString(row['提示词']).trim() ||
    asString(row['描述']).trim()
  const id = stableWorldElementId(kind, name, asString(row.id).trim() || undefined)
  const status = normalizeReviewStatus(
    row.status ?? row.reviewStatus ?? row['状态'] ?? row['审核状态']
  )
  return { id, name, prompt, status }
}

function normalizeKindList(kind: WorldElementKind, raw: unknown): WorldElementItem[] {
  if (!Array.isArray(raw)) return []
  const items: WorldElementItem[] = []
  for (let i = 0; i < raw.length; i++) {
    const item = normalizeItem(kind, raw[i], i)
    if (item) items.push(item)
  }
  return items
}

export function emptyWorldElementCatalog(): WorldElementCatalog {
  const catalog = {} as WorldElementCatalog
  for (const kind of WORLD_ELEMENT_KINDS) catalog[kind] = []
  return catalog
}

function mapCatalogItems(
  catalog: WorldElementCatalog,
  mapItem: (item: WorldElementItem) => WorldElementItem
): WorldElementCatalog {
  const out = emptyWorldElementCatalog()
  for (const kind of WORLD_ELEMENT_KINDS) {
    out[kind] = catalog[kind].map(mapItem)
  }
  return out
}

/**
 * 解析世界元素提取 JSON。成功返回目录（可含空数组）；失败返回 null。
 * 支持中文 key 别名：角色/场景/道具/武器。
 */
export function parseWorldElementCatalog(
  raw: string | null | undefined
): WorldElementCatalog | null {
  if (!raw?.trim()) return null
  const text = stripWorldJsonCodeFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const catalog = emptyWorldElementCatalog()
  let anyKey = false
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const kind = KIND_ALIASES[key.trim()] ?? KIND_ALIASES[key.trim().toLowerCase()]
    if (!kind) continue
    anyKey = true
    catalog[kind] = normalizeKindList(kind, value)
  }
  if (!anyKey) return null
  return catalog
}

/**
 * 再次提取时：按 id 保留上游「已审核」项；新列表更短时把剩余已审核项追加到同类末尾。
 */
export function mergeWorldCatalogPreservingReviewed(
  previous: WorldElementCatalog | null | undefined,
  next: WorldElementCatalog | null | undefined
): WorldElementCatalog | null {
  if (!next) return previous ? mapCatalogItems(previous, (item) => ({ ...item })) : null
  if (!previous) {
    return mapCatalogItems(next, (item) => ({
      ...item,
  status: normalizeReviewStatus(item.status)
    }))
  }

  const result = emptyWorldElementCatalog()
  for (const kind of WORLD_ELEMENT_KINDS) {
    const prevById = new Map(previous[kind].map((item) => [item.id, item]))
    const used = new Set<string>()
    for (const row of next[kind]) {
      const prev = prevById.get(row.id)
      if (prev?.status === '已审核') {
        result[kind].push({ ...prev })
        used.add(prev.id)
        continue
      }
      result[kind].push({
        ...row,
  status: normalizeReviewStatus(row.status) || DEFAULT_REVIEW_STATUS
      })
      used.add(row.id)
    }
    for (const prev of previous[kind]) {
      if (prev.status === '已审核' && !used.has(prev.id)) {
        result[kind].push({ ...prev })
      }
    }
  }
  return result
}

function nodeCatalogPayload(doc: GraphDocument, nodeId: string): string | null {
  const node = doc.nodes.find((item) => item.id === nodeId)
  const fromParams = node?.params?.text?.trim()
  if (fromParams) return fromParams
  const out = doc.runStates?.[nodeId]?.outputs?.out
  if (out && typeof out === 'object' && out.kind === 'world' && typeof out.text === 'string') {
    const live = out.text.trim()
    if (live) return live
  }
  return null
}

/** 序列化世界元素目录（表格 ↔ 提取 JSON） */
export function stringifyWorldElementCatalog(catalog: WorldElementCatalog): string {
  const payload = {} as Record<
    WorldElementKind,
    Array<Pick<WorldElementItem, 'id' | 'name' | 'prompt' | 'status'>>
  >
  for (const kind of WORLD_ELEMENT_KINDS) {
    payload[kind] = catalog[kind].map((item) => ({
      id: item.id,
      name: item.name,
      prompt: item.prompt,
  status: normalizeReviewStatus(item.status)
    }))
  }
  return JSON.stringify(payload, null, 2)
}

/** 世界元素生成结果实体 type（中文标签） */
export type WorldElementOutputType = '角色' | '场景' | '道具' | '武器'

export const WORLD_ELEMENT_KIND_TO_TYPE: Record<WorldElementKind, WorldElementOutputType> = {
  characters: '角色',
  scenes: '场景',
  props: '道具',
  weapons: '武器'
}

export const WORLD_ELEMENT_TYPE_TO_KIND: Record<WorldElementOutputType, WorldElementKind> = {
  角色: 'characters',
  场景: 'scenes',
  道具: 'props',
  武器: 'weapons'
}

const WORLD_ELEMENT_OUTPUT_TYPES: readonly WorldElementOutputType[] = [
  '角色',
  '场景',
  '道具',
  '武器'
] as const

/** 世界元素生成节点：四类图片组输出口 */
export const WORLD_GEN_IMAGE_OUT_PORTS = [
  { id: 'out-characters', kind: 'characters' as const, type: '角色' as const, label: '角色' },
  { id: 'out-scenes', kind: 'scenes' as const, type: '场景' as const, label: '场景' },
  { id: 'out-props', kind: 'props' as const, type: '道具' as const, label: '道具' },
  { id: 'out-weapons', kind: 'weapons' as const, type: '武器' as const, label: '武器' }
] as const

export type WorldGenImageOutPortId = (typeof WORLD_GEN_IMAGE_OUT_PORTS)[number]['id']

export function isWorldGenImageOutPortId(id: string): id is WorldGenImageOutPortId {
  return WORLD_GEN_IMAGE_OUT_PORTS.some((port) => port.id === id)
}

export function worldGenImageOutPortIdForType(
  type: WorldElementOutputType
): WorldGenImageOutPortId {
  const kind = WORLD_ELEMENT_TYPE_TO_KIND[type]
  return (
    WORLD_GEN_IMAGE_OUT_PORTS.find((port) => port.kind === kind)?.id ?? 'out-characters'
  )
}

export interface WorldElementGenResult {
  type: WorldElementOutputType
  name: string
  imageUrl: string
}

/** 世界元素生成结果 → 角色/场景/道具/武器四个图片组输出口 */
export function worldGenImageGroupOutputs(
  results: WorldElementGenResult[]
): Record<string, GraphValue> {
  const buckets: Record<WorldElementOutputType, GraphImageItem[]> = {
    角色: [],
    场景: [],
    道具: [],
    武器: []
  }
  for (const [index, item] of results.entries()) {
    const url = item.imageUrl?.trim() || ''
    if (!item.type || !item.name?.trim() || !url) continue
    if (!(item.type in buckets)) continue
    const imageItem: GraphImageItem = {
      id: `${item.type}:${item.name}:${index}`,
      dataUrl: url.startsWith('data:') ? url : '',
      ...(url.startsWith('data:') ? {} : { relativePath: url })
    }
    buckets[item.type].push(imageItem)
  }
  const out: Record<string, GraphValue> = {}
  for (const port of WORLD_GEN_IMAGE_OUT_PORTS) {
    out[port.id] = { kind: 'images', items: buckets[port.type] }
  }
  return out
}

export function stringifyWorldElementGenResults(results: WorldElementGenResult[]): string {
  return JSON.stringify(results, null, 2)
}

export function parseWorldElementGenResults(raw: string | undefined | null): WorldElementGenResult[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(stripWorldJsonCodeFence(raw)) as unknown
    if (!Array.isArray(parsed)) return []
    const out: WorldElementGenResult[] = []
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue
      const item = row as Record<string, unknown>
      const typeRaw = asString(item.type).trim()
      const kind = KIND_ALIASES[typeRaw]
      const type = kind ? WORLD_ELEMENT_KIND_TO_TYPE[kind] : null
      if (!type) continue
      const name = asString(item.name).trim()
      const imageUrl =
        asString(item.imageUrl).trim() ||
        asString(item.image_url).trim() ||
        asString(item.url).trim()
      if (!name || !imageUrl) continue
      out.push({ type, name, imageUrl })
    }
    return out
  } catch {
    return []
  }
}

/** 节点 params 上缓存的世界元素实体 */
export function worldElementOutputsFromParams(
  params: GraphNodeParams | undefined | null
): WorldElementGenResult[] {
  const raw = params?.worldElementOutputs
  if (!Array.isArray(raw)) return []
  const out: WorldElementGenResult[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const type = asString(item.type).trim()
    const name = asString(item.name).trim()
    const imageUrl = asString(item.imageUrl).trim()
    if (!name || !imageUrl) continue
    if (!WORLD_ELEMENT_OUTPUT_TYPES.includes(type as WorldElementOutputType)) continue
    out.push({ type: type as WorldElementOutputType, name, imageUrl })
  }
  return out
}

/** 从世界元素资产图取出连到「世界元素表格」的上游文本，否则表格自身 / 提取节点正文 */
export function extractWorldCatalogJsonText(doc: GraphDocument | null | undefined): string | null {
  if (!doc?.nodes?.length) return null

  const table = doc.nodes.find((node) => node.typeId === 'world.table')
  if (table) {
    for (const edge of doc.edges) {
      if (edge.target !== table.id) continue
      if ((edge.targetPort ?? 'in') !== 'in') continue
      const text = nodeCatalogPayload(doc, edge.source)
      if (text) return text
    }
    const own = nodeCatalogPayload(doc, table.id)
    if (own) return own
  }

  const extract = doc.nodes.find((node) => node.typeId === 'world.extract')
  return (extract && nodeCatalogPayload(doc, extract.id)) || null
}
