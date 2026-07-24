import {
  DEFAULT_SHOT_REVIEW_STATUS,
  normalizeShotReviewStatus,
  type Shot,
  type ShotReviewStatus
} from '../domain'
import type { GraphDocument } from './types'

/** 分镜拆分 JSON 一行，字段对齐分镜表格 / ShotStoryboard */
export interface ShotSplitRow {
  title: string
  durationSec: number
  visualDescription: string
  shotSize: string
  lighting: string
  dialogue: string
  soundFx: string
  cameraMove: string
  /** 审核状态：未审核 | 已审核 */
  status: ShotReviewStatus
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function clampDurationSec(value: unknown): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN
  if (!Number.isFinite(n)) return 5
  return Math.min(60, Math.max(1, Math.round(n)))
}

/** 去掉模型常见的 markdown 代码围栏 */
export function stripJsonCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced?.[1]) return fenced[1].trim()
  return trimmed
}

function normalizeRow(item: unknown, index: number): ShotSplitRow | null {
  if (!item || typeof item !== 'object') return null
  const row = item as Record<string, unknown>
  const title = asString(row.title).trim() || `分镜 ${index + 1}`
  return {
    title,
    durationSec: clampDurationSec(row.durationSec),
    visualDescription: asString(row.visualDescription).trim(),
    shotSize: asString(row.shotSize).trim(),
    lighting: asString(row.lighting).trim(),
    dialogue: asString(row.dialogue).trim(),
    soundFx: asString(row.soundFx).trim(),
    cameraMove: asString(row.cameraMove).trim(),
    status: normalizeShotReviewStatus(row.status)
  }
}

/**
 * 解析分镜拆分节点输出。成功返回至少 1 行；失败返回 null。
 */
export function parseShotSplitJson(raw: string | null | undefined): ShotSplitRow[] | null {
  if (!raw?.trim()) return null
  const text = stripJsonCodeFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // 容错：截取首个 [ ... ] 再试
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
  const rows: ShotSplitRow[] = []
  for (let i = 0; i < parsed.length; i++) {
    const row = normalizeRow(parsed[i], i)
    if (row) rows.push(row)
  }
  return rows.length ? rows : null
}

/** 将分镜列表序列化为拆分 JSON（供表格节点输出 / 再次拆分输入） */
export function shotsToShotSplitRows(shots: Shot[]): ShotSplitRow[] {
  return shots.map((shot, index) => {
    const sb = shot.storyboard
    return {
      title: shot.title?.trim() || `分镜 ${index + 1}`,
      durationSec: clampDurationSec(shot.camera?.durationSec),
      visualDescription: sb?.visualDescription?.trim() ?? '',
      shotSize: sb?.shotSize?.trim() ?? '',
      lighting: sb?.lighting?.trim() ?? '',
      dialogue: sb?.dialogue?.trim() ?? '',
      soundFx: sb?.soundFx?.trim() ?? '',
      cameraMove: sb?.cameraMove?.trim() ?? '',
      status: normalizeShotReviewStatus(shot.reviewStatus)
    }
  })
}

export function stringifyShotSplitRows(rows: ShotSplitRow[]): string {
  return JSON.stringify(rows, null, 2)
}

/**
 * 再次拆分时：按索引保留上游「已审核」行，防止模型改写。
 * 若新列表更短，把剩余已审核行追加到末尾。
 */
export function mergeShotSplitRowsPreservingReviewed(
  previous: ShotSplitRow[] | null | undefined,
  next: ShotSplitRow[] | null | undefined
): ShotSplitRow[] | null {
  if (!next?.length) return previous?.length ? [...previous] : null
  if (!previous?.length) {
    return next.map((row) => ({
      ...row,
      status: normalizeShotReviewStatus(row.status)
    }))
  }

  const result: ShotSplitRow[] = next.map((row, index) => {
    const prev = previous[index]
    if (prev?.status === '已审核') return { ...prev }
    return {
      ...row,
      status: normalizeShotReviewStatus(row.status) || DEFAULT_SHOT_REVIEW_STATUS
    }
  })

  for (let i = next.length; i < previous.length; i++) {
    const prev = previous[i]
    if (prev?.status === '已审核') result.push({ ...prev })
  }
  return result
}

function nodeTextPayload(doc: GraphDocument, nodeId: string): string | null {
  const node = doc.nodes.find((item) => item.id === nodeId)
  const fromParams = node?.params?.text?.trim()
  if (fromParams) return fromParams
  const out = doc.runStates?.[nodeId]?.outputs?.out
  if (out && typeof out === 'object' && out.kind === 'text' && typeof out.text === 'string') {
    const live = out.text.trim()
    if (live) return live
  }
  return null
}

/** 从分镜资产图中取出连到「分镜表格」的上游文本，否则用分镜拆分节点正文 */
export function extractShotSplitJsonText(doc: GraphDocument | null | undefined): string | null {
  if (!doc?.nodes?.length) return null

  const table = doc.nodes.find((node) => node.typeId === 'script.shotTable')
  if (table) {
    for (const edge of doc.edges) {
      if (edge.target !== table.id) continue
      if ((edge.targetPort ?? 'in') !== 'in') continue
      const text = nodeTextPayload(doc, edge.source)
      if (text) return text
    }
    // 表格节点自身缓存（再次拆分：表格 → 拆分 时也会写回）
    const own = nodeTextPayload(doc, table.id)
    if (own) return own
  }

  const split = doc.nodes.find((node) => node.typeId === 'script.shotSplit')
  return (split && nodeTextPayload(doc, split.id)) || null
}
