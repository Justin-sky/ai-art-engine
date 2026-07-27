import {
  DEFAULT_SHOT_REVIEW_STATUS,
  asWorldRefList,
  normalizeShotReviewStatus,
  type ShotReviewStatus,
  type WorldEntityRef
} from '../domain'
import { stripJsonCodeFence } from './shotSplitParse'
import type { GraphDocument } from './types'

/** 叙事单元中的世界元素引用（通常仅有 name；绑定在分镜层完成） */
export type NarrativeWorldRef = WorldEntityRef
export { asWorldRefList }

/** 剧本叙事单元（介于完整剧本与分镜之间） */
export interface NarrativeUnitRow {
  id: string
  title: string
  /** 叙事顺序，从 1 起 */
  order: number
  summary: string
  /** 建置 / 冲突 / 转折 / 高潮 / 收束 等 */
  dramaticFunction: string
  characters: NarrativeWorldRef[]
  scenes: NarrativeWorldRef[]
  props: NarrativeWorldRef[]
  weapons: NarrativeWorldRef[]
  /** 对应原文摘录 */
  sourceExcerpt: string
  emotionalBeat: string
  /** 时长提示，如「短」「中」「长」或秒数描述 */
  durationHint: string
  status: ShotReviewStatus
}


function serializeWorldRef(ref: NarrativeWorldRef): NarrativeWorldRef {
  return {
    name: ref.name,
    ...(ref.imageUrl?.trim() ? { imageUrl: ref.imageUrl.trim() } : {}),
    ...(ref.type ? { type: ref.type } : {})
  }
}

function worldRefNames(refs: NarrativeWorldRef[]): string {
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
export function stableNarrativeUnitId(
  title: string,
  order: number,
  rawId?: string
): string {
  const fromModel = rawId?.trim()
  if (fromModel) return fromModel
  const key = `${order}:${title.trim().toLowerCase()}`
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `nu-${(hash >>> 0).toString(16)}`
}

function normalizeRow(item: unknown, index: number): NarrativeUnitRow | null {
  if (!item || typeof item !== 'object') return null
  const row = item as Record<string, unknown>
  const title =
    asString(row.title).trim() ||
    asString(row.name).trim() ||
    asString(row['名称']).trim() ||
    `叙事单元 ${index + 1}`
  const order = clampOrder(row.order ?? row.index ?? row['顺序'], index + 1)
  const summary =
    asString(row.summary).trim() ||
    asString(row.description).trim() ||
    asString(row['摘要']).trim()
  const dramaticFunction =
    asString(row.dramaticFunction).trim() ||
    asString(row.function).trim() ||
    asString(row['戏剧功能']).trim()
  const characters = asWorldRefList(row.characters ?? row['角色'])
  const scenes = asWorldRefList(row.scenes ?? row['场景'])
  const props = asWorldRefList(row.props ?? row['道具'])
  const weapons = asWorldRefList(row.weapons ?? row['武器'])
  const sourceExcerpt =
    asString(row.sourceExcerpt).trim() ||
    asString(row.sourceSpan).trim() ||
    asString(row.excerpt).trim() ||
    asString(row['原文']).trim()
  const emotionalBeat =
    asString(row.emotionalBeat).trim() ||
    asString(row.emotion).trim() ||
    asString(row['情绪']).trim()
  const durationHint =
    asString(row.durationHint).trim() ||
    asString(row.duration).trim() ||
    asString(row['时长']).trim()
  const id = stableNarrativeUnitId(title, order, asString(row.id).trim() || undefined)
  const status = normalizeShotReviewStatus(
    row.status ?? row.reviewStatus ?? row['状态'] ?? row['审核状态']
  )
  return {
    id,
    title,
    order,
    summary,
    dramaticFunction,
    characters,
    scenes,
    props,
    weapons,
    sourceExcerpt,
    emotionalBeat,
    durationHint,
    status
  }
}

/**
 * 解析叙事单元拆解 JSON。成功返回至少 1 行；失败返回 null。
 */
export function parseNarrativeUnitJson(
  raw: string | null | undefined
): NarrativeUnitRow[] | null {
  if (!raw?.trim()) return null
  const text = stripJsonCodeFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end <= start) return null
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  const rows: NarrativeUnitRow[] = []
  for (let i = 0; i < parsed.length; i++) {
    const row = normalizeRow(parsed[i], i)
    if (row) rows.push(row)
  }
  if (!rows.length) return null
  return rows
    .map((row, index) => ({ ...row, order: row.order || index + 1 }))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh'))
}

