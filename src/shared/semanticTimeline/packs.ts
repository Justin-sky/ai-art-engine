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

/** 变体配方槽位展开：笛卡尔积 */
export function expandVariantMatrix(
  slots: Array<{ key: string; values: unknown[] }>
): Record<string, unknown>[] {
  if (slots.length === 0) return [{}]
  let rows: Record<string, unknown>[] = [{}]
  for (const slot of slots) {
    const next: Record<string, unknown>[] = []
    for (const row of rows) {
      for (const value of slot.values) {
        next.push({ ...row, [slot.key]: value })
      }
    }
    rows = next
  }
  return rows
}

/** 将模板字符串中的 {{key}} 替换为槽位值 */
export function fillTemplate(template: string, slots: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = slots[key]
    return v === undefined || v === null ? '' : String(v)
  })
}

/**
 * 变体配方 × 槽位矩阵 → 多组 SemanticEdit 草稿（未落盘）。
 * editTemplates 里的字符串字段会做 {{slot}} 替换。
 */
export function expandRecipeEditMatrix(
  editTemplates: Array<Record<string, unknown>>,
  slots: Array<{ key: string; values: unknown[] }>
): Array<Record<string, unknown>[]> {
  const matrix = expandVariantMatrix(slots)
  return matrix.map((row) =>
    editTemplates.map((tpl) => {
      const out: Record<string, unknown> = { ...tpl }
      for (const [k, v] of Object.entries(out)) {
        if (typeof v === 'string') out[k] = fillTemplate(v, row)
      }
      return out
    })
  )
}
