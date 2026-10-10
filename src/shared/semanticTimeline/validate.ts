import { SEMANTIC_TIMELINE_SCHEMA, type SemanticEdit, type SemanticTimeline } from './types'

export interface ValidationIssue {
  path: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
}

function issue(path: string, message: string): ValidationIssue {
  return { path, message }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function validateTimeRange(path: string, raw: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(raw)) {
    issues.push(issue(path, 'timeRange must be an object'))
    return
  }
  for (const key of ['start', 'end', 'startFrame', 'endFrame'] as const) {
    if (!isFiniteNumber(raw[key])) issues.push(issue(`${path}.${key}`, 'must be a finite number'))
  }
  if (isFiniteNumber(raw.start) && isFiniteNumber(raw.end) && raw.end < raw.start) {
    issues.push(issue(`${path}.end`, 'must be >= start'))
  }
}

/** 轻量 Schema 校验：拒绝坏文档，不抛异常 */
export function validateSemanticTimeline(doc: unknown): ValidationResult {
  const issues: ValidationIssue[] = []
  if (!isRecord(doc)) {
    return { ok: false, issues: [issue('', 'document must be an object')] }
  }
  if (doc.schema !== SEMANTIC_TIMELINE_SCHEMA) {
    issues.push(issue('schema', `expected ${SEMANTIC_TIMELINE_SCHEMA}`))
  }
  if (typeof doc.id !== 'string' || !doc.id) issues.push(issue('id', 'required string'))
  if (!isRecord(doc.source)) {
    issues.push(issue('source', 'required object'))
  } else {
    if (typeof doc.source.assetId !== 'string') issues.push(issue('source.assetId', 'required'))
    for (const key of ['fps', 'duration', 'width', 'height'] as const) {
      if (!isFiniteNumber(doc.source[key])) issues.push(issue(`source.${key}`, 'finite number'))
    }
  }
  if (!isRecord(doc.evidence)) issues.push(issue('evidence', 'required object'))
  if (!Array.isArray(doc.events)) issues.push(issue('events', 'required array'))
  else {
    doc.events.forEach((ev, i) => {
      if (!isRecord(ev)) {
        issues.push(issue(`events[${i}]`, 'must be object'))
        return
      }
      if (typeof ev.id !== 'string') issues.push(issue(`events[${i}].id`, 'required'))
      if (typeof ev.label !== 'string') issues.push(issue(`events[${i}].label`, 'required'))
      validateTimeRange(`events[${i}].timeRange`, ev.timeRange, issues)
      if (!Array.isArray(ev.evidence)) {
        issues.push(issue(`events[${i}].evidence`, 'required array'))
      }
    })
  }
  if (!Array.isArray(doc.beats)) issues.push(issue('beats', 'required array'))
  if (!Array.isArray(doc.entities)) issues.push(issue('entities', 'required array'))
  if (!Array.isArray(doc.intents)) issues.push(issue('intents', 'required array'))
  if (!Array.isArray(doc.tracks)) issues.push(issue('tracks', 'required array'))
  if (!Array.isArray(doc.edits)) issues.push(issue('edits', 'required array'))

  // 事件必须引用至少一个证据（分析产出的硬约束）
  if (Array.isArray(doc.events)) {
    for (let i = 0; i < doc.events.length; i++) {
      const ev = doc.events[i]
      if (!isRecord(ev)) continue
      if (Array.isArray(ev.evidence) && ev.evidence.length === 0 && ev.origin === 'analysis') {
        issues.push(issue(`events[${i}].evidence`, 'analysis events require evidence refs'))
      }
    }
  }

  return { ok: issues.length === 0, issues }
}

/** 丢弃无证据的分析事件 */
export function filterEventsRequiringEvidence(
  events: SemanticTimeline['events']
): SemanticTimeline['events'] {
  return events.filter((ev) => ev.origin !== 'analysis' || (ev.evidence?.length ?? 0) > 0)
}

export function assertValidEdit(edit: SemanticEdit): ValidationResult {
  const issues: ValidationIssue[] = []
  if (!edit.id) issues.push(issue('id', 'required'))
  if (!edit.kind) issues.push(issue('kind', 'required'))
  if (!edit.origin) issues.push(issue('origin', 'required'))
  switch (edit.kind) {
    case 'replaceEntity':
      if (!edit.entityId) issues.push(issue('entityId', 'required'))
      if (!edit.newAssetId) issues.push(issue('newAssetId', 'required'))
      break
    case 'removeEntity':
      if (!edit.entityId) issues.push(issue('entityId', 'required'))
      break
    case 'rewriteUtterance':
      if (!edit.utteranceId) issues.push(issue('utteranceId', 'required'))
      if (!edit.newText) issues.push(issue('newText', 'required'))
      break
    case 'editText':
      if (!edit.regionId) issues.push(issue('regionId', 'required'))
      if (!edit.newText) issues.push(issue('newText', 'required'))
      break
    case 'dropBeat':
    case 'retimeBeat':
      if (!('beatId' in edit) || !edit.beatId) issues.push(issue('beatId', 'required'))
      break
    case 'regenerateShot':
    case 'fixFrames':
      if (!('shotId' in edit) || !edit.shotId) issues.push(issue('shotId', 'required'))
      break
    default:
      break
  }
  return { ok: issues.length === 0, issues }
}
