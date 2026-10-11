/**
 * 市场包查找 — 纯函数（语义分析 / 编译节点共用）。
 *
 * 命名沿用历史的 `edits.ts`：这里原本还放着编辑草稿规范化与变体配方展开，
 * 那些服务的是已删除的语义编辑 / 变体节点，随管线重构一并移除。
 */
import { BUILTIN_VOCABULARIES } from './vocabulary'
import { BUILTIN_DIRECTOR_RULES } from './compiler'
import type { BeatVocabulary, DirectorRulePack, SemanticPack } from './types'

export function findVocabularyInPacks(
  packs: SemanticPack[],
  id: string | undefined
): BeatVocabulary | undefined {
  if (!id) return undefined
  for (const p of packs) {
    if (p.kind === 'vocabulary' && p.vocabulary && (p.vocabulary.id === id || p.id === id)) {
      return p.vocabulary
    }
  }
  return BUILTIN_VOCABULARIES.find((v) => v.id === id)
}

export function listVocabularies(packs: SemanticPack[]): BeatVocabulary[] {
  const out = [...BUILTIN_VOCABULARIES]
  for (const p of packs) {
    if (p.kind === 'vocabulary' && p.vocabulary && !out.some((v) => v.id === p.vocabulary!.id)) {
      out.push(p.vocabulary)
    }
  }
  return out
}

/**
 * 内置规则 + 市场规则包；ids 非空时只取命中的包（按包 id 或规则包 id）。
 */
export function collectRulePacks(packs: SemanticPack[], ids?: string[]): DirectorRulePack[] {
  const all: Array<{ packId: string; rules: DirectorRulePack }> = [
    { packId: BUILTIN_DIRECTOR_RULES.id, rules: BUILTIN_DIRECTOR_RULES }
  ]
  for (const p of packs) {
    if (p.kind === 'rules' && p.rules) all.push({ packId: p.id, rules: p.rules })
  }
  const wanted = (ids ?? []).map((s) => s.trim()).filter(Boolean)
  if (wanted.length === 0) return all.map((x) => x.rules)
  return all
    .filter((x) => wanted.includes(x.packId) || wanted.includes(x.rules.id))
    .map((x) => x.rules)
}
