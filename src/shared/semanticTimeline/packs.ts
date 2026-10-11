/**
 * 市场数据包（semanticPacks）加载与校验 — 纯 JSON，无可执行代码。
 */
import type { SemanticPack } from './types'

export interface PackValidation {
  ok: boolean
  issues: string[]
}

export function validateSemanticPack(raw: unknown): PackValidation {
  const issues: string[] = []
  if (!raw || typeof raw !== 'object') return { ok: false, issues: ['pack must be object'] }
  const p = raw as Record<string, unknown>
  if (p.schemaVersion !== 1) issues.push('schemaVersion must be 1')
  if (typeof p.id !== 'string' || !p.id) issues.push('id required')
  if (typeof p.title !== 'string') issues.push('title required')
  const kind = p.kind
  if (kind !== 'vocabulary' && kind !== 'rules' && kind !== 'recipe' && kind !== 'persona') {
    issues.push('kind must be vocabulary|rules|recipe|persona')
  }
  if (kind === 'vocabulary' && !p.vocabulary) issues.push('vocabulary payload missing')
  if (kind === 'rules' && !p.rules) issues.push('rules payload missing')
  if (kind === 'recipe' && !p.recipe) issues.push('recipe payload missing')
  if (kind === 'persona' && !p.persona) issues.push('persona payload missing')
  return { ok: issues.length === 0, issues }
}

export function parseSemanticPack(raw: unknown): SemanticPack | null {
  const v = validateSemanticPack(raw)
  if (!v.ok) return null
  return raw as SemanticPack
}
