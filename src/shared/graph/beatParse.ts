import {
  DEFAULT_SHOT_REVIEW_STATUS,
  asWorldRefList,
  normalizeShotReviewStatus,
  type ShotReviewStatus,
  type WorldEntityRef
} from '../domain'
import { stripJsonCodeFence } from './shotSplitParse'
import type { GraphDocument } from './types'

/** 场中的世界元素引用（绑定在分镜层完成） */
export type BeatWorldRef = WorldEntityRef
export { asWorldRefList }

/** 剧本中的场（介于完整剧本与分镜之间） */
export interface BeatRow {
  id: string
  title: string
  /** 场顺序，从 1 起 */
  order: number
  time: string
  /** 时长提示，如「短」「中」「长」或秒数描述 */
  durationHint: string
  location: string
  locations: BeatWorldRef[]
  characters: BeatWorldRef[]
  action: string
  conflict: string
  atmosphere: string
  props: BeatWorldRef[]
  weapons: BeatWorldRef[]
  /** 对应原文摘录 */
  sourceExcerpt: string
  status: ShotReviewStatus
}

function serializeWorldRef(ref: BeatWorldRef): BeatWorldRef {
  return {
    name: ref.name,
    ...(ref.imageUrl?.trim() ? { imageUrl: ref.imageUrl.trim() } : {}),
    ...(ref.type ? { type: ref.type } : {})
  }
}

function worldRefNames(refs: BeatWorldRef[]): string {
  return refs.map((ref) => ref.name.trim()).filter(Boolean).join('、')
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function clampOrder(value: unknown, fallback: number): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.round(n))
}

/** 稳定 id：优先用模型给的 id，否则 hash(title+order) */
export function stableBeatId(title: string, order: number, rawId?: string): string {
  const fromModel = rawId?.trim()
  if (fromModel) return fromModel
  const key = `${order}:${title.trim().toLowerCase()}`
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `beat-${(hash >>> 0).toString(16)}`
}

function normalizeRow(item: unknown, index: number): BeatRow | null {
  if (!item || typeof item !== 'object') return null
  const row = item as Record<string, unknown>
  const title = asString(row.title).trim() || asString(row['名称']).trim() || `场 ${index + 1}`
  const order = clampOrder(row.order ?? row['顺序'], index + 1)
  const time = asString(row.time ?? row['时间']).trim()
  const durationHint = asString(row.durationHint ?? row['时长']).trim()
  const location = asString(row.location ?? row['空间与地点']).trim()
  const locations = asWorldRefList(row.locations ?? row['地点绑定'])
  const characters = asWorldRefList(row.characters ?? row['角色'])
  const action = asString(row.action ?? row['核心动作']).trim()
  const conflict = asString(row.conflict ?? row['冲突与目标']).trim()
  const atmosphere = asString(row.atmosphere ?? row['氛围与声音']).trim()
  const props = asWorldRefList(row.props)
  const weapons = asWorldRefList(row.weapons)
  const sourceExcerpt = asString(row.sourceExcerpt ?? row['原文']).trim()
  const id = stableBeatId(title, order, asString(row.id).trim() || undefined)
  const status = normalizeShotReviewStatus(row.status ?? row['状态'])
  return {
    id,
    title,
    order,
    time,
    durationHint,
    location,
    locations,
    characters,
    action,
    conflict,
    atmosphere,
    props,
    weapons,
    sourceExcerpt,
    status
  }
}

function parseJson(raw: string): unknown {
  const text = stripJsonCodeFence(raw)
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

/** 解析场拆解 JSON。成功返回至少 1 行；失败返回 null。 */
export function parseBeatJson(raw: string | null | undefined): BeatRow[] | null {
  if (!raw?.trim()) return null
  const parsed = parseJson(raw)
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  const rows: BeatRow[] = []
  for (let i = 0; i < parsed.length; i++) {
    const row = normalizeRow(parsed[i], i)
    if (row) rows.push(row)
  }
  if (!rows.length) return null
  return rows
    .map((row, index) => ({ ...row, order: row.order || index + 1 }))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh'))
}

function serializableBeat(row: BeatRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    order: row.order,
    time: row.time,
    durationHint: row.durationHint,
    location: row.location,
    locations: row.locations.map(serializeWorldRef),
    characters: row.characters.map(serializeWorldRef),
    action: row.action,
    conflict: row.conflict,
    atmosphere: row.atmosphere,
    props: row.props.map(serializeWorldRef),
    weapons: row.weapons.map(serializeWorldRef),
    sourceExcerpt: row.sourceExcerpt,
    status: normalizeShotReviewStatus(row.status)
  }
}

