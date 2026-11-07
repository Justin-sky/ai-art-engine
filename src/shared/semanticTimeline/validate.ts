import { SEMANTIC_TIMELINE_SCHEMA } from './types'

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
  if (!Array.isArray(doc.entities)) issues.push(issue('entities', 'required array'))

  for (const key of ['shots', 'dialogue', 'textLayers', 'speakers', 'edits'] as const) {
    if (doc[key] !== undefined && !Array.isArray(doc[key])) {
      issues.push(issue(key, 'must be an array'))
    }
  }
  if (Array.isArray(doc.shots)) {
    const seen = new Set<string>()
    doc.shots.forEach((shot, i) => {
      if (!isRecord(shot) || typeof shot.id !== 'string' || !shot.id) {
        issues.push(issue(`shots[${i}].id`, 'required'))
        return
      }
      if (seen.has(shot.id)) issues.push(issue(`shots[${i}].id`, 'duplicate'))
      seen.add(shot.id)
      validateTimeRange(`shots[${i}].range`, shot.range, issues)
      const seg = shot.sourceSegment
      if (!isRecord(seg) || !isFiniteNumber(seg.start) || !isFiniteNumber(seg.end)) {
        issues.push(issue(`shots[${i}].sourceSegment`, 'start/end required'))
      }
    })
  }
  if (Array.isArray(doc.dialogue)) {
    doc.dialogue.forEach((line, i) => {
      if (!isRecord(line) || typeof line.id !== 'string' || typeof line.text !== 'string') {
        issues.push(issue(`dialogue[${i}]`, 'id/text required'))
        return
      }
      validateTimeRange(`dialogue[${i}].range`, line.range, issues)
    })
  }

  return { ok: issues.length === 0, issues }
}
