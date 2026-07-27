import type { GraphCatalogKind } from './types'
import { isGraphCatalogKind } from './types'
import type { GraphCatalogValue, GraphValue } from './execute/types'

export function catalogValue(
  kind: GraphCatalogKind,
  text: string,
  relativePath?: string
): GraphCatalogValue {
  return relativePath?.trim()
    ? { kind, text, relativePath: relativePath.trim() }
    : { kind, text }
}

export function isCatalogValue(
  value: GraphValue | undefined | null,
  kind?: GraphCatalogKind
): value is GraphCatalogValue {
  if (!value || !isGraphCatalogKind(value.kind)) return false
  return kind ? value.kind === kind : true
}

/** 从单个 GraphValue 取出指定目录 kind 的 JSON 正文 */
export function catalogTextFromValue(
  value: GraphValue | undefined | null,
  kind: GraphCatalogKind
): string | null {
  if (!isCatalogValue(value, kind)) return null
  const text = value.text?.trim() ?? ''
  return text || null
}

/** 从入边值列表中取第一条匹配目录 */
export function catalogTextFromInputs(
  inputs: GraphValue[] | undefined | null,
  kind: GraphCatalogKind
): string | null {
  if (!inputs?.length) return null
  for (const value of inputs) {
    const text = catalogTextFromValue(value, kind)
    if (text) return text
  }
  return null
}