export function stringifyBeatRows(rows: BeatRow[]): string {
  return JSON.stringify(rows.map(serializableBeat), null, 2)
}

/** 单个场 JSON（对象；亦接受单元素数组） */
export function parseBeatEntityJson(raw: string | null | undefined): BeatRow | null {
  if (!raw?.trim()) return null
  const text = stripJsonCodeFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return parseBeatJson(text)?.[0] ?? null
  }
  if (Array.isArray(parsed)) return parseBeatJson(JSON.stringify(parsed))?.[0] ?? null
  return normalizeRow(parsed, 0)
}

export function stringifyBeatEntity(row: BeatRow): string {
  return JSON.stringify(serializableBeat(row), null, 2)
}

/** 场全文（列表详情 / texts 输出口） */
export function formatBeatFullText(row: BeatRow): string {
  const lines: string[] = [`${row.order}. ${row.title}`.trim()]
  if (row.time.trim()) lines.push(`时间：${row.time.trim()}`)
  if (row.durationHint.trim()) lines.push(`时长：${row.durationHint.trim()}`)
  if (row.location.trim()) lines.push(`空间与地点：${row.location.trim()}`)
  const locations = worldRefNames(row.locations)
  if (locations) lines.push(`地点绑定：${locations}`)
  const characters = worldRefNames(row.characters)
  if (characters) lines.push(`角色：${characters}`)
  if (row.action.trim()) lines.push(`核心动作：${row.action.trim()}`)
  if (row.conflict.trim()) lines.push(`冲突与目标：${row.conflict.trim()}`)
  if (row.atmosphere.trim()) lines.push(`氛围与声音：${row.atmosphere.trim()}`)
  const props = worldRefNames(row.props)
  if (props) lines.push(`道具：${props}`)
  const weapons = worldRefNames(row.weapons)
  if (weapons) lines.push(`武器：${weapons}`)
  const body = row.sourceExcerpt.trim()
  if (body) {
    lines.push('')
    lines.push(body)
  }
  return lines.join('\n').trim()
}

/** 目录行 → 图执行 texts 数组 */
export function beatRowsToTextItems(
  rows: BeatRow[]
): Array<{ id: string; title: string; text: string }> {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    text: formatBeatFullText(row)
  }))
}

/** 再次拆解时按 id 保留已审核行。 */
export function mergeBeatRowsPreservingReviewed(
  previous: BeatRow[] | null | undefined,
  next: BeatRow[] | null | undefined
): BeatRow[] | null {
  if (!next?.length) return previous?.length ? [...previous] : null
  if (!previous?.length) {
    return next.map((row) => ({
      ...row,
      status: normalizeShotReviewStatus(row.status) || DEFAULT_SHOT_REVIEW_STATUS
    }))
  }

  const prevById = new Map(previous.map((row) => [row.id, row]))
  const used = new Set<string>()
  const result: BeatRow[] = next.map((row) => {
    const prev = prevById.get(row.id)
    if (prev?.status === '已审核') {
      used.add(prev.id)
      return { ...prev }
    }
    used.add(row.id)
    return {
      ...row,
      status: normalizeShotReviewStatus(row.status) || DEFAULT_SHOT_REVIEW_STATUS
    }
  })

  for (const prev of previous) {
    if (prev.status === '已审核' && !used.has(prev.id)) result.push({ ...prev })
  }
  return result
}

function nodeCatalogPayload(doc: GraphDocument, nodeId: string): string | null {
  const node = doc.nodes.find((item) => item.id === nodeId)
  const fromParams = node?.params?.text?.trim()
  if (fromParams) return fromParams
  const out = doc.runStates?.[nodeId]?.outputs?.out
  if (out && typeof out === 'object' && out.kind === 'beat' && typeof out.text === 'string') {
    const live = out.text.trim()
    if (live) return live
  }
  return null
}

/** 从场资产图取出连到场表格的上游文本，否则取表格自身或拆解节点正文。 */
export function extractBeatJsonText(doc: GraphDocument | null | undefined): string | null {
  if (!doc?.nodes?.length) return null

  const table = doc.nodes.find((node) => node.typeId === 'beat.table')
  if (table) {
    for (const edge of doc.edges) {
      if (edge.target !== table.id || (edge.targetPort ?? 'in') !== 'in') continue
      const text = nodeCatalogPayload(doc, edge.source)
      if (text) return text
    }
    const own = nodeCatalogPayload(doc, table.id)
    if (own) return own
  }

  const split = doc.nodes.find((node) => node.typeId === 'beat.split')
  return (split && nodeCatalogPayload(doc, split.id)) || null
}