export function stringifyNarrativeUnitRows(rows: NarrativeUnitRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      order: row.order,
      summary: row.summary,
      dramaticFunction: row.dramaticFunction,
      characters: row.characters.map(serializeWorldRef),
      scenes: row.scenes.map(serializeWorldRef),
      props: row.props.map(serializeWorldRef),
      weapons: row.weapons.map(serializeWorldRef),
      sourceExcerpt: row.sourceExcerpt,
      emotionalBeat: row.emotionalBeat,
      durationHint: row.durationHint,
      status: normalizeShotReviewStatus(row.status)
    })),
    null,
    2
  )
}

/** 叙事单元全文（列表详情 / texts 输出口） */
export function formatNarrativeUnitFullText(row: NarrativeUnitRow): string {
  const lines: string[] = [`${row.order}. ${row.title}`.trim()]
  if (row.dramaticFunction.trim()) lines.push(`戏剧功能：${row.dramaticFunction.trim()}`)
  const characters = worldRefNames(row.characters)
  if (characters) lines.push(`角色：${characters}`)
  const scenes = worldRefNames(row.scenes)
  if (scenes) lines.push(`场景：${scenes}`)
  const props = worldRefNames(row.props)
  if (props) lines.push(`道具：${props}`)
  const weapons = worldRefNames(row.weapons)
  if (weapons) lines.push(`武器：${weapons}`)
  if (row.emotionalBeat.trim()) lines.push(`情绪：${row.emotionalBeat.trim()}`)
  if (row.durationHint.trim()) lines.push(`时长：${row.durationHint.trim()}`)
  if (row.summary.trim()) {
    lines.push('')
    lines.push(row.summary.trim())
  }
  const body = row.sourceExcerpt.trim()
  if (body) {
    lines.push('')
    lines.push(body)
  }
  return lines.join('\n').trim()
}

/** 目录行 → 图执行 texts 数组 */
export function narrativeUnitRowsToTextItems(
  rows: NarrativeUnitRow[]
): Array<{ id: string; title: string; text: string }> {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    text: formatNarrativeUnitFullText(row)
  }))
}

/**
 * 再次拆解时：按 id 保留上游「已审核」行；新列表更短时把剩余已审核行追加到末尾。
 */
export function mergeNarrativeUnitRowsPreservingReviewed(
  previous: NarrativeUnitRow[] | null | undefined,
  next: NarrativeUnitRow[] | null | undefined
): NarrativeUnitRow[] | null {
  if (!next?.length) return previous?.length ? [...previous] : null
  if (!previous?.length) {
    return next.map((row) => ({
      ...row,
      status: normalizeShotReviewStatus(row.status) || DEFAULT_SHOT_REVIEW_STATUS
    }))
  }

  const prevById = new Map(previous.map((row) => [row.id, row]))
  const used = new Set<string>()
  const result: NarrativeUnitRow[] = next.map((row) => {
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
    if (prev.status === '已审核' && !used.has(prev.id)) {
      result.push({ ...prev })
    }
  }
  return result
}

function nodeCatalogPayload(doc: GraphDocument, nodeId: string): string | null {
  const node = doc.nodes.find((item) => item.id === nodeId)
  const fromParams = node?.params?.text?.trim()
  if (fromParams) return fromParams
  const out = doc.runStates?.[nodeId]?.outputs?.out
  if (
    out &&
    typeof out === 'object' &&
    out.kind === 'narrative' &&
    typeof out.text === 'string'
  ) {
    const live = out.text.trim()
    if (live) return live
  }
  return null
}

/** 从叙事资产图取出连到「叙事表格」的上游文本，否则表格自身 / 拆解节点正文 */
export function extractNarrativeUnitJsonText(
  doc: GraphDocument | null | undefined
): string | null {
  if (!doc?.nodes?.length) return null

  const table = doc.nodes.find((node) => node.typeId === 'narrative.table')
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

  const split = doc.nodes.find(
    (node) => node.typeId === 'narrative.split' || node.typeId === 'screenplay.narrativeSplit'
  )
  return (split && nodeCatalogPayload(doc, split.id)) || null
}
