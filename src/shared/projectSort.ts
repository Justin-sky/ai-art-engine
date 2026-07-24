/**
 * Unity Project 窗口排序规则（对齐 EditorUtility.NaturalCompare + foldersFirst）。
 *
 * - 自然排序：字母序，数字段按数值比较（shot2 < shot10）
 * - 大小写不敏感
 * - 使用 en collator，与 Unity 原生 NaturalCompare 行为一致
 */
const UNITY_NATURAL_COLLATOR = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base'
})

export function unityNaturalCompare(a: string, b: string): number {
  return UNITY_NATURAL_COLLATOR.compare(a, b)
}

export type ProjectEntryKind = 'folder' | 'asset'

/** 同一目录下条目排序：默认文件夹在文件之前，组内按 NaturalCompare。 */
export function compareProjectEntries(
  a: { kind: ProjectEntryKind; name: string },
  b: { kind: ProjectEntryKind; name: string },
  foldersFirst = true
): number {
  if (foldersFirst && a.kind !== b.kind) {
    return a.kind === 'folder' ? -1 : 1
  }
  const byName = unityNaturalCompare(a.name, b.name)
  if (byName !== 0) return byName
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
  return 0
}
